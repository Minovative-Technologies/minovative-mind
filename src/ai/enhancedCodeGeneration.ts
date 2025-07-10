import * as vscode from "vscode";
import * as path from "path";
import { AIRequestService } from "../services/aiRequestService";
import { ActiveSymbolDetailedInfo } from "../services/contextService";
import {
	IncrementalCodeUpdater,
	CodeChange,
} from "../utils/incrementalCodeUpdater";

/**
 * Real-time feedback interface for code generation
 */
interface RealTimeFeedback {
	stage: string;
	message: string;
	issues: CodeIssue[];
	suggestions: string[];
	progress: number; // 0-100
}

/**
 * Enhanced code generation with improved accuracy through:
 * 1. Better context analysis
 * 2. Code validation and refinement
 * 3. Dependency analysis
 * 4. Style consistency enforcement
 * 5. Error prevention
 * 6. Inline edit support for precise modifications
 * 7. Real-time feedback loop for immediate validation
 */
export class EnhancedCodeGenerator {
	constructor(
		private aiRequestService: AIRequestService,
		private workspaceRoot: vscode.Uri,
		private config: {
			enableInlineEdits?: boolean;
			inlineEditFallbackThreshold?: number;
			enableRealTimeFeedback?: boolean;
			maxFeedbackIterations?: number;
		} = {}
	) {
		// Set defaults
		this.config.enableInlineEdits = this.config.enableInlineEdits ?? true;
		this.config.inlineEditFallbackThreshold =
			this.config.inlineEditFallbackThreshold ?? 0.3;
		this.config.enableRealTimeFeedback =
			this.config.enableRealTimeFeedback ?? true;
		this.config.maxFeedbackIterations = this.config.maxFeedbackIterations ?? 5;
	}

	/**
	 * Enhanced file content generation with real-time feedback loop
	 */
	public async generateFileContent(
		filePath: string,
		generatePrompt: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
		},
		modelName: string,
		token?: vscode.CancellationToken,
		feedbackCallback?: (feedback: RealTimeFeedback) => void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		if (this.config.enableRealTimeFeedback) {
			return this._generateWithRealTimeFeedback(
				filePath,
				generatePrompt,
				context,
				modelName,
				token,
				feedbackCallback
			);
		} else {
			// Fallback to original method
			const initialContent = await this._generateInitialContent(
				filePath,
				generatePrompt,
				context,
				modelName,
				token
			);

			const validation = await this._validateAndRefineContent(
				filePath,
				initialContent,
				context,
				modelName,
				token
			);

			return {
				content: validation.finalContent,
				validation,
			};
		}
	}

	/**
	 * Enhanced file modification with intelligent diff analysis and inline edit support
	 */
	public async modifyFileContent(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
		},
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<{ content: string; validation: CodeValidationResult }> {
		// Try incremental updates first if enabled
		if (this.config.enableInlineEdits) {
			try {
				const incrementalChanges =
					await IncrementalCodeUpdater.generateMinimalChanges(
						currentContent,
						modificationPrompt,
						{
							projectContext: context.projectContext,
							relevantSnippets: context.relevantSnippets,
							filePath: filePath,
						},
						this.aiRequestService,
						modelName,
						token
					);

				if (incrementalChanges.length > 0) {
					// Apply incremental changes to generate the final content
					const modifiedContent = this._applyIncrementalChangesToContent(
						currentContent,
						incrementalChanges
					);

					// Validate the result
					const validation = await this._validateCode(
						filePath,
						modifiedContent
					);

					return {
						content: modifiedContent,
						validation: {
							...validation,
							incrementalChanges: incrementalChanges,
							usedIncrementalUpdates: true,
						},
					};
				}
			} catch (error) {
				console.warn(
					"Incremental update generation failed, falling back to inline edits:",
					error
				);
			}
		}

		// Try inline edits as fallback
		if (this.config.enableInlineEdits) {
			try {
				const inlineResult = await this.generateInlineEditInstructions(
					filePath,
					modificationPrompt,
					currentContent,
					context,
					modelName,
					token
				);

				if (
					inlineResult.editInstructions.length > 0 &&
					inlineResult.validation.isValid
				) {
					// Apply inline edits to generate the final content
					const modifiedContent = this._applyInlineEditsToContent(
						currentContent,
						inlineResult.editInstructions
					);

					// Validate the result
					const validation = await this._validateCode(
						filePath,
						modifiedContent
					);

					return {
						content: modifiedContent,
						validation: {
							...validation,
							editInstructions: inlineResult.editInstructions,
							usedInlineEdits: true,
						},
					};
				}
			} catch (error) {
				console.warn(
					"Inline edit generation failed, falling back to full file modification:",
					error
				);
			}
		}

		// Fallback to original full file modification
		return this._modifyFileContentFull(
			filePath,
			modificationPrompt,
			currentContent,
			context,
			modelName,
			token
		);
	}

	/**
	 * Generate initial content with enhanced context analysis
	 */
	private async _generateInitialContent(
		filePath: string,
		generatePrompt: string,
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<string> {
		const fileExtension = path.extname(filePath);
		const languageId = this._getLanguageId(fileExtension);

		// Enhanced prompt with better context analysis
		const enhancedPrompt = this._createEnhancedGenerationPrompt(
			filePath,
			generatePrompt,
			context,
			languageId
		);

		const content = await this.aiRequestService.generateWithRetry(
			enhancedPrompt,
			modelName,
			undefined,
			"enhanced file generation",
			undefined,
			undefined,
			token
		);

		return content;
	}

	/**
	 * Create enhanced generation prompt with better context analysis
	 */
	private _createEnhancedGenerationPrompt(
		filePath: string,
		generatePrompt: string,
		context: any,
		languageId: string
	): string {
		const fileAnalysis = this._analyzeFilePath(filePath);
		const styleGuide = this._getStyleGuide(languageId);

		return `You are an expert software engineer specializing in ${languageId} development. Your task is to generate production-ready, accurate code.

**CRITICAL REQUIREMENTS:**
1. **Accuracy First**: Ensure all imports, types, and dependencies are correctly specified
2. **Style Consistency**: Follow the project's existing coding patterns and conventions
3. **Error Prevention**: Generate code that compiles and runs without errors
4. **Best Practices**: Use modern language features and industry standards
5. **Security**: Implement secure coding practices appropriate for the language

**File Analysis:**
- Path: ${filePath}
- Language: ${languageId}
- Framework: ${fileAnalysis.framework}
- Project Structure: ${fileAnalysis.projectStructure}
- Expected Patterns: ${fileAnalysis.expectedPatterns}

**Style Guide for ${languageId}:**
${styleGuide}

**Generation Instructions:**
${generatePrompt}

**Project Context:**
${context.projectContext}

**Relevant Code Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Information:**
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

**IMPORTANT:**
- Ensure all imports are correct and necessary
- Follow the project's naming conventions
- Use appropriate error handling
- Include proper type definitions for TypeScript
- Make the code modular and maintainable
- Consider performance implications
- Add appropriate comments for complex logic

Generate ONLY the file content without any markdown formatting or explanations:`;
	}

	/**
	 * Validate and refine generated content
	 */
	private async _validateAndRefineContent(
		filePath: string,
		content: string,
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<CodeValidationResult> {
		const validation = await this._validateCode(filePath, content);

		if (validation.isValid) {
			return {
				isValid: true,
				finalContent: content,
				issues: [],
				suggestions: validation.suggestions,
			};
		}

		// Refine content if validation failed
		const refinedContent = await this._refineContent(
			filePath,
			content,
			validation.issues,
			context,
			modelName,
			token
		);

		const finalValidation = await this._validateCode(filePath, refinedContent);

		return {
			isValid: finalValidation.isValid,
			finalContent: refinedContent,
			issues: finalValidation.issues,
			suggestions: finalValidation.suggestions,
		};
	}

	/**
	 * Validate code for common issues
	 */
	private async _validateCode(
		filePath: string,
		content: string
	): Promise<CodeValidationResult> {
		const issues: CodeIssue[] = [];
		const suggestions: string[] = [];
		const fileExtension = path.extname(filePath);
		const languageId = this._getLanguageId(fileExtension);

		// Check for common issues based on language
		if (languageId === "typescript" || languageId === "javascript") {
			// Check for missing imports
			const importIssues = this._checkImportIssues(content, filePath);
			issues.push(...importIssues);

			// Check for syntax issues
			const syntaxIssues = this._checkSyntaxIssues(content, languageId);
			issues.push(...syntaxIssues);

			// Check for best practices
			const bestPracticeIssues = this._checkBestPractices(content, languageId);
			issues.push(...bestPracticeIssues);
		}

		// Check for security issues
		const securityIssues = this._checkSecurityIssues(content, languageId);
		issues.push(...securityIssues);

		// Generate suggestions for improvement
		if (issues.length === 0) {
			suggestions.push(
				"Code appears to be well-structured and follows best practices"
			);
		} else {
			suggestions.push(
				"Consider addressing the identified issues for better code quality"
			);
		}

		return {
			isValid: issues.length === 0,
			finalContent: content,
			issues,
			suggestions,
		};
	}

	/**
	 * Refine content based on validation issues
	 */
	private async _refineContent(
		filePath: string,
		content: string,
		issues: CodeIssue[],
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<string> {
		const refinementPrompt = `The generated code has the following issues that need to be fixed:

**Issues to Address:**
${issues
	.map((issue) => `- ${issue.type}: ${issue.message} (Line ${issue.line})`)
	.join("\n")}

**Original Content:**
\`\`\`${this._getLanguageId(path.extname(filePath))}
${content}
\`\`\`

**Refinement Instructions:**
- Fix all identified issues
- Maintain the original functionality
- Ensure code compiles and runs correctly
- Follow the project's coding standards

**Project Context:**
${context.projectContext}

Provide ONLY the corrected file content without any markdown formatting:`;

		return await this.aiRequestService.generateWithRetry(
			refinementPrompt,
			modelName,
			undefined,
			"code refinement",
			undefined,
			undefined,
			token
		);
	}

	/**
	 * Analyze file path for framework and structure information
	 */
	private _analyzeFilePath(filePath: string): FileAnalysis {
		const segments = filePath.split("/");
		const fileName = path.basename(filePath);
		const extension = path.extname(filePath);

		let framework = "unknown";
		let projectStructure = "unknown";
		let expectedPatterns = "standard";

		// Detect framework based on path structure
		if (segments.includes("pages") || segments.includes("app")) {
			framework = "Next.js";
			projectStructure = "pages/app router";
		} else if (segments.includes("src") && segments.includes("components")) {
			framework = "React";
			projectStructure = "src-based";
		} else if (segments.includes("src") && segments.includes("services")) {
			framework = "Node.js/Express";
			projectStructure = "service-oriented";
		}

		// Detect patterns based on file location
		if (segments.includes("components")) {
			expectedPatterns = "React component patterns";
		} else if (segments.includes("utils") || segments.includes("helpers")) {
			expectedPatterns = "utility function patterns";
		} else if (segments.includes("services")) {
			expectedPatterns = "service layer patterns";
		}

		return {
			framework,
			projectStructure,
			expectedPatterns,
			fileName,
			extension,
		};
	}

	/**
	 * Get language-specific style guide
	 */
	private _getStyleGuide(languageId: string): string {
		const guides: Record<string, string> = {
			typescript: `
- Use TypeScript strict mode
- Prefer interfaces over types for object shapes
- Use async/await over Promises
- Use const assertions where appropriate
- Prefer arrow functions for callbacks
- Use optional chaining and nullish coalescing
- Export named exports over default exports
- Use proper type annotations`,
			javascript: `
- Use ES6+ features (const, let, arrow functions)
- Prefer async/await over Promises
- Use optional chaining and nullish coalescing
- Use template literals over string concatenation
- Prefer arrow functions for callbacks
- Use proper JSDoc comments for documentation`,
			python: `
- Follow PEP 8 style guide
- Use type hints where appropriate
- Use f-strings over .format()
- Use list/dict comprehensions
- Prefer pathlib over os.path
- Use proper docstrings`,
			java: `
- Follow Java naming conventions
- Use proper access modifiers
- Implement equals() and hashCode() together
- Use try-with-resources for resource management
- Prefer Optional over null
- Use proper JavaDoc comments`,
		};

		return (
			guides[languageId] ||
			"Follow standard coding conventions for the language"
		);
	}

	/**
	 * Get language ID from file extension
	 */
	private _getLanguageId(extension: string): string {
		const languageMap: Record<string, string> = {
			".ts": "typescript",
			".tsx": "typescript",
			".js": "javascript",
			".jsx": "javascript",
			".py": "python",
			".java": "java",
			".cs": "csharp",
			".cpp": "cpp",
			".c": "c",
			".go": "go",
			".rs": "rust",
			".php": "php",
			".rb": "ruby",
			".swift": "swift",
			".kt": "kotlin",
		};

		return languageMap[extension] || "text";
	}

	/**
	 * Check for import-related issues
	 */
	private _checkImportIssues(content: string, filePath: string): CodeIssue[] {
		const issues: CodeIssue[] = [];
		const lines = content.split("\n");

		// Check for unused imports (basic check)
		const importLines = lines.filter((line) =>
			line.trim().startsWith("import")
		);
		const usedIdentifiers = this._extractUsedIdentifiers(content);

		for (let i = 0; i < importLines.length; i++) {
			const importLine = importLines[i];
			const importedItems = this._extractImportedItems(importLine);

			for (const item of importedItems) {
				if (!usedIdentifiers.includes(item)) {
					issues.push({
						type: "unused_import",
						message: `Unused import: ${item}`,
						line: lines.indexOf(importLine) + 1,
						severity: "warning",
					});
				}
			}
		}

		return issues;
	}

	/**
	 * Check for syntax issues
	 */
	private _checkSyntaxIssues(content: string, languageId: string): CodeIssue[] {
		const issues: CodeIssue[] = [];

		// Basic syntax checks
		if (languageId === "typescript" || languageId === "javascript") {
			// Check for missing semicolons (basic check)
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (
					line &&
					!line.endsWith(";") &&
					!line.endsWith("{") &&
					!line.endsWith("}") &&
					!line.startsWith("//")
				) {
					// This is a very basic check - in practice, you'd use a proper parser
					if (
						line.includes("=") ||
						line.includes("return") ||
						line.includes("const") ||
						line.includes("let")
					) {
						issues.push({
							type: "syntax",
							message: "Consider adding semicolon",
							line: i + 1,
							severity: "warning",
						});
					}
				}
			}
		}

		return issues;
	}

	/**
	 * Check for best practices
	 */
	private _checkBestPractices(
		content: string,
		languageId: string
	): CodeIssue[] {
		const issues: CodeIssue[] = [];

		if (languageId === "typescript" || languageId === "javascript") {
			// Check for console.log in production code
			if (content.includes("console.log(")) {
				issues.push({
					type: "best_practice",
					message: "Consider removing console.log statements for production",
					line: 0,
					severity: "warning",
				});
			}

			// Check for proper error handling
			if (
				content.includes("async") &&
				!content.includes("try") &&
				!content.includes("catch")
			) {
				issues.push({
					type: "best_practice",
					message: "Consider adding proper error handling for async operations",
					line: 0,
					severity: "warning",
				});
			}
		}

		return issues;
	}

	/**
	 * Check for security issues
	 */
	private _checkSecurityIssues(
		content: string,
		languageId: string
	): CodeIssue[] {
		const issues: CodeIssue[] = [];

		// Check for potential security issues
		const securityPatterns = [
			{ pattern: "eval(", message: "Avoid using eval() for security reasons" },
			{
				pattern: "innerHTML",
				message: "Be careful with innerHTML to prevent XSS",
			},
			{
				pattern: "document.write",
				message: "Avoid document.write for security reasons",
			},
		];

		for (const { pattern, message } of securityPatterns) {
			if (content.includes(pattern)) {
				issues.push({
					type: "security",
					message,
					line: 0,
					severity: "warning",
				});
			}
		}

		return issues;
	}

	/**
	 * Extract used identifiers from content
	 */
	private _extractUsedIdentifiers(content: string): string[] {
		// This is a simplified implementation
		// In practice, you'd use a proper AST parser
		const identifiers: string[] = [];
		const regex = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
		const matches = content.match(regex) || [];

		for (const match of matches) {
			if (
				![
					"const",
					"let",
					"var",
					"function",
					"class",
					"import",
					"export",
					"from",
					"as",
				].includes(match)
			) {
				identifiers.push(match);
			}
		}

		return [...new Set(identifiers)];
	}

	/**
	 * Extract imported items from import statement
	 */
	private _extractImportedItems(importLine: string): string[] {
		const items: string[] = [];

		// Handle different import patterns
		const patterns = [
			/import\s*{\s*([^}]+)\s*}\s*from/,
			/import\s+(\w+)\s+from/,
			/import\s+(\w+)/,
			/import\s*{\s*([^}]+)\s*}/,
		];

		for (const pattern of patterns) {
			const match = importLine.match(pattern);
			if (match) {
				const imported = match[1].split(",").map((item) => item.trim());
				items.push(...imported);
			}
		}

		return items;
	}

	/**
	 * Analyze file structure for modification context
	 */
	private async _analyzeFileStructure(
		filePath: string,
		content: string
	): Promise<FileStructureAnalysis> {
		const lines = content.split("\n");
		const structure: FileStructureAnalysis = {
			imports: [],
			exports: [],
			functions: [],
			classes: [],
			variables: [],
			comments: [],
		};

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();

			if (line.startsWith("import ")) {
				structure.imports.push({ line: i + 1, content: line });
			} else if (line.startsWith("export ")) {
				structure.exports.push({ line: i + 1, content: line });
			} else if (line.includes("function ") || line.includes("=>")) {
				structure.functions.push({ line: i + 1, content: line });
			} else if (line.includes("class ")) {
				structure.classes.push({ line: i + 1, content: line });
			} else if (
				line.includes("const ") ||
				line.includes("let ") ||
				line.includes("var ")
			) {
				structure.variables.push({ line: i + 1, content: line });
			} else if (line.startsWith("//") || line.startsWith("/*")) {
				structure.comments.push({ line: i + 1, content: line });
			}
		}

		return structure;
	}

	/**
	 * Generate modification with enhanced context
	 */
	private async _generateModification(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		fileAnalysis: FileStructureAnalysis,
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<string> {
		const enhancedPrompt = this._createEnhancedModificationPrompt(
			filePath,
			modificationPrompt,
			currentContent,
			fileAnalysis,
			context
		);

		return await this.aiRequestService.generateWithRetry(
			enhancedPrompt,
			modelName,
			undefined,
			"enhanced file modification",
			undefined,
			undefined,
			token
		);
	}

	/**
	 * Create enhanced modification prompt
	 */
	private _createEnhancedModificationPrompt(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		fileAnalysis: FileStructureAnalysis,
		context: any
	): string {
		const languageId = this._getLanguageId(path.extname(filePath));

		return `You are an expert software engineer. Your task is to modify the existing file according to the provided instructions.

**CRITICAL REQUIREMENTS:**
1. **Preserve Existing Structure**: Maintain the current file organization and patterns
2. **Accurate Modifications**: Make only the requested changes
3. **Maintain Imports**: Keep all necessary imports and add new ones as needed
4. **Consistent Style**: Follow the existing code style and conventions
5. **Error Prevention**: Ensure the modified code compiles and runs correctly

**File Path:** ${filePath}
**Language:** ${languageId}

**Current File Structure:**
- Imports: ${fileAnalysis.imports.length} lines
- Exports: ${fileAnalysis.exports.length} lines  
- Functions: ${fileAnalysis.functions.length} functions
- Classes: ${fileAnalysis.classes.length} classes
- Variables: ${fileAnalysis.variables.length} variables

**Modification Instructions:**
${modificationPrompt}

**Current File Content:**
\`\`\`${languageId}
${currentContent}
\`\`\`

**Project Context:**
${context.projectContext}

**Relevant Code Snippets:**
${context.relevantSnippets}

**IMPORTANT:**
- Make only the requested modifications
- Preserve all existing functionality
- Maintain the existing code structure and style
- Add necessary imports if new dependencies are used
- Ensure the code remains functional and error-free
- Follow the project's coding conventions

Provide ONLY the complete modified file content without any markdown formatting or explanations:`;
	}

	/**
	 * Validate and refine modification
	 */
	private async _validateAndRefineModification(
		filePath: string,
		originalContent: string,
		modifiedContent: string,
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<CodeValidationResult> {
		// Check if the modification is reasonable
		const diffAnalysis = this._analyzeDiff(originalContent, modifiedContent);

		if (diffAnalysis.isReasonable) {
			const validation = await this._validateCode(filePath, modifiedContent);
			return {
				isValid: validation.isValid,
				finalContent: modifiedContent,
				issues: validation.issues,
				suggestions: validation.suggestions,
			};
		}

		// If the modification seems unreasonable, try to refine it
		const refinedContent = await this._refineModification(
			filePath,
			originalContent,
			modifiedContent,
			diffAnalysis.issues,
			context,
			modelName,
			token
		);

		const finalValidation = await this._validateCode(filePath, refinedContent);

		return {
			isValid: finalValidation.isValid,
			finalContent: refinedContent,
			issues: finalValidation.issues,
			suggestions: finalValidation.suggestions,
		};
	}

	/**
	 * Analyze the diff between original and modified content
	 */
	private _analyzeDiff(original: string, modified: string): DiffAnalysis {
		const originalLines = original.split("\n");
		const modifiedLines = modified.split("\n");

		const issues: string[] = [];
		let isReasonable = true;

		// Check if the modification is too drastic
		const originalLength = originalLines.length;
		const modifiedLength = modifiedLines.length;
		const changeRatio =
			Math.abs(modifiedLength - originalLength) / originalLength;

		if (changeRatio > 0.8) {
			issues.push(
				"Modification seems too drastic - consider a more targeted approach"
			);
			isReasonable = false;
		}

		// Check if essential structure is preserved
		const originalImports = originalLines.filter((line) =>
			line.trim().startsWith("import")
		);
		const modifiedImports = modifiedLines.filter((line) =>
			line.trim().startsWith("import")
		);

		if (originalImports.length > 0 && modifiedImports.length === 0) {
			issues.push("All imports were removed - this may be incorrect");
			isReasonable = false;
		}

		return {
			isReasonable,
			issues,
			changeRatio,
		};
	}

	/**
	 * Refine modification based on diff analysis
	 */
	private async _refineModification(
		filePath: string,
		originalContent: string,
		modifiedContent: string,
		issues: string[],
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<string> {
		const refinementPrompt = `The modification seems to have issues that need to be addressed:

**Issues with the modification:**
${issues.map((issue) => `- ${issue}`).join("\n")}

**Original Content:**
\`\`\`${this._getLanguageId(path.extname(filePath))}
${originalContent}
\`\`\`

**Current Modification:**
\`\`\`${this._getLanguageId(path.extname(filePath))}
${modifiedContent}
\`\`\`

**Refinement Instructions:**
- Make a more targeted modification
- Preserve the existing structure and imports
- Make only the necessary changes
- Ensure the modification is reasonable and functional

**Project Context:**
${context.projectContext}

Provide ONLY the refined file content without any markdown formatting:`;

		return await this.aiRequestService.generateWithRetry(
			refinementPrompt,
			modelName,
			undefined,
			"modification refinement",
			undefined,
			undefined,
			token
		);
	}

	/**
	 * Generate inline edit instructions for precise file modifications
	 */
	public async generateInlineEditInstructions(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
		},
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<{
		editInstructions: InlineEditInstruction[];
		validation: CodeValidationResult;
	}> {
		// Step 1: Analyze the current file structure
		const fileAnalysis = await this._analyzeFileStructure(
			filePath,
			currentContent
		);

		// Step 2: Generate inline edit instructions
		const editInstructions = await this._generateInlineEditInstructions(
			filePath,
			modificationPrompt,
			currentContent,
			fileAnalysis,
			context,
			modelName,
			token
		);

		// Step 3: Validate the edit instructions
		const validation = await this._validateInlineEditInstructions(
			filePath,
			currentContent,
			editInstructions,
			context,
			modelName,
			token
		);

		return {
			editInstructions,
			validation,
		};
	}

	/**
	 * Generate specific inline edit instructions
	 */
	private async _generateInlineEditInstructions(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		fileAnalysis: FileStructureAnalysis,
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<InlineEditInstruction[]> {
		const languageId = this._getLanguageId(path.extname(filePath));

		const prompt = `You are an expert software engineer. Your task is to generate PRECISE inline edit instructions for modifying an existing file.

**CRITICAL REQUIREMENTS:**
1. **Generate ONLY edit instructions** - do NOT rewrite the entire file
2. **Be extremely specific** - provide exact line numbers and text changes
3. **Minimal changes only** - make only the necessary modifications
4. **Preserve existing structure** - keep all other code unchanged
5. **Follow VS Code edit format** - use ranges and replacement text

**File Path:** ${filePath}
**Language:** ${languageId}

**Current File Structure:**
- Total Lines: ${currentContent.split("\n").length}
- Imports: ${fileAnalysis.imports.length} lines
- Functions: ${fileAnalysis.functions.length} functions
- Classes: ${fileAnalysis.classes.length} classes
- Variables: ${fileAnalysis.variables.length} variables

**Modification Request:**
${modificationPrompt}

**Current File Content:**
\`\`\`${languageId}
${currentContent}
\`\`\`

**Project Context:**
${context.projectContext}

**Relevant Code Snippets:**
${context.relevantSnippets}

**TASK:** Generate a JSON array of precise edit instructions. Each instruction should specify:
- startLine: The starting line number (1-based)
- endLine: The ending line number (1-based)
- newText: The exact text to replace the specified range
- description: Brief description of what this edit does

**IMPORTANT:**
- Use exact line numbers from the current file
- Provide complete replacement text for each range
- Make minimal, surgical changes
- Preserve indentation and formatting
- Include only the changes needed

**OUTPUT FORMAT:**
Return ONLY a JSON array like this:
[
  {
    "startLine": 15,
    "endLine": 15,
    "newText": "  const newVariable = 'value';",
    "description": "Add new variable declaration"
  },
  {
    "startLine": 25,
    "endLine": 30,
    "newText": "function updatedFunction() {\n  // new implementation\n}",
    "description": "Update function implementation"
  }
]

Generate ONLY the JSON array of edit instructions:`;

		const response = await this.aiRequestService.generateWithRetry(
			prompt,
			modelName,
			undefined,
			"inline edit instructions generation",
			{
				responseMimeType: "application/json",
				temperature: 0.1, // Low temperature for precise instructions
			},
			undefined,
			token
		);

		try {
			const editInstructions = JSON.parse(response) as InlineEditInstruction[];
			return this._validateAndRefineEditInstructions(
				editInstructions,
				currentContent
			);
		} catch (error) {
			console.error("Failed to parse edit instructions:", error);
			// Fallback to generating a single edit instruction
			return this._generateFallbackEditInstruction(
				filePath,
				modificationPrompt,
				currentContent,
				context,
				modelName,
				token
			);
		}
	}

	/**
	 * Validate and refine edit instructions
	 */
	private _validateAndRefineEditInstructions(
		instructions: InlineEditInstruction[],
		currentContent: string
	): InlineEditInstruction[] {
		const lines = currentContent.split("\n");
		const validatedInstructions: InlineEditInstruction[] = [];

		for (const instruction of instructions) {
			// Validate line numbers
			if (instruction.startLine < 1 || instruction.endLine > lines.length) {
				console.warn(
					`Invalid line range: ${instruction.startLine}-${instruction.endLine}`
				);
				continue;
			}

			// Validate that startLine <= endLine
			if (instruction.startLine > instruction.endLine) {
				console.warn(`Invalid line range: start > end`);
				continue;
			}

			// Validate newText is not empty for non-deletion edits
			if (
				!instruction.newText.trim() &&
				instruction.startLine !== instruction.endLine
			) {
				console.warn(`Empty newText for non-deletion edit`);
				continue;
			}

			validatedInstructions.push(instruction);
		}

		return validatedInstructions;
	}

	/**
	 * Generate fallback edit instruction if JSON parsing fails
	 */
	private async _generateFallbackEditInstruction(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<InlineEditInstruction[]> {
		const languageId = this._getLanguageId(path.extname(filePath));

		const fallbackPrompt = `The previous attempt to generate precise edit instructions failed. Please provide a simple, single edit instruction.

**File:** ${filePath}
**Language:** ${languageId}
**Request:** ${modificationPrompt}

**Current Content:**
\`\`\`${languageId}
${currentContent}
\`\`\`

**Task:** Provide ONE edit instruction in this exact format:
{
  "startLine": [line number],
  "endLine": [line number], 
  "newText": "[exact replacement text]",
  "description": "[brief description]"
}

Return ONLY the JSON object:`;

		const response = await this.aiRequestService.generateWithRetry(
			fallbackPrompt,
			modelName,
			undefined,
			"fallback edit instruction",
			{
				responseMimeType: "application/json",
				temperature: 0.1,
			},
			undefined,
			token
		);

		try {
			const instruction = JSON.parse(response) as InlineEditInstruction;
			return this._validateAndRefineEditInstructions(
				[instruction],
				currentContent
			);
		} catch (error) {
			console.error("Fallback edit instruction generation failed:", error);
			return [];
		}
	}

	/**
	 * Validate inline edit instructions
	 */
	private async _validateInlineEditInstructions(
		filePath: string,
		currentContent: string,
		editInstructions: InlineEditInstruction[],
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<CodeValidationResult> {
		const issues: CodeIssue[] = [];
		const suggestions: string[] = [];

		// Check if edit instructions are reasonable
		if (editInstructions.length === 0) {
			issues.push({
				type: "other",
				message: "No edit instructions generated",
				line: 0,
				severity: "error",
			});
			return {
				isValid: false,
				finalContent: currentContent,
				issues,
				suggestions: [
					"Consider providing more specific modification instructions",
				],
			};
		}

		// Check for overlapping edits
		const sortedEdits = [...editInstructions].sort(
			(a, b) => a.startLine - b.startLine
		);
		for (let i = 0; i < sortedEdits.length - 1; i++) {
			const current = sortedEdits[i];
			const next = sortedEdits[i + 1];

			if (current.endLine >= next.startLine) {
				issues.push({
					type: "other",
					message: `Overlapping edits detected: lines ${current.startLine}-${current.endLine} and ${next.startLine}-${next.endLine}`,
					line: current.startLine,
					severity: "error",
				});
			}
		}

		// Check if edits are too extensive
		const totalLines = currentContent.split("\n").length;
		const totalEditLines = editInstructions.reduce(
			(sum, edit) => sum + (edit.endLine - edit.startLine + 1),
			0
		);

		if (totalEditLines > totalLines * 0.3) {
			// More than 30% of file
			issues.push({
				type: "other",
				message: `Edit instructions modify too much of the file (${Math.round(
					(totalEditLines / totalLines) * 100
				)}%)`,
				line: 0,
				severity: "warning",
			});
		}

		if (issues.length === 0) {
			suggestions.push(
				"Edit instructions appear to be well-targeted and reasonable"
			);
		} else {
			suggestions.push(
				"Consider refining the edit instructions to address the identified issues"
			);
		}

		return {
			isValid: issues.length === 0,
			finalContent: currentContent, // We don't apply edits here, just validate
			issues,
			suggestions,
		};
	}

	/**
	 * Apply inline edits to content string
	 */
	private _applyInlineEditsToContent(
		content: string,
		editInstructions: InlineEditInstruction[]
	): string {
		const lines = content.split("\n");
		const sortedEdits = [...editInstructions].sort(
			(a, b) => a.startLine - b.startLine
		);

		// Apply edits in reverse order to maintain line numbers
		for (let i = sortedEdits.length - 1; i >= 0; i--) {
			const edit = sortedEdits[i];
			const startLine = Math.max(0, edit.startLine - 1);
			const endLine = Math.max(0, edit.endLine - 1);

			// Replace the specified lines
			const newLines = edit.newText.split("\n");
			lines.splice(startLine, endLine - startLine + 1, ...newLines);
		}

		return lines.join("\n");
	}

	/**
	 * Apply incremental changes to content
	 */
	private _applyIncrementalChangesToContent(
		content: string,
		changes: CodeChange[]
	): string {
		const lines = content.split("\n");
		const sortedChanges = [...changes].sort(
			(a, b) => b.range.start.line - a.range.start.line
		); // Sort in reverse order to maintain line numbers

		for (const change of sortedChanges) {
			const startLine = change.range.start.line;
			const endLine = change.range.end.line;
			const startChar = change.range.start.character;
			const endChar = change.range.end.character;

			if (change.type === "insert") {
				// Insert new text at the specified position
				const newLines = change.newText.split("\n");
				if (newLines.length === 1) {
					// Single line insertion
					const line = lines[startLine] || "";
					const before = line.substring(0, startChar);
					const after = line.substring(startChar);
					lines[startLine] = before + change.newText + after;
				} else {
					// Multi-line insertion
					const firstLine = lines[startLine] || "";
					const before = firstLine.substring(0, startChar);
					const after = firstLine.substring(startChar);

					lines[startLine] = before + newLines[0];
					lines.splice(startLine + 1, 0, ...newLines.slice(1, -1));
					if (newLines.length > 1) {
						lines.splice(
							startLine + newLines.length - 1,
							0,
							newLines[newLines.length - 1] + after
						);
					}
				}
			} else if (change.type === "delete") {
				// Delete the specified range
				if (startLine === endLine) {
					// Same line deletion
					const line = lines[startLine] || "";
					lines[startLine] =
						line.substring(0, startChar) + line.substring(endChar);
				} else {
					// Multi-line deletion
					const firstLine = lines[startLine] || "";
					const lastLine = lines[endLine] || "";
					lines[startLine] =
						firstLine.substring(0, startChar) + lastLine.substring(endChar);
					lines.splice(startLine + 1, endLine - startLine);
				}
			} else if (change.type === "replace" || change.type === "modify") {
				// Replace the specified range
				if (startLine === endLine) {
					// Same line replacement
					const line = lines[startLine] || "";
					lines[startLine] =
						line.substring(0, startChar) +
						change.newText +
						line.substring(endChar);
				} else {
					// Multi-line replacement
					const firstLine = lines[startLine] || "";
					const lastLine = lines[endLine] || "";
					const newLines = change.newText.split("\n");

					lines[startLine] = firstLine.substring(0, startChar) + newLines[0];
					lines.splice(
						startLine + 1,
						endLine - startLine,
						...newLines.slice(1, -1)
					);
					if (newLines.length > 1) {
						lines[startLine + newLines.length - 1] =
							newLines[newLines.length - 1] + lastLine.substring(endChar);
					}
				}
			}
		}

		return lines.join("\n");
	}

	/**
	 * Original full file modification method (fallback)
	 */
	private async _modifyFileContentFull(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
		},
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<{ content: string; validation: CodeValidationResult }> {
		// Step 1: Analyze current file structure and dependencies
		const fileAnalysis = await this._analyzeFileStructure(
			filePath,
			currentContent
		);

		// Step 2: Generate modification with enhanced context
		const modifiedContent = await this._generateModification(
			filePath,
			modificationPrompt,
			currentContent,
			fileAnalysis,
			context,
			modelName,
			token
		);

		// Step 3: Validate and refine the modification
		const validation = await this._validateAndRefineModification(
			filePath,
			currentContent,
			modifiedContent,
			context,
			modelName,
			token
		);

		return {
			content: validation.finalContent,
			validation: {
				...validation,
				usedInlineEdits: false,
			},
		};
	}

	/**
	 * Heuristically determines if the AI's raw text output is likely an error message
	 * instead of valid code/content.
	 * @param content The raw string content generated by the AI.
	 * @returns True if the content is likely an error message, false otherwise.
	 */
	private _isAIOutputLikelyErrorMessage(content: string): boolean {
		const lowerContent = content.toLowerCase().trim();

		// Common phrases indicating an AI error or inability to perform a task
		const errorPhrases = [
			"i am sorry",
			"i'm sorry",
			"i cannot fulfill this request",
			"i encountered an error",
			"i ran into an issue",
			"an error occurred",
			"i am unable to provide",
			"please try again",
			"i couldn't generate",
			"i'm having trouble",
			"error:",
			"failure:",
			"exception:",
			"i can't",
			"i am not able to",
			"as an ai model", // Often precedes an explanation for not being able to do something
			"i lack the ability to",
			"insufficient information",
			"invalid request",
			"not enough context",
		];

		// Common system/API error phrases that might be passed through
		const systemErrorPhrases = [
			"access denied",
			"file not found",
			"permission denied",
			"timeout",
			"rate limit",
			"quota exceeded",
			"server error",
			"api error",
		];

		// Combine all phrases
		const allErrorPhrases = [...errorPhrases, ...systemErrorPhrases];

		if (allErrorPhrases.some((phrase) => lowerContent.includes(phrase))) {
			return true;
		}

		// Heuristic for very short content that looks like an error
		// E.g., if it's less than 200 characters and contains keywords like "error", "fail", "issue"
		if (
			content.length < 200 &&
			(lowerContent.includes("error") ||
				lowerContent.includes("fail") ||
				lowerContent.includes("issue"))
		) {
			return true;
		}

		// Safety net: check for markdown code blocks that explicitly contain error-like text.
		// This is for cases where markdown stripping might fail or AI incorrectly wraps an error in a code block.
		const markdownErrorPattern =
			/```(?:[a-zA-Z0-9]+)?\s*(error|fail|exception|apology|i am sorry)[\s\S]*?```/i;
		if (markdownErrorPattern.test(content)) {
			return true;
		}

		return false;
	}

	/**
	 * Generate content with real-time feedback loop
	 */
	private async _generateWithRealTimeFeedback(
		filePath: string,
		generatePrompt: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
		},
		modelName: string,
		token?: vscode.CancellationToken,
		feedbackCallback?: (feedback: RealTimeFeedback) => void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		let currentContent = "";
		let iteration = 0;
		let totalIssues = 0;
		let resolvedIssues = 0;

		// Send initial feedback
		this._sendFeedback(feedbackCallback, {
			stage: "initialization",
			message: "Starting code generation with real-time validation...",
			issues: [],
			suggestions: [
				"Analyzing project context",
				"Preparing generation strategy",
			],
			progress: 0,
		});

		try {
			// Step 1: Generate initial content
			this._sendFeedback(feedbackCallback, {
				stage: "generation",
				message: "Generating initial code structure...",
				issues: [],
				suggestions: ["Creating file structure", "Adding imports"],
				progress: 20,
			});

			currentContent = await this._generateInitialContent(
				filePath,
				generatePrompt,
				context,
				modelName,
				token
			);

			// Step 2: Real-time validation and correction loop
			while (iteration < this.config.maxFeedbackIterations!) {
				if (token?.isCancellationRequested) {
					throw new Error("Operation cancelled");
				}

				iteration++;
				this._sendFeedback(feedbackCallback, {
					stage: "validation",
					message: `Validating code (iteration ${iteration}/${this.config.maxFeedbackIterations})...`,
					issues: [],
					suggestions: [
						"Checking syntax",
						"Validating imports",
						"Analyzing structure",
					],
					progress: 20 + iteration * 15,
				});

				// Validate current content
				const validation = await this._validateCode(filePath, currentContent);
				const currentIssues = validation.issues.length;

				if (currentIssues === 0) {
					// No issues found, we're done
					this._sendFeedback(feedbackCallback, {
						stage: "completion",
						message: "Code generation completed successfully!",
						issues: [],
						suggestions: validation.suggestions,
						progress: 100,
					});

					return {
						content: currentContent,
						validation: {
							...validation,
							finalContent: currentContent,
							iterations: iteration,
							totalIssues: totalIssues,
							resolvedIssues: resolvedIssues,
						},
					};
				}

				// Track issues
				totalIssues += currentIssues;

				this._sendFeedback(feedbackCallback, {
					stage: "correction",
					message: `Found ${currentIssues} issues, applying corrections...`,
					issues: validation.issues,
					suggestions: [
						"Fixing syntax errors",
						"Correcting imports",
						"Improving structure",
					],
					progress: 20 + iteration * 15,
				});

				// Apply corrections
				const correctedContent = await this._applyRealTimeCorrections(
					filePath,
					currentContent,
					validation.issues,
					context,
					modelName,
					token
				);

				// Check if corrections actually improved the code
				const correctedValidation = await this._validateCode(
					filePath,
					correctedContent
				);
				const correctedIssues = correctedValidation.issues.length;

				if (correctedIssues < currentIssues) {
					// Corrections helped
					resolvedIssues += currentIssues - correctedIssues;
					currentContent = correctedContent;

					this._sendFeedback(feedbackCallback, {
						stage: "improvement",
						message: `Resolved ${
							currentIssues - correctedIssues
						} issues (${correctedIssues} remaining)...`,
						issues: correctedValidation.issues,
						suggestions: correctedValidation.suggestions,
						progress: 20 + iteration * 15,
					});
				} else if (correctedIssues === currentIssues) {
					// No improvement, try different approach
					this._sendFeedback(feedbackCallback, {
						stage: "alternative",
						message: "Trying alternative correction approach...",
						issues: validation.issues,
						suggestions: ["Using different strategy", "Analyzing patterns"],
						progress: 20 + iteration * 15,
					});

					const alternativeContent = await this._applyAlternativeCorrections(
						filePath,
						currentContent,
						validation.issues,
						context,
						modelName,
						token
					);

					const alternativeValidation = await this._validateCode(
						filePath,
						alternativeContent
					);

					if (alternativeValidation.issues.length < currentIssues) {
						currentContent = alternativeContent;
						resolvedIssues +=
							currentIssues - alternativeValidation.issues.length;
					} else {
						// No improvement with alternative approach, break to avoid infinite loop
						break;
					}
				} else {
					// Corrections made things worse, revert and break
					this._sendFeedback(feedbackCallback, {
						stage: "revert",
						message:
							"Corrections made issues worse, reverting to previous version...",
						issues: validation.issues,
						suggestions: [
							"Using previous version",
							"Manual review recommended",
						],
						progress: 20 + iteration * 15,
					});
					break;
				}
			}

			// Final validation
			const finalValidation = await this._validateCode(
				filePath,
				currentContent
			);

			this._sendFeedback(feedbackCallback, {
				stage: "final",
				message: `Code generation completed with ${finalValidation.issues.length} remaining issues`,
				issues: finalValidation.issues,
				suggestions: finalValidation.suggestions,
				progress: 100,
			});

			return {
				content: currentContent,
				validation: {
					...finalValidation,
					finalContent: currentContent,
					iterations: iteration,
					totalIssues: totalIssues,
					resolvedIssues: resolvedIssues,
				},
			};
		} catch (error) {
			this._sendFeedback(feedbackCallback, {
				stage: "error",
				message: `Code generation failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
				issues: [],
				suggestions: [
					"Check error details",
					"Try again with different approach",
				],
				progress: 100,
			});

			throw error;
		}
	}

	/**
	 * Apply real-time corrections based on validation issues
	 */
	private async _applyRealTimeCorrections(
		filePath: string,
		content: string,
		issues: CodeIssue[],
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<string> {
		// Group issues by type for targeted correction
		const syntaxIssues = issues.filter((i) => i.type === "syntax");
		const importIssues = issues.filter((i) => i.type === "unused_import");
		const practiceIssues = issues.filter((i) => i.type === "best_practice");
		const securityIssues = issues.filter((i) => i.type === "security");

		let correctedContent = content;

		// Apply corrections in order of priority
		if (syntaxIssues.length > 0) {
			correctedContent = await this._correctSyntaxIssues(
				filePath,
				correctedContent,
				syntaxIssues,
				context,
				modelName,
				token
			);
		}

		if (importIssues.length > 0) {
			correctedContent = await this._correctImportIssues(
				filePath,
				correctedContent,
				importIssues,
				context,
				modelName,
				token
			);
		}

		if (practiceIssues.length > 0) {
			correctedContent = await this._correctPracticeIssues(
				filePath,
				correctedContent,
				practiceIssues,
				context,
				modelName,
				token
			);
		}

		if (securityIssues.length > 0) {
			correctedContent = await this._correctSecurityIssues(
				filePath,
				correctedContent,
				securityIssues,
				context,
				modelName,
				token
			);
		}

		return correctedContent;
	}

	/**
	 * Apply alternative correction strategy when standard corrections fail
	 */
	private async _applyAlternativeCorrections(
		filePath: string,
		content: string,
		issues: CodeIssue[],
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<string> {
		const alternativePrompt = `The code has the following issues that need to be fixed using a different approach:

**Issues to Address:**
${issues
	.map((issue) => `- ${issue.type}: ${issue.message} (Line ${issue.line})`)
	.join("\n")}

**Current Content:**
\`\`\`${this._getLanguageId(path.extname(filePath))}
${content}
\`\`\`

**Alternative Correction Strategy:**
- Use a completely different approach to fix these issues
- Consider architectural changes if needed
- Focus on the root cause rather than symptoms
- Ensure the solution is more robust and maintainable

**Project Context:**
${context.projectContext}

Provide ONLY the corrected file content without any markdown formatting:`;

		return await this.aiRequestService.generateWithRetry(
			alternativePrompt,
			modelName,
			undefined,
			"alternative code correction",
			undefined,
			undefined,
			token
		);
	}

	/**
	 * Correct syntax issues
	 */
	private async _correctSyntaxIssues(
		filePath: string,
		content: string,
		issues: CodeIssue[],
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<string> {
		const syntaxPrompt = `Fix the following syntax issues in the code:

**Syntax Issues:**
${issues.map((issue) => `- Line ${issue.line}: ${issue.message}`).join("\n")}

**Current Content:**
\`\`\`${this._getLanguageId(path.extname(filePath))}
${content}
\`\`\`

**Correction Instructions:**
- Fix all syntax errors
- Ensure proper language syntax
- Maintain the original functionality
- Keep the code structure intact

**Project Context:**
${context.projectContext}

Provide ONLY the corrected file content without any markdown formatting:`;

		return await this.aiRequestService.generateWithRetry(
			syntaxPrompt,
			modelName,
			undefined,
			"syntax correction",
			undefined,
			undefined,
			token
		);
	}

	/**
	 * Correct import issues
	 */
	private async _correctImportIssues(
		filePath: string,
		content: string,
		issues: CodeIssue[],
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<string> {
		const importPrompt = `Fix the following import issues in the code:

**Import Issues:**
${issues.map((issue) => `- Line ${issue.line}: ${issue.message}`).join("\n")}

**Current Content:**
\`\`\`${this._getLanguageId(path.extname(filePath))}
${content}
\`\`\`

**Correction Instructions:**
- Remove unused imports
- Add missing imports
- Fix import paths
- Ensure all imports are necessary and correct

**Project Context:**
${context.projectContext}

Provide ONLY the corrected file content without any markdown formatting:`;

		return await this.aiRequestService.generateWithRetry(
			importPrompt,
			modelName,
			undefined,
			"import correction",
			undefined,
			undefined,
			token
		);
	}

	/**
	 * Correct best practice issues
	 */
	private async _correctPracticeIssues(
		filePath: string,
		content: string,
		issues: CodeIssue[],
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<string> {
		const practicePrompt = `Fix the following best practice issues in the code:

**Best Practice Issues:**
${issues.map((issue) => `- Line ${issue.line}: ${issue.message}`).join("\n")}

**Current Content:**
\`\`\`${this._getLanguageId(path.extname(filePath))}
${content}
\`\`\`

**Correction Instructions:**
- Follow coding best practices
- Improve code readability
- Use proper naming conventions
- Apply design patterns where appropriate
- Ensure code is maintainable

**Project Context:**
${context.projectContext}

Provide ONLY the corrected file content without any markdown formatting:`;

		return await this.aiRequestService.generateWithRetry(
			practicePrompt,
			modelName,
			undefined,
			"best practice correction",
			undefined,
			undefined,
			token
		);
	}

	/**
	 * Correct security issues
	 */
	private async _correctSecurityIssues(
		filePath: string,
		content: string,
		issues: CodeIssue[],
		context: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<string> {
		const securityPrompt = `Fix the following security issues in the code:

**Security Issues:**
${issues.map((issue) => `- Line ${issue.line}: ${issue.message}`).join("\n")}

**Current Content:**
\`\`\`${this._getLanguageId(path.extname(filePath))}
${content}
\`\`\`

**Correction Instructions:**
- Fix all security vulnerabilities
- Use secure coding practices
- Validate inputs properly
- Handle sensitive data correctly
- Follow security best practices

**Project Context:**
${context.projectContext}

Provide ONLY the corrected file content without any markdown formatting:`;

		return await this.aiRequestService.generateWithRetry(
			securityPrompt,
			modelName,
			undefined,
			"security correction",
			undefined,
			undefined,
			token
		);
	}

	/**
	 * Send feedback to callback if provided
	 */
	private _sendFeedback(
		callback?: (feedback: RealTimeFeedback) => void,
		feedback?: RealTimeFeedback
	): void {
		if (callback && feedback) {
			try {
				callback(feedback);
			} catch (error) {
				console.warn("Error in feedback callback:", error);
			}
		}
	}
}

/**
 * Interfaces for enhanced code generation
 */
export interface CodeValidationResult {
	isValid: boolean;
	finalContent: string;
	issues: CodeIssue[];
	suggestions: string[];
	editInstructions?: InlineEditInstruction[];
	usedInlineEdits?: boolean;
	incrementalChanges?: CodeChange[];
	usedIncrementalUpdates?: boolean;
	iterations?: number;
	totalIssues?: number;
	resolvedIssues?: number;
}

export interface CodeIssue {
	type: "syntax" | "unused_import" | "best_practice" | "security" | "other";
	message: string;
	line: number;
	severity: "error" | "warning" | "info";
}

export interface FileAnalysis {
	framework: string;
	projectStructure: string;
	expectedPatterns: string;
	fileName: string;
	extension: string;
}

export interface FileStructureAnalysis {
	imports: Array<{ line: number; content: string }>;
	exports: Array<{ line: number; content: string }>;
	functions: Array<{ line: number; content: string }>;
	classes: Array<{ line: number; content: string }>;
	variables: Array<{ line: number; content: string }>;
	comments: Array<{ line: number; content: string }>;
}

export interface DiffAnalysis {
	isReasonable: boolean;
	issues: string[];
	changeRatio: number;
}

export interface InlineEditInstruction {
	startLine: number;
	endLine: number;
	newText: string;
	description: string;
}

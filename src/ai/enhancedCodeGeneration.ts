import * as vscode from "vscode";
import * as path from "path";
import { AIRequestService } from "../services/aiRequestService";
import { intelligentlySummarizeFileContent } from "../context/fileContentProcessor";
import { ActiveSymbolDetailedInfo } from "../services/contextService";

/**
 * Enhanced code generation with improved accuracy through:
 * 1. Better context analysis
 * 2. Code validation and refinement
 * 3. Dependency analysis
 * 4. Style consistency enforcement
 * 5. Error prevention
 */
export class EnhancedCodeGenerator {
	constructor(
		private aiRequestService: AIRequestService,
		private workspaceRoot: vscode.Uri
	) {}

	/**
	 * Enhanced file content generation with validation and refinement
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
		token?: vscode.CancellationToken
	): Promise<{ content: string; validation: CodeValidationResult }> {
		// Step 1: Generate initial content with enhanced context
		const initialContent = await this._generateInitialContent(
			filePath,
			generatePrompt,
			context,
			modelName,
			token
		);

		// Step 2: Validate and refine the generated content
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

	/**
	 * Enhanced file modification with intelligent diff analysis
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
			validation,
		};
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
}

/**
 * Interfaces for enhanced code generation
 */
export interface CodeValidationResult {
	isValid: boolean;
	finalContent: string;
	issues: CodeIssue[];
	suggestions: string[];
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

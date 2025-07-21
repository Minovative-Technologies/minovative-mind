import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { AIRequestService } from "../services/aiRequestService";
import { ActiveSymbolDetailedInfo } from "../services/contextService";
import { cleanCodeOutput } from "../utils/codeUtils";
import { DiagnosticService, getSeverityName } from "../utils/diagnosticUtils"; // MODIFIED: Added getSeverityName
import { ExtensionToWebviewMessages } from "../sidebar/common/sidebarTypes";

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

export interface CodeValidationResult {
	isValid: boolean;
	finalContent: string;
	issues: CodeIssue[];
	suggestions: string[];
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
		private postMessageToWebview: (message: ExtensionToWebviewMessages) => void,
		private config: {
			enableRealTimeFeedback?: boolean;
			maxFeedbackIterations?: number;
		} = {}
	) {
		// Set defaults
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
		feedbackCallback?: (feedback: RealTimeFeedback) => void,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		const languageId = this._getLanguageId(path.extname(filePath));
		const streamId = crypto.randomUUID();

		this.postMessageToWebview({
			type: "codeFileStreamStart",
			value: { streamId: streamId, filePath: filePath, languageId: languageId },
		});

		try {
			if (this.config.enableRealTimeFeedback) {
				const result = await this._generateWithRealTimeFeedback(
					filePath,
					generatePrompt,
					context,
					modelName,
					streamId,
					token,
					feedbackCallback,
					onCodeChunkCallback
				);
				this.postMessageToWebview({
					type: "codeFileStreamEnd",
					value: { streamId: streamId, filePath: filePath, success: true },
				});
				return result;
			} else {
				const initialContent = await this._generateInitialContent(
					filePath,
					generatePrompt,
					context,
					modelName,
					streamId,
					token,
					onCodeChunkCallback
				);

				const validation = await this._validateAndRefineContent(
					filePath,
					initialContent,
					context,
					modelName,
					streamId,
					token,
					onCodeChunkCallback
				);

				const result = {
					content: validation.finalContent,
					validation,
				};
				this.postMessageToWebview({
					type: "codeFileStreamEnd",
					value: { streamId: streamId, filePath: filePath, success: true },
				});
				return result;
			}
		} catch (error: any) {
			this.postMessageToWebview({
				type: "codeFileStreamEnd",
				value: {
					streamId: streamId,
					filePath: filePath,
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
			});
			throw error;
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
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		const languageId = this._getLanguageId(path.extname(filePath));
		const streamId = crypto.randomUUID();

		this.postMessageToWebview({
			type: "codeFileStreamStart",
			value: { streamId: streamId, filePath: filePath, languageId: languageId },
		});

		try {
			const result = await this._modifyFileContentFull(
				filePath,
				modificationPrompt,
				currentContent,
				context,
				modelName,
				streamId,
				token,
				onCodeChunkCallback
			);
			this.postMessageToWebview({
				type: "codeFileStreamEnd",
				value: { streamId: streamId, filePath: filePath, success: true },
			});
			return result;
		} catch (error: any) {
			this.postMessageToWebview({
				type: "codeFileStreamEnd",
				value: {
					streamId: streamId,
					filePath: filePath,
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
			});
			throw error;
		}
	}

	/**
	 * Generate initial content with enhanced context analysis
	 */
	private async _generateInitialContent(
		filePath: string,
		generatePrompt: string,
		context: any,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
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

		try {
			const rawContent = await this.aiRequestService.generateWithRetry(
				enhancedPrompt,
				modelName,
				undefined,
				"enhanced file generation",
				undefined,
				{
					onChunk: async (chunk: string) => {
						this.postMessageToWebview({
							type: "codeFileStreamChunk",
							value: { streamId: streamId, filePath: filePath, chunk: chunk },
						});
						if (onCodeChunkCallback) {
							await onCodeChunkCallback(chunk);
						}
					},
				},
				token
			);

			return cleanCodeOutput(rawContent);
		} catch (error: any) {
			throw error;
		}
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
1. **Accuracy First**: Ensure all imports, types, and dependencies are *absolutely* correct and precisely specified. Verify module paths, type definitions, and API usage.
2. **Style Consistency**: Adhere * rigorously* to the project's existing coding patterns, conventions, and formatting. Maintain current indentation, naming, and structural choices.
3. **Error Prevention**: Generate code that will compile and run *without any errors or warnings*. Proactively identify and mitigate potential runtime issues, logical flaws, and edge cases.
4. **Best Practices**: Employ modern language features, established design patterns, and industry best practices to ensure high-quality, efficient, and robust code.
5. **Security**: Implement secure coding practices meticulously, identifying and addressing potential vulnerabilities relevant to the language and context.

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

Your response MUST contain **ONLY** the file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE GENERATED CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;
	}

	/**
	 * Validate and refine generated content
	 */
	private async _validateAndRefineContent(
		filePath: string,
		content: string,
		context: any,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
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
			streamId,
			token,
			onCodeChunkCallback
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
		let hasError = false;

		const fileUri = vscode.Uri.file(filePath);
		const diagnostics = DiagnosticService.getDiagnosticsForUri(fileUri);

		for (const diag of diagnostics) {
			const severityName = getSeverityName(diag.severity);
			let issueSeverity: CodeIssue["severity"];
			let issueType: CodeIssue["type"];

			// Map VS Code severity to CodeIssue severity
			if (severityName === "Error") {
				issueSeverity = "error";
				hasError = true;
			} else if (severityName === "Warning") {
				issueSeverity = "warning";
			} else {
				issueSeverity = "info";
			}

			// Map VS Code diagnostic to CodeIssue type (prioritize specific types, then broad categories)
			const messageLower = diag.message.toLowerCase();
			if (messageLower.includes("unused import")) {
				issueType = "unused_import";
			} else if (
				issueSeverity === "error" ||
				issueSeverity === "warning" ||
				messageLower.includes("syntax") ||
				messageLower.includes("compilation") ||
				messageLower.includes("lint")
			) {
				issueType = "syntax"; // General compilation/linting issues
			} else if (messageLower.includes("security")) {
				issueType = "security"; // Explicitly map security if mentioned
			} else if (messageLower.includes("best practice")) {
				issueType = "best_practice"; // Explicitly map best practice if mentioned
			} else {
				issueType = "other"; // General fallback
			}

			issues.push({
				type: issueType,
				message: diag.message,
				line: diag.range.start.line + 1, // VS Code diagnostics are 0-indexed, CodeIssue is 1-indexed
				severity: issueSeverity,
			});
		}

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
			isValid: !hasError, // isValid is false if any error diagnostic is found
			finalContent: content, // content is not modified by this method
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
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const languageId = this._getLanguageId(path.extname(filePath));
		const refinementPrompt = `The generated code has the following **VS Code-reported compilation/linting issues** that need to be fixed:

**Issues to Address:**
${issues
	.map((issue) => {
		const snippet = this._getCodeSnippet(content, issue.line);
		return `**Severity:** ${issue.severity.toUpperCase()}\n**Type:** ${
			issue.type
		}\n**Message:** ${
			issue.message
		}\n**Code Snippet:**\n\`\`\`${languageId}\n${snippet}\n\`\`\``;
	})
	.join("\n\n")}

**Original Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Refinement Instructions:**
- **Absolute Comprehensive Issue Resolution:** Fix *every single identified issue* meticulously, ensuring perfectly valid, error-free code.
- **Surgical Precision & Minimal Changes:** Stress focused, targeted changes to resolve specific issues, forbidding unrelated refactoring, reformatting, or cosmetic changes unless essential.
- **Import Correctness:** Verify and correct all imports. Ensure all necessary imports are present, and eliminate any unused or redundant ones.
- **Variable and Type Usage:** Reinforce correct variable declarations, scope, and accurate TypeScript types.
- **Functionality Preservation:** Ensure original or intended new functionality is perfectly maintained.
- **Compile and Runtime Errors:** Demand code that compiles and runs *without any errors or warnings*, proactively identifying and mitigating potential runtime issues, logical flaws, and edge cases (e.g., empty arrays, zero values), null/undefined checks, and off-by-one errors.
- **Code Style and Formatting:** Stricter adherence to existing project coding style and formatting conventions (indentation, spacing, line breaks, bracket placement, naming conventions), ensuring seamless integration.
- **Efficiency and Performance:** Instruct to review for code efficiency, optimizing loops, eliminating redundant computations, and choosing appropriate data structures/algorithms.
- **Modularity and Maintainability:** Ensure code is modular with clear separation of concerns, easy to read, understand, and maintain.
- **Production Readiness:** Demand the final code be production-ready, robust, and clean.
- **No Extra Text**: Ensure NO additional text, commentary, or conversational elements are present outside the pure code.

**Project Context:**
${context.projectContext}

**Active Symbol Information (if available, for context on related code and impact analysis):**
${
	context.activeSymbolInfo
		? JSON.stringify(context.activeSymbolInfo, null, 2)
		: "N/A"
}

Your response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			refinementPrompt,
			modelName,
			undefined,
			"code refinement",
			undefined,
			{
				onChunk: async (chunk: string) => {
					const currentStreamId = streamId;
					this.postMessageToWebview({
						type: "codeFileStreamChunk",
						value: {
							streamId: currentStreamId,
							filePath: filePath,
							chunk: chunk,
						},
					});
					if (onCodeChunkCallback) {
						await onCodeChunkCallback(chunk);
					}
				},
			},
			token
		);
		return cleanCodeOutput(rawContent);
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
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const enhancedPrompt = this._createEnhancedModificationPrompt(
			filePath,
			modificationPrompt,
			currentContent,
			fileAnalysis,
			context
		);

		try {
			const rawContent = await this.aiRequestService.generateWithRetry(
				enhancedPrompt,
				modelName,
				undefined,
				"enhanced file modification",
				undefined,
				{
					onChunk: async (chunk: string) => {
						this.postMessageToWebview({
							type: "codeFileStreamChunk",
							value: { streamId: streamId, filePath: filePath, chunk: chunk },
						});
						if (onCodeChunkCallback) {
							await onCodeChunkCallback(chunk);
						}
					},
				},
				token
			);
			return cleanCodeOutput(rawContent);
		} catch (error: any) {
			throw error;
		}
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

		return `You are an expert software engineer. Your task is to modify the existing file according to the provided instructions.\n\n**CRITICAL REQUIREMENTS:**\n1. **Preserve Existing Structure**: Maintain the current file organization, structural patterns, and architectural design. Do not refactor unrelated code.\n2. **Surgical Precision & Minimal Changes**: Make *only* the exact, most targeted changes required by the 'Modification Instructions'. Do not introduce extraneous refactoring, reformatting, or stylistic changes (e.g., whitespace-only changes, reordering unrelated code blocks) unless explicitly requested and essential for the modification.\n3. **No Cosmetic-Only Changes**: Your output must represent a *functional or structural change*. Do not output content that differs from the original *only* by whitespace, comments, or minor formatting.\n4. **Maintain Imports**: Maintain all *necessary* existing imports and add *only* strictly required new ones. Ensure import order is preserved unless a new logical grouping is absolutely essential for the requested modification.\n5. **Consistent Style**: Strictly follow the existing code style, formatting, and conventions of the current file.\n6. **Error Prevention**: Ensure the modified code compiles and runs *without any errors or warnings*. Proactively address potential runtime issues, logical flaws, and edge cases.\n\n**File Path:** ${filePath}\n**Language:** ${languageId}\n\n**Current File Structure:**\n- Imports: ${fileAnalysis.imports.length} lines\n- Exports: ${fileAnalysis.exports.length} lines  \n- Functions: ${fileAnalysis.functions.length} functions\n- Classes: ${fileAnalysis.classes.length} classes\n- Variables: ${fileAnalysis.variables.length} variables\n\n**Modification Instructions:**\n${modificationPrompt}\n\n**Current File Content:**\n\`\`\`${languageId}\n${currentContent}\n\`\`\`\n\n**Project Context:**\n${context.projectContext}\n\n**Relevant Code Snippets:**\n${context.relevantSnippets}\n\n**IMPORTANT:**\n- Make only the requested modifications\n- Preserve all existing functionality\n- Maintain the existing code structure and style\n- Add necessary imports if new dependencies are used\n- Ensure the code remains functional and error-free\n- Follow the project's coding conventions\n\nYour response MUST contain **ONLY** the complete modified file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE MODIFIED CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure, modified file content and nothing else.`;
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
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
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
			streamId,
			token,
			onCodeChunkCallback
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
			originalLength === 0
				? modifiedLength > 0
					? 1
					: 0
				: Math.abs(modifiedLength - originalLength) / originalLength;

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
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const refinementPrompt = `The modification seems to have issues that need to be addressed:\n\n**Issues with the modification:**\n${issues
			.map((issue) => `- ${issue}`)
			.join("\n")}\n\n**Original Content:**\n\`\`\`${this._getLanguageId(
			path.extname(filePath)
		)}\n${originalContent}\n\`\`\`\n\n**Current Modification:**\n\`\`\`${this._getLanguageId(
			path.extname(filePath)
		)}\n${modifiedContent}\n\`\`\`\n\n**Refinement Instructions:**\n- **Extreme Targeted Fixes:** Apply only the most precise and surgical fixes to address the reported issues. Do not introduce any unrelated changes or refactoring.\n- **Preserve Unchanged Code:** Absolutely preserve all surrounding code that is not directly affected by the reported issues. Avoid reformatting or touching lines that do not require modification.\n- **Minimize Diff Size:** Strive to make the diff (changes between 'Original Content' and 'Current Modification') as small and focused as possible. Avoid unnecessary line additions or deletions.\n- **Strict Style Adherence:** Strictly adhere to the original file's existing code style, formatting (indentation, spacing, line breaks, bracket placement), and naming conventions.\n- **Functionality and Correctness:** Ensure the modified code maintains all original functionality and is fully functional and error-free after correction. Specifically address any **VS Code-reported compilation/linting issues**.\n\n**Project Context:**\n${
			context.projectContext
		}\n\nYour response MUST contain **ONLY** the refined file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			refinementPrompt,
			modelName,
			undefined,
			"refine modification",
			undefined,
			{
				onChunk: async (chunk: string) => {
					this.postMessageToWebview({
						type: "codeFileStreamChunk",
						value: { streamId: streamId, filePath: filePath, chunk: chunk },
					});
					if (onCodeChunkCallback) {
						await onCodeChunkCallback(chunk);
					}
				},
			},
			token
		);
		// Clean the output to ensure it contains only valid code
		// This is a safety net to ensure no extra text is included
		return cleanCodeOutput(rawContent);
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
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
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
			streamId,
			token,
			onCodeChunkCallback
		);

		// Step 3: Validate and refine the modification
		const validation = await this._validateAndRefineModification(
			filePath,
			currentContent,
			modifiedContent,
			context,
			modelName,
			streamId,
			token,
			onCodeChunkCallback
		);

		return {
			content: validation.finalContent,
			validation: {
				...validation,
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
	 * Extracts a code snippet around a given line number.
	 * @param fullContent The full string content of the file.
	 * @param lineNumber The 1-indexed line number to center the snippet around.
	 * @param linesBefore The number of lines to include before the target line.
	 * @param linesAfter The number of lines to include after the target line.
	 * @returns A string containing the formatted code snippet.
	 */
	private _getCodeSnippet(
		fullContent: string,
		lineNumber: number,
		linesBefore: number = 2,
		linesAfter: number = 2
	): string {
		const lines = fullContent.split("\n");
		const zeroBasedLineNumber = lineNumber - 1; // Convert to 0-indexed

		const start = Math.max(0, zeroBasedLineNumber - linesBefore);
		const end = Math.min(lines.length - 1, zeroBasedLineNumber + linesAfter);

		const snippetLines: string[] = [];
		const maxLineNumLength = String(end + 1).length; // For padding

		for (let i = start; i <= end; i++) {
			const currentLineNum = i + 1; // Convert back to 1-indexed for display
			const paddedLineNum = String(currentLineNum).padStart(
				maxLineNumLength,
				" "
			);
			snippetLines.push(`${paddedLineNum}: ${lines[i]}`);
		}

		return snippetLines.join("\n");
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
		streamId: string,
		token?: vscode.CancellationToken,
		feedbackCallback?: (feedback: RealTimeFeedback) => void,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
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
				streamId,
				token,
				onCodeChunkCallback
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
					message: `Found ${currentIssues} VS Code-reported compilation/linting issues, applying corrections...`, // MODIFIED PROMPT
					issues: validation.issues,
					suggestions: [
						"Fixing syntax errors",
						"Correcting imports",
						"Improving structure",
					],
					progress: 20 + iteration * 15,
				});

				const correctedContent = await this._applyRealTimeCorrections(
					filePath,
					currentContent,
					validation.issues,
					context,
					modelName,
					streamId,
					token,
					onCodeChunkCallback
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
						streamId,
						token,
						onCodeChunkCallback
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
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const syntaxIssues = issues.filter((i) => i.type === "syntax");
		const importIssues = issues.filter((i) => i.type === "unused_import");
		const bestPracticeIssues = issues.filter((i) => i.type === "best_practice");
		const securityIssues = issues.filter((i) => i.type === "security");
		const otherIssues = issues.filter((i) => i.type === "other");

		let correctedContent = content;

		// Apply corrections in order of priority
		if (syntaxIssues.length > 0) {
			correctedContent = await this._correctSyntaxIssues(
				filePath,
				correctedContent,
				syntaxIssues,
				context,
				modelName,
				streamId,
				token,
				onCodeChunkCallback
			);
		}

		if (importIssues.length > 0) {
			correctedContent = await this._correctImportIssues(
				filePath,
				correctedContent,
				importIssues,
				context,
				modelName,
				streamId,
				token,
				onCodeChunkCallback
			);
		}

		// Combine best_practice and general 'other' issues, as they might stem from general diagnostics
		const combinedPracticeAndOtherIssues = [
			...bestPracticeIssues,
			...otherIssues,
		];
		if (combinedPracticeAndOtherIssues.length > 0) {
			correctedContent = await this._correctPracticeIssues(
				filePath,
				correctedContent,
				combinedPracticeAndOtherIssues, // Pass combined issues
				context,
				modelName,
				streamId,
				token,
				onCodeChunkCallback
			);
		}

		// Explicitly call _correctSecurityIssues, even if securityIssues array is empty based on current _validateCode mapping
		if (securityIssues.length > 0) {
			// Keep this check, though it might be empty
			correctedContent = await this._correctSecurityIssues(
				filePath,
				correctedContent,
				securityIssues, // Will be empty unless `_validateCode` explicitly maps to "security"
				context,
				modelName,
				streamId,
				token,
				onCodeChunkCallback
			);
		}

		return await this._applyAlternativeCorrections(
			filePath,
			correctedContent,
			issues, // Re-pass all issues for alternative corrections if needed
			context,
			modelName,
			streamId,
			token,
			onCodeChunkCallback
		);
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
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const alternativePrompt = `The code has the following **VS Code-reported compilation/linting issues** that need to be fixed using a different approach:\n\n**Issues to Address:**\n${issues
			.map((issue) => `- ${issue.type}: ${issue.message} (Line ${issue.line})`)
			.join("\n")}\n\n**Current Content:**\n\`\`\`${this._getLanguageId(
			path.extname(filePath)
		)}\n${content}\n\`\`\`\n\n**Alternative Correction Strategy:**\n- Use a completely different approach to fix these issues\n- Consider architectural changes if needed\n- Focus on the root cause rather than symptoms\n- Ensure the solution is more robust and maintainable\n\n**Project Context:**\n${
			context.projectContext
		}\n\nYour response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			alternativePrompt,
			modelName,
			undefined,
			"alternative code correction",
			undefined,
			{
				onChunk: async (chunk: string) => {
					this.postMessageToWebview({
						type: "codeFileStreamChunk",
						value: { streamId: streamId, filePath: filePath, chunk: chunk },
					});
					if (onCodeChunkCallback) {
						await onCodeChunkCallback(chunk);
					}
				},
			},
			token
		);
		return cleanCodeOutput(rawContent);
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
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const syntaxPrompt = `Fix the following **VS Code-reported compilation/linting issues** (syntax errors) in the code:\n\n**Syntax Issues:**\n${issues
			.map((issue) => `- Line ${issue.line}: ${issue.message}`)
			.join("\n")}\n\n**Current Content:**\n\`\`\`${this._getLanguageId(
			path.extname(filePath)
		)}\n${content}\n\`\`\`\n\n**Correction Instructions:**\n- Fix all syntax errors\n- Ensure proper language syntax\n- Maintain the original functionality\n- Keep the code structure intact\n\n**Project Context:**\n${
			context.projectContext
		}\n\nYour response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			syntaxPrompt,
			modelName,
			undefined,
			"syntax correction",
			undefined,
			{
				onChunk: async (chunk: string) => {
					this.postMessageToWebview({
						type: "codeFileStreamChunk",
						value: { streamId: streamId, filePath: filePath, chunk: chunk },
					});
					if (onCodeChunkCallback) {
						await onCodeChunkCallback(chunk);
					}
				},
			},
			token
		);
		return cleanCodeOutput(rawContent);
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
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const importPrompt = `Fix the following **VS Code-reported compilation/linting issues** (import errors/warnings) in the code:\n\n**Import Issues:**\n${issues
			.map((issue) => `- Line ${issue.line}: ${issue.message}`)
			.join("\n")}\n\n**Current Content:**\n\`\`\`${this._getLanguageId(
			path.extname(filePath)
		)}\n${content}\n\`\`\`\n\n**Correction Instructions:**\n- Remove unused imports\n- Add missing imports\n- Fix import paths\n- Ensure all imports are necessary and correct\n\n**Project Context:**\n${
			context.projectContext
		}\n\nYour response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			importPrompt,
			modelName,
			undefined,
			"import correction",
			undefined,
			{
				onChunk: async (chunk: string) => {
					this.postMessageToWebview({
						type: "codeFileStreamChunk",
						value: { streamId: streamId, filePath: filePath, chunk: chunk },
					});
					if (onCodeChunkCallback) {
						await onCodeChunkCallback(chunk);
					}
				},
			},
			token
		);
		return cleanCodeOutput(rawContent);
	}

	/**
	 * Correct best practice issues
	 */ private async _correctPracticeIssues(
		filePath: string,
		content: string,
		issues: CodeIssue[],
		context: any,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const practicePrompt = `Fix the following **VS Code-reported compilation/linting issues** (best practice or other general issues) in the code:\n\n**Issues to Address:**\n${issues
			.map(
				(issue) => `- Type: ${issue.type}, Line ${issue.line}: ${issue.message}`
			)
			.join("\n")}\n\n**Current Content:**\n\`\`\`${this._getLanguageId(
			path.extname(filePath)
		)}\n${content}\n\`\`\`\n\n**Correction Instructions:**\n- Follow coding best practices\n- Improve code readability\n- Use proper naming conventions\n- Apply design patterns where appropriate\n- Ensure code is maintainable\n- Address any other identified issues that are not syntax or import related.\n\n**Project Context:**\n${
			context.projectContext
		}\n\nYour response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			practicePrompt,
			modelName,
			undefined,
			"best practice correction",
			undefined,
			{
				onChunk: async (chunk: string) => {
					this.postMessageToWebview({
						type: "codeFileStreamChunk",
						value: { filePath: filePath, chunk: chunk, streamId: streamId },
					});
					if (onCodeChunkCallback) {
						await onCodeChunkCallback(chunk);
					}
				},
			},
			token
		);
		return cleanCodeOutput(rawContent);
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
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const securityPrompt = `Fix the following **VS Code-reported compilation/linting issues** (security vulnerabilities) in the code:\n\n**Security Issues:**\n${issues
			.map((issue) => `- Line ${issue.line}: ${issue.message}`)
			.join("\n")}\n\n**Current Content:**\n\`\`\`${this._getLanguageId(
			path.extname(filePath)
		)}\n${content}\n\`\`\`\n\n**Correction Instructions:**\n- Fix all security vulnerabilities\n- Use secure coding practices\n- Validate inputs properly\n- Handle sensitive data correctly\n- Follow security best practices\n\n**Project Context:**\n${
			context.projectContext
		}\n\nYour response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			securityPrompt,
			modelName,
			undefined,
			"security correction",
			undefined,
			{
				onChunk: async (chunk: string) => {
					this.postMessageToWebview({
						type: "codeFileStreamChunk",
						value: { streamId: streamId, filePath: filePath, chunk: chunk },
					});
					if (onCodeChunkCallback) {
						await onCodeChunkCallback(chunk);
					}
				},
			},
			token
		);
		return cleanCodeOutput(rawContent);
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

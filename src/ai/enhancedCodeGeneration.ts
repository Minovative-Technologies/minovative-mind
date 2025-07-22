import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { AIRequestService } from "../services/aiRequestService";
import { ActiveSymbolDetailedInfo } from "../services/contextService";
import { cleanCodeOutput } from "../utils/codeUtils";
import { DiagnosticService, getSeverityName } from "../utils/diagnosticUtils";
import { generateFileChangeSummary } from "../utils/diffingUtils"; // NEW: Import generateFileChangeSummary
import { ExtensionToWebviewMessages } from "../sidebar/common/sidebarTypes";
import { ProjectChangeLogger } from "../workflow/ProjectChangeLogger"; // NEW
import { RevertibleChangeSet, FileChangeEntry } from "../types/workflow"; // NEW

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
	code?: string | number; // MODIFIED: Add code property
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

// NEW: Define EnhancedGenerationContext interface
export interface EnhancedGenerationContext {
	projectContext: string;
	relevantSnippets: string;
	editorContext?: any;
	activeSymbolInfo?: ActiveSymbolDetailedInfo;
	fileStructureAnalysis?: FileStructureAnalysis;
	lastFailedCorrectionDiff?: string;
	successfulChangeHistory?: string; // NEW: Added property
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
	// NEW: Define issue ordering constants
	private readonly issueTypeOrder: CodeIssue["type"][] = [
		"syntax",
		"unused_import",
		"security",
		"best_practice",
		"other",
	];
	private readonly severityOrder: CodeIssue["severity"][] = [
		"error",
		"warning",
		"info",
	];

	constructor(
		private aiRequestService: AIRequestService,
		private workspaceRoot: vscode.Uri,
		private postMessageToWebview: (message: ExtensionToWebviewMessages) => void,
		private changeLogger: ProjectChangeLogger, // MODIFIED: Add changeLogger parameter
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
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
				[{ text: enhancedPrompt }], // Modified: Wrap prompt string in HistoryEntryPart array
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
		languageId: string
	): string {
		const fileAnalysis = this._analyzeFilePath(filePath);
		const styleGuide = this._getStyleGuide(languageId);

		return `You are an expert software engineer specializing in ${languageId} development. Your task is to generate production-ready, accurate code.

**CRITICAL REQUIREMENTS:**
1. **Accuracy First**: Ensure all imports, types, and dependencies are *absolutely* correct and precisely specified. Verify module paths, type definitions, and API usage.
2. **Style Consistency**: Adhere * rigorously* to the project's existing coding patterns, conventions, and formatting. Maintain current indentation, naming, and structural choices.
3. **Error Prevention**: Generate code that will compile and run *without any errors or warnings*. Proactively anticipate and guard against common pitfalls beyond just the immediate task, such as null/undefined checks, input validations, edge cases, and off-by-one errors.
4. **Best Practices**: Employ modern language features, established design patterns, and industry best practices to ensure high-quality, efficient, and robust code that is production-ready, maintainable, and clean.
5. **Surgical Precision & No Unrelated Changes**: DO NOT introduce extraneous refactoring, reformatting, or cosmetic alterations. Generate only the necessary new code.
6. **Security**: Implement secure coding practices meticulously, identifying and addressing potential vulnerabilities relevant to the language and context.

**File Analysis:**
- Path: ${filePath}
- Language: ${languageId}
- Framework: ${fileAnalysis.framework}
- Project Structure: ${fileAnalysis.projectStructure}
- Expected Patterns: ${fileAnalysis.expectedPatterns}

**Style Guide for ${languageId}:**
${styleGuide}
**Strict Adherence**: Rigorously follow all guidelines within this style guide to ensure seamless integration and absolute code consistency. Any deviation is considered a critical error.

**Generation Instructions:**
${generatePrompt}

**Project Context:**
${context.projectContext}

**Relevant Code Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Information:**
- **Contextual Accuracy**: Leverage this detailed information to ensure correct integration, function signatures, parameter types, class structures, and naming conventions for any generated code that interacts with these symbols.
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

${
	context.fileStructureAnalysis
		? this._formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}
${
	context.successfulChangeHistory
		? `
**Successful Change History:**
Analyze past successful patterns and apply similar effective solution strategies to new generations.
${context.successfulChangeHistory}
`
		: ""
}

**IMPORTANT:**
- Ensure all imports are correct and necessary.
- Follow the project's naming conventions.
- **Robust Error Handling**: Implement comprehensive error handling, including null/undefined checks, input validations for edge cases, and graceful handling of asynchronous failures.
- Include proper type definitions for TypeScript.
- Make the code modular and maintainable.
- **Zero Errors/Warnings**: Produce code *without any VS Code compilation or linting errors/warnings*. This is an absolute, non-negotiable requirement.
- Consider performance implications.
- Add appropriate comments for complex logic.

**CRITICAL NEGATIVE CONSTRAINT**: Your response MUST ONLY contain the code for the SINGLE target file. DO NOT include any file headers, separators, or meta-information (e.g., \`--- File: ... ---\`, \`--- Relevant File: ... ---\`, \`--- Path: ... ---\`, \`--- End File ---\`, or any form of file delimiters) in your output. Your response must **start directly with the pure code content** on the first line and **end directly with the pure code content** on the last line, with no conversational text, explanations, or extraneous elements whatsoever.

Your response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE GENERATED CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;
	}

	/**
	 * Validate and refine generated content
	 */
	private async _validateAndRefineContent(
		filePath: string,
		content: string,
		context: EnhancedGenerationContext, // MODIFIED: Change context type
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

			let issueCode: string | number | undefined;
			if (
				typeof diag.code === "object" &&
				diag.code !== null &&
				"value" in diag.code
			) {
				issueCode = (diag.code as { value: string | number }).value;
			} else if (
				typeof diag.code === "string" ||
				typeof diag.code === "number"
			) {
				issueCode = diag.code;
			}

			issues.push({
				type: issueType,
				message: diag.message,
				line: diag.range.start.line + 1, // VS Code diagnostics are 0-indexed, CodeIssue is 1-indexed
				severity: issueSeverity,
				code: issueCode, // MODIFIED: Use issueCode
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const languageId = this._getLanguageId(path.extname(filePath));
		// MODIFIED: Replace issue formatting
		const groupedAndPrioritizedIssues = this._groupAndPrioritizeIssues(issues);
		const formattedIssues = this._formatGroupedIssuesForPrompt(
			groupedAndPrioritizedIssues,
			languageId,
			content
		);

		const refinementPrompt = `The generated code has the following **VS Code-reported compilation/linting issues** that need to be fixed:

**Issues to Address:**
${formattedIssues}

**Original Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Refinement Instructions:**
-   **Surgical Precision**: Apply *only* the most targeted and minimal changes necessary to resolve the *exact* reported issues. Do not introduce any unrelated refactoring, reformatting, or cosmetic alterations.
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- **Absolute Comprehensive Issue Resolution:** Fix *every single identified issue* meticulously, ensuring perfectly valid, error-free code.
- **Import Correctness:** Verify and correct all imports. Ensure all necessary imports are present, and eliminate any unused or redundant ones.
- **Variable and Type Usage:** Reinforce correct variable declarations, scope, and accurate TypeScript types.
- **Functionality Preservation:** Ensure original or intended new functionality is perfectly maintained.
- **Compile and Runtime Errors:** Demand code that compiles and runs *without any errors or warnings*, proactively identifying and mitigating potential runtime issues, logical flaws, and edge cases (e.g., empty arrays, zero values), null/undefined checks, and off-by-one errors.
- **Code Style and Formatting:** Stricter adherence to existing project coding style and formatting conventions (indentation, spacing, line breaks, bracket placement, naming conventions), ensuring seamless integration.
- **Efficiency and Performance:** Instruct to review for code efficiency, optimizing loops, eliminating redundant computations, and choosing appropriate data structures/algorithms.
- **Modularity and Maintainability:** Ensure code is modular with clear separation of concerns, easy to read, understand, and maintain.
- **Production Readiness:** Demand the final code be production-ready, robust, and clean.

**Project Context:**
${context.projectContext}

**Relevant Code Snippets:**
${context.relevantSnippets}

**Active Symbol Information (if available, for context on related code and impact analysis):**
${
	context.activeSymbolInfo
		? JSON.stringify(context.activeSymbolInfo, null, 2)
		: "N/A"
}

${
	context.fileStructureAnalysis
		? this._formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Successful Change History:**
Identify and replicate effective solution patterns from these past successes.
${context.successfulChangeHistory}
`
		: ""
}

${
	context.lastFailedCorrectionDiff
		? `--- Previous Failed Correction Attempt Diff ---\n**CRITICAL**: Analyze this diff carefully. The previous attempt to fix issues resulted in this specific change, and it *did not improve the situation*. You MUST understand *why* the previous attempt failed, identify the unproductive changes, and devise a *fundamentally different and significantly more effective strategy* to fix the issues without reintroducing past mistakes.\n\`\`\`diff\n${context.lastFailedCorrectionDiff}\n\`\`\`\n`
		: ""
}

**CRITICAL NEGATIVE CONSTRAINT**: Your response MUST ONLY contain the code for the SINGLE target file. DO NOT include any file headers, separators, or meta-information (e.g., \`--- File: ... ---\`, \`--- Relevant File: ... ---\`, \`--- Path: ... ---\`, \`--- End File ---\`, or any form of file delimiters) in your output. Your response must **start directly with the pure code content** on the first line and **end directly with the pure code content** on the last line, with no conversational text, explanations, or extraneous elements whatsoever.

Your response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE GENERATED CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			[{ text: refinementPrompt }], // Modified: Wrap prompt string in HistoryEntryPart array
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
	 * Create Helper for Formatting `FileStructureAnalysis`
	 */
	private _formatFileStructureAnalysis(
		analysis?: FileStructureAnalysis
	): string {
		if (!analysis) {
			return "";
		}

		let formatted = "**File Structure Analysis:**\n";
		if (analysis.imports.length > 0) {
			formatted += `- Imports: ${analysis.imports.length} lines\n`;
		}
		if (analysis.exports.length > 0) {
			formatted += `- Exports: ${analysis.exports.length} lines\n`;
		}
		if (analysis.functions.length > 0) {
			formatted += `- Functions: ${analysis.functions.length} functions\n`;
		}
		if (analysis.classes.length > 0) {
			formatted += `- Classes: ${analysis.classes.length} classes\n`;
		}
		if (analysis.variables.length > 0) {
			formatted += `- Variables: ${analysis.variables.length} variables\n`;
		}
		if (analysis.comments.length > 0) {
			formatted += `- Comments: ${analysis.comments.length} lines\n`;
		}
		formatted +=
			"Analyze this structure to understand the file's organization and apply changes consistently.";
		return formatted;
	}

	/**
	 * Formats successful change sets into a concise string for AI prompts.
	 * Limits output to the last 3 change sets and 3 changes per set.
	 * @param changeSets An array of RevertibleChangeSet.
	 * @returns A formatted string summary of recent changes.
	 */
	private _formatSuccessfulChangesForPrompt(
		changeSets: RevertibleChangeSet[]
	): string {
		if (!changeSets || changeSets.length === 0) {
			return "";
		}

		const recentChangeSets = changeSets.slice(-3); // Get last 3 change sets
		let formattedHistory =
			"--- Recent Successful Project Changes (Context for AI) ---\n";

		for (const changeSet of recentChangeSets) {
			const date = new Date(changeSet.timestamp).toLocaleString();
			formattedHistory += `\n**Plan Executed on ${date} (ID: ${changeSet.id.substring(
				0,
				8
			)})**\n`;
			if (changeSet.planSummary) {
				// Changed from changeSet.summary
				formattedHistory += `Summary: ${changeSet.planSummary}\n`; // Changed from changeSet.summary
			}
			formattedHistory += `Changes:\n`;
			const limitedChanges = changeSet.changes.slice(0, 3); // Limit to last 3 changes per set
			for (const change of limitedChanges) {
				formattedHistory += `- **${change.changeType.toUpperCase()}**: \`${
					change.filePath
				}\` - ${change.summary.split("\n")[0]}\n`;
			}
			if (changeSet.changes.length > 3) {
				formattedHistory += `  ...and ${
					changeSet.changes.length - 3
				} more changes.\n`;
			}
		}
		formattedHistory += "\n--- End Recent Successful Project Changes ---\n";
		return formattedHistory;
	}

	/**
	 * Groups and prioritizes code issues for prompt generation.
	 * Issues are grouped by a combination of type, severity, and specific code (if applicable).
	 * Priorities are based on predefined orders (`issueTypeOrder`, `severityOrder`).
	 * Special handling for 'cannot find name' errors by grouping them by the missing name.
	 * @param issues An array of CodeIssue objects.
	 * @returns A Map where keys are formatted group headers and values are arrays of CodeIssue.
	 */
	private _groupAndPrioritizeIssues(
		issues: CodeIssue[]
	): Map<string, CodeIssue[]> {
		const groupedIssues = new Map<string, CodeIssue[]>();

		// Sort issues initially based on predefined order and then line number
		issues.sort((a, b) => {
			const typeOrderA = this.issueTypeOrder.indexOf(a.type);
			const typeOrderB = this.issueTypeOrder.indexOf(b.type);
			if (typeOrderA !== typeOrderB) {
				return typeOrderA - typeOrderB;
			}

			const severityOrderA = this.severityOrder.indexOf(a.severity);
			const severityOrderB = this.severityOrder.indexOf(b.severity);
			if (severityOrderA !== severityOrderB) {
				return severityOrderA - severityOrderB;
			}

			return a.line - b.line;
		});

		for (const issue of issues) {
			let groupKey = "";
			// Special grouping for 'cannot find name' errors
			if (
				issue.message.includes("Cannot find name") &&
				issue.type === "syntax" &&
				issue.severity === "error"
			) {
				const match = issue.message.match(/Cannot find name '([^']*)'/);
				const missingName = match ? match[1] : "unknown_name";
				groupKey = `TYPE: ${issue.type.toUpperCase()} / SEVERITY: ${issue.severity.toUpperCase()} / CODE: Cannot find name '${missingName}'`;
			} else {
				groupKey = `TYPE: ${issue.type.toUpperCase()} / SEVERITY: ${issue.severity.toUpperCase()}${
					issue.code ? ` / CODE: ${issue.code}` : ""
				}`;
			}

			if (!groupedIssues.has(groupKey)) {
				groupedIssues.set(groupKey, []);
			}
			groupedIssues.get(groupKey)!.push(issue);
		}

		return groupedIssues;
	}

	/**
	 * Formats grouped and prioritized issues into a Markdown string for AI prompts.
	 * @param groupedIssues A Map of grouped CodeIssue objects.
	 * @param languageId The language ID of the file (e.g., 'typescript', 'javascript').
	 * @param content The full content of the file to extract code snippets.
	 * @returns A formatted Markdown string representing the issues.
	 */
	private _formatGroupedIssuesForPrompt(
		groupedIssues: Map<string, CodeIssue[]>,
		languageId: string,
		content: string
	): string {
		let formattedString = "";

		// Sort group keys based on issue type and severity order
		const sortedGroupKeys = Array.from(groupedIssues.keys()).sort(
			(keyA, keyB) => {
				const issueTypeA =
					this.issueTypeOrder.find((type) =>
						keyA.includes(`TYPE: ${type.toUpperCase()}`)
					) || "other";
				const issueTypeB =
					this.issueTypeOrder.find((type) =>
						keyB.includes(`TYPE: ${type.toUpperCase()}`)
					) || "other";
				const typeOrderResult =
					this.issueTypeOrder.indexOf(issueTypeA as CodeIssue["type"]) -
					this.issueTypeOrder.indexOf(issueTypeB as CodeIssue["type"]);
				if (typeOrderResult !== 0) {
					return typeOrderResult;
				}

				const severityA =
					this.severityOrder.find((severity) =>
						keyA.includes(`SEVERITY: ${severity.toUpperCase()}`)
					) || "info";
				const severityB =
					this.severityOrder.find((severity) =>
						keyB.includes(`SEVERITY: ${severity.toUpperCase()}`)
					) || "info";
				return (
					this.severityOrder.indexOf(severityA as CodeIssue["severity"]) -
					this.severityOrder.indexOf(severityB as CodeIssue["severity"])
				);
			}
		);

		for (const groupKey of sortedGroupKeys) {
			const issuesInGroup = groupedIssues.get(groupKey)!;
			formattedString += `--- Issue Group: ${groupKey} ---\n`;

			// Add suggested strategy for the group
			let suggestedStrategy =
				"Review the provided code snippet and diagnostic message. Apply the most targeted fix to resolve this specific issue while adhering to all critical requirements.";
			if (groupKey.includes("Cannot find name")) {
				suggestedStrategy =
					"This group contains 'Cannot find name' errors. This often means a missing import, a typo in a variable/function name, or an undeclared variable. Carefully check imports and variable/function declarations. If it's a missing dependency, add the necessary import. If it's an undeclared variable, declare it with the correct type. If it's a typo, correct the spelling. Pay close attention to case sensitivity.";
			} else if (groupKey.includes("TYPE: UNUSED_IMPORT")) {
				suggestedStrategy =
					"This group contains unused import warnings. Remove the unused import statement to clean up the code. Ensure no other code relies on this import before removal.";
			} else if (groupKey.includes("TYPE: SECURITY")) {
				suggestedStrategy =
					"This group contains security issues. Implement secure coding practices, validate inputs, handle sensitive data correctly, and follow security best practices to mitigate these vulnerabilities.";
			} else if (groupKey.includes("TYPE: BEST_PRACTICE")) {
				suggestedStrategy =
					"This group contains best practice issues. Refine the code to align with established coding patterns, improve readability, and ensure maintainability. This might involve refactoring small sections, improving naming, or using more idiomatic language features.";
			} else if (
				groupKey.includes("TYPE: SYNTAX") &&
				groupKey.includes("ERROR")
			) {
				suggestedStrategy =
					"This group contains critical syntax errors. Focus on correcting the exact syntax mistake indicated by the message (e.g., missing semicolon, incorrect keyword, bad function signature).";
			} else if (groupKey.includes("TYPE: OTHER")) {
				suggestedStrategy =
					"This group contains general issues. Analyze the specific message and problematic code. Apply a precise fix that resolves the issue without unnecessary changes.";
			}
			formattedString += `Suggested Strategy: ${suggestedStrategy}\n`;

			for (const issue of issuesInGroup) {
				formattedString += `--- Individual Issue Details ---\n`;
				formattedString += `Severity: ${issue.severity.toUpperCase()}\n`;
				formattedString += `Type: ${issue.type}\n`;
				formattedString += `Line: ${issue.line}\n`;
				formattedString += `Message: ${issue.message}\n`;
				if (issue.code) {
					formattedString += `Issue Code: ${issue.code}\n`;
				}
				formattedString += `Problematic Code Snippet:\n`;
				formattedString += `\`\`\`${languageId}\n`;
				formattedString += `${this._getCodeSnippet(content, issue.line)}\n`;
				formattedString += `\`\`\`\n`;
				formattedString += `--- End Individual Issue Details ---\n\n`;
			}
			formattedString += "\n"; // Add extra newline between groups
		}

		return formattedString;
	}

	/**
	 * Generate modification with enhanced context
	 */
	private async _generateModification(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		context: EnhancedGenerationContext, // MODIFIED: fileAnalysis now part of context
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const enhancedPrompt = this._createEnhancedModificationPrompt(
			filePath,
			modificationPrompt,
			currentContent,
			context // MODIFIED: Pass context directly
		);

		try {
			const rawContent = await this.aiRequestService.generateWithRetry(
				[{ text: enhancedPrompt }], // Modified: Wrap prompt string in HistoryEntryPart array
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
		context: EnhancedGenerationContext // MODIFIED: fileAnalysis now part of context
	): string {
		const languageId = this._getLanguageId(path.extname(filePath));
		// MODIFIED: Get fileAnalysis from context
		const fileAnalysis = context.fileStructureAnalysis;

		return `You are an expert software engineer. Your task is to modify the existing file according to the provided instructions.\n\n**CRITICAL REQUIREMENTS:**\n1. **Preserve Existing Structure**: Maintain the current file organization, structural patterns, and architectural design without unrelated refactoring. This is paramount for seamless integration.\n2. **Surgical Precision & Minimal Changes**: Make *only* the exact, most targeted and minimal changes required by the 'Modification Instructions'. Do not introduce extraneous refactoring, reformatting, or stylistic changes (e.g., whitespace-only changes, reordering unrelated code blocks) unless explicitly requested and essential for the modification.\n3. **No Cosmetic-Only Changes**: Your output must represent a *functional or structural change*, strictly avoiding changes that are solely whitespace, comments, or minor formatting, unless explicitly requested.\n4. **Maintain Imports**: Maintain all *necessary* existing imports and add *only* strictly required new ones. Ensure import order is preserved unless a new logical grouping is absolutely essential for the requested modification.\n5. **Consistent Style**: Strictly follow the existing code style, formatting, and conventions of the current file.\n6. **Error Prevention**: Ensure the modified code compiles and runs *without any errors or warnings* and proactively address potential runtime issues, logical flaws, and edge cases (e.g., null/undefined checks, off-by-one errors, input validations).\n7. **Production Readiness**: Stress robustness, maintainability, and adherence to best practices for all modifications.\n\n**File Path:** ${filePath}\n**Language:** ${languageId}\n\n${this._formatFileStructureAnalysis(
			fileAnalysis
		)}\n\n**Modification Instructions:**\n${modificationPrompt}\n\n**Current File Content:**\n\`\`\`${languageId}\n${currentContent}\n\`\`\`\n\n**Project Context:**\n${
			context.projectContext
		}\n\n**Relevant Code Snippets:**
${context.relevantSnippets}

**Active Symbol Information (if available, for context on related code and impact analysis):**
${
	context.activeSymbolInfo
		? JSON.stringify(context.activeSymbolInfo, null, 2)
		: "N/A"
}

${
	context.successfulChangeHistory
		? `
**Successful Change History:**
Learn from previous effective modifications.
${context.successfulChangeHistory}
`
		: ""
}

**IMPORTANT:**
- Make only the requested modifications
- Preserve all existing functionality
- Maintain the existing code structure and style
- Add necessary imports if new dependencies are used
- Ensure the code remains functional and error-free
- Follow the project's coding conventions.

**CRITICAL NEGATIVE CONSTRAINT**: Your response MUST ONLY contain the code for the SINGLE target file. DO NOT include any file headers, separators, or meta-information (e.g., \`--- File: ... ---\`, \`--- Relevant File: ... ---\`, \`--- Path: ... ---\`, \`--- End File ---\`, or any form of file delimiters) in your output. Your response must **start directly with the pure code content** on the first line and **end directly with the pure code content** on the last line, with no conversational text, explanations, or extraneous elements whatsoever.

Your response MUST contain **ONLY** the modified file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE GENERATED CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;
	}

	/**
	 * Validate and refine modification
	 */
	private async _validateAndRefineModification(
		filePath: string,
		originalContent: string,
		modifiedContent: string,
		context: EnhancedGenerationContext, // MODIFIED: Change context type
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
		diffIssues: string[], // Renamed 'issues' to 'diffIssues' to avoid conflict with `issues` for `_validateCode`
		context: EnhancedGenerationContext, // MODIFIED: Change context type
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const languageId = this._getLanguageId(path.extname(filePath));
		let initialFeedback =
			"The modification seems to have issues that need to be addressed:";

		if (
			diffIssues.includes(
				"Modification seems too drastic - consider a more targeted approach"
			)
		) {
			initialFeedback +=
				"\n- **Drastic Change Detected**: The changes introduce a very high ratio of new/removed lines compared to the original content. This might indicate an unintended refactoring or deletion.";
		}
		if (
			diffIssues.includes("All imports were removed - this may be incorrect")
		) {
			initialFeedback +=
				"\n- **Import Integrity Compromised**: All imports appear to have been removed, which is highly likely to cause compilation errors.";
		}
		if (
			diffIssues.length === 0 &&
			(this._analyzeDiff(originalContent, modifiedContent).changeRatio > 0.8 ||
				this._analyzeDiff(originalContent, modifiedContent).issues.length > 0)
		) {
			// Fallback if diffIssues array is empty but diff analysis still flags issues (e.g., from initial call to _validateAndRefineModification)
			if (
				this._analyzeDiff(originalContent, modifiedContent).changeRatio > 0.8
			) {
				initialFeedback +=
					"\n- **Drastic Change Detected**: The changes introduce a very high ratio of new/removed lines compared to the original content. This might indicate an unintended refactoring or deletion.";
			}
			if (
				this._analyzeDiff(originalContent, modifiedContent).issues.includes(
					"All imports were removed - this may be incorrect"
				)
			) {
				initialFeedback +=
					"\n- **Import Integrity Compromised**: All imports appear to have been removed, which is highly likely to cause compilation errors.";
			}
		}

		const refinementPrompt = `${initialFeedback}\n\n**Issues with the modification:**\n${diffIssues
			.map((issue) => `- ${issue}`)
			.join(
				"\n"
			)}\n\n**Original Content:**\n\`\`\`${languageId}\n${originalContent}\n\`\`\`\n\n**Current Modification:**\n\`\`\`${languageId}\n${modifiedContent}\n\`\`\`\n\n**Refinement Instructions:**\n- **Revert Unintended Structural Changes**: If the modification drastically altered the file's inherent structure (e.g., deleted major components or refactored unrelated sections), revert those unintended changes.\n- **Maintain Import Integrity**: Ensure all necessary imports are present and correct. Do not remove existing imports unless they are explicitly unused by the new, correct code. Add only strictly required new imports.\n- **Targeted Changes**: For small functional changes, ensure the modification is highly localized and does not affect unrelated parts of the codebase.\n- **Extreme Targeted Fixes:** Apply only the most precise and surgical fixes to address the reported issues. Do not introduce any unrelated changes or refactoring.\n- **Preserve Unchanged Code:** Absolutely preserve all surrounding code that is not directly affected by the reported issues. Avoid reformatting or touching lines that do not require modification.\n- **Minimize Diff Size:** Strive to make the diff (changes between 'Original Content' and 'Current Modification') as small and focused as possible. Avoid unnecessary line additions or deletions.\n- **Strict Style Adherence:** Strictly adhere to the original file's existing code style, formatting (indentation, spacing, line breaks, bracket placement), and naming conventions.\n- **Functionality and Correctness:** Ensure the modified code maintains all original functionality and is fully functional and error-free after correction. Specifically address any **VS Code-reported compilation/linting issues**.\n\n**Project Context:**\n${
			context.projectContext
		}

**Relevant Code Snippets:**
${context.relevantSnippets}

**Active Symbol Information (if available, for context on related code and impact analysis):**
${
	context.activeSymbolInfo
		? JSON.stringify(context.activeSymbolInfo, null, 2)
		: "N/A"
}

${
	context.fileStructureAnalysis
		? this._formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Successful Change History:**
Identify and replicate effective solution patterns from these past successes.
${context.successfulChangeHistory}
`
		: ""
}

${
	context.lastFailedCorrectionDiff
		? `--- Previous Failed Correction Attempt Diff ---\n**CRITICAL**: Analyze this diff carefully. The previous attempt to fix issues resulted in this specific change, and it *did not improve the situation*. You MUST understand *why* the previous attempt failed, identify the unproductive changes, and devise a *fundamentally different and significantly more effective strategy* to fix the issues without reintroducing past mistakes.\n\`\`\`diff\n${context.lastFailedCorrectionDiff}\n\`\`\`\n`
		: ""
}

**CRITICAL NEGATIVE CONSTRAINT**: Your response MUST ONLY contain the code for the SINGLE target file. DO NOT include any file headers, separators, or meta-information (e.g., \`--- File: ... ---\`, \`--- Relevant File: ... ---\`, \`--- Path: ... ---\`, \`--- End File ---\`, or any form of file delimiters) in your output. Your response must **start directly with the pure code content** on the first line and **end directly with the pure code content** on the last line, with no conversational text, explanations, or extraneous elements whatsoever.

Your response MUST contain **ONLY** the modified file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE GENERATED CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			[{ text: refinementPrompt }], // Modified: Wrap prompt string in HistoryEntryPart array
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
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

		// MODIFIED: Create a new context object that includes fileStructureAnalysis and successfulChangeHistory
		const contextWithAllAnalysis: EnhancedGenerationContext = {
			...context,
			fileStructureAnalysis: fileAnalysis,
			successfulChangeHistory: this._formatSuccessfulChangesForPrompt(
				this.changeLogger.getCompletedPlanChangeSets()
			), // NEW: Populate history
		};

		// Step 2: Generate modification with enhanced context
		const modifiedContent = await this._generateModification(
			filePath,
			modificationPrompt,
			currentContent,
			contextWithAllAnalysis, // MODIFIED: Pass the new context object
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
			contextWithAllAnalysis, // MODIFIED: Pass the new context object
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
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

				// MODIFIED: Capture content before correction attempt for diff calculation
				let currentContentBeforeCorrectionAttempt = currentContent;

				// Validate current content
				const validation = await this._validateCode(filePath, currentContent);
				const currentIssues = validation.issues.length;

				// MODIFIED: Analyze file structure and update context, and add successfulChangeHistory
				const fileStructureAnalysis = await this._analyzeFileStructure(
					filePath,
					currentContent
				);
				const updatedContext: EnhancedGenerationContext = {
					...context,
					fileStructureAnalysis,
					successfulChangeHistory: this._formatSuccessfulChangesForPrompt(
						this.changeLogger.getCompletedPlanChangeSets()
					), // NEW: Populate history
				};

				if (currentIssues === 0) {
					// No issues found, we're done
					this._sendFeedback(feedbackCallback, {
						stage: "completion",
						message: "Code generation completed successfully!",
						issues: [],
						suggestions: validation.suggestions,
						progress: 100,
					});

					// MODIFIED: Clear diff on success
					context.lastFailedCorrectionDiff = undefined;

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
					updatedContext, // MODIFIED: Pass updatedContext
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
					// MODIFIED: Clear diff on success
					context.lastFailedCorrectionDiff = undefined;

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
					// MODIFIED: Calculate and store diff for failed correction
					const { formattedDiff } = await generateFileChangeSummary(
						currentContentBeforeCorrectionAttempt,
						correctedContent,
						filePath
					);
					context.lastFailedCorrectionDiff = formattedDiff;

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
						updatedContext, // MODIFIED: Pass updatedContext with potential diff
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
						// MODIFIED: Clear diff on success
						context.lastFailedCorrectionDiff = undefined;
					} else {
						// No improvement with alternative approach, break to avoid infinite loop
						// MODIFIED: Diff is already set if it came from previous `correctedIssues === currentIssues` branch
						break;
					}
				} else {
					// Corrections made things worse, revert and break
					// MODIFIED: Calculate and store diff for failed correction
					const { formattedDiff } = await generateFileChangeSummary(
						currentContentBeforeCorrectionAttempt,
						correctedContent,
						filePath
					);
					context.lastFailedCorrectionDiff = formattedDiff;

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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const languageId = this._getLanguageId(path.extname(filePath));
		// MODIFIED: Replace issue formatting
		const groupedAndPrioritizedIssues = this._groupAndPrioritizeIssues(issues);
		const formattedIssues = this._formatGroupedIssuesForPrompt(
			groupedAndPrioritizedIssues,
			languageId,
			content
		);

		const alternativePrompt = `The code has the following **VS Code-reported compilation/linting issues** that need to be fixed using a different approach:

**Issues to Address:**
${formattedIssues}

**Current Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Alternative Correction Strategy:**
-   **Surgical Precision**: Apply *only* the most targeted and minimal changes necessary to resolve the *exact* reported issues. Do not introduce any unrelated refactoring, reformatting, or cosmetic alterations.
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- Implement a genuinely different problem-solving approach to fix these issues, strictly avoiding re-attempting similar fixes that have failed or were unproductive.
- Consider architectural changes if needed
- Focus on the root cause rather than symptoms
- Ensure the solution is more robust and maintainable
- **Proactive Error Mitigation**: Anticipate and guard against common pitfalls, such as null/undefined checks, input validations, edge cases, and off-by-one errors.
- **Production Readiness**: Ensure the solution is robust, maintainable, secure, clean, and efficient, adhering to industry best practices for production-ready code.

**Project Context:**
${context.projectContext}

**Relevant Code Snippets:**
${context.relevantSnippets}

**Active Symbol Information (if available, for context on related code and impact analysis):**
${
	context.activeSymbolInfo
		? JSON.stringify(context.activeSymbolInfo, null, 2)
		: "N/A"
}

${
	context.fileStructureAnalysis
		? this._formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Successful Change History:**
Identify and replicate effective solution patterns from these past successes.
${context.successfulChangeHistory}
`
		: ""
}

${
	context.lastFailedCorrectionDiff
		? `--- Previous Failed Correction Attempt Diff ---\n**CRITICAL**: Analyze this diff carefully. The previous attempt to fix issues resulted in this specific change, and it *did not improve the situation*. You MUST understand *why* the previous attempt failed, identify the unproductive changes, and devise a *fundamentally different and significantly more effective strategy* to fix the issues without reintroducing past mistakes.\n\`\`\`diff\n${context.lastFailedCorrectionDiff}\n\`\`\`\n`
		: ""
}

**CRITICAL NEGATIVE CONSTRAINT**: Your response MUST ONLY contain the code for the SINGLE target file. DO NOT include any file headers, separators, or meta-information (e.g., \`--- File: ... ---\`, \`--- Relevant File: ... ---\`, \`--- Path: ... ---\`, \`--- End File ---\`, or any form of file delimiters) in your output. Your response must **start directly with the pure code content** on the first line and **end directly with the pure code content** on the last line, with no conversational text, explanations, or extraneous elements whatsoever.

Your response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE GENERATED CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			[{ text: alternativePrompt }], // Modified: Wrap prompt string in HistoryEntryPart array
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const languageId = this._getLanguageId(path.extname(filePath));
		// MODIFIED: Replace issue formatting
		const groupedAndPrioritizedIssues = this._groupAndPrioritizeIssues(issues);
		const formattedIssues = this._formatGroupedIssuesForPrompt(
			groupedAndPrioritizedIssues,
			languageId,
			content
		);

		const syntaxPrompt = `Fix the following **VS Code-reported compilation/linting issues** (syntax errors) in the code:

**Syntax Issues:**
${formattedIssues}

**Current Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Correction Instructions:**
- **Learn from History**: Analyze and learn from the provided Successful Change History to replicate effective solutions, and from the Previous Failed Correction Attempt Diff to understand past failures and avoid repeating unproductive strategies.
-   **Surgical Precision**: Apply *only* the most targeted and minimal changes necessary to resolve the *exact* reported issues. Do not introduce any unrelated refactoring, reformatting, or cosmetic alterations.
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- **Proactive Error Mitigation**: Beyond fixing the immediate issues, proactively prevent future occurrences where applicable, such as robust type usage, proper import organization, secure data handling, and comprehensive null/undefined checks.
- Fix all syntax errors
- Ensure proper language syntax
- Maintain the original functionality
- Keep the code structure intact

**Project Context:**
${context.projectContext}

**Relevant Code Snippets:**
${context.relevantSnippets}

**Active Symbol Information (if available, for context on related code and impact analysis):**
${
	context.activeSymbolInfo
		? JSON.stringify(context.activeSymbolInfo, null, 2)
		: "N/A"
}

${
	context.fileStructureAnalysis
		? this._formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Successful Change History:**
Identify and replicate effective solution patterns from these past successes.
${context.successfulChangeHistory}
`
		: ""
}

${
	context.lastFailedCorrectionDiff
		? `--- Previous Failed Correction Attempt Diff ---\n**CRITICAL**: Analyze this diff carefully. The previous attempt to fix issues resulted in this specific change, and it *did not improve the situation*. You MUST understand *why* the previous attempt failed, identify the unproductive changes, and devise a *fundamentally different and significantly more effective strategy* to fix the issues without reintroducing past mistakes.\n\`\`\`diff\n${context.lastFailedCorrectionDiff}\n\`\`\`\n`
		: ""
}

**CRITICAL NEGATIVE CONSTRAINT**: Your response MUST ONLY contain the code for the SINGLE target file. DO NOT include any file headers, separators, or meta-information (e.g., \`--- File: ... ---\`, \`--- Relevant File: ... ---\`, \`--- Path: ... ---\`, \`--- End File ---\`, or any form of file delimiters) in your output. Your response must **start directly with the pure code content** on the first line and **end directly with the pure code content** on the last line, with no conversational text, explanations, or extraneous elements whatsoever.

Your response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE GENERATED CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			[{ text: syntaxPrompt }], // Modified: Wrap prompt string in HistoryEntryPart array
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const languageId = this._getLanguageId(path.extname(filePath));
		// MODIFIED: Replace issue formatting
		const groupedAndPrioritizedIssues = this._groupAndPrioritizeIssues(issues);
		const formattedIssues = this._formatGroupedIssuesForPrompt(
			groupedAndPrioritizedIssues,
			languageId,
			content
		);

		const importPrompt = `Fix the following **VS Code-reported compilation/linting issues** (import errors/warnings) in the code:

**Import Issues:**
${formattedIssues}

**Current Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Correction Instructions:**
- **Learn from History**: Analyze and learn from the provided Successful Change History to replicate effective solutions, and from the Previous Failed Correction Attempt Diff to understand past failures and avoid repeating unproductive strategies.
-   **Surgical Precision**: Apply *only* the most targeted and minimal changes necessary to resolve the *exact* reported issues. Do not introduce any unrelated refactoring, reformatting, or cosmetic alterations.
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- **Proactive Error Mitigation**: Beyond fixing the immediate issues, proactively prevent future occurrences where applicable, such as robust type usage, proper import organization, secure data handling, and comprehensive null/undefined checks.
- Remove unused imports
- Add missing imports
- Fix import paths
- Ensure all imports are necessary and correct

**Project Context:**
${context.projectContext}

**Relevant Code Snippets:**
${context.relevantSnippets}

**Active Symbol Information (if available, for context on related code and impact analysis):**
${
	context.activeSymbolInfo
		? JSON.stringify(context.activeSymbolInfo, null, 2)
		: "N/A"
}

${
	context.fileStructureAnalysis
		? this._formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Successful Change History:**
Identify and replicate effective solution patterns from these past successes.
${context.successfulChangeHistory}
`
		: ""
}

${
	context.lastFailedCorrectionDiff
		? `--- Previous Failed Correction Attempt Diff ---\n**CRITICAL**: Analyze this diff carefully. The previous attempt to fix issues resulted in this specific change, and it *did not improve the situation*. You MUST understand *why* the previous attempt failed, identify the unproductive changes, and devise a *fundamentally different and significantly more effective strategy* to fix the issues without reintroducing past mistakes.\n\`\`\`diff\n${context.lastFailedCorrectionDiff}\n\`\`\`\n`
		: ""
}

**CRITICAL NEGATIVE CONSTRAINT**: Your response MUST ONLY contain the code for the SINGLE target file. DO NOT include any file headers, separators, or meta-information (e.g., \`--- File: ... ---\`, \`--- Relevant File: ... ---\`, \`--- Path: ... ---\`, \`--- End File ---\`, or any form of file delimiters) in your output. Your response must **start directly with the pure code content** on the first line and **end directly with the pure code content** on the last line, with no conversational text, explanations, or extraneous elements whatsoever.

Your response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE GENERATED CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			[{ text: importPrompt }], // Modified: Wrap prompt string in HistoryEntryPart array
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const languageId = this._getLanguageId(path.extname(filePath));
		// MODIFIED: Replace issue formatting
		const groupedAndPrioritizedIssues = this._groupAndPrioritizeIssues(issues);
		const formattedIssues = this._formatGroupedIssuesForPrompt(
			groupedAndPrioritizedIssues,
			languageId,
			content
		);

		const practicePrompt = `Fix the following **VS Code-reported compilation/linting issues** (best practice or other general issues) in the code:

**Issues to Address:**
${formattedIssues}

**Current Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Correction Instructions:**
- **Learn from History**: Analyze and learn from the provided Successful Change History to replicate effective solutions, and from the Previous Failed Correction Attempt Diff to understand past failures and avoid repeating unproductive strategies.
-   **Surgical Precision**: Apply *only* the most targeted and minimal changes necessary to resolve the *exact* reported issues. Do not introduce any unrelated refactoring, reformatting, or cosmetic alterations.
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- **Proactive Error Mitigation**: Beyond fixing the immediate issues, proactively prevent future occurrences where applicable, such as robust type usage, proper import organization, secure data handling, and comprehensive null/undefined checks.
- Follow coding best practices
- Improve code readability
- Use proper naming conventions
- Apply design patterns where appropriate
- Ensure code is maintainable
- Address any other identified issues that are not syntax or import related.

**Project Context:**
${context.projectContext}

**Relevant Code Snippets:**
${context.relevantSnippets}

**Active Symbol Information (if available, for context on related code and impact analysis):**
${
	context.activeSymbolInfo
		? JSON.stringify(context.activeSymbolInfo, null, 2)
		: "N/A"
}

${
	context.fileStructureAnalysis
		? this._formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
${context.successfulChangeHistory}
`
		: ""
}

${
	context.lastFailedCorrectionDiff
		? `--- Previous Failed Correction Attempt Diff ---\n**CRITICAL**: Analyze this diff carefully. The previous attempt to fix issues resulted in this specific change, and it *did not improve the situation*. You MUST understand *why* the previous attempt failed, identify the unproductive changes, and devise a *fundamentally different and significantly more effective strategy* to fix the issues without reintroducing past mistakes.\n\`\`\`diff\n${context.lastFailedCorrectionDiff}\n\`\`\`\n`
		: ""
}

**CRITICAL NEGATIVE CONSTRAINT**: Your response MUST ONLY contain the code for the SINGLE target file. DO NOT include any file headers, separators, or meta-information (e.g., \`--- File: ... ---\`, \`--- Relevant File: ... ---\`, \`--- Path: ... ---\`, \`--- End File ---\`, or any form of file delimiters) in your output. Your response must **start directly with the pure code content** on the first line and **end directly with the pure code content** on the last line, with no conversational text, explanations, or extraneous elements whatsoever.

Your response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE GENERATED CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			[{ text: practicePrompt }], // Modified: Wrap prompt string in HistoryEntryPart array
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
		context: EnhancedGenerationContext, // MODIFIED: Change context type
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<string> {
		const languageId = this._getLanguageId(path.extname(filePath));
		// MODIFIED: Replace issue formatting
		const groupedAndPrioritizedIssues = this._groupAndPrioritizeIssues(issues);
		const formattedIssues = this._formatGroupedIssuesForPrompt(
			groupedAndPrioritizedIssues,
			languageId,
			content
		);

		const securityPrompt = `Fix the following **VS Code-reported compilation/linting issues** (security vulnerabilities) in the code:

**Security Issues:**
${formattedIssues}

**Current Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Correction Instructions:**
- **Learn from History**: Analyze and learn from the provided Successful Change History to replicate effective solutions, and from the Previous Failed Correction Attempt Diff to understand past failures and avoid repeating unproductive strategies.
-   **Surgical Precision**: Apply *only* the most targeted and minimal changes necessary to resolve the *exact* reported issues. Do not introduce any unrelated refactoring, reformatting, or cosmetic alterations.
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- **Proactive Error Mitigation**: Beyond fixing the immediate issues, proactively prevent future occurrences where applicable, such as robust type usage, proper import organization, secure data handling, and comprehensive null/undefined checks.
- Fix all security vulnerabilities
- Use secure coding practices
- Validate inputs properly
- Handle sensitive data correctly
- Follow security best practices

**Project Context:**
${context.projectContext}

**Relevant Code Snippets:**
${context.relevantSnippets}

**Active Symbol Information (if available, for context on related code and impact analysis):**
${
	context.activeSymbolInfo
		? JSON.stringify(context.activeSymbolInfo, null, 2)
		: "N/A"
}

${
	context.fileStructureAnalysis
		? this._formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
${context.successfulChangeHistory}
`
		: ""
}

${
	context.lastFailedCorrectionDiff
		? `--- Previous Failed Correction Attempt Diff ---\n**CRITICAL**: Analyze this diff carefully. The previous attempt to fix issues resulted in this specific change, and it *did not improve the situation*. You MUST understand *why* the previous attempt failed, identify the unproductive changes, and devise a *fundamentally different and significantly more effective strategy* to fix the issues without reintroducing past mistakes.\n\`\`\`diff\n${context.lastFailedCorrectionDiff}\n\`\`\`\n`
		: ""
}

**CRITICAL NEGATIVE CONSTRAINT**: Your response MUST ONLY contain the code for the SINGLE target file. DO NOT include any file headers, separators, or meta-information (e.g., \`--- File: ... ---\`, \`--- Relevant File: ... ---\`, \`--- Path: ... ---\`, \`--- End File ---\`, or any form of file delimiters) in your output. Your response must **start directly with the pure code content** on the first line and **end directly with the pure code content** on the last line, with no conversational text, explanations, or extraneous elements whatsoever.

Your response MUST contain **ONLY** the corrected file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE GENERATED CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** The response **MUST START DIRECTLY ON THE FIRST LINE** with the pure code content and nothing else.`;

		const rawContent = await this.aiRequestService.generateWithRetry(
			[{ text: securityPrompt }], // Modified: Wrap prompt string in HistoryEntryPart array
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

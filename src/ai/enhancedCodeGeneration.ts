import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { GenerationConfig } from "@google/generative-ai";
import * as sidebarConstants from "../sidebar/common/sidebarConstants";
import { ERROR_OPERATION_CANCELLED } from "../ai/gemini";
import {
	ExecutionPlan,
	isCreateDirectoryStep,
	isCreateFileStep,
	isModifyFileStep,
	isRunCommandStep,
	parseAndValidatePlan,
	ParsedPlanResult,
	PlanStep,
	PlanStepAction,
} from "../ai/workflowPlanner";
import {
	CorrectionFeedback,
	createCorrectionPlanPrompt,
} from "./prompts/correctionPrompts";
import { applyAITextEdits } from "../utils/codeUtils";
import { generateFileChangeSummary } from "../utils/diffingUtils";
import { executeCommand, CommandResult } from "../utils/commandExecution";
import { formatUserFacingErrorMessage } from "../utils/errorFormatter";
import { EditorContext } from "../sidebar/common/sidebarTypes";
import { AIRequestService } from "../services/aiRequestService";
import {
	CodeIssue,
	CodeValidationResult,
	EnhancedGenerationContext,
	RealTimeFeedback,
	FileAnalysis,
	FileStructureAnalysis,
	CorrectionAttemptOutcome,
} from "../types/codeGenerationTypes";
import { cleanCodeOutput } from "../utils/codeUtils";
import { areIssuesSimilar } from "../utils/aiUtils";
import { ExtensionToWebviewMessages } from "../sidebar/common/sidebarTypes";
import { ProjectChangeLogger } from "../workflow/ProjectChangeLogger";
import { ContextRefresherService } from "../services/contextRefresherService";
import {
	analyzeFileStructure,
	getLanguageId,
	isRewriteIntentDetected,
} from "../utils/codeAnalysisUtils";
import { formatSuccessfulChangesForPrompt } from "../workflow/changeHistoryFormatter";
import { analyzeDiff } from "../utils/diffingUtils";
import { DiagnosticService, getSeverityName } from "../utils/diagnosticUtils";
import {
	createEnhancedGenerationPrompt,
	createEnhancedModificationPrompt,
	createRefineModificationPrompt,
} from "./prompts/enhancedCodeGenerationPrompts";
import { escapeForJsonValue } from "../utils/aiUtils";
import { CodeValidationService } from "../services/codeValidationService";

// Re-export these types to make them accessible to other modules that import from this file.
export type {
	CodeIssue,
	FileAnalysis,
	FileStructureAnalysis,
	CorrectionAttemptOutcome,
	EnhancedGenerationContext,
};

/**
 * Orchestrates the AI-driven code generation and modification process,
 * leveraging a real-time feedback loop and specialized services for accuracy and quality.
 */
export class EnhancedCodeGenerator {
	constructor(
		private aiRequestService: AIRequestService,
		private postMessageToWebview: (message: ExtensionToWebviewMessages) => void,
		private changeLogger: ProjectChangeLogger,
		private codeValidationService: CodeValidationService,
		private contextRefresherService: ContextRefresherService,
		private config: {
			enableRealTimeFeedback?: boolean;
			maxFeedbackIterations?: number;
		} = {}
	) {
		this.config.enableRealTimeFeedback =
			this.config.enableRealTimeFeedback ?? false;
		this.config.maxFeedbackIterations = this.config.maxFeedbackIterations ?? 5;
	}

	/**
	 * Enhanced file content generation with real-time feedback loop.
	 */
	public async generateFileContent(
		filePath: string,
		generatePrompt: string,
		context: EnhancedGenerationContext,
		modelName: string,
		token?: vscode.CancellationToken,
		feedbackCallback?: (feedback: RealTimeFeedback) => void,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		const languageId = getLanguageId(path.extname(filePath));
		const streamId = crypto.randomUUID();

		this.postMessageToWebview({
			type: "codeFileStreamStart",
			value: { streamId, filePath, languageId },
		});

		try {
			const isRewriteOp = isRewriteIntentDetected(generatePrompt, filePath);
			const generationContext: EnhancedGenerationContext = {
				...context,
				isRewriteOperation: isRewriteOp,
			};

			if (this.config.enableRealTimeFeedback) {
				const result = await this._generateWithRealTimeFeedback(
					filePath,
					generatePrompt,
					generationContext,
					modelName,
					streamId,
					token,
					feedbackCallback,
					onCodeChunkCallback
				);
				this.postMessageToWebview({
					type: "codeFileStreamEnd",
					value: { streamId, filePath, success: true },
				});
				return result;
			} else {
				// Fallback for non-real-time generation
				const initialResult = await this._generateInitialContent(
					filePath,
					generatePrompt,
					generationContext,
					modelName,
					streamId,
					token,
					onCodeChunkCallback
				);
				if (!initialResult.isValid) {
					return {
						content: initialResult.finalContent,
						validation: initialResult,
					};
				}
				const validation = await this.codeValidationService.validateCode(
					filePath,
					initialResult.finalContent
				);
				const result = { content: validation.finalContent, validation };
				this.postMessageToWebview({
					type: "codeFileStreamEnd",
					value: { streamId, filePath, success: true },
				});
				return result;
			}
		} catch (error: any) {
			// Check if the error message indicates cancellation (case-insensitive)
			if (
				error instanceof Error &&
				error.message.toLowerCase().includes("cancelled")
			) {
				// If it's a cancellation error, re-throw it immediately.
				// This prevents sending a redundant codeFileStreamEnd message from this layer.
				throw error;
			} else {
				// For any other type of error, post the codeFileStreamEnd message
				// to indicate failure for this specific operation, and then re-throw.
				this.postMessageToWebview({
					type: "codeFileStreamEnd",
					value: {
						streamId,
						filePath,
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
				});
				throw error; // Re-throw the error for higher-level handling
			}
		}
	}

	/**
	 * Enhanced file modification with intelligent diff analysis and real-time feedback.
	 */
	public async modifyFileContent(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		context: EnhancedGenerationContext,
		modelName: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		const languageId = getLanguageId(path.extname(filePath));
		const streamId = crypto.randomUUID();

		this.postMessageToWebview({
			type: "codeFileStreamStart",
			value: { streamId, filePath, languageId },
		});

		try {
			const isRewriteOp = isRewriteIntentDetected(modificationPrompt, filePath);
			const modificationContext: EnhancedGenerationContext = {
				...context,
				isRewriteOperation: isRewriteOp,
			};

			const result = await this._modifyFileContentFull(
				filePath,
				modificationPrompt,
				currentContent,
				modificationContext,
				modelName,
				streamId,
				token,
				onCodeChunkCallback
			);
			this.postMessageToWebview({
				type: "codeFileStreamEnd",
				value: { streamId, filePath, success: true },
			});
			return result;
		} catch (error: any) {
			// Check if the error message indicates cancellation (case-insensitive)
			if (
				error instanceof Error &&
				error.message.toLowerCase().includes("cancelled")
			) {
				// If it's a cancellation error, re-throw it immediately.
				// This prevents sending a redundant codeFileStreamEnd message from this layer.
				throw error;
			} else {
				// For any other type of error, post the codeFileStreamEnd message
				// to indicate failure for this specific operation, and then re-throw.
				this.postMessageToWebview({
					type: "codeFileStreamEnd",
					value: {
						streamId,
						filePath,
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
				});
				throw error; // Re-throw the error for higher-level handling
			}
		}
	}

	public async validateFileContent(
		fsPath: string,
		content: string
	): Promise<CodeValidationResult> {
		console.log(`[EnhancedCodeGenerator] Validating file: ${fsPath}`);
		try {
			const validationResult = await this.codeValidationService.validateCode(
				fsPath,
				content
			);
			return validationResult;
		} catch (error) {
			console.error(
				`[EnhancedCodeGenerator] Error during validation for ${fsPath}:`,
				error
			);
			// Return a default error structure if validation itself fails unexpectedly
			return {
				isValid: false,
				finalContent: content,
				issues: [
					{
						type: "other",
						line: 1,
						severity: "error",
						message: `Validation failed: ${(error as Error).message}`,
						code: "VALIDATION_ERROR",
						source: "EnhancedCodeGenerator",
					},
				],
				suggestions: [
					"An unexpected error occurred during the validation process.",
				],
			};
		}
	}

	/**
	 * Generates the initial version of the code.
	 */
	private async _generateInitialContent(
		filePath: string,
		generatePrompt: string,
		context: EnhancedGenerationContext,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<CodeValidationResult> {
		const enhancedPrompt = createEnhancedGenerationPrompt(
			filePath,
			generatePrompt,
			context
		);
		try {
			const rawContent = await this.aiRequestService.generateWithRetry(
				[{ text: enhancedPrompt }],
				modelName,
				undefined,
				"enhanced file generation",
				undefined,
				{
					onChunk: async (chunk) =>
						this._streamChunk(streamId, filePath, chunk, onCodeChunkCallback),
				},
				token
			);

			return this.codeValidationService.checkPureCodeFormat(rawContent, false);
		} catch (error: any) {
			return {
				isValid: false,
				finalContent: "",
				issues: [
					{
						type: "other",
						message: `AI generation failed: ${error.message}`,
						line: 1,
						severity: "error",
					},
				],
				suggestions: ["Check AI service status."],
			};
		}
	}

	/**
	 * Orchestrates the full modification process including generation, validation, and refinement.
	 */
	private async _modifyFileContentFull(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		context: EnhancedGenerationContext,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		const fileAnalysis = await analyzeFileStructure(filePath, currentContent);
		const contextWithAnalysis: EnhancedGenerationContext = {
			...context,
			fileStructureAnalysis: fileAnalysis,
			successfulChangeHistory: formatSuccessfulChangesForPrompt(
				this.changeLogger.getCompletedPlanChangeSets()
			),
		};

		const enhancedPrompt = createEnhancedModificationPrompt(
			filePath,
			modificationPrompt,
			currentContent,
			contextWithAnalysis
		);
		const rawContent = await this.aiRequestService.generateWithRetry(
			[{ text: enhancedPrompt }],
			modelName,
			undefined,
			"enhanced file modification",
			undefined,
			{
				onChunk: async (chunk) =>
					this._streamChunk(streamId, filePath, chunk, onCodeChunkCallback),
			},
			token
		);

		const modifiedContent = cleanCodeOutput(rawContent);

		const validation = await this._validateAndRefineModification(
			filePath,
			currentContent,
			modifiedContent,
			contextWithAnalysis,
			modelName,
			streamId,
			token,
			onCodeChunkCallback
		);

		return { content: validation.finalContent, validation };
	}

	/**
	 * Validates and refines a generated modification.
	 */
	private async _validateAndRefineModification(
		filePath: string,
		originalContent: string,
		modifiedContent: string,
		context: EnhancedGenerationContext,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<CodeValidationResult> {
		const diffAnalysis = analyzeDiff(originalContent, modifiedContent);
		if (!diffAnalysis.isReasonable) {
			const refinePrompt = createRefineModificationPrompt(
				filePath,
				originalContent,
				modifiedContent,
				diffAnalysis.issues,
				context
			);
			const rawRefinedContent = await this.aiRequestService.generateWithRetry(
				[{ text: refinePrompt }],
				modelName,
				undefined,
				"refine modification",
				undefined,
				{
					onChunk: async (chunk) =>
						this._streamChunk(streamId, filePath, chunk, onCodeChunkCallback),
				},
				token
			);

			const refinedContent = cleanCodeOutput(rawRefinedContent);
			return this.codeValidationService.validateCode(filePath, refinedContent);
		}
		return this.codeValidationService.validateCode(filePath, modifiedContent);
	}

	/**
	 * Helper for handling streaming chunks.
	 */
	private async _streamChunk(
		streamId: string,
		filePath: string,
		chunk: string,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	) {
		this.postMessageToWebview({
			type: "codeFileStreamChunk",
			value: { streamId, filePath, chunk },
		});
		if (onCodeChunkCallback) {
			await onCodeChunkCallback(chunk);
		}
	}

	/**
	 * Sends feedback to the UI callback.
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

	/**
	 * Helper method to parse and validate an AI-generated CorrectionPlan (ExecutionPlan).
	 * @param jsonString The raw JSON string from the AI.
	 * @param rootUri The workspace root URI for path validation.
	 * @returns An object containing either the parsed plan or an error message.
	 */
	private async _parseAndValidateCorrectionPlan(
		jsonString: string,
		rootUri: vscode.Uri
	): Promise<ParsedPlanResult> {
		try {
			const cleanedJsonString = jsonString
				.replace(/^\s*/im, "")
				.replace(/\s*$/im, "")
				.trim();

			const parsedResult = await parseAndValidatePlan(
				cleanedJsonString,
				rootUri
			);
			return parsedResult;
		} catch (e: any) {
			console.error(
				`[EnhancedCodeGenerator] Error parsing/validating correction plan: ${e.message}`,
				e
			);
			return { plan: null, error: `Parsing/validation failed: ${e.message}` };
		}
	}

	/**
	 * Helper method to report progress and messages related to correction steps.
	 */
	private _reportCorrectionStepProgress(
		message: string,
		index: number, // Modified signature
		totalSteps: number, // Modified signature
		isError: boolean = false,
		diffContent?: string
	): void {
		this.postMessageToWebview({
			type: "appendRealtimeModelMessage",
			value: { text: message, isError: isError },
			isPlanStepUpdate: true,
			diffContent: diffContent,
		});
		console.log(`[EnhancedCodeGenerator] Correction Step: ${message}`);
		if (isError) {
			console.error(
				`[EnhancedCodeGenerator] Correction Step Error: ${message}`
			);
		}
		if (diffContent) {
			console.log(`[EnhancedCodeGenerator] Diff/Details:\n${diffContent}`);
		}
	}

	/**
	 * Helper to format relevant files content into Markdown fenced code blocks for prompts.
	 */
	private async _formatRelevantFilesForPrompt(
		relevantFilePaths: string[],
		workspaceRootUri: vscode.Uri,
		token: vscode.CancellationToken
	): Promise<string> {
		if (!relevantFilePaths || relevantFilePaths.length === 0) {
			return "";
		}

		const formattedSnippets: string[] = [];
		const maxFileSizeForSnippet = 1024 * 1024 * 1; // 1MB limit per file

		for (const relativePath of relevantFilePaths) {
			if (token.isCancellationRequested) {
				return formattedSnippets.join("\n");
			}

			const fileUri = vscode.Uri.joinPath(workspaceRootUri, relativePath);
			let fileContent: string | null = null;
			let languageId = path.extname(relativePath).substring(1);
			if (!languageId) {
				languageId = path.basename(relativePath).toLowerCase();
			}
			if (languageId === "makefile") {
				languageId = "makefile";
			} else if (languageId === "dockerfile") {
				languageId = "dockerfile";
			} else if (languageId === "jsonc") {
				languageId = "json";
			} else if (
				languageId === "eslintignore" ||
				languageId === "prettierignore" ||
				languageId === "gitignore"
			) {
				languageId = "ignore";
			} else if (languageId === "license") {
				languageId = "plaintext";
			}

			try {
				const fileStat = await vscode.workspace.fs.stat(fileUri);

				if (fileStat.type === vscode.FileType.Directory) {
					continue;
				}

				if (fileStat.size > maxFileSizeForSnippet) {
					console.warn(
						`[EnhancedCodeGenerator] Skipping relevant file '${relativePath}' (size: ${fileStat.size} bytes) due to size limit for prompt inclusion.`
					);
					formattedSnippets.push(
						`--- Relevant File: ${relativePath} ---\n\`\`\`plaintext\n[File skipped: too large for context (${(
							fileStat.size / 1024
						).toFixed(2)}KB > ${(maxFileSizeForSnippet / 1024).toFixed(
							2
						)}KB)]\n\`\`\`\n`
					);
					continue;
				}

				const contentBuffer = await vscode.workspace.fs.readFile(fileUri);
				const content = Buffer.from(contentBuffer).toString("utf8");

				if (content.includes("\0")) {
					console.warn(
						`[EnhancedCodeGenerator] Skipping relevant file '${relativePath}' as it appears to be binary.`
					);
					formattedSnippets.push(
						`--- Relevant File: ${relativePath} ---\n\`\`\`plaintext\n[File skipped: appears to be binary]\n\`\`\`\n`
					);
					continue;
				}

				fileContent = content;
			} catch (error: any) {
				if (
					error instanceof vscode.FileSystemError &&
					(error.code === "FileNotFound" || error.code === "EntryNotFound")
				) {
					console.warn(
						`[EnhancedCodeGenerator] Relevant file not found: '${relativePath}'. Skipping.`
					);
				} else if (error.message.includes("is not a file")) {
					console.warn(
						`[EnhancedCodeGenerator] Skipping directory '${relativePath}' as a relevant file.`
					);
				} else {
					console.error(
						`[EnhancedCodeGenerator] Error reading relevant file '${relativePath}': ${error.message}. Skipping.`,
						error
					);
				}
				formattedSnippets.push(
					`--- Relevant File: ${relativePath} ---\n\`\`\`plaintext\n[File skipped: could not be read or is inaccessible: ${error.message}]\n\`\`\`\n`
				);
				continue;
			}

			if (fileContent !== null) {
				formattedSnippets.push(
					`--- Relevant File: ${relativePath} ---\n\`\`\`${languageId}\n${fileContent}\n\`\`\`\n`
				);
			}
		}

		return formattedSnippets.join("\n");
	}

	/**
	 * Helper to apply file modifications (create/modify) and log changes consistently.
	 * @returns The new content of the file after applying changes.
	 */
	private async _applyFileOperationAndLog(
		fileUri: vscode.Uri,
		relativePath: string,
		desiredContent: string,
		aiGeneratedContent: string, // The raw/cleaned content from AI for logging
		changeType: "created" | "modified",
		stepIndex: number,
		totalSteps: number,
		affectedFileUris: Set<vscode.Uri>,
		token: vscode.CancellationToken
	): Promise<string> {
		let originalContent = "";
		let newContentAfterApply = desiredContent; // Default to desired content if creating or full overwrite

		try {
			// Check if file exists to determine if it's truly a creation or a modification
			const fileStat = await vscode.workspace.fs.stat(fileUri);
			if (fileStat.type === vscode.FileType.File) {
				originalContent = Buffer.from(
					await vscode.workspace.fs.readFile(fileUri)
				).toString("utf-8");
				changeType = "modified"; // Override to modified if file already exists
			}
		} catch (error: any) {
			// File not found, so it's a creation
			if (
				!(
					error instanceof vscode.FileSystemError &&
					(error.code === "FileNotFound" || error.code === "EntryNotFound")
				)
			) {
				// Re-throw if it's an unexpected file system error
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				console.debug(
					`[Generate/Apply Trace] File: ${relativePath}, AI Output: ${aiGeneratedContent}, Applied Content: None (failed to stat), Error: ${errorMessage}`
				);
				throw error;
			}
			changeType = "created"; // Explicitly set if file was not found
		}

		let document: vscode.TextDocument;
		let editor: vscode.TextEditor;

		try {
			// Try to open the document; if it's already open, this gets the current editor state.
			document = await vscode.workspace.openTextDocument(fileUri);
			editor = await vscode.window.showTextDocument(document);
			// Use the content from the editor's buffer as the true "original" content for diffing
			// if the file was already open and potentially modified.
			originalContent = editor.document.getText();
		} catch (docError: any) {
			// If opening the document fails (e.g., file not readable, permissions),
			// but we still want to attempt to write it.
			const errorMessage =
				docError instanceof Error ? docError.message : String(docError);
			console.debug(
				`[Generate/Apply Trace] File: ${relativePath}, AI Output: ${aiGeneratedContent}, Applied Content: None (failed to open doc for apply), Error: ${errorMessage}`
			);
			// Fallback: If document cannot be opened, directly write using fs.writeFile.
			// This might bypass editor events and undo stack, but ensures content is written.
			await vscode.workspace.fs.writeFile(fileUri, Buffer.from(desiredContent));
			newContentAfterApply = desiredContent; // Since we directly wrote it

			const { formattedDiff, summary } = await generateFileChangeSummary(
				originalContent,
				newContentAfterApply,
				relativePath
			);
			this._reportCorrectionStepProgress(
				`Step ${stepIndex + 1} OK: ${
					changeType === "created" ? "Created" : "Modified"
				} file \`${relativePath}\` (via direct write)`,
				stepIndex,
				totalSteps, // Pass index and totalSteps
				false,
				formattedDiff
			);
			this.changeLogger.logChange({
				filePath: relativePath,
				changeType: changeType,
				summary,
				diffContent: formattedDiff,
				timestamp: Date.now(),
				originalContent: originalContent,
				newContent: newContentAfterApply,
			});
			affectedFileUris.add(fileUri);
			console.debug(
				`[Generate/Apply Trace] File: ${relativePath}, AI Output: ${aiGeneratedContent}, Applied Content: ${newContentAfterApply}, Error: None (direct write)`
			);
			return newContentAfterApply;
		}

		try {
			await applyAITextEdits(editor, originalContent, desiredContent, token);
			newContentAfterApply = editor.document.getText();
		} catch (applyError: any) {
			const errorMessage =
				applyError instanceof Error ? applyError.message : String(applyError);
			console.debug(
				`[Generate/Apply Trace] File: ${relativePath}, AI Output: ${aiGeneratedContent}, Applied Content: ${newContentAfterApply}, Error: ${errorMessage}`
			);
			throw applyError; // Re-throw the error for higher-level handling
		}

		const { formattedDiff, summary, addedLines, removedLines } =
			await generateFileChangeSummary(
				originalContent,
				newContentAfterApply,
				relativePath
			);

		if (
			addedLines.length > 0 ||
			removedLines.length > 0 ||
			changeType === "created"
		) {
			affectedFileUris.add(fileUri);
			this._reportCorrectionStepProgress(
				`Step ${stepIndex + 1}/${totalSteps} OK: ${
					changeType === "created" ? "Created" : "Modified"
				} file \`${relativePath}\``,
				stepIndex,
				totalSteps, // Pass index and totalSteps
				false,
				formattedDiff
			);
			this.changeLogger.logChange({
				filePath: relativePath,
				changeType: changeType,
				summary,
				diffContent: formattedDiff,
				timestamp: Date.now(),
				originalContent: originalContent,
				newContent: newContentAfterApply,
			});
			console.debug(
				`[Generate/Apply Trace] File: ${relativePath}, AI Output: ${aiGeneratedContent}, Applied Content: ${newContentAfterApply}, Error: None`
			);
		} else {
			this._reportCorrectionStepProgress(
				`Step ${
					stepIndex + 1
				}/${totalSteps} OK: File \`${relativePath}\` content is already as desired, no substantial modifications needed.`,
				stepIndex,
				totalSteps, // Pass index and totalSteps
				false // Explicitly pass isError
			);
			console.debug(
				`[Generate/Apply Trace] File: ${relativePath}, AI Output: ${aiGeneratedContent}, Applied Content: ${newContentAfterApply}, Error: None (no substantial change)`
			);
		}
		return newContentAfterApply;
	}

	/**
	 * Executes the steps of a correction plan.
	 * @returns The set of URIs of files that were actually modified or created.
	 */
	private async _executeCorrectionPlanSteps(
		steps: PlanStep[],
		rootUri: vscode.Uri,
		originalUserInstruction: string,
		originalContext: EnhancedGenerationContext,
		modelName: string,
		streamId: string,
		token: vscode.CancellationToken,
		feedbackCallback?: (feedback: RealTimeFeedback) => void,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<Set<vscode.Uri>> {
		const affectedFileUris = new Set<vscode.Uri>();
		const totalSteps = steps.length;
		const MAX_TRANSIENT_STEP_RETRIES = 3;

		const relevantFilesToFormat = Array.isArray(originalContext.relevantFiles)
			? originalContext.relevantFiles
			: originalContext.relevantFiles
			? [originalContext.relevantFiles]
			: [];

		const relevantSnippets = await this._formatRelevantFilesForPrompt(
			relevantFilesToFormat,
			rootUri,
			token
		);

		let index = 0;
		while (index < totalSteps) {
			const step = steps[index];
			let currentStepCompletedSuccessfullyOrSkipped = false;
			let currentTransientAttempt = 0;

			while (!currentStepCompletedSuccessfullyOrSkipped) {
				if (token.isCancellationRequested) {
					throw new Error(ERROR_OPERATION_CANCELLED);
				}

				let detailedStepDescription: string;
				if (step.description && step.description.trim() !== "") {
					detailedStepDescription = step.description;
				} else {
					switch (step.action) {
						case PlanStepAction.CreateDirectory:
							detailedStepDescription = `Creating directory: \`${step.path}\``;
							break;
						case PlanStepAction.CreateFile:
							detailedStepDescription = `Creating file: \`${
								step.path
							}\` (content ${
								step.generate_prompt ? "generated by AI" : "predefined"
							})`;
							break;
						case PlanStepAction.ModifyFile:
							detailedStepDescription = `Modifying file: \`${step.path}\` (AI will apply changes)`;
							break;
						case PlanStepAction.RunCommand:
							detailedStepDescription = `Running command: \`${step.command}\``;
							break;
						default:
							detailedStepDescription = `Executing action: ${(
								step.action as string
							).replace(/_/g, " ")}`;
							break;
					}
				}

				this._reportCorrectionStepProgress(
					`Step ${index + 1}/${totalSteps}: ${detailedStepDescription}${
						currentTransientAttempt > 0
							? ` (Auto-retry ${currentTransientAttempt}/${MAX_TRANSIENT_STEP_RETRIES})`
							: ""
					}`,
					index,
					totalSteps // Pass index and totalSteps
				);

				try {
					if (isCreateDirectoryStep(step)) {
						await vscode.workspace.fs.createDirectory(
							vscode.Uri.joinPath(rootUri, step.path)
						);
						this.changeLogger.logChange({
							filePath: step.path,
							changeType: "created",
							summary: `Created directory: '${step.path}'`,
							timestamp: Date.now(),
						});
						currentStepCompletedSuccessfullyOrSkipped = true;
					} else if (isCreateFileStep(step)) {
						const fileUri = vscode.Uri.joinPath(rootUri, step.path);
						let desiredContent: string | undefined = step.content;
						let aiGeneratedContentForFile: string = "";

						if (step.generate_prompt) {
							const generationContext: EnhancedGenerationContext = {
								...originalContext,
								relevantSnippets: relevantSnippets,
								editorContext: originalContext.editorContext,
							};

							const generatedResult = await this.generateFileContent(
								step.path,
								step.generate_prompt,
								generationContext,
								modelName,
								token,
								feedbackCallback,
								onCodeChunkCallback
							);
							desiredContent = generatedResult.content;
							aiGeneratedContentForFile = generatedResult.content;
						}

						const cleanedDesiredContent = cleanCodeOutput(desiredContent ?? "");
						aiGeneratedContentForFile = cleanedDesiredContent; // Capture final cleaned content for logging

						await this._applyFileOperationAndLog(
							fileUri,
							step.path,
							cleanedDesiredContent,
							aiGeneratedContentForFile,
							"created", // Initially assume created, helper will refine
							index,
							totalSteps,
							affectedFileUris,
							token
						);
						currentStepCompletedSuccessfullyOrSkipped = true;
					} else if (isModifyFileStep(step)) {
						const fileUri = vscode.Uri.joinPath(rootUri, step.path);
						// Ensure existingContent is read from the open document if possible
						let existingContent: string;
						try {
							const document = await vscode.workspace.openTextDocument(fileUri);
							existingContent = document.getText();
						} catch {
							// Fallback to reading from file system if document cannot be opened
							existingContent = Buffer.from(
								await vscode.workspace.fs.readFile(fileUri)
							).toString("utf-8");
						}

						const modificationContext: EnhancedGenerationContext = {
							...originalContext,
							relevantSnippets: relevantSnippets,
							editorContext: {
								...((originalContext.editorContext || {}) as EditorContext),
								filePath: step.path,
								documentUri: fileUri,
								fullText: existingContent,
							} as EditorContext,
						};

						let aiGeneratedContentForFile = (
							await this.modifyFileContent(
								step.path,
								step.modification_prompt,
								existingContent, // Pass the most current content to modification prompt
								modificationContext,
								modelName,
								token,
								onCodeChunkCallback
							)
						).content;

						await this._applyFileOperationAndLog(
							fileUri,
							step.path,
							aiGeneratedContentForFile,
							aiGeneratedContentForFile,
							"modified",
							index,
							totalSteps,
							affectedFileUris,
							token
						);
						currentStepCompletedSuccessfullyOrSkipped = true;
					} else if (isRunCommandStep(step)) {
						const userChoice = await vscode.window.showWarningMessage(
							`The plan wants to run a command: \`${step.command}\`\n\nAllow?`,
							{ modal: true },
							"Allow",
							"Skip"
						);
						if (userChoice === "Allow") {
							try {
								const commandResult: CommandResult = await executeCommand(
									step.command,
									rootUri.fsPath,
									token,
									[]
								);

								if (commandResult.exitCode !== 0) {
									const errorMessage = `Command \`${step.command}\` failed with exit code ${commandResult.exitCode}.
                                    \n--- STDOUT ---\n${commandResult.stdout}
                                    \n--- STDERR ---\n${commandResult.stderr}`;

									this._reportCorrectionStepProgress(
										`Step ${index + 1} FAILED: Command execution error.`,
										index,
										totalSteps, // Pass index and totalSteps
										true,
										errorMessage
									);

									throw new Error(
										`Command execution failed: ${step.command}. Output: ${errorMessage}`
									);
								} else {
									const successMessage = `Command \`${step.command}\` executed successfully.
                                    \n--- STDOUT ---\n${commandResult.stdout}
                                    \n--- STDERR ---\n${commandResult.stderr}`;

									this._reportCorrectionStepProgress(
										`Step ${index + 1} OK: Command executed.`,
										index,
										totalSteps, // Pass index and totalSteps
										false,
										successMessage
									);
									currentStepCompletedSuccessfullyOrSkipped = true;
								}
							} catch (commandExecError: any) {
								if (commandExecError.message === ERROR_OPERATION_CANCELLED) {
									throw commandExecError;
								}
								let detailedError = `Error executing command \`${step.command}\`: ${commandExecError.message}`;
								this._reportCorrectionStepProgress(
									`Step ${index + 1} FAILED: ${detailedError}`,
									index,
									totalSteps, // Pass index and totalSteps
									true
								);
								throw detailedError;
							}
						} else {
							currentStepCompletedSuccessfullyOrSkipped = true;
							this._reportCorrectionStepProgress(
								`Step ${index + 1} SKIPPED by user.`,
								index,
								totalSteps // Pass index and totalSteps
							);
						}
					}
				} catch (error: any) {
					let errorMsg = formatUserFacingErrorMessage(
						error,
						"Failed to execute correction plan step. Please review the details.",
						"Step execution failed: ",
						rootUri
					);

					let isRetryableTransientError = false;
					if (errorMsg.includes(ERROR_OPERATION_CANCELLED)) {
						throw error;
					}

					if (
						errorMsg.includes("quota exceeded") ||
						errorMsg.includes("rate limit exceeded") ||
						errorMsg.includes("network issue") ||
						errorMsg.includes("AI service unavailable") ||
						errorMsg.includes("timeout")
					) {
						isRetryableTransientError = true;
					}

					if (
						isRetryableTransientError &&
						currentTransientAttempt < MAX_TRANSIENT_STEP_RETRIES
					) {
						this._reportCorrectionStepProgress(
							`Step ${
								index + 1
							} FAILED (transient, auto-retrying): ${errorMsg}`,
							index,
							totalSteps, // Pass index and totalSteps
							true
						);
						console.warn(
							`[EnhancedCodeGenerator] Step ${
								index + 1
							} failed, auto-retrying due to transient error: ${errorMsg}`
						);
						await new Promise((resolve) =>
							setTimeout(resolve, 10000 + currentTransientAttempt * 5000)
						);
						currentTransientAttempt++;
					} else {
						this._reportCorrectionStepProgress(
							`Step ${
								index + 1
							} FAILED: ${errorMsg}. Requires manual review or retry of the overall correction.`,
							index,
							totalSteps, // Pass index and totalSteps
							true
						);
						throw new Error(
							`Correction plan step failed: ${detailedStepDescription}. Error: ${errorMsg}`
						);
					}
				}
			}
			index++;
		}
		return affectedFileUris;
	}

	/**
	 * Orchestrates the generation and execution of a correction plan based on current diagnostics.
	 * This is the new core method replacing _applyRealTimeCorrections.
	 * @param filePath The path of the file currently being worked on (relevant for initial prompt context).
	 * @param initialContent The initial content of the file before any correction attempts in this loop.
	 * @param currentDiagnostics The initial diagnostic issues for the file.
	 * @param context The enhanced generation context.
	 * @param modelName The AI model to use.
	 * @param streamId The stream ID for UI updates.
	 * @param token Cancellation token.
	 * @param feedbackCallback Callback for real-time UI feedback.
	 * @param originalUserInstruction The original user instruction/prompt for context in AI calls.
	 * @param rootUri The workspace root URI.
	 * @param onCodeChunkCallback Callback for handling code chunks during streaming.
	 * @returns A CodeValidationResult after attempts.
	 */
	private async _generateAndExecuteCorrectionPlan(
		filePath: string,
		initialContent: string,
		currentDiagnostics: CodeIssue[],
		context: EnhancedGenerationContext,
		modelName: string,
		streamId: string,
		token: vscode.CancellationToken,
		feedbackCallback: (feedback: RealTimeFeedback) => void,
		originalUserInstruction: string,
		rootUri: vscode.Uri,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<CodeValidationResult> {
		let iteration = 0;
		let currentContent = initialContent;
		let validationResult: CodeValidationResult = {
			isValid: false,
			finalContent: currentContent,
			issues: currentDiagnostics,
			suggestions: [],
		};
		let currentContext: EnhancedGenerationContext = {
			...context,
			recentCorrectionAttemptOutcomes:
				context.recentCorrectionAttemptOutcomes || [],
			isOscillating: context.isOscillating || false,
		};

		this._sendFeedback(feedbackCallback, {
			stage: "correction",
			message: "Starting code correction...",
			issues: currentDiagnostics,
			suggestions: [],
			progress: 20,
		});

		while (iteration < this.config.maxFeedbackIterations!) {
			if (token.isCancellationRequested) {
				validationResult.issues.push({
					type: "other",
					message: "Code correction cancelled by user.",
					line: 1,
					severity: "info",
					source: "EnhancedCodeGenerator",
				});
				return validationResult;
			}

			iteration++;
			const contentBeforeAttempt = currentContent;
			const issuesBeforeAttempt = [...validationResult.issues];
			const issuesBeforeAttemptCount = issuesBeforeAttempt.length;

			this._reportCorrectionStepProgress(
				`Generating correction plan (attempt ${iteration})...`,
				iteration,
				this.config.maxFeedbackIterations! // Pass index and totalSteps
			);

			currentContext.fileStructureAnalysis = await analyzeFileStructure(
				filePath,
				currentContent
			);
			currentContext =
				await this.contextRefresherService.refreshErrorFocusedContext(
					filePath,
					currentContent,
					issuesBeforeAttempt,
					currentContext,
					token
				);

			let relevantFilesToFormat: string[] = [];
			if (context.relevantFiles) {
				if (Array.isArray(context.relevantFiles)) {
					relevantFilesToFormat = context.relevantFiles;
				} else if (typeof context.relevantFiles === "string") {
					relevantFilesToFormat = [context.relevantFiles];
				}
			}
			const updatedRelevantSnippets = await this._formatRelevantFilesForPrompt(
				relevantFilesToFormat,
				rootUri,
				token
			);
			currentContext.relevantSnippets = updatedRelevantSnippets;

			const fileSpecificEditorContext: EditorContext = {
				...((context.editorContext || {}) as EditorContext),
				filePath: filePath,
				documentUri: vscode.Uri.file(filePath),
				fullText: currentContent,
			};
			currentContext.editorContext = fileSpecificEditorContext;

			let correctionFeedbackForPrompt: CorrectionFeedback | undefined;
			let parsingFailedForThisAttempt = false;

			if (
				currentContext.recentCorrectionAttemptOutcomes &&
				currentContext.recentCorrectionAttemptOutcomes.length >= 2
			) {
				const lastOutcome =
					currentContext.recentCorrectionAttemptOutcomes[
						currentContext.recentCorrectionAttemptOutcomes.length - 1
					];
				const secondLastOutcome =
					currentContext.recentCorrectionAttemptOutcomes[
						currentContext.recentCorrectionAttemptOutcomes.length - 2
					];
				if (
					!lastOutcome.success &&
					!secondLastOutcome.success &&
					areIssuesSimilar(
						lastOutcome.issuesRemaining,
						secondLastOutcome.issuesRemaining
					)
				) {
					currentContext.isOscillating = true;
					correctionFeedbackForPrompt = {
						type: "oscillation_detected",
						message: `Detected oscillation: previous two attempts resulted in similar unresolved issues.`,
						relevantDiff: lastOutcome.relevantDiff,
						details: {
							previousIssues: lastOutcome.issuesRemaining,
							currentIssues: lastOutcome.issuesRemaining,
						},
						issuesRemaining: lastOutcome.issuesRemaining,
						issuesIntroduced: lastOutcome.issuesIntroduced,
					};
					this._sendFeedback(feedbackCallback, {
						stage: "correction",
						message: "AI detected oscillation, adjusting strategy...",
						issues: issuesBeforeAttempt,
						suggestions: ["AI is attempting to break an oscillation pattern."],
						progress:
							20 + iteration * (60 / this.config.maxFeedbackIterations!) + 5,
					});
				}
			}

			if (
				currentContext.lastCorrectionAttemptOutcome?.type === "parsing_failed"
			) {
				correctionFeedbackForPrompt =
					currentContext.lastCorrectionAttemptOutcome.feedbackUsed;
			}

			const jsonGenerationConfig: GenerationConfig = {
				responseMimeType: "application/json",
				temperature: sidebarConstants.TEMPERATURE,
			};

			const formattedRecentChanges = formatSuccessfulChangesForPrompt(
				this.changeLogger.getCompletedPlanChangeSets()
			);

			await DiagnosticService.waitForDiagnosticsToStabilize(
				vscode.Uri.file(filePath),
				token,
				5000,
				100
			);

			const diagnosticsFromVsCode =
				(await DiagnosticService.formatContextualDiagnostics(
					vscode.Uri.file(filePath),
					rootUri,
					undefined,
					5000,
					undefined,
					token,
					[
						vscode.DiagnosticSeverity.Error,
						vscode.DiagnosticSeverity.Warning,
						vscode.DiagnosticSeverity.Information,
					]
				)) || null;

			const customFormatIssues = issuesBeforeAttempt.filter(
				(issue) => issue.type === "format_error"
			);

			let formattedCustomIssues = "";
			if (customFormatIssues.length > 0) {
				formattedCustomIssues = "--- AI Response Format Issues ---\n";
				formattedCustomIssues += customFormatIssues
					.map((issue) => {
						let severityVscode: vscode.DiagnosticSeverity;
						switch (issue.severity) {
							case "error":
								severityVscode = vscode.DiagnosticSeverity.Error;
								break;
							case "warning":
								severityVscode = vscode.DiagnosticSeverity.Warning;
								break;
							case "info":
								severityVscode = vscode.DiagnosticSeverity.Information;
								break;
							default:
								severityVscode = vscode.DiagnosticSeverity.Information;
						}
						const severityName = getSeverityName(severityVscode);
						return `  - [${severityName.toUpperCase()}] ${
							issue.type
						}: "${escapeForJsonValue(issue.message)}" at line ${issue.line}${
							issue.code ? ` (Code: ${issue.code})` : ""
						}`;
					})
					.join("\n");
				formattedCustomIssues += "\n--- End AI Response Format Issues ---";
			}

			let combinedDiagnosticsString = "";
			if (
				diagnosticsFromVsCode !== null &&
				diagnosticsFromVsCode !== "No specific diagnostics found."
			) {
				combinedDiagnosticsString += diagnosticsFromVsCode;
			}

			if (formattedCustomIssues !== "") {
				if (combinedDiagnosticsString !== "") {
					combinedDiagnosticsString += "\n\n";
				}
				combinedDiagnosticsString += formattedCustomIssues;
			}

			const diagnosticsForPrompt =
				combinedDiagnosticsString !== ""
					? combinedDiagnosticsString
					: "No specific diagnostics found.";

			let jsonEscapingInstructionsForPrompt = "";
			if (
				correctionFeedbackForPrompt?.type === "parsing_failed" &&
				correctionFeedbackForPrompt.details?.parsingError &&
				correctionFeedbackForPrompt.details.failedJson
			) {
				const failedJsonPreview =
					correctionFeedbackForPrompt.details.failedJson.substring(0, 500);
				jsonEscapingInstructionsForPrompt = `CRITICAL: Your previous output was NOT valid JSON due to "${correctionFeedbackForPrompt.details.parsingError}". You MUST provide ONLY a valid JSON object that strictly adheres to the schema. Do NOT include markdown fences (e.g., \`\\\`json) or any additional text, comments, or explanations outside the JSON object itself. Your previous invalid JSON was (truncated): \`\\\`json\n${failedJsonPreview}\n\`\\\`. You MUST correct this.`;
			}

			const correctionPlanPrompt = createCorrectionPlanPrompt(
				originalUserInstruction,
				currentContext.projectContext,
				fileSpecificEditorContext,
				[],
				currentContext.relevantSnippets,
				diagnosticsForPrompt,
				formattedRecentChanges,
				correctionFeedbackForPrompt,
				currentContext.activeSymbolInfo,
				jsonEscapingInstructionsForPrompt
			);

			let aiGeneratedPlanContent: string = "";
			let parsedPlan: ExecutionPlan | null = null;
			let parsingError: string | undefined;

			try {
				aiGeneratedPlanContent = await this.aiRequestService.generateWithRetry(
					[{ text: correctionPlanPrompt }],
					modelName,
					undefined,
					`correction plan generation (iteration ${iteration})`,
					jsonGenerationConfig,
					undefined,
					token
				);

				const parsedResult = await this._parseAndValidateCorrectionPlan(
					aiGeneratedPlanContent,
					rootUri
				);
				parsedPlan = parsedResult.plan;
				parsingError = parsedResult.error;

				if (parsingError) {
					parsingFailedForThisAttempt = true;
					this._reportCorrectionStepProgress(
						`AI generated a malformed correction plan (iteration ${iteration}). Error: ${parsingError}`,
						iteration,
						this.config.maxFeedbackIterations!, // Pass index and totalSteps
						true,
						aiGeneratedPlanContent
					);
					console.error(`Malformed plan from AI:\n`, aiGeneratedPlanContent);
					console.debug(
						`[Generate/Apply Trace] File: ${filePath}, AI Output: ${aiGeneratedPlanContent}, Applied Content: ${currentContent}, Error: ${parsingError}`
					);
					throw new Error(parsingError);
				}
			} catch (e: any) {
				parsingFailedForThisAttempt = true;
				const errorMessage = `Failed to generate/parse correction plan: ${e.message}`;
				console.error(`[EnhancedCodeGenerator] ${errorMessage}`, e);
				console.debug(
					`[Generate/Apply Trace] File: ${filePath}, AI Output: ${aiGeneratedPlanContent}, Applied Content: ${currentContent}, Error: ${errorMessage}`
				);

				correctionFeedbackForPrompt = {
					type: "parsing_failed",
					message: errorMessage,
					details: {
						parsingError: e.message,
						failedJson: aiGeneratedPlanContent || "N/A",
						previousIssues: issuesBeforeAttempt,
						currentIssues: issuesBeforeAttempt,
					},
					issuesRemaining: issuesBeforeAttempt,
					relevantDiff: "",
					issuesIntroduced: [],
				};
				currentContext.lastCorrectionAttemptOutcome = {
					iteration: iteration,
					success: false,
					originalIssuesCount: issuesBeforeAttemptCount,
					issuesAfterAttemptCount: issuesBeforeAttemptCount,
					issuesRemaining: issuesBeforeAttempt,
					issuesIntroduced: [],
					relevantDiff: "",
					aiFailureAnalysis: errorMessage,
					type: "parsing_failed",
					failureType: "parsing_failed",
					feedbackUsed: correctionFeedbackForPrompt,
					aiGeneratedContent: aiGeneratedPlanContent,
				};
				continue;
			}

			let didPlanExecuteSuccessfully = true;
			try {
				if (parsedPlan && parsedPlan.steps && parsedPlan.steps.length > 0) {
					this._reportCorrectionStepProgress(
						`Executing correction plan for '${filePath}' (iteration ${iteration})...`,
						iteration,
						this.config.maxFeedbackIterations! // Pass index and totalSteps
					);
					await this._executeCorrectionPlanSteps(
						parsedPlan.steps,
						rootUri,
						originalUserInstruction,
						currentContext,
						modelName,
						streamId,
						token,
						feedbackCallback,
						onCodeChunkCallback
					);
					const contentBuffer = await vscode.workspace.fs.readFile(
						vscode.Uri.file(filePath)
					);
					currentContent = Buffer.from(contentBuffer).toString("utf-8");
				} else {
					didPlanExecuteSuccessfully = false;
					this._reportCorrectionStepProgress(
						`AI generated an empty or no-op correction plan for '${filePath}' (iteration ${iteration}).`,
						iteration,
						this.config.maxFeedbackIterations!, // Pass index and totalSteps
						true
					);
					throw new Error("Empty or no-op correction plan generated.");
				}
			} catch (executionError: any) {
				didPlanExecuteSuccessfully = false;
				if (executionError.message === ERROR_OPERATION_CANCELLED) {
					throw executionError;
				}
				const errorMessage = `Correction plan execution failed: ${executionError.message}`;
				this._reportCorrectionStepProgress(
					errorMessage,
					iteration,
					this.config.maxFeedbackIterations!, // Pass index and totalSteps
					true
				);
				console.error(
					`[EnhancedCodeGenerator] ${errorMessage}`,
					executionError
				);
				console.debug(
					`[Generate/Apply Trace] File: ${filePath}, AI Output: ${aiGeneratedPlanContent}, Applied Content: ${currentContent}, Error: ${errorMessage}`
				);

				correctionFeedbackForPrompt = {
					type: "command_failed",
					message: errorMessage,
					details: {
						previousIssues: issuesBeforeAttempt,
						currentIssues: issuesBeforeAttempt,
					},
					issuesRemaining: issuesBeforeAttempt,
					relevantDiff: "",
					issuesIntroduced: [],
				};
				currentContext.lastCorrectionAttemptOutcome = {
					iteration: iteration,
					success: false,
					originalIssuesCount: issuesBeforeAttemptCount,
					issuesAfterAttemptCount: issuesBeforeAttemptCount,
					issuesRemaining: issuesBeforeAttempt,
					issuesIntroduced: [],
					relevantDiff: "",
					aiFailureAnalysis: errorMessage,
					type: "command_failed",
					failureType: "command_failed",
					feedbackUsed: correctionFeedbackForPrompt,
					aiGeneratedContent: aiGeneratedPlanContent,
				};
				continue;
			}

			await DiagnosticService.waitForDiagnosticsToStabilize(
				vscode.Uri.file(filePath),
				token,
				5000,
				100
			);
			const finalValidation = await this.codeValidationService.validateCode(
				filePath,
				currentContent
			);
			const issuesAfterAttempt = [...finalValidation.issues];
			const issuesAfterAttemptCount = issuesAfterAttempt.length;

			const wasImprovement = issuesAfterAttemptCount < issuesBeforeAttemptCount;
			const issuesIntroduced = issuesAfterAttempt.filter(
				(newIssue) =>
					!issuesBeforeAttempt.some((oldIssue) =>
						areIssuesSimilar([newIssue], [oldIssue])
					)
			);
			const { formattedDiff: relevantDiff } = await generateFileChangeSummary(
				contentBeforeAttempt,
				currentContent,
				filePath
			);

			let outcomeType: CorrectionAttemptOutcome["type"];
			let failureType: CorrectionAttemptOutcome["failureType"];
			let aiFailureAnalysisMessage: string;

			if (issuesAfterAttemptCount === 0) {
				outcomeType = "unknown";
				failureType = "unknown";
				aiFailureAnalysisMessage = "Success";
			} else if (issuesIntroduced.length > 0) {
				failureType = "new_errors_introduced";
				outcomeType = "new_errors_introduced";
				aiFailureAnalysisMessage = `Correction failed: new errors were introduced.`;
			} else if (currentContext.isOscillating && !wasImprovement) {
				failureType = "oscillation_detected";
				outcomeType = "oscillation_detected";
				aiFailureAnalysisMessage = `Correction failed: detected oscillation, issues remain similar.`;
			} else {
				failureType = "no_improvement";
				outcomeType = "no_improvement";
				aiFailureAnalysisMessage = `Correction failed: no improvement in issues.`;
			}

			const currentAttemptOutcome: CorrectionAttemptOutcome = {
				iteration: iteration,
				success: issuesAfterAttemptCount === 0,
				originalIssuesCount: issuesBeforeAttemptCount,
				issuesAfterAttemptCount: issuesAfterAttemptCount,
				issuesRemaining: issuesAfterAttempt,
				issuesIntroduced: issuesIntroduced,
				relevantDiff: relevantDiff,
				aiFailureAnalysis: aiFailureAnalysisMessage,
				type: outcomeType,
				failureType: failureType,
				feedbackUsed: correctionFeedbackForPrompt,
				aiGeneratedContent: aiGeneratedPlanContent,
			};
			currentContext.recentCorrectionAttemptOutcomes?.push(
				currentAttemptOutcome
			);
			currentContext.lastCorrectionAttemptOutcome = currentAttemptOutcome;

			validationResult = {
				...finalValidation,
				finalContent: currentContent,
				issues: issuesAfterAttempt,
				iterations: iteration,
			};

			if (issuesAfterAttempt.length === 0) {
				currentContext.recentCorrectionAttemptOutcomes = [];
				currentContext.isOscillating = false;
				return validationResult;
			} else if (iteration === this.config.maxFeedbackIterations!) {
				this._sendFeedback(feedbackCallback, {
					stage: "correction",
					message: `Max correction attempts reached. Remaining issues: ${issuesAfterAttempt.length}.`,
					issues: issuesAfterAttempt,
					suggestions: [
						"Manual intervention may be required.",
						"Try refining the initial request.",
					],
					progress: 100,
				});
				return validationResult;
			} else {
				correctionFeedbackForPrompt = {
					type: failureType,
					message: aiFailureAnalysisMessage,
					details: {
						previousIssues: issuesBeforeAttempt,
						currentIssues: issuesAfterAttempt,
					},
					issuesRemaining: issuesAfterAttempt,
					issuesIntroduced: issuesIntroduced,
					relevantDiff: relevantDiff,
				};

				if (failureType === "new_errors_introduced") {
					this._sendFeedback(feedbackCallback, {
						stage: "correction",
						message: `New errors introduced (iteration ${iteration}), retrying...`,
						issues: issuesAfterAttempt,
						suggestions: ["AI is attempting to revert or fix new regressions."],
						progress:
							20 + iteration * (60 / this.config.maxFeedbackIterations!),
					});
				} else if (failureType === "no_improvement") {
					this._sendFeedback(feedbackCallback, {
						stage: "correction",
						message: `No improvement (iteration ${iteration}), retrying...`,
						issues: issuesAfterAttempt,
						suggestions: [
							"AI is attempting an alternative correction strategy.",
						],
						progress:
							20 + iteration * (60 / this.config.maxFeedbackIterations!),
					});
				} else if (failureType === "oscillation_detected") {
					this._sendFeedback(feedbackCallback, {
						stage: "correction",
						message: `Oscillation detected (iteration ${iteration}), retrying...`,
						issues: issuesAfterAttempt,
						suggestions: ["AI is attempting to break an oscillation pattern."],
						progress:
							20 + iteration * (60 / this.config.maxFeedbackIterations!),
					});
				}
			}
		}

		return validationResult;
	}

	/**
	 * The core feedback loop for generating and iteratively correcting code.
	 */
	private async _generateWithRealTimeFeedback(
		filePath: string,
		generatePrompt: string,
		context: EnhancedGenerationContext,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		feedbackCallback?: (feedback: RealTimeFeedback) => void,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!rootUri) {
			const errorMsg =
				"Cannot generate code: No VS Code workspace folder is currently open.";
			this._sendFeedback(feedbackCallback, {
				stage: "error",
				message: errorMsg,
				issues: [
					{ type: "other", message: errorMsg, line: 1, severity: "error" },
				],
				suggestions: ["Open a project folder."],
				progress: 100,
			});
			throw new Error(errorMsg);
		}

		let currentContent = "";
		let initialGenerationResult: CodeValidationResult;

		let currentContext: EnhancedGenerationContext = {
			...context,
			successfulChangeHistory: formatSuccessfulChangesForPrompt(
				this.changeLogger.getCompletedPlanChangeSets()
			),
			recentCorrectionAttemptOutcomes: [],
			isOscillating: false,
		};

		this._sendFeedback(feedbackCallback, {
			stage: "initialization",
			message: "Starting code generation...",
			issues: [],
			suggestions: [],
			progress: 0,
		});

		currentContext.fileStructureAnalysis = await analyzeFileStructure(
			filePath,
			""
		);
		initialGenerationResult = await this._generateInitialContent(
			filePath,
			generatePrompt,
			currentContext,
			modelName,
			streamId,
			token,
			onCodeChunkCallback
		);
		currentContent = initialGenerationResult.finalContent;

		await DiagnosticService.waitForDiagnosticsToStabilize(
			vscode.Uri.file(filePath),
			token,
			5000,
			100
		);

		let diagnosticValidation = await this.codeValidationService.validateCode(
			filePath,
			currentContent
		);
		let combinedIssues = [
			...diagnosticValidation.issues,
			...initialGenerationResult.issues.filter(
				(i) => i.type === "format_error"
			),
		];

		if (combinedIssues.length === 0) {
			this._sendFeedback(feedbackCallback, {
				stage: "completion",
				message: "Initial generation successful!",
				issues: [],
				suggestions: [],
				progress: 100,
			});
			return {
				content: currentContent,
				validation: {
					...diagnosticValidation,
					finalContent: currentContent,
					iterations: 1,
				},
			};
		}

		this._sendFeedback(feedbackCallback, {
			stage: "validation",
			message: `Initial generation has issues. Starting correction loop...`,
			issues: combinedIssues,
			suggestions: [],
			progress: 20,
		});

		const finalCorrectionResult = await this._generateAndExecuteCorrectionPlan(
			filePath,
			currentContent,
			combinedIssues,
			currentContext,
			modelName,
			streamId,
			token!,
			feedbackCallback!,
			generatePrompt,
			rootUri,
			onCodeChunkCallback
		);

		return {
			content: finalCorrectionResult.finalContent,
			validation: {
				...finalCorrectionResult,
				iterations: finalCorrectionResult.iterations || 0,
			},
		};
	}
}

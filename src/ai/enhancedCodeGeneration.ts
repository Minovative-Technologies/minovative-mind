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
import { CodeValidationService } from "../services/codeValidationService";
import { ContextRefresherService } from "../services/contextRefresherService";
import {
	analyzeFileStructure,
	getLanguageId,
	isRewriteIntentDetected,
} from "../utils/codeAnalysisUtils";
import { formatSuccessfulChangesForPrompt } from "../workflow/changeHistoryFormatter";
import { analyzeDiff } from "../utils/diffingUtils";
import { DiagnosticService, getSeverityName } from "../utils/diagnosticUtils"; // MODIFIED: Added getSeverityName import
import {
	createEnhancedGenerationPrompt,
	createEnhancedModificationPrompt,
	createRefineModificationPrompt,
} from "./prompts/enhancedCodeGenerationPrompts";
import { escapeForJsonValue } from "../utils/aiUtils"; // MODIFIED: Ensure escapeForJsonValue is imported

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

		// --- Inlined logic from _generateModification ---
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
		// --- End inlined logic ---

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

	// src/ai/enhancedCodeGeneration.ts

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
		// FIX: Return ParsedPlanResult
		// Replicate logic from PlanService.parseAndValidatePlan
		try {
			// Markdown stripping, consistent with PlanService
			const cleanedJsonString = jsonString
				.replace(/^\s*/im, "")
				.replace(/\s*$/im, "")
				.trim();

			// Use the shared utility function for parsing and validation
			const parsedResult = await parseAndValidatePlan(
				cleanedJsonString,
				rootUri
			);
			return parsedResult; // parsedResult is already a ParsedPlanResult
		} catch (e: any) {
			console.error(
				`[EnhancedCodeGenerator] Error parsing/validating correction plan: ${e.message}`,
				e
			);
			// FIX: Return a valid ParsedPlanResult with a null plan
			return { plan: null, error: `Parsing/validation failed: ${e.message}` };
		}
	}

	/**
	 * Helper method to report progress and messages related to correction steps.
	 * This adapts `_postChatUpdateForPlanExecution` from `PlanService` for this context.
	 */
	private _reportCorrectionStepProgress(
		message: string,
		isError: boolean = false,
		diffContent?: string
	): void {
		// `postMessageToWebview` is available.
		this.postMessageToWebview({
			type: "appendRealtimeModelMessage",
			value: { text: message, isError: isError },
			isPlanStepUpdate: true, // Mark as plan step update for UI differentiation
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
	 * Copied and adapted from PlanService's _formatRelevantFilesForPrompt.
	 */
	private async _formatRelevantFilesForPrompt(
		relevantFilePaths: string[], // These are relative paths
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
	 * Executes the steps of a correction plan.
	 * This method is adapted from PlanService._executePlanSteps.
	 * @returns The set of URIs of files that were actually modified or created.
	 */
	private async _executeCorrectionPlanSteps(
		steps: PlanStep[],
		rootUri: vscode.Uri,
		originalUserInstruction: string, // This is the root instruction from generatePrompt/modificationPrompt
		originalContext: EnhancedGenerationContext, // Broader context for prompt generation
		modelName: string,
		streamId: string,
		token: vscode.CancellationToken,
		feedbackCallback?: (feedback: RealTimeFeedback) => void,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<Set<vscode.Uri>> {
		const affectedFileUris = new Set<vscode.Uri>();
		const totalSteps = steps.length;
		const MAX_TRANSIENT_STEP_RETRIES = 3; // Define locally or as class constant

		// Pre-compute relevant snippets once before the step execution loop.
		// Use originalContext.relevantFiles for this, as it should contain the broader project context.
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
					}`
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
						let aiGeneratedContentForFile: string = ""; // To store AI's raw/cleaned content for this file

						if (step.generate_prompt) {
							// Use the original context for content generation
							const generationContext: EnhancedGenerationContext = {
								...originalContext,
								relevantSnippets: relevantSnippets, // Use updated relevant snippets
								// editorContext might need to be specific to this file if applicable
								editorContext: originalContext.editorContext, // For initial generation context, use the broad editor context
							};

							const generatedResult = await this.generateFileContent(
								step.path, // relative path
								step.generate_prompt,
								generationContext,
								modelName,
								token,
								feedbackCallback,
								onCodeChunkCallback
							);
							desiredContent = generatedResult.content;
							aiGeneratedContentForFile = generatedResult.content; // Capture AI's content
						}

						const cleanedDesiredContent = cleanCodeOutput(desiredContent ?? "");
						// Update with cleaned content, as this is what's intended to be applied
						aiGeneratedContentForFile = cleanedDesiredContent;

						try {
							await vscode.workspace.fs.stat(fileUri);
							const existingContent = Buffer.from(
								await vscode.workspace.fs.readFile(fileUri)
							).toString("utf-8");

							if (existingContent === cleanedDesiredContent) {
								this._reportCorrectionStepProgress(
									`Step ${index + 1} OK: File \`${
										step.path
									}\` already has the desired content. Skipping.`
								);
								currentStepCompletedSuccessfullyOrSkipped = true;
								// Instruction 3: Logging for no-op modification
								console.debug(
									`[Generate/Apply Trace] File: ${step.path}, AI Output: ${aiGeneratedContentForFile}, Applied Content: ${existingContent}, Error: None (no substantial change)`
								);
							} else {
								const document = await vscode.workspace.openTextDocument(
									fileUri
								);
								const editor = await vscode.window.showTextDocument(document);

								await applyAITextEdits(
									editor,
									existingContent,
									cleanedDesiredContent,
									token
								);
								const newContentAfterApply = editor.document.getText();

								const { formattedDiff, summary } =
									await generateFileChangeSummary(
										existingContent,
										newContentAfterApply,
										step.path
									);

								this._reportCorrectionStepProgress(
									`Step ${index + 1} OK: Modified file \`${
										step.path
									}\` (See diff below)`,
									false,
									formattedDiff
								);
								this.changeLogger.logChange({
									filePath: step.path,
									changeType: "modified",
									summary,
									diffContent: formattedDiff,
									timestamp: Date.now(),
									originalContent: existingContent,
									newContent: newContentAfterApply,
								});
								currentStepCompletedSuccessfullyOrSkipped = true;
								affectedFileUris.add(fileUri);
								// Instruction 3: Logging for successful modification
								console.debug(
									`[Generate/Apply Trace] File: ${step.path}, AI Output: ${aiGeneratedContentForFile}, Applied Content: ${newContentAfterApply}, Error: None`
								);
							}
						} catch (error: any) {
							const errorMessage =
								error instanceof Error ? error.message : String(error);
							// Instruction 3: Logging for error during apply/stat
							console.debug(
								`[Generate/Apply Trace] File: ${step.path}, AI Output: ${aiGeneratedContentForFile}, Applied Content: None (failed to apply), Error: ${errorMessage}`
							);

							if (
								error instanceof vscode.FileSystemError &&
								(error.code === "FileNotFound" ||
									error.code === "EntryNotFound")
							) {
								await vscode.workspace.fs.writeFile(
									fileUri,
									Buffer.from(cleanedDesiredContent)
								);

								const document = await vscode.workspace.openTextDocument(
									fileUri
								);
								await vscode.window.showTextDocument(document);

								const { formattedDiff, summary } =
									await generateFileChangeSummary(
										"",
										cleanedDesiredContent,
										step.path
									);

								this._reportCorrectionStepProgress(
									`Step ${index + 1} OK: Created file \`${
										step.path
									}\` (See diff below)`,
									false,
									formattedDiff
								);
								this.changeLogger.logChange({
									filePath: step.path,
									changeType: "created",
									summary,
									diffContent: formattedDiff,
									timestamp: Date.now(),
									originalContent: "",
									newContent: cleanedDesiredContent,
								});
								currentStepCompletedSuccessfullyOrSkipped = true;
								affectedFileUris.add(fileUri);
								// Instruction 3: Logging for successful creation
								console.debug(
									`[Generate/Apply Trace] File: ${step.path}, AI Output: ${aiGeneratedContentForFile}, Applied Content: ${cleanedDesiredContent}, Error: None`
								);
							} else {
								throw error;
							}
						}
					} else if (isModifyFileStep(step)) {
						const fileUri = vscode.Uri.joinPath(rootUri, step.path);
						const existingContent = Buffer.from(
							await vscode.workspace.fs.readFile(fileUri)
						).toString("utf-8");

						// For modification, context should also reflect the broader situation
						const modificationContext: EnhancedGenerationContext = {
							...originalContext,
							relevantSnippets: relevantSnippets,
							// editorContext might need to be specific to this file if applicable.
							// For modifyFileContent, it usually uses editorContext for the *current* file open.
							// Here, the file being modified might not be the "editorContext.documentUri" initially.
							// Pass a specific editorContext for the file being modified if necessary, otherwise the general one.
							editorContext: {
								...((originalContext.editorContext || {}) as EditorContext), // Base from context, ensuring it's an object
								filePath: step.path, // Override filePath with the one being modified
								documentUri: fileUri, // Override documentUri
								fullText: existingContent, // Ensure fullText is current content of this file
							} as EditorContext, // Cast to EditorContext for clarity
						};

						let aiGeneratedContentForFile = (
							await this.modifyFileContent(
								step.path,
								step.modification_prompt,
								existingContent,
								modificationContext,
								modelName,
								token,
								onCodeChunkCallback
							)
						).content;

						let document: vscode.TextDocument;
						let editor: vscode.TextEditor;
						try {
							document = await vscode.workspace.openTextDocument(fileUri);
							editor = await vscode.window.showTextDocument(document);
						} catch (docError: any) {
							const errorMessage =
								docError instanceof Error ? docError.message : String(docError);
							// Instruction 3: Logging for error opening document
							console.debug(
								`[Generate/Apply Trace] File: ${step.path}, AI Output: ${aiGeneratedContentForFile}, Applied Content: None (failed to open doc), Error: ${errorMessage}`
							);
							throw new Error(
								`Failed to open document ${fileUri.fsPath} for modification: ${docError.message}`
							);
						}

						let newContentAfterApply = editor.document.getText(); // Initialize with current editor content
						try {
							await applyAITextEdits(
								editor,
								editor.document.getText(),
								aiGeneratedContentForFile,
								token
							);
							newContentAfterApply = editor.document.getText();
							// Instruction 3: Logging for successful modification
							console.debug(
								`[Generate/Apply Trace] File: ${step.path}, AI Output: ${aiGeneratedContentForFile}, Applied Content: ${newContentAfterApply}, Error: None`
							);
						} catch (applyError: any) {
							const errorMessage =
								applyError instanceof Error
									? applyError.message
									: String(applyError);
							// Instruction 3: Logging for error during applyAITextEdits
							console.debug(
								`[Generate/Apply Trace] File: ${step.path}, AI Output: ${aiGeneratedContentForFile}, Applied Content: ${newContentAfterApply}, Error: ${errorMessage}`
							);
							throw applyError; // Re-throw the error
						}

						const { formattedDiff, summary, addedLines, removedLines } =
							await generateFileChangeSummary(
								existingContent,
								newContentAfterApply,
								step.path
							);

						if (addedLines.length > 0 || removedLines.length > 0) {
							affectedFileUris.add(fileUri);

							this._reportCorrectionStepProgress(
								`Step ${index + 1} OK: Modified file \`${
									step.path
								}\` (See diff below)`,
								false,
								formattedDiff
							);
							this.changeLogger.logChange({
								filePath: step.path,
								changeType: "modified",
								summary,
								diffContent: formattedDiff,
								timestamp: Date.now(),
								originalContent: existingContent,
								newContent: newContentAfterApply,
							});
						} else {
							this._reportCorrectionStepProgress(
								`Step ${index + 1} OK: File \`${
									step.path
								}\` content is already as desired, no substantial modifications needed.`
							);
							// Instruction 3: Logging for no-op modification (already handled above, but good to double check)
							console.debug(
								`[Generate/Apply Trace] File: ${step.path}, AI Output: ${aiGeneratedContentForFile}, Applied Content: ${newContentAfterApply}, Error: None (no substantial change)`
							);
						}
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
									[] // No activeChildProcesses management in EnhancedCodeGenerator
								);

								if (commandResult.exitCode !== 0) {
									const errorMessage = `Command \`${step.command}\` failed with exit code ${commandResult.exitCode}.
                                    \n--- STDOUT ---\n${commandResult.stdout}
                                    \n--- STDERR ---\n${commandResult.stderr}`;

									this._reportCorrectionStepProgress(
										`Step ${index + 1} FAILED: Command execution error.`,
										true,
										errorMessage
									);

									// If a command fails within a correction plan, the correction plan itself failed.
									throw new Error(
										`Command execution failed: ${step.command}. Output: ${errorMessage}`
									);
								} else {
									const successMessage = `Command \`${step.command}\` executed successfully.
                                    \n--- STDOUT ---\n${commandResult.stdout}
                                    \n--- STDERR ---\n${commandResult.stderr}`;

									this._reportCorrectionStepProgress(
										`Step ${index + 1} OK: Command executed.`,
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
									true
								);
								// Re-throw to indicate step failure to the orchestration method
								throw detailedError;
							}
						} else {
							currentStepCompletedSuccessfullyOrSkipped = true;
							this._reportCorrectionStepProgress(
								`Step ${index + 1} SKIPPED by user.`
							);
						}
					}
				} catch (error: any) {
					let errorMsg = formatUserFacingErrorMessage(
						error,
						"Failed to execute correction plan step. Please review the details.",
						"Step execution failed: ",
						rootUri // Pass rootUri for proper formatting
					);

					let isRetryableTransientError = false;
					if (errorMsg.includes(ERROR_OPERATION_CANCELLED)) {
						throw error;
					}

					// Implement transient error identification
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
							true
						);
						// For steps within a correction plan, if they fail critically, we bubble up.
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
		let currentContent = initialContent; // This will be updated within the loop
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

		// Initial progress for correction loop
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
			const contentBeforeAttempt = currentContent; // Capture content state BEFORE this attempt
			const issuesBeforeAttempt = [...validationResult.issues];
			const issuesBeforeAttemptCount = issuesBeforeAttempt.length;

			this._sendFeedback(feedbackCallback, {
				stage: "correction",
				message: `Generating correction plan (attempt ${iteration})...`,
				issues: issuesBeforeAttempt,
				suggestions: [],
				progress: 20 + iteration * (60 / this.config.maxFeedbackIterations!), // Allocate 60% of progress for corrections
			});

			// Instruction 2: Refresh AI context variables (currentContent, projectContext, relevantSnippets, EditorContext)
			currentContext.fileStructureAnalysis = await analyzeFileStructure(
				filePath,
				currentContent
			); // Refresh file structure with latest content
			currentContext =
				await this.contextRefresherService.refreshErrorFocusedContext(
					filePath,
					currentContent, // Pass the *latest* content
					issuesBeforeAttempt,
					currentContext,
					token
				);

			// Re-format relevant files into snippets for each correction attempt.
			let relevantFilesToFormat: string[] = [];
			if (context.relevantFiles) {
				// Use the original context's relevant files list
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
			currentContext.relevantSnippets = updatedRelevantSnippets; // Update currentContext with new snippets

			// Prepare editorContext specific to the current file for the prompt.
			const fileSpecificEditorContext: EditorContext = {
				...((context.editorContext || {}) as EditorContext), // Base from context, ensuring it's an object
				filePath: filePath,
				documentUri: vscode.Uri.file(filePath),
				fullText: currentContent, // Ensure fullText reflects the latest state
				// selection and selectedText might not be relevant here for auto-correction,
				// but keep them if they exist in the original editorContext.
			};
			currentContext.editorContext = fileSpecificEditorContext; // Update editorContext in currentContext

			let correctionFeedbackForPrompt: CorrectionFeedback | undefined;
			let parsingFailedForThisAttempt = false;

			// Check for oscillation from previous attempts
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
					// Instruction 1: Enrich CorrectionFeedback: Set type to 'oscillation_detected'
					correctionFeedbackForPrompt = {
						type: "oscillation_detected",
						message: `Detected oscillation: previous two attempts resulted in similar unresolved issues.`,
						relevantDiff: lastOutcome.relevantDiff,
						details: {
							previousIssues: lastOutcome.issuesRemaining,
							currentIssues: lastOutcome.issuesRemaining,
							// relevantDiff: lastOutcome.relevantDiff, // Removed as per instruction
						},
						issuesRemaining: lastOutcome.issuesRemaining,
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

			// If last attempt specifically failed due to parsing, provide that specific feedback
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

			// Diagnostics string for the prompt
			await DiagnosticService.waitForDiagnosticsToStabilize(
				vscode.Uri.file(filePath),
				token,
				5000,
				100
			);

			// 1. Fetch standard VS Code diagnostics
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

			// 2. Retrieve custom `format_error` issues
			const customFormatIssues = currentDiagnostics.filter(
				(issue) => issue.type === "format_error"
			);

			// 3. Format these `customFormatIssues` into a readable string.
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
								severityVscode = vscode.DiagnosticSeverity.Information; // Default to info
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

			// 4. Combine the diagnostics strings.
			let combinedDiagnosticsString = "";
			if (
				diagnosticsFromVsCode !== null &&
				diagnosticsFromVsCode !== "No specific diagnostics found."
			) {
				combinedDiagnosticsString += diagnosticsFromVsCode;
			}

			if (formattedCustomIssues !== "") {
				if (combinedDiagnosticsString !== "") {
					combinedDiagnosticsString += "\n\n"; // Separator
				}
				combinedDiagnosticsString += formattedCustomIssues;
			}

			// 5. Assign the final `combinedDiagnosticsString` to the `diagnosticsForPrompt` variable.
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
				fileSpecificEditorContext, // Use the file-specific editor context
				[], // Chat history is not managed by EnhancedCodeGenerator
				currentContext.relevantSnippets,
				diagnosticsForPrompt,
				formattedRecentChanges,
				correctionFeedbackForPrompt,
				currentContext.activeSymbolInfo,
				jsonEscapingInstructionsForPrompt
			);

			let aiGeneratedPlanContent: string = ""; // Initialized with empty string for logging
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
				// This assignment is now type-safe
				parsedPlan = parsedResult.plan;
				parsingError = parsedResult.error;

				if (parsingError) {
					parsingFailedForThisAttempt = true;
					this._reportCorrectionStepProgress(
						`AI generated a malformed correction plan (iteration ${iteration}). Error: ${parsingError}`,
						true,
						aiGeneratedPlanContent
					);
					console.error(`Malformed plan from AI:\n`, aiGeneratedPlanContent);
					// Instruction 3: Logging AI content vs Applied content during errors
					console.debug(
						`[Generate/Apply Trace] File: ${filePath}, AI Output: ${aiGeneratedPlanContent}, Applied Content: ${currentContent}, Error: ${parsingError}`
					);
					throw new Error(parsingError); // Throw to be caught by outer catch for logging
				}
			} catch (e: any) {
				// This catch handles AI generation failure or direct parsing errors thrown by _parseAndValidateCorrectionPlan
				parsingFailedForThisAttempt = true;
				const errorMessage = `Failed to generate/parse correction plan: ${e.message}`;
				console.error(`[EnhancedCodeGenerator] ${errorMessage}`, e);
				// Instruction 3: Logging AI content vs Applied content during errors
				console.debug(
					`[Generate/Apply Trace] File: ${filePath}, AI Output: ${aiGeneratedPlanContent}, Applied Content: ${currentContent}, Error: ${errorMessage}`
				);

				// Instruction 1: Enrich CorrectionFeedback for parsing_failed
				correctionFeedbackForPrompt = {
					type: "parsing_failed",
					message: errorMessage,
					details: {
						parsingError: e.message,
						failedJson: aiGeneratedPlanContent || "N/A",
						previousIssues: issuesBeforeAttempt,
						currentIssues: issuesBeforeAttempt, // No change as parsing failed
						// relevantDiff: "", // Removed from details as it's top-level
					},
					issuesRemaining: issuesBeforeAttempt,
					relevantDiff: "", // No diff if parsing failed, ensure top-level
					issuesIntroduced: [], // Add if not explicitly there, to conform to type
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
					failureType: "parsing_failed", // Added: failureType
					feedbackUsed: correctionFeedbackForPrompt,
					aiGeneratedContent: aiGeneratedPlanContent, // Capture AI output
				};
				// Continue to next iteration if retries are available
				continue;
			}

			// If plan parsed successfully, execute it
			let didPlanExecuteSuccessfully = true;
			try {
				if (parsedPlan && parsedPlan.steps && parsedPlan.steps.length > 0) {
					this._reportCorrectionStepProgress(
						`Executing correction plan for '${filePath}' (iteration ${iteration})...`
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
					// After plan execution, refresh content and diagnostics for the target file
					// It's possible the plan modified other files, but our primary loop is for `filePath`
					const contentBuffer = await vscode.workspace.fs.readFile(
						vscode.Uri.file(filePath)
					);
					currentContent = Buffer.from(contentBuffer).toString("utf-8");
				} else {
					didPlanExecuteSuccessfully = false; // Flag that execution was not successful (due to empty plan)
					this._reportCorrectionStepProgress(
						`AI generated an empty or no-op correction plan for '${filePath}' (iteration ${iteration}).`,
						true
					);
					// Treat as no improvement if no steps were executed
					throw new Error("Empty or no-op correction plan generated.");
				}
			} catch (executionError: any) {
				didPlanExecuteSuccessfully = false;
				if (executionError.message === ERROR_OPERATION_CANCELLED) {
					throw executionError; // Bubble up cancellation
				}
				const errorMessage = `Correction plan execution failed: ${executionError.message}`;
				this._reportCorrectionStepProgress(errorMessage, true);
				console.error(
					`[EnhancedCodeGenerator] ${errorMessage}`,
					executionError
				);
				// Instruction 3: Logging AI content vs Applied content during errors
				console.debug(
					`[Generate/Apply Trace] File: ${filePath}, AI Output: ${aiGeneratedPlanContent}, Applied Content: ${currentContent}, Error: ${errorMessage}`
				);

				// Instruction 1: Enrich CorrectionFeedback for command_failed
				correctionFeedbackForPrompt = {
					type: "command_failed", // Generalizing execution failures to 'command_failed' for now. Could be 'unknown' or 'unreasonable_diff'
					message: errorMessage,
					details: {
						previousIssues: issuesBeforeAttempt,
						currentIssues: issuesBeforeAttempt, // No change if execution failed
						// relevantDiff: "", // Removed from details as it's top-level
					},
					issuesRemaining: issuesBeforeAttempt,
					relevantDiff: "", // Difficult to capture diff on execution failure, ensure top-level
					issuesIntroduced: [], // Add if not explicitly there, to conform to type
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
					type: "command_failed", // Adjust type if specific failure is known
					failureType: "command_failed", // Added: failureType
					feedbackUsed: correctionFeedbackForPrompt,
					aiGeneratedContent: aiGeneratedPlanContent, // Capture AI output
				};
				// Continue to next iteration if retries are available
				continue;
			}

			// Re-validate after applying changes
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
			// Instruction 1: Calculate issuesIntroduced
			const issuesIntroduced = issuesAfterAttempt.filter(
				(newIssue) =>
					!issuesBeforeAttempt.some((oldIssue) =>
						areIssuesSimilar([newIssue], [oldIssue])
					)
			);
			// Instruction 1: Generate relevantDiff for the entire iteration
			const { formattedDiff: relevantDiff } = await generateFileChangeSummary(
				contentBeforeAttempt, // Content before this iteration
				currentContent, // Content after this iteration
				filePath
			);

			// Instruction 1: Determine outcome and failureType
			let outcomeType: CorrectionAttemptOutcome["type"];
			let failureType: CorrectionAttemptOutcome["failureType"];
			let aiFailureAnalysisMessage: string;

			// Explicitly set `failureType = "unknown"` in the success case (`issuesAfterAttemptCount === 0`).
			if (issuesAfterAttemptCount === 0) {
				outcomeType = "unknown"; // Success, so not really a "type" of failure
				failureType = "unknown"; // Success, so not a failure type
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
				// If issues still exist and no new errors, no oscillation, and not a success
				// This implies !wasImprovement and issuesAfterAttemptCount > 0
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
				issuesIntroduced: issuesIntroduced, // Populate issuesIntroduced
				relevantDiff: relevantDiff, // Populate relevantDiff
				aiFailureAnalysis: aiFailureAnalysisMessage,
				type: outcomeType,
				failureType: failureType, // Set the determined failureType
				feedbackUsed: correctionFeedbackForPrompt, // Store the feedback used to generate THIS plan
				aiGeneratedContent: aiGeneratedPlanContent, // Capture AI output
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
				this._sendFeedback(feedbackCallback, {
					stage: "completion",
					message: `Correction successful (iteration ${iteration})!`,
					issues: [],
					suggestions: [],
					progress: 100,
				});
				currentContext.recentCorrectionAttemptOutcomes = []; // Clear history on success
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
				// Issues remain, or new errors introduced. Update feedback for next iteration.
				// Instruction 1: Enrich CorrectionFeedback for the next AI prompt
				correctionFeedbackForPrompt = {
					type: failureType, // Set type appropriately
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
				// Note: 'parsing_failed' and 'command_failed' feedback is sent in their respective catch blocks,
				// which then causes a 'continue' in the loop, preventing this section from being reached.
				// So, no explicit 'else if' for those types is needed here.
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

		// If initial generation is perfect, return early
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
					iterations: 1, // First iteration was success
				},
			};
		}

		// Proceed to correction phase if issues exist
		this._sendFeedback(feedbackCallback, {
			stage: "validation",
			message: `Initial generation has issues. Starting correction loop...`,
			issues: combinedIssues,
			suggestions: [],
			progress: 20,
		});

		const finalCorrectionResult = await this._generateAndExecuteCorrectionPlan(
			filePath,
			currentContent, // Pass the initial content to the correction loop
			combinedIssues, // Issues from initial generation
			currentContext,
			modelName,
			streamId,
			token!, // Token is guaranteed by public API
			feedbackCallback!, // Callback is guaranteed by public API
			generatePrompt, // Pass the original prompt as instruction for the plan generation
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
import * as vscode from "vscode";
import * as path from "path";
import BPromise from "bluebird"; // Added for parallelization
import { GenerationConfig } from "@google/generative-ai";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import * as sidebarTypes from "../sidebar/common/sidebarTypes";
import { ExtensionToWebviewMessages } from "../sidebar/common/sidebarTypes";
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
	CreateDirectoryStep,
	CreateFileStep,
	ModifyFileStep,
	RunCommandStep,
} from "../ai/workflowPlanner";
import { generateFileChangeSummary } from "../utils/diffingUtils";
import { FileChangeEntry } from "../types/workflow";
import { GitConflictResolutionService } from "./gitConflictResolutionService";
import { applyAITextEdits } from "../utils/codeUtils";
import { DiagnosticService } from "../utils/diagnosticUtils";
import { formatUserFacingErrorMessage } from "../utils/errorFormatter";
import { UrlContextService } from "./urlContextService";
import { EnhancedCodeGenerator, CodeIssue } from "../ai/enhancedCodeGeneration";
import { executeCommand, CommandResult } from "../utils/commandExecution";
import {
	createInitialPlanningExplanationPrompt,
	createPlanningPrompt,
} from "../ai/prompts/planningPrompts";
import {
	createCorrectionPlanPrompt,
	CorrectionFeedback,
} from "../ai/prompts/correctionPrompts";
import { areIssuesSimilar } from "../utils/aiUtils";
import { cleanCodeOutput } from "../utils/codeUtils";
import { repairJsonEscapeSequences } from "../utils/jsonUtils";
import { ParallelProcessor } from "../utils/parallelProcessor"; // Import ParallelProcessor

export class PlanService {
	// Audited retry constants and made configurable via VS Code settings
	private readonly MAX_PLAN_PARSE_RETRIES: number;
	private readonly MAX_TRANSIENT_STEP_RETRIES: number;
	private readonly MAX_CORRECTION_PLAN_ATTEMPTS: number; // Max attempts for AI to generate a valid correction *plan*
	private urlContextService: UrlContextService;
	private enhancedCodeGenerator: EnhancedCodeGenerator;
	// To store correction attempt history per file
	private fileCorrectionAttemptHistory: Map<
		string,
		{
			iteration: number;
			issuesRemaining: CodeIssue[];
			success: boolean;
			feedbackUsed?: CorrectionFeedback;
		}[]
	> = new Map();

	constructor(
		private provider: SidebarProvider,
		private workspaceRootUri: vscode.Uri | undefined,
		private gitConflictResolutionService: GitConflictResolutionService,
		enhancedCodeGenerator: EnhancedCodeGenerator,
		private postMessageToWebview: (message: ExtensionToWebviewMessages) => void
	) {
		this.urlContextService = new UrlContextService();
		this.enhancedCodeGenerator = enhancedCodeGenerator;

		// Read retry constants from VS Code settings, with fallbacks to defaults
		const config = vscode.workspace.getConfiguration(
			"minovativeMind.planExecution"
		);
		this.MAX_PLAN_PARSE_RETRIES = config.get("maxPlanParseRetries", 3);
		this.MAX_TRANSIENT_STEP_RETRIES = config.get("maxTransientStepRetries", 3);
		this.MAX_CORRECTION_PLAN_ATTEMPTS = config.get(
			"maxCorrectionPlanAttempts",
			3
		);
	}

	/**
	 * Triggers the UI to display the textual plan for review.
	 * This public method acts as a wrapper for the private _handlePostTextualPlanGenerationUI.
	 * @param planContext The context containing the generated plan and associated data.
	 */
	public async triggerPostTextualPlanUI(
		planContext: sidebarTypes.PlanGenerationContext
	): Promise<void> {
		return this._handlePostTextualPlanGenerationUI(planContext);
	}

	// --- CHAT-INITIATED PLAN ---
	public async handleInitialPlanRequest(userRequest: string): Promise<void> {
		const { apiKeyManager, changeLogger } = this.provider;
		const modelName = sidebarConstants.DEFAULT_FLASH_LITE_MODEL; // Use default model for initial plan generation
		const apiKey = apiKeyManager.getActiveApiKey();

		if (!apiKey) {
			this.provider.postMessageToWebview({
				type: "statusUpdate",
				value:
					"Action blocked: No active API key found. Please add or select an API key in the sidebar settings.",
				isError: true,
			});
			return;
		}

		this.provider.activeOperationCancellationTokenSource =
			new vscode.CancellationTokenSource();
		const token = this.provider.activeOperationCancellationTokenSource.token;

		changeLogger.clear();

		const rootFolder = vscode.workspace.workspaceFolders?.[0];
		if (!rootFolder) {
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: false,
				error:
					"Action blocked: No VS Code workspace folder is currently open. Please open a project folder to proceed.",
			});
			return;
		}

		let success = false;
		let textualPlanResponse: string | null = null;
		let finalErrorForDisplay: string | null = null;

		try {
			this.provider.pendingPlanGenerationContext = null;

			const buildContextResult =
				await this.provider.contextService.buildProjectContext(
					token,
					userRequest,
					undefined, // Pass undefined for editorContext
					undefined, // Pass undefined for initialDiagnosticsString
					undefined, // Pass undefined for options
					false, // CRITICAL: Pass false to exclude the AI persona
					false // Add false for includeVerboseHeaders
				);
			const { contextString, relevantFiles } = buildContextResult;

			// Initialize currentAiStreamingState immediately before aiResponseStart
			this.provider.currentAiStreamingState = {
				content: "",
				relevantFiles: relevantFiles,
				isComplete: false,
				isError: false,
			};
			// Add new aiResponseStart message here with relevantFiles
			this.provider.postMessageToWebview({
				type: "aiResponseStart",
				value: { modelName, relevantFiles: relevantFiles },
			});
			this.provider.postMessageToWebview({
				type: "updateStreamingRelevantFiles",
				value: relevantFiles,
			});

			if (contextString.startsWith("[Error")) {
				throw new Error(contextString);
			}

			// Process URLs in user request for context
			const urlContexts =
				await this.urlContextService.processMessageForUrlContext(userRequest);
			const urlContextString =
				this.urlContextService.formatUrlContexts(urlContexts);

			const textualPlanPrompt = createInitialPlanningExplanationPrompt(
				contextString,
				userRequest,
				undefined,
				undefined,
				[...this.provider.chatHistoryManager.getChatHistory()],
				urlContextString
			);

			let accumulatedTextualResponse = "";
			// Line 164: Modify first argument to wrap string prompt in HistoryEntryPart array
			textualPlanResponse =
				await this.provider.aiRequestService.generateWithRetry(
					[{ text: textualPlanPrompt }],
					modelName,
					undefined,
					"initial plan explanation",
					undefined,
					{
						onChunk: (chunk: string) => {
							accumulatedTextualResponse += chunk;
							if (this.provider.currentAiStreamingState) {
								this.provider.currentAiStreamingState.content += chunk;
							}
							this.provider.postMessageToWebview({
								type: "aiResponseChunk",
								value: chunk,
							});
						},
					},
					token
				);

			if (token.isCancellationRequested) {
				throw new Error(ERROR_OPERATION_CANCELLED);
			}
			if (textualPlanResponse.toLowerCase().startsWith("error:")) {
				throw new Error(
					formatUserFacingErrorMessage(
						new Error(textualPlanResponse),
						"AI failed to generate initial plan explanation.",
						"AI response error: ",
						rootFolder.uri
					)
				);
			}

			this.provider.chatHistoryManager.addHistoryEntry(
				"model",
				textualPlanResponse,
				undefined,
				relevantFiles,
				relevantFiles && relevantFiles.length <= 3,
				true // Added: Mark as plan explanation
			);
			this.provider.chatHistoryManager.restoreChatHistoryToWebview();
			success = true;

			this.provider.pendingPlanGenerationContext = {
				type: "chat",
				originalUserRequest: userRequest,
				projectContext: contextString,
				relevantFiles,
				activeSymbolDetailedInfo: buildContextResult.activeSymbolDetailedInfo,
				initialApiKey: apiKey,
				modelName,
				chatHistory: [...this.provider.chatHistoryManager.getChatHistory()],
				textualPlanExplanation: textualPlanResponse,
				workspaceRootUri: rootFolder.uri,
			};
			this.provider.lastPlanGenerationContext = {
				...this.provider.pendingPlanGenerationContext,
				relevantFiles,
			};

			// Add the following code here
			const dataToPersist: sidebarTypes.PersistedPlanData = {
				type: this.provider.pendingPlanGenerationContext.type,
				originalUserRequest:
					this.provider.pendingPlanGenerationContext.originalUserRequest,
				originalInstruction:
					this.provider.pendingPlanGenerationContext.editorContext?.instruction,
				relevantFiles: this.provider.pendingPlanGenerationContext.relevantFiles,
				textualPlanExplanation: textualPlanResponse, // Pass the full generated text
			};
			await this.provider.updatePersistedPendingPlanData(dataToPersist);
			// End of added code
		} catch (error: any) {
			if (this.provider.currentAiStreamingState) {
				this.provider.currentAiStreamingState.isError = true;
			}
			finalErrorForDisplay = error.message;
		} finally {
			if (this.provider.currentAiStreamingState) {
				this.provider.currentAiStreamingState.isComplete = true;
			}
			const isCancellation = finalErrorForDisplay === ERROR_OPERATION_CANCELLED;

			// Determine if the generated response is a confirmable plan
			const isConfirmablePlanResponse =
				success &&
				!!this.provider.pendingPlanGenerationContext?.textualPlanExplanation;

			// Construct and post the aiResponseEnd message directly
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: success,
				// Conditionally include error
				...((!success || isCancellation) && {
					error: isCancellation
						? "Plan generation cancelled."
						: formatUserFacingErrorMessage(
								finalErrorForDisplay
									? new Error(finalErrorForDisplay)
									: new Error("Unknown error"), // Pass an actual Error instance
								"An unexpected error occurred during initial plan generation.",
								"AI response error: ",
								rootFolder.uri
						  ),
				}),
				// Conditionally include plan-related data if it's a confirmable plan response
				...(isConfirmablePlanResponse &&
					this.provider.pendingPlanGenerationContext && {
						isPlanResponse: true,
						requiresConfirmation: true,
						planData: {
							type: "textualPlanPending", // Use "textualPlanPending" for webview message
							originalRequest:
								this.provider.pendingPlanGenerationContext.type === "chat"
									? this.provider.pendingPlanGenerationContext
											.originalUserRequest
									: undefined,
							originalInstruction:
								this.provider.pendingPlanGenerationContext.type === "editor"
									? this.provider.pendingPlanGenerationContext.editorContext
											?.instruction
									: undefined,
							relevantFiles:
								this.provider.pendingPlanGenerationContext.relevantFiles,
							textualPlanExplanation:
								this.provider.pendingPlanGenerationContext
									.textualPlanExplanation,
						},
					}),
			});

			this.provider.activeOperationCancellationTokenSource?.dispose();
			this.provider.activeOperationCancellationTokenSource = undefined;
		}
	}

	// --- EDITOR-INITIATED PLAN ---
	public async initiatePlanFromEditorAction(
		instruction: string,
		selectedText: string,
		fullText: string,
		languageId: string,
		documentUri: vscode.Uri,
		selection: vscode.Range,
		initialProgress?: vscode.Progress<{ message?: string; increment?: number }>,
		initialToken?: vscode.CancellationToken,
		diagnosticsString?: string,
		isMergeOperation: boolean = false
	): Promise<sidebarTypes.PlanGenerationResult> {
		const { apiKeyManager, changeLogger } = this.provider;
		const modelName = sidebarConstants.DEFAULT_FLASH_LITE_MODEL; // Use default model for editor-initiated plan generation
		const apiKey = apiKeyManager.getActiveApiKey();

		const rootFolder = vscode.workspace.workspaceFolders?.[0];
		if (!rootFolder) {
			initialProgress?.report({
				message: "Error: No workspace folder open.",
				increment: 100,
			});
			return {
				success: false,
				error:
					"Action blocked: No VS Code workspace folder is currently open. Please open a project folder to proceed.",
			};
		}

		this.provider.activeOperationCancellationTokenSource =
			new vscode.CancellationTokenSource();
		const activeOpToken =
			this.provider.activeOperationCancellationTokenSource.token;

		const disposable = initialToken?.onCancellationRequested(() => {
			this.provider.activeOperationCancellationTokenSource?.cancel();
		});

		if (activeOpToken.isCancellationRequested) {
			initialProgress?.report({
				message: "Plan generation cancelled.",
				increment: 100,
			});
			disposable?.dispose();
			return { success: false, error: "Plan generation cancelled." };
		}

		changeLogger.clear();

		let finalResult: sidebarTypes.PlanGenerationResult = {
			success: false,
			error: "An unexpected error occurred during plan generation.",
		};

		try {
			this.provider.pendingPlanGenerationContext = null;

			const relativeFilePath = path
				.relative(rootFolder.uri.fsPath, documentUri.fsPath)
				.replace(/\\/g, "/");

			const editorCtx: sidebarTypes.EditorContext = {
				instruction,
				selectedText,
				fullText,
				languageId,
				filePath: relativeFilePath,
				documentUri,
				selection,
			};

			const buildContextResult =
				await this.provider.contextService.buildProjectContext(
					activeOpToken,
					editorCtx.instruction,
					editorCtx,
					diagnosticsString,
					undefined, // Pass undefined for options
					false, // CRITICAL: Pass false to exclude the AI persona
					false // Add false for includeVerboseHeaders
				);
			const { contextString, relevantFiles } = buildContextResult;

			// Initialize currentAiStreamingState if not already set (aiResponseStart was sent from extension.ts)
			if (!this.provider.currentAiStreamingState) {
				this.provider.currentAiStreamingState = {
					content: "",
					relevantFiles: relevantFiles,
					isComplete: false,
					isError: false,
				};
			} else {
				// Update the relevantFiles in the existing streaming state
				this.provider.currentAiStreamingState.relevantFiles = relevantFiles;
			}
			this.provider.postMessageToWebview({
				type: "updateStreamingRelevantFiles",
				value: relevantFiles,
			});

			if (contextString.startsWith("[Error")) {
				throw new Error(contextString);
			}

			const textualPlanPrompt = createInitialPlanningExplanationPrompt(
				contextString,
				undefined,
				editorCtx,
				diagnosticsString,
				[...this.provider.chatHistoryManager.getChatHistory()]
			);

			initialProgress?.report({
				message: "Generating textual plan explanation...",
				increment: 20,
			});

			let textualPlanResponse = "";
			// Line 421: Modify first argument to wrap string prompt in HistoryEntryPart array
			textualPlanResponse =
				await this.provider.aiRequestService.generateWithRetry(
					[{ text: textualPlanPrompt }],
					modelName,
					undefined,
					"editor action plan explanation",
					undefined,
					{
						onChunk: (chunk: string) => {
							textualPlanResponse += chunk;
							this.provider.postMessageToWebview({
								type: "aiResponseChunk",
								value: chunk,
							});
						},
					},
					activeOpToken
				);

			if (activeOpToken.isCancellationRequested) {
				throw new Error(ERROR_OPERATION_CANCELLED);
			}
			if (textualPlanResponse.toLowerCase().startsWith("error:")) {
				throw new Error(textualPlanResponse);
			}

			this.provider.chatHistoryManager.addHistoryEntry(
				"model",
				textualPlanResponse,
				undefined,
				relevantFiles,
				relevantFiles && relevantFiles.length <= 3,
				true
			);
			initialProgress?.report({
				message: "Textual plan generated.",
				increment: 100,
			});

			this.provider.pendingPlanGenerationContext = {
				type: "editor",
				editorContext: editorCtx,
				projectContext: contextString,
				relevantFiles,
				activeSymbolDetailedInfo: buildContextResult.activeSymbolDetailedInfo,
				diagnosticsString,
				initialApiKey: apiKey!,
				modelName,
				chatHistory: [...this.provider.chatHistoryManager.getChatHistory()],
				textualPlanExplanation: textualPlanResponse,
				workspaceRootUri: rootFolder.uri,
				isMergeOperation: isMergeOperation,
			};
			this.provider.lastPlanGenerationContext = {
				...this.provider.pendingPlanGenerationContext,
				relevantFiles,
			};

			// ADDED: Persist the pending plan data here for editor-initiated plans
			const dataToPersist: sidebarTypes.PersistedPlanData = {
				type: "editor",
				originalInstruction: editorCtx.instruction,
				relevantFiles: relevantFiles,
				textualPlanExplanation: textualPlanResponse,
			};
			await this.provider.updatePersistedPendingPlanData(dataToPersist);

			// Set isGeneratingUserRequest to true for persistence like /plan
			this.provider.isGeneratingUserRequest = true;
			await this.provider.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				true
			);
			// END ADDED

			finalResult = {
				success: true,
				textualPlanExplanation: textualPlanResponse,
				context: this.provider.pendingPlanGenerationContext,
			};
		} catch (genError: any) {
			const isCancellation = genError.message === ERROR_OPERATION_CANCELLED;
			if (this.provider.currentAiStreamingState) {
				this.provider.currentAiStreamingState.isError = true;
			}
			finalResult = {
				success: false,
				error: isCancellation
					? "Plan generation cancelled."
					: formatUserFacingErrorMessage(
							genError,
							"An unexpected error occurred during editor action plan generation.",
							"Error: ",
							rootFolder.uri
					  ),
			};
		} finally {
			// Mark streaming state as complete
			if (this.provider.currentAiStreamingState) {
				this.provider.currentAiStreamingState.isComplete = true;
			}

			// Determine if the generated response is a confirmable plan
			const isConfirmablePlanResponse =
				finalResult.success &&
				!!this.provider.pendingPlanGenerationContext?.textualPlanExplanation;

			// Construct and post the aiResponseEnd message directly
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: finalResult.success,
				// Conditionally include error
				...(!finalResult.success &&
					finalResult.error && {
						error: finalResult.error,
					}),
				// Conditionally include plan-related data if it's a confirmable plan response
				...(isConfirmablePlanResponse &&
					this.provider.pendingPlanGenerationContext && {
						isPlanResponse: true,
						requiresConfirmation: true,
						planData: {
							type: "textualPlanPending",
							originalRequest:
								this.provider.pendingPlanGenerationContext.type === "chat"
									? this.provider.pendingPlanGenerationContext
											.originalUserRequest
									: undefined,
							originalInstruction:
								this.provider.pendingPlanGenerationContext.type === "editor"
									? this.provider.pendingPlanGenerationContext.editorContext
											?.instruction
									: undefined,
							relevantFiles:
								this.provider.pendingPlanGenerationContext.relevantFiles,
							textualPlanExplanation:
								this.provider.pendingPlanGenerationContext
									.textualPlanExplanation,
						},
					}),
			});
			disposable?.dispose();
			this.provider.activeOperationCancellationTokenSource?.dispose();
			this.provider.chatHistoryManager.restoreChatHistoryToWebview();
			this.provider.activeOperationCancellationTokenSource = undefined;
			return finalResult;
		}
	}

	/**
	 * Attempts to parse and validate JSON, applying programmatic repair for escape sequence errors.
	 * @param jsonString The raw JSON string to parse.
	 * @param workspaceRootUri The root URI of the workspace for context.
	 * @returns A promise resolving to the parsed plan or an error.
	 */
	private async parseAndValidatePlanWithFix(
		jsonString: string,
		workspaceRootUri: vscode.Uri
	): Promise<ParsedPlanResult> {
		try {
			// 1. Attempt initial parse and validation.
			let parsedResult = await parseAndValidatePlan(
				jsonString,
				workspaceRootUri
			);

			// 2. Check if parsing failed and if the error is specifically about escaped characters.
			if (!parsedResult.plan && parsedResult.error) {
				const errorMessageLower = parsedResult.error.toLowerCase();
				if (errorMessageLower.includes("bad escaped character")) {
					console.log(
						"[PlanService] Detected 'Bad escaped character' error. Attempting programmatic repair."
					);

					// Attempt programmatic repair.
					const repairedJsonString = repairJsonEscapeSequences(jsonString);

					// Only re-parse if the repair function actually changed the string.
					if (repairedJsonString !== jsonString) {
						console.log(
							"[PlanService] Re-parsing JSON after programmatic repair."
						);
						// 3. Attempt to parse the repaired JSON.
						const reParsedResult = await parseAndValidatePlan(
							repairedJsonString,
							workspaceRootUri
						);

						if (reParsedResult.plan) {
							// 4. Repair was successful. Return the repaired plan.
							console.log("[PlanService] Programmatic JSON repair successful.");
							return reParsedResult;
						} else {
							// Repair failed. Report a combined error.
							console.warn(
								"[PlanService] Programmatic JSON repair failed. Original error:",
								parsedResult.error,
								"Repair error:",
								reParsedResult.error
							);
							return {
								plan: null,
								error: `JSON parsing failed: Original error "${parsedResult.error}". Programmatic repair failed with error: "${reParsedResult.error}".`,
							};
						}
					} else {
						// Repair function didn't change the string, implies no fix was applied or needed for this specific error type.
						console.log(
							"[PlanService] Repair function did not alter JSON. Proceeding with original error."
						);
						// Fallback to the original error.
						return parsedResult;
					}
				} else {
					// Error is not related to escaped characters, return original result.
					return parsedResult;
				}
			} else {
				// Initial parse was successful.
				return parsedResult;
			}
		} catch (e: any) {
			// Catch any exceptions during the process (e.g., parseAndValidatePlan itself throws).
			console.error(
				"[PlanService] Exception during parseAndValidatePlanWithFix:",
				e
			);
			return {
				plan: null,
				error: `An unexpected error occurred during JSON parsing/validation: ${e.message}`,
			};
		}
	}
	// --- PLAN GENERATION & EXECUTION ---
	public async generateStructuredPlanAndExecute(
		planContext: sidebarTypes.PlanGenerationContext
	): Promise<void> {
		await this.provider.setPlanExecutionActive(true);

		// Notify webview that structured plan generation is starting - this will hide the stop button
		this.provider.postMessageToWebview({
			type: "updateLoadingState",
			value: true,
		});

		let structuredPlanJsonString = "";
		const token = this.provider.activeOperationCancellationTokenSource?.token;

		// Initialize retry variables
		let retryAttempt = 0;
		let executablePlan: ExecutionPlan | null = null;
		let lastParsingError: string | undefined;
		let lastFailedJson: string | undefined;

		try {
			await this.provider.updatePersistedPendingPlanData(null); // Clear persisted data as it's no longer pending confirmation

			if (token?.isCancellationRequested) {
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			const jsonGenerationConfig: GenerationConfig = {
				responseMimeType: "application/json",
				temperature: sidebarConstants.TEMPERATURE,
			};

			const recentChanges = this.provider.changeLogger.getChangeLog();
			const formattedRecentChanges =
				this._formatRecentChangesForPrompt(recentChanges);

			// Process URLs in the original user request for context
			const urlContexts =
				await this.urlContextService.processMessageForUrlContext(
					planContext.originalUserRequest || ""
				);
			const urlContextString =
				this.urlContextService.formatUrlContexts(urlContexts);

			// Initial prompt creation outside the loop. This variable will be updated for retries.
			// Pass JSON_ESCAPING_INSTRUCTIONS for the initial prompt generation.
			let currentJsonPlanningPrompt = createPlanningPrompt(
				planContext.type === "chat"
					? planContext.originalUserRequest
					: undefined,
				planContext.projectContext,
				planContext.type === "editor" ? planContext.editorContext : undefined,
				undefined,
				planContext.chatHistory,
				planContext.textualPlanExplanation,
				formattedRecentChanges,
				urlContextString
			);

			// Start of the retry loop
			while (retryAttempt <= this.MAX_PLAN_PARSE_RETRIES) {
				if (token?.isCancellationRequested) {
					throw new Error(ERROR_OPERATION_CANCELLED);
				}

				// Inform the user about the attempt
				if (retryAttempt > 0) {
					this._logStepProgress(
						0,
						0, // Not a specific step number
						`JSON plan parsing failed. Retrying (Attempt ${retryAttempt}/${this.MAX_PLAN_PARSE_RETRIES})...`,
						0,
						0, // No transient attempt for this loop
						true
					);
					console.log(
						`JSON plan parsing failed. Retrying (Attempt ${retryAttempt}/${this.MAX_PLAN_PARSE_RETRIES})...`
					);
				} else {
					console.log(`Initial attempt to generate and parse structured plan.`);
				}

				// AI Request
				structuredPlanJsonString =
					await this.provider.aiRequestService.generateWithRetry(
						[{ text: currentJsonPlanningPrompt }],
						sidebarConstants.DEFAULT_FLASH_LITE_MODEL,
						undefined,
						"structured plan generation",
						jsonGenerationConfig,
						undefined,
						token
					);

				if (token?.isCancellationRequested) {
					throw new Error(ERROR_OPERATION_CANCELLED);
				}
				if (structuredPlanJsonString.toLowerCase().startsWith("error:")) {
					throw new Error(
						formatUserFacingErrorMessage(
							new Error(structuredPlanJsonString),
							"The AI failed to generate a valid structured plan. This might be a model issue.",
							"AI response error: ",
							planContext.workspaceRootUri
						)
					);
				}

				// Markdown stripping
				structuredPlanJsonString = structuredPlanJsonString
					.replace(/^\s*/im, "")
					.replace(/\s*$/im, "")
					.trim();

				// JSON Parsing and Validation
				let parsedPlanResult: ParsedPlanResult;
				let currentJsonStringForParse = structuredPlanJsonString; // Start with the AI output
				let successfulRepairOccurred = false; // Flag to indicate if repair fixed the issue

				// Call the enhanced parsing function
				parsedPlanResult = await this.parseAndValidatePlanWithFix(
					currentJsonStringForParse,
					planContext.workspaceRootUri
				);

				if (parsedPlanResult.plan) {
					executablePlan = parsedPlanResult.plan;
					// ADDED CHECK: Ensure the plan has steps before proceeding
					if (executablePlan.steps.length === 0) {
						const errorMsg = `Correction plan generated with no executable steps. This is not allowed.`;
						console.error(`[PlanService] ${errorMsg}`);
						// Treat this as a parsing/validation failure to trigger retries or final error reporting
						parsedPlanResult.error = errorMsg; // Set error for retry logic
						parsedPlanResult.plan = null; // Ensure no plan is used
					} else {
						// Success! We have a valid plan, potentially after a repair.
						// We can break the retry loop here, as AI retries are not needed for this specific successful repair.
						successfulRepairOccurred = true; // Mark that repair was successful
					}
				}

				// If we reach here, it means parsing failed (either initially or after repair attempt).
				// Capture error and failed JSON for the retry mechanism.
				lastParsingError =
					parsedPlanResult.error || "Failed to parse the JSON plan from AI.";
				lastFailedJson = currentJsonStringForParse; // The JSON string that was attempted to parse (original AI output)

				// Increment retry count ONLY if AI needs to regenerate the plan.
				// If a successful repair occurred, we do NOT increment the AI retry count.
				if (!successfulRepairOccurred) {
					retryAttempt++;
				}

				// If more retries are available, prepare for the next AI attempt.
				if (
					retryAttempt <= this.MAX_PLAN_PARSE_RETRIES &&
					!successfulRepairOccurred
				) {
					// Update the prompt for the next iteration, including the captured error.
					currentJsonPlanningPrompt = createPlanningPrompt(
						planContext.type === "chat"
							? planContext.originalUserRequest
							: undefined,
						planContext.projectContext,
						planContext.type === "editor"
							? planContext.editorContext
							: undefined,
						// Inject the error message into the prompt for the AI to correct.
						`CRITICAL ERROR: Your previous JSON output failed parsing/validation with the following error: "${lastParsingError}". You MUST correct this. Provide ONLY a valid JSON object according to the schema, with no additional text or explanations. (Attempt ${retryAttempt}/${this.MAX_PLAN_PARSE_RETRIES} to correct JSON)`,
						planContext.chatHistory,
						planContext.textualPlanExplanation,
						formattedRecentChanges,
						urlContextString
					);
				}

				// Check if a plan was successfully obtained after all attempts or if a repair succeeded
				if (
					executablePlan &&
					executablePlan.steps &&
					executablePlan.steps.length > 0 &&
					successfulRepairOccurred
				) {
					break; // Exit retry loop if plan is valid and successful repair occurred.
				} else if (
					retryAttempt > this.MAX_PLAN_PARSE_RETRIES &&
					!successfulRepairOccurred
				) {
					// If all retries failed and no successful repair happened, break to handle final failure.
					break;
				}
			} // End of while loop

			// Check if a plan was successfully obtained after all attempts
			if (!executablePlan) {
				// All retries failed
				const finalErrorMsg = `Failed to generate a valid plan after ${
					this.MAX_PLAN_PARSE_RETRIES
				} attempts. The AI response did not conform to the expected JSON format. Error: ${
					lastParsingError || "Unknown parsing issue"
				}`;
				this._logStepProgress(
					0,
					0, // Not a specific step number
					finalErrorMsg,
					0,
					0, // No transient attempt for this loop
					true
				);

				this.provider.postMessageToWebview({
					type: "structuredPlanParseFailed",
					value: {
						error:
							lastParsingError ||
							"Failed to parse JSON plan after multiple retries.",
						failedJson: lastFailedJson || "N/A",
					},
				});
				this.provider.currentExecutionOutcome = "failed";

				// Notify webview that structured plan generation has ended
				this.provider.postMessageToWebview({
					type: "updateLoadingState",
					value: false,
				});

				await this.provider.endUserOperation("failed"); // Signal failure and re-enable input
				return; // Important: return here to stop further execution
			}

			// If we reached here, executablePlan is valid. Proceed with execution.
			// Note: We don't set loading state to false here because _executePlan will manage it
			this.provider.pendingPlanGenerationContext = null;
			await this._executePlan(
				executablePlan,
				planContext,
				token ?? new vscode.CancellationTokenSource().token
			);
		} catch (error: any) {
			const isCancellation = error.message === ERROR_OPERATION_CANCELLED;

			// Notify webview that structured plan generation has ended
			this.provider.postMessageToWebview({
				type: "updateLoadingState",
				value: false,
			});

			if (isCancellation) {
				this.provider.postMessageToWebview({
					type: "statusUpdate",
					value: "Structured plan generation cancelled.",
				});
				await this.provider.endUserOperation("cancelled"); // Signal cancellation and re-enable input
			} else {
				this.provider.postMessageToWebview({
					type: "statusUpdate",
					value: formatUserFacingErrorMessage(
						error,
						"An unexpected error occurred during plan generation.",
						"Error generating plan: ",
						planContext.workspaceRootUri
					),
					isError: true,
				});
				await this.provider.endUserOperation("failed"); // Signal failure and re-enable input
			}
		}
	}

	private async _executePlan(
		plan: ExecutionPlan,
		planContext: sidebarTypes.PlanGenerationContext,
		operationToken: vscode.CancellationToken
	): Promise<void> {
		this.provider.currentExecutionOutcome = undefined;
		this.provider.activeChildProcesses = [];

		// Use the workspaceRootUri from the class property, which is passed during instantiation
		const rootUri = this.workspaceRootUri;
		if (!rootUri) {
			this.provider.postMessageToWebview({
				type: "statusUpdate",
				value: "Cannot execute plan: no workspace folder open.",
				isError: true,
			});
			return;
		}

		// Notify webview that plan execution is starting - this will hide the stop button
		this.provider.postMessageToWebview({
			type: "updateLoadingState",
			value: true,
		});

		// Notify webview that plan execution has started
		this.provider.postMessageToWebview({
			type: "planExecutionStarted",
		});

		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Minovative Mind: Executing Plan`,
					cancellable: true,
				},
				async (progress, progressNotificationToken) => {
					const combinedTokenSource = new vscode.CancellationTokenSource();
					const combinedToken = combinedTokenSource.token;

					const opListener = operationToken.onCancellationRequested(() =>
						combinedTokenSource.cancel()
					);
					const progListener =
						progressNotificationToken.onCancellationRequested(() =>
							combinedTokenSource.cancel()
						);

					try {
						if (combinedToken.isCancellationRequested) {
							this.provider.currentExecutionOutcome = "cancelled";
							return;
						}

						const originalRootInstruction =
							planContext.type === "chat"
								? planContext.originalUserRequest ?? ""
								: planContext.editorContext!.instruction;

						const affectedFilesSet = await this._executePlanSteps(
							plan.steps!,
							rootUri,
							planContext,
							combinedToken,
							progress,
							originalRootInstruction
						);

						let overallPlanExecutionSuccess = true; // Represents if steps executed without user cancellation/fatal errors

						if (!combinedToken.isCancellationRequested) {
							// If the main plan execution was not cancelled, proceed with final validation
							const finalValidationOutcome =
								await this._performFinalValidationAndCorrection(
									affectedFilesSet,
									rootUri,
									combinedToken,
									planContext,
									progress,
									originalRootInstruction
								);
							// The overall plan is successful only if both steps execution AND final validation succeed
							if (!finalValidationOutcome) {
								overallPlanExecutionSuccess = false;
							}
						} else {
							overallPlanExecutionSuccess = false; // Plan was cancelled during step execution
						}

						// Update currentExecutionOutcome based on the overall success
						if (combinedToken.isCancellationRequested) {
							this.provider.currentExecutionOutcome = "cancelled";
						} else {
							this.provider.currentExecutionOutcome =
								overallPlanExecutionSuccess ? "success" : "failed";
						}
					} finally {
						opListener.dispose();
						progListener.dispose();
						combinedTokenSource.dispose();
					}
				}
			);
		} catch (error: any) {
			const isCancellation =
				error.message.includes("Operation cancelled by user.") ||
				error.message === ERROR_OPERATION_CANCELLED;
			this.provider.currentExecutionOutcome = isCancellation
				? "cancelled"
				: "failed";
		} finally {
			this.provider.activeChildProcesses.forEach((cp) => cp.kill());
			this.provider.activeChildProcesses = [];
			await this.provider.setPlanExecutionActive(false);

			// 1. Determine the final outcome, defaulting to 'failed' if undefined.
			let outcome: sidebarTypes.ExecutionOutcome;
			if (this.provider.currentExecutionOutcome === undefined) {
				outcome = "failed";
			} else {
				outcome = this.provider
					.currentExecutionOutcome as sidebarTypes.ExecutionOutcome;
			}

			// Use the provider's notification method to avoid duplicate notifications
			await this.provider.showPlanCompletionNotification(
				plan.planDescription || "Unnamed Plan",
				outcome
			);

			// Notify webview that plan execution has ended - this will re-enable inputs and show stop button if needed
			this.provider.postMessageToWebview({
				type: "updateLoadingState",
				value: false,
			});

			// Notify webview that plan execution has ended
			this.provider.postMessageToWebview({
				type: "planExecutionEnded",
			});

			// Centralized call to end user operation and re-enable inputs
			await this.provider.endUserOperation(outcome);

			// 2. Construct a planSummary string
			let planSummary: string;
			const baseDescription = plan.planDescription || "AI Plan Execution";
			if (outcome === "success") {
				planSummary = baseDescription;
			} else if (outcome === "cancelled") {
				planSummary = `${baseDescription} (Cancelled)`;
			} else {
				// outcome === 'failed'
				planSummary = `${baseDescription} (Failed)`;
			}

			// 3. Call saveChangesAsLastCompletedPlan regardless of the outcome
			this.provider.changeLogger.saveChangesAsLastCompletedPlan(planSummary);

			// 4. Update the persistent storage with all completed plan change sets
			await this.provider.updatePersistedCompletedPlanChangeSets(
				this.provider.changeLogger.getCompletedPlanChangeSets()
			);

			// 5. Post the planExecutionFinished message
			this.provider.postMessageToWebview({
				type: "planExecutionFinished",
				hasRevertibleChanges: this.provider.completedPlanChangeSets.length > 0,
			});

			// 6. Crucially, clear the in-memory log buffer for the next operation AFTER saving the changes
			this.provider.changeLogger.clear();

			// This should remain at the end of the finally block
			this.postMessageToWebview({ type: "resetCodeStreamingArea" });
		}
	}

	private async _executePlanSteps(
		steps: PlanStep[],
		rootUri: vscode.Uri,
		context: sidebarTypes.PlanGenerationContext,
		combinedToken: vscode.CancellationToken,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		originalRootInstruction: string
	): Promise<Set<vscode.Uri>> {
		const affectedFileUris = new Set<vscode.Uri>();
		const totalSteps = steps.length;
		const { settingsManager, changeLogger } = this.provider;

		let index = 0;
		while (index < totalSteps) {
			const step = steps[index];
			let currentStepCompletedSuccessfullyOrSkipped = false;
			let currentTransientAttempt = 0;

			// Move formatting utility call outside the inner retry loop
			const relevantSnippets = await this._formatRelevantFilesForPrompt(
				context.relevantFiles ?? [],
				rootUri,
				combinedToken
			);

			// Inner loop for auto-retries and user intervention for the *current* step
			while (!currentStepCompletedSuccessfullyOrSkipped) {
				if (combinedToken.isCancellationRequested) {
					throw new Error(ERROR_OPERATION_CANCELLED);
				}

				// Start of detailedStepDescription logic
				const detailedStepDescription = this._getStepDescription(
					step,
					index,
					totalSteps,
					currentTransientAttempt
				);
				this._logStepProgress(
					index + 1,
					totalSteps,
					detailedStepDescription,
					currentTransientAttempt,
					this.MAX_TRANSIENT_STEP_RETRIES
				);

				try {
					if (isCreateDirectoryStep(step)) {
						await this._handleCreateDirectoryStep(step, rootUri, changeLogger);
					} else if (isCreateFileStep(step)) {
						await this._handleCreateFileStep(
							step,
							index,
							totalSteps,
							rootUri,
							context,
							relevantSnippets,
							affectedFileUris,
							changeLogger,
							combinedToken
						);
					} else if (isModifyFileStep(step)) {
						await this._handleModifyFileStep(
							step,
							index,
							totalSteps,
							rootUri,
							context,
							relevantSnippets,
							affectedFileUris,
							changeLogger,
							settingsManager,
							combinedToken
						);
					} else if (isRunCommandStep(step)) {
						const commandSuccess = await this._handleRunCommandStep(
							step,
							index,
							totalSteps,
							rootUri,
							context,
							progress,
							originalRootInstruction,
							combinedToken
						);
						if (!commandSuccess) {
							// If command correction failed, re-throw to outer error handler
							throw new Error(
								`Command execution failed and AI correction failed for '${step.command}'.`
							);
						}
					}
					currentStepCompletedSuccessfullyOrSkipped = true;
				} catch (error: any) {
					let errorMsg = formatUserFacingErrorMessage(
						error,
						"Failed to execute plan step. Please review the details and try again.",
						"Step execution failed: ",
						rootUri
					);

					if (errorMsg.includes(ERROR_OPERATION_CANCELLED)) {
						throw error;
					}

					const shouldRetry = await this._reportStepError(
						error,
						rootUri,
						detailedStepDescription,
						index + 1,
						totalSteps,
						currentTransientAttempt,
						this.MAX_TRANSIENT_STEP_RETRIES
					);

					if (shouldRetry.type === "retry") {
						currentTransientAttempt = shouldRetry.resetTransientCount
							? 0
							: currentTransientAttempt + 1;
						await new Promise((resolve) =>
							setTimeout(resolve, 10000 + currentTransientAttempt * 5000)
						);
					} else if (shouldRetry.type === "skip") {
						currentStepCompletedSuccessfullyOrSkipped = true;
						this._logStepProgress(
							index + 1,
							totalSteps,
							`Step SKIPPED by user.`,
							0,
							0
						);
						console.log(
							`Minovative Mind: User chose to skip Step ${index + 1}.`
						);
					} else {
						// 'cancel' or unknown
						throw new Error(ERROR_OPERATION_CANCELLED);
					}
				}
			} // End of inner `while (!currentStepCompletedSuccessfullyOrSkipped)` loop

			index++;
		} // End of outer `while (index < totalSteps)` loop
		return affectedFileUris;
	}

	// --- Private Handler Methods for PlanStepAction types ---

	private async _handleCreateDirectoryStep(
		step: CreateDirectoryStep,
		rootUri: vscode.Uri,
		changeLogger: SidebarProvider["changeLogger"]
	): Promise<void> {
		await vscode.workspace.fs.createDirectory(
			vscode.Uri.joinPath(rootUri, step.path)
		);
		changeLogger.logChange({
			filePath: step.path,
			changeType: "created",
			summary: `Created directory: '${step.path}'`,
			timestamp: Date.now(),
		});
	}

	private async _handleCreateFileStep(
		step: CreateFileStep,
		index: number,
		totalSteps: number,
		rootUri: vscode.Uri,
		context: sidebarTypes.PlanGenerationContext,
		relevantSnippets: string, // Passed from outer loop
		affectedFileUris: Set<vscode.Uri>,
		changeLogger: SidebarProvider["changeLogger"],
		combinedToken: vscode.CancellationToken
	): Promise<void> {
		const fileUri = vscode.Uri.joinPath(rootUri, step.path);
		let desiredContent: string | undefined = step.content;

		if (step.generate_prompt) {
			const generationContext = {
				projectContext: context.projectContext,
				relevantSnippets: relevantSnippets,
				editorContext: context.editorContext,
				activeSymbolInfo: undefined,
			};

			const generatedResult =
				await this.enhancedCodeGenerator.generateFileContent(
					step.path,
					step.generate_prompt,
					generationContext,
					this.provider.settingsManager.getSelectedModelName(),
					combinedToken
				);
			desiredContent = generatedResult.content;
		}

		const cleanedDesiredContent = cleanCodeOutput(desiredContent ?? "");

		try {
			await vscode.workspace.fs.stat(fileUri);
			const existingContent = Buffer.from(
				await vscode.workspace.fs.readFile(fileUri)
			).toString("utf-8");

			if (existingContent === cleanedDesiredContent) {
				this._logStepProgress(
					index + 1,
					totalSteps,
					`File \`${step.path}\` already has the desired content. Skipping.`,
					0,
					0
				);
			} else {
				const document = await vscode.workspace.openTextDocument(fileUri);
				const editor = await vscode.window.showTextDocument(document);

				await applyAITextEdits(
					editor,
					existingContent,
					cleanedDesiredContent,
					combinedToken
				);
				const newContentAfterApply = editor.document.getText();

				const { formattedDiff, summary } = await generateFileChangeSummary(
					existingContent,
					newContentAfterApply,
					step.path
				);

				this._logStepProgress(
					index + 1,
					totalSteps,
					`Modified file \`${step.path}\``,
					0,
					0,
					false,
					formattedDiff
				);
				changeLogger.logChange({
					filePath: step.path,
					changeType: "modified",
					summary,
					diffContent: formattedDiff,
					timestamp: Date.now(),
					originalContent: existingContent,
					newContent: newContentAfterApply,
				});
				affectedFileUris.add(fileUri);
			}
		} catch (error: any) {
			if (
				error instanceof vscode.FileSystemError &&
				(error.code === "FileNotFound" || error.code === "EntryNotFound")
			) {
				await vscode.workspace.fs.writeFile(
					fileUri,
					Buffer.from(cleanedDesiredContent)
				);

				const document = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(document);

				const { formattedDiff, summary } = await generateFileChangeSummary(
					"",
					cleanedDesiredContent,
					step.path
				);

				this._logStepProgress(
					index + 1,
					totalSteps,
					`Created file \`${step.path}\``,
					0,
					0,
					false,
					formattedDiff
				);
				changeLogger.logChange({
					filePath: step.path,
					changeType: "created",
					summary,
					diffContent: formattedDiff,
					timestamp: Date.now(),
					originalContent: "",
					newContent: cleanedDesiredContent,
				});
				affectedFileUris.add(fileUri);
			} else {
				throw error;
			}
		}
	}

	private async _handleModifyFileStep(
		step: ModifyFileStep,
		index: number,
		totalSteps: number,
		rootUri: vscode.Uri,
		context: sidebarTypes.PlanGenerationContext,
		relevantSnippets: string, // Passed from outer loop
		affectedFileUris: Set<vscode.Uri>,
		changeLogger: SidebarProvider["changeLogger"],
		settingsManager: SidebarProvider["settingsManager"],
		combinedToken: vscode.CancellationToken
	): Promise<void> {
		const fileUri = vscode.Uri.joinPath(rootUri, step.path);
		const existingContent = Buffer.from(
			await vscode.workspace.fs.readFile(fileUri)
		).toString("utf-8");

		const modificationContext = {
			projectContext: context.projectContext,
			relevantSnippets: relevantSnippets,
			editorContext: context.editorContext,
			activeSymbolInfo: undefined,
		};

		let modifiedContent = (
			await this.enhancedCodeGenerator.modifyFileContent(
				step.path,
				step.modification_prompt,
				existingContent,
				modificationContext,
				settingsManager.getSelectedModelName(),
				combinedToken
			)
		).content;

		let document: vscode.TextDocument;
		let editor: vscode.TextEditor;
		try {
			document = await vscode.workspace.openTextDocument(fileUri);
			editor = await vscode.window.showTextDocument(document);
		} catch (docError: any) {
			throw new Error(
				`Failed to open document ${fileUri.fsPath} for modification: ${docError.message}`
			);
		}

		await applyAITextEdits(
			editor,
			editor.document.getText(),
			modifiedContent,
			combinedToken
		);

		const newContentAfterApply = editor.document.getText();

		const { formattedDiff, summary, addedLines, removedLines } =
			await generateFileChangeSummary(
				existingContent,
				newContentAfterApply,
				step.path
			);

		if (addedLines.length > 0 || removedLines.length > 0) {
			affectedFileUris.add(fileUri);

			if (
				context.isMergeOperation &&
				context.editorContext &&
				fileUri.toString() === context.editorContext.documentUri.toString()
			) {
				await this.gitConflictResolutionService.unmarkFileAsResolved(fileUri);
			}

			this._logStepProgress(
				index + 1,
				totalSteps,
				`Modified file \`${step.path}\``,
				0,
				0,
				false,
				formattedDiff
			);
			changeLogger.logChange({
				filePath: step.path,
				changeType: "modified",
				summary,
				diffContent: formattedDiff,
				timestamp: Date.now(),
				originalContent: existingContent,
				newContent: newContentAfterApply,
			});
		} else {
			this._logStepProgress(
				index + 1,
				totalSteps,
				`File \`${step.path}\` content is already as desired, no substantial modifications needed.`,
				0,
				0
			);
		}
	}

	private async _handleRunCommandStep(
		step: RunCommandStep,
		index: number,
		totalSteps: number,
		rootUri: vscode.Uri,
		context: sidebarTypes.PlanGenerationContext,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		originalRootInstruction: string,
		combinedToken: vscode.CancellationToken
	): Promise<boolean> {
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
					combinedToken,
					this.provider.activeChildProcesses
				);

				if (commandResult.exitCode !== 0) {
					const errorMessage = `Command \`${step.command}\` failed with exit code ${commandResult.exitCode}.
                                    \n--- STDOUT ---\n${commandResult.stdout}
                                    \n--- STDERR ---\n${commandResult.stderr}`;

					this._logStepProgress(
						index + 1,
						totalSteps,
						`Command execution error.`,
						0,
						0,
						true,
						errorMessage
					);

					const correctionSuccessful = await this._performCommandCorrection(
						step.command,
						commandResult.stdout,
						commandResult.stderr,
						rootUri,
						combinedToken,
						context,
						progress,
						originalRootInstruction
					);

					return correctionSuccessful;
				} else {
					const successMessage = `Command \`${step.command}\` executed successfully.
                                    \n--- STDOUT ---\n${commandResult.stdout}
                                    \n--- STDERR ---\n${commandResult.stderr}`;

					this._logStepProgress(
						index + 1,
						totalSteps,
						`Command executed.`,
						0,
						0,
						false,
						successMessage
					);
					return true;
				}
			} catch (commandExecError: any) {
				if (commandExecError.message === ERROR_OPERATION_CANCELLED) {
					throw commandExecError;
				}
				let detailedError = `Error executing command \`${step.command}\`: ${commandExecError.message}`;
				this._logStepProgress(index + 1, totalSteps, detailedError, 0, 0, true);
				throw commandExecError; // Re-throw to be caught by the step retry loop
			}
		} else {
			this._logStepProgress(
				index + 1,
				totalSteps,
				`Step SKIPPED by user.`,
				0,
				0
			);
			return true; // Command was skipped, consider it successfully handled for this step's flow
		}
	}

	// --- Dedicated Private Helper Methods for UI Updates and Error Handling ---

	private _getStepDescription(
		step: PlanStep,
		index: number,
		totalSteps: number,
		currentTransientAttempt: number
	): string {
		let detailedStepDescription: string;
		if (step.description && step.description.trim() !== "") {
			detailedStepDescription = step.description;
		} else {
			switch (step.action) {
				case PlanStepAction.CreateDirectory:
					if (isCreateDirectoryStep(step)) {
						detailedStepDescription = `Creating directory: \`${step.path}\``;
					} else {
						detailedStepDescription = `Creating directory`;
					}
					break;
				case PlanStepAction.CreateFile:
					if (isCreateFileStep(step)) {
						if (step.generate_prompt) {
							detailedStepDescription = `Creating file: \`${step.path}\` (content generated by AI)`;
						} else if (step.content) {
							detailedStepDescription = `Creating file: \`${step.path}\` (with predefined content)`;
						} else {
							detailedStepDescription = `Creating file: \`${step.path}\``;
						}
					} else {
						detailedStepDescription = `Creating file`;
					}
					break;
				case PlanStepAction.ModifyFile:
					if (isModifyFileStep(step)) {
						detailedStepDescription = `Modifying file: \`${step.path}\` (AI will apply changes)`;
					} else {
						detailedStepDescription = `Modifying file`;
					}
					break;
				case PlanStepAction.RunCommand:
					if (isRunCommandStep(step)) {
						detailedStepDescription = `Running command: \`${step.command}\``;
					} else {
						detailedStepDescription = `Running command`;
					}
					break;
				default:
					detailedStepDescription = `Executing action: ${(
						step.action as string
					).replace(/_/g, " ")}`;
					break;
			}
		}
		const retrySuffix =
			currentTransientAttempt > 0
				? ` (Auto-retry ${currentTransientAttempt}/${this.MAX_TRANSIENT_STEP_RETRIES})`
				: "";
		return `Step ${
			index + 1
		}/${totalSteps}: ${detailedStepDescription}${retrySuffix}`;
	}

	private _logStepProgress(
		currentStepNumber: number,
		totalSteps: number,
		message: string,
		currentTransientAttempt: number,
		maxTransientRetries: number,
		isError: boolean = false,
		diffContent?: string
	): void {
		this.provider.postMessageToWebview({
			type: "appendRealtimeModelMessage",
			value: {
				text: message,
				isError: isError,
			},
			isPlanStepUpdate: true,
			diffContent: diffContent,
		});
		if (isError) {
			console.error(`Minovative Mind: ${message}`);
		} else {
			console.log(`Minovative Mind: ${message}`);
		}
	}

	private async _reportStepError(
		error: any,
		rootUri: vscode.Uri,
		stepDescription: string,
		currentStepNumber: number,
		totalSteps: number,
		currentTransientAttempt: number,
		maxTransientRetries: number
	): Promise<{
		type: "retry" | "skip" | "cancel";
		resetTransientCount?: boolean;
	}> {
		const errorMsg = formatUserFacingErrorMessage(
			error,
			"Failed to execute plan step. Please review the details and try again.",
			"Step execution failed: ",
			rootUri
		);

		let isRetryableTransientError = false;
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
			currentTransientAttempt < maxTransientRetries
		) {
			this._logStepProgress(
				currentStepNumber,
				totalSteps,
				`FAILED (transient, auto-retrying): ${errorMsg}`,
				currentTransientAttempt + 1,
				maxTransientRetries,
				true
			);
			console.warn(
				`Minovative Mind: Step ${currentStepNumber} failed, auto-retrying due to transient error: ${errorMsg}`
			);
			return { type: "retry" };
		} else {
			this._logStepProgress(
				currentStepNumber,
				totalSteps,
				`FAILED: ${errorMsg}. Requires user intervention.`,
				currentTransientAttempt,
				maxTransientRetries,
				true
			);
			const choice = await vscode.window.showErrorMessage(
				`Step ${currentStepNumber}/${totalSteps} failed: ${errorMsg}. What would you like to do?`,
				"Retry Step",
				"Skip Step",
				"Cancel Plan"
			);

			if (choice === undefined) {
				return { type: "cancel" };
			} else if (choice === "Retry Step") {
				return { type: "retry", resetTransientCount: true };
			} else if (choice === "Skip Step") {
				return { type: "skip" };
			} else {
				return { type: "cancel" };
			}
		}
	}

	private async _formatRelevantFilesForPrompt(
		relevantFiles: string[],
		workspaceRootUri: vscode.Uri,
		token: vscode.CancellationToken
	): Promise<string> {
		if (!relevantFiles || relevantFiles.length === 0) {
			return "";
		}

		const formattedSnippets: string[] = [];
		const maxFileSizeForSnippet = 1024 * 1024 * 1; // 1MB limit per file to prevent prompt overflow

		for (const relativePath of relevantFiles) {
			if (token.isCancellationRequested) {
				return formattedSnippets.join("\n");
			}

			const fileUri = vscode.Uri.joinPath(workspaceRootUri, relativePath);
			let fileContent: string | null = null;
			let languageId = path.extname(relativePath).substring(1);
			if (!languageId) {
				// Fallback for files without extension (e.g., Dockerfile, LICENSE)
				languageId = path.basename(relativePath).toLowerCase();
			}
			// Special handling for common files without extensions where syntax highlighting is helpful
			if (languageId === "makefile") {
				languageId = "makefile";
			} else if (languageId === "dockerfile") {
				languageId = "dockerfile";
			} else if (languageId === "jsonc") {
				languageId = "json";
			} else if (languageId === "eslintignore") {
				languageId = "ignore";
			} else if (languageId === "prettierignore") {
				languageId = "ignore";
			} else if (languageId === "gitignore") {
				languageId = "ignore";
			} else if (languageId === "license") {
				languageId = "plaintext";
			}

			try {
				const fileStat = await vscode.workspace.fs.stat(fileUri);

				// Skip directories
				if (fileStat.type === vscode.FileType.Directory) {
					continue;
				}

				// Skip files larger than maxFileSizeForSnippet
				if (fileStat.size > maxFileSizeForSnippet) {
					console.warn(
						`[MinovativeMind] Skipping relevant file '${relativePath}' (size: ${fileStat.size} bytes) due to size limit for prompt inclusion.`
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

				// Basic heuristic for binary files: check for null characters
				if (content.includes("\0")) {
					console.warn(
						`[MinovativeMind] Skipping relevant file '${relativePath}' as it appears to be binary.`
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
						`[MinovativeMind] Relevant file not found: '${relativePath}'. Skipping.`
					);
				} else if (error.message.includes("is not a file")) {
					// This can happen if fileUri points to a directory
					console.warn(
						`[MinovativeMind] Skipping directory '${relativePath}' as a relevant file.`
					);
				} else {
					console.error(
						`[MinovativeMind] Error reading relevant file '${relativePath}': ${error.message}. Skipping.`,
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

	private _handlePostTextualPlanGenerationUI(
		planContext: sidebarTypes.PlanGenerationContext
	): Promise<void> {
		if (this.provider.isSidebarVisible) {
			const planDataForRestore =
				planContext.type === "chat"
					? {
							type: planContext.type,
							originalRequest: planContext.originalUserRequest,
							relevantFiles: planContext.relevantFiles,
							textualPlanExplanation: planContext.textualPlanExplanation,
					  }
					: {
							type: planContext.type,
							originalInstruction: planContext.editorContext!.instruction,
							relevantFiles: planContext.relevantFiles,
							textualPlanExplanation: planContext.textualPlanExplanation,
					  };

			this.provider.postMessageToWebview({
				type: "restorePendingPlanConfirmation",
				value: planDataForRestore,
			});
			this.provider.postMessageToWebview({
				type: "statusUpdate",
				value: "Textual plan generated. Review and confirm to proceed.",
			});
		} else {
			// Automatically open the sidebar when a plan is completed
			void vscode.commands.executeCommand("minovative-mind.activitybar.focus");
			this.provider.postMessageToWebview({
				type: "statusUpdate",
				value: "Plan generated and sidebar opened for review.",
			});
		}
		return Promise.resolve();
	}

	private _postChatUpdateForPlanExecution(
		message: sidebarTypes.AppendRealtimeModelMessage
	): void {
		this.provider.chatHistoryManager.addHistoryEntry(
			"model",
			message.value.text,
			message.diffContent,
			undefined,
			undefined,
			message.isPlanStepUpdate
		);
		// This call is intentional to ensure the UI is fully consistent with the updated chat history after each step/status update during plan execution.
		this.provider.postMessageToWebview(message);
		this.provider.chatHistoryManager.restoreChatHistoryToWebview();
	}

	private _formatRecentChangesForPrompt(changes: FileChangeEntry[]): string {
		if (!changes || changes.length === 0) {
			return "";
		}
		let formattedString =
			"--- Recent Project Changes (During Current Workflow) ---\n";
		formattedString += changes
			.map(
				(c) =>
					`--- File ${c.changeType.toUpperCase()}: ${
						c.filePath
					} ---\nSummary: ${c.summary}\nDiff:\n\`\`\`diff\n${
						c.diffContent
					}\n\`\`\`\n`
			)
			.join("\n");
		return formattedString + "--- End Recent Project Changes ---\n";
	}

	// Helper to format CorrectionFeedback into a string for the prompt's retryReason
	private _formatCorrectionFeedbackForPrompt(
		feedback: CorrectionFeedback | undefined
	): string | undefined {
		if (!feedback) {
			return undefined;
		}

		let message = `CRITICAL ERROR: Your previous attempt had a issue of type '${feedback.type}'. Message: "${feedback.message}".`;
		if (feedback.details) {
			if (feedback.details.parsingError) {
				message += ` Parsing Error: "${feedback.details.parsingError}".`;
			}
			if (feedback.details.failedJson) {
				// Truncate failed JSON to prevent excessively long prompts
				let failedJsonPreview = feedback.details.failedJson.substring(0, 500);
				if (feedback.details.failedJson.length > 500) {
					failedJsonPreview += "\n// ... (truncated)";
				}
				message += ` Failed JSON output: \`\`\`json\n${failedJsonPreview}\n\`\`\`.`;
			}
			if (feedback.details.stdout) {
				let stdoutPreview = feedback.details.stdout.substring(0, 500);
				if (feedback.details.stdout.length > 500) {
					stdoutPreview += "\n// ... (truncated)";
				}
				message += ` STDOUT: \`\`\`\n${stdoutPreview}\n\`\`\`.`;
			}
			if (feedback.details.stderr) {
				let stderrPreview = feedback.details.stderr.substring(0, 500);
				if (feedback.details.stderr.length > 500) {
					stderrPreview += "\n// ... (truncated)";
				}
				message += ` STDERR: \`\`\`\n${stderrPreview}\n\`\`\`.`;
			}
			if (feedback.details.previousIssues && feedback.details.currentIssues) {
				// Summarize issues, don't include full objects
				const prevIssueCount = feedback.details.previousIssues.length;
				const currIssueCount = feedback.details.currentIssues.length;
				message += ` Previous errors count: ${prevIssueCount}. Current errors count: ${currIssueCount}.`;
			}
		}
		return message;
	}

	// Helper to convert vscode.Diagnostic to CodeIssue
	private _diagnosticToCodeIssue(diagnostic: vscode.Diagnostic): CodeIssue {
		let severityString =
			vscode.DiagnosticSeverity[diagnostic.severity].toLowerCase();

		// Map VS Code severity levels to the expected CodeIssue severity levels
		if (severityString === "information" || severityString === "hint") {
			severityString = "info";
		}

		const messageLower = diagnostic.message.toLowerCase();
		let codeIssueType: CodeIssue["type"];

		if (messageLower.includes("unused import")) {
			codeIssueType = "unused_import";
		} else if (
			severityString === "error" ||
			severityString === "warning" ||
			messageLower.includes("syntax") ||
			messageLower.includes("compilation") ||
			messageLower.includes("lint")
		) {
			codeIssueType = "syntax";
		} else if (messageLower.includes("security")) {
			codeIssueType = "security";
		} else if (messageLower.includes("best practice")) {
			codeIssueType = "best_practice";
		} else {
			codeIssueType = "other";
		}

		return {
			message: diagnostic.message,
			severity: severityString as "error" | "warning" | "info",
			line: diagnostic.range.start.line,
			code:
				typeof diagnostic.code === "string"
					? diagnostic.code
					: diagnostic.code
					? diagnostic.code.toString()
					: undefined,
			source: diagnostic.source,
			type: codeIssueType,
		};
	}

	private async _performFinalValidationAndCorrection(
		affectedFileUris: Set<vscode.Uri>,
		rootUri: vscode.Uri,
		token: vscode.CancellationToken,
		planContext: sidebarTypes.PlanGenerationContext,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		originalUserInstruction: string
	): Promise<boolean> {
		let filesNeedingCorrection = new Set<vscode.Uri>(affectedFileUris);

		if (filesNeedingCorrection.size === 0) {
			this._logStepProgress(
				0,
				0,
				`No files were modified or created by the plan. Skipping final validation.`,
				0,
				0
			);
			this.fileCorrectionAttemptHistory.clear();
			return true;
		}

		let currentCorrectionAttempt = 1;
		while (currentCorrectionAttempt <= this.MAX_CORRECTION_PLAN_ATTEMPTS) {
			if (token.isCancellationRequested) {
				this._logStepProgress(0, 0, `Final code validation cancelled.`, 0, 0);
				this.fileCorrectionAttemptHistory.clear();
				return false;
			}
			if (filesNeedingCorrection.size === 0) {
				console.log(
					`[MinovativeMind] All files corrected. Exiting validation loop.`
				);
				this.fileCorrectionAttemptHistory.clear();
				return true;
			}

			// Declare local async function `fileProcessor`
			const fileProcessor = async (
				currentFileUri: vscode.Uri
			): Promise<{ currentFileUri: vscode.Uri; needsCorrection: boolean }> => {
				if (token.isCancellationRequested) {
					return { currentFileUri, needsCorrection: false }; // Indicate cancellation
				}

				let errorsFoundInCurrentFileBeforeAttempt = false;
				let aggregatedFormattedDiagnosticsForFile = "";

				const fileRelativePath = path
					.relative(rootUri.fsPath, currentFileUri.fsPath)
					.replace(/\\/g, "/");

				const previousAttemptsForFile =
					this.fileCorrectionAttemptHistory.get(fileRelativePath) || [];

				let lastAttemptForFile:
					| (typeof previousAttemptsForFile)[number]
					| undefined;
				let secondLastAttemptForFile:
					| (typeof previousAttemptsForFile)[number]
					| undefined;

				if (previousAttemptsForFile.length > 0) {
					lastAttemptForFile =
						previousAttemptsForFile[previousAttemptsForFile.length - 1];
					if (previousAttemptsForFile.length > 1) {
						secondLastAttemptForFile =
							previousAttemptsForFile[previousAttemptsForFile.length - 2];
					}
				}

				let feedbackForPrompt: CorrectionFeedback | undefined = undefined;

				if (lastAttemptForFile?.feedbackUsed?.type === "parsing_failed") {
					feedbackForPrompt = lastAttemptForFile.feedbackUsed;
					this._logStepProgress(
						0,
						0,
						`Previous attempt for '${fileRelativePath}' failed parsing. Providing feedback for AI.`,
						0,
						0,
						true
					);
				} else if (lastAttemptForFile && secondLastAttemptForFile) {
					if (
						!lastAttemptForFile.success &&
						!secondLastAttemptForFile.success &&
						areIssuesSimilar(
							lastAttemptForFile.issuesRemaining,
							secondLastAttemptForFile.issuesRemaining
						)
					) {
						feedbackForPrompt = {
							type: "no_improvement",
							message: `AI is oscillating, previous attempts (${lastAttemptForFile.iteration}, ${secondLastAttemptForFile.iteration}) for '${fileRelativePath}' resulted in similar unresolved issues.`,
							details: {
								previousIssues: lastAttemptForFile.issuesRemaining,
								currentIssues: lastAttemptForFile.issuesRemaining,
							},
							issuesRemaining: lastAttemptForFile?.issuesRemaining ?? [],
						};
						this._logStepProgress(
							0,
							0,
							`Detected oscillation for '${fileRelativePath}'. Providing feedback for AI.`,
							0,
							0,
							true
						);
					}
				}

				try {
					// Parallelized diagnostic stabilization and retrieval
					await DiagnosticService.waitForDiagnosticsToStabilize(
						currentFileUri,
						token,
						5000,
						100
					);
					const diagnosticsForFile =
						DiagnosticService.getDiagnosticsForUri(currentFileUri);
					const errorsForFile = diagnosticsForFile.filter(
						(d: vscode.Diagnostic) =>
							d.severity === vscode.DiagnosticSeverity.Error
					);

					let currentAIPlanGenerationSuccessful = false;
					let correctionFeedbackForHistory: CorrectionFeedback | undefined =
						undefined;

					if (errorsForFile.length > 0) {
						errorsFoundInCurrentFileBeforeAttempt = true;

						const formattedForFile =
							await DiagnosticService.formatContextualDiagnostics(
								currentFileUri,
								rootUri,
								undefined,
								5000,
								undefined,
								token,
								[vscode.DiagnosticSeverity.Error]
							);

						if (formattedForFile) {
							aggregatedFormattedDiagnosticsForFile = formattedForFile;
						}

						this._logStepProgress(
							0,
							0,
							`File '${fileRelativePath}' has ${errorsForFile.length} errors. Attempting AI correction (Attempt ${currentCorrectionAttempt}/${this.MAX_CORRECTION_PLAN_ATTEMPTS})...`,
							0,
							0,
							true
						);

						try {
							const jsonGenerationConfig: GenerationConfig = {
								responseMimeType: "application/json",
								temperature: sidebarConstants.TEMPERATURE,
							};

							const dynamicallyGeneratedRelevantSnippets =
								await this._formatRelevantFilesForPrompt(
									[fileRelativePath],
									rootUri,
									token
								);

							const recentChanges = this.provider.changeLogger.getChangeLog();
							const formattedRecentChanges =
								this._formatRecentChangesForPrompt(recentChanges);

							const originalContextString =
								planContext.originalUserRequest ||
								planContext.editorContext?.instruction ||
								"";

							let fileSpecificEditorContext:
								| sidebarTypes.EditorContext
								| undefined;
							if (planContext.type === "editor" && planContext.editorContext) {
								fileSpecificEditorContext = {
									...planContext.editorContext,
									filePath: fileRelativePath,
									documentUri: currentFileUri,
								};
							}

							let jsonEscapingInstructionsForPrompt = "";
							if (
								feedbackForPrompt &&
								feedbackForPrompt.type === "parsing_failed" &&
								feedbackForPrompt.details &&
								feedbackForPrompt.details.parsingError &&
								feedbackForPrompt.details.failedJson
							) {
								const failedJsonPreview =
									feedbackForPrompt.details.failedJson.substring(0, 500);
								jsonEscapingInstructionsForPrompt = `CRITICAL: Your previous output was NOT valid JSON due to "${feedbackForPrompt.details.parsingError}". You MUST provide ONLY a valid JSON object that strictly adheres to the schema. Do NOT include markdown fences (e.g., \`\\\`json) or any additional text, comments, or explanations outside the JSON object itself. Your previous invalid JSON was (truncated): \`\\\`json\n${failedJsonPreview}\n\`\\\`. You MUST correct this.`;
							}

							const correctionPlanPrompt = createCorrectionPlanPrompt(
								originalContextString,
								"",
								fileSpecificEditorContext,
								[],
								dynamicallyGeneratedRelevantSnippets,
								aggregatedFormattedDiagnosticsForFile,
								formattedRecentChanges,
								feedbackForPrompt,
								planContext.activeSymbolDetailedInfo,
								jsonEscapingInstructionsForPrompt
							);

							progress.report({
								message: `AI generating correction plan for '${fileRelativePath}' (Attempt ${currentCorrectionAttempt}/${this.MAX_CORRECTION_PLAN_ATTEMPTS})...`,
							});

							let correctionPlanJsonString =
								await this.provider.aiRequestService.generateWithRetry(
									[{ text: correctionPlanPrompt }],
									sidebarConstants.DEFAULT_FLASH_LITE_MODEL,
									undefined,
									`correction plan for ${fileRelativePath} (attempt ${currentCorrectionAttempt})`,
									jsonGenerationConfig,
									undefined,
									token
								);

							correctionPlanJsonString = correctionPlanJsonString
								.replace(/^\s*/im, "")
								.replace(/\s*$/im, "")
								.trim();

							const parsedPlanResult: ParsedPlanResult =
								await parseAndValidatePlan(correctionPlanJsonString, rootUri);

							if (token.isCancellationRequested) {
								throw new Error(ERROR_OPERATION_CANCELLED);
							}

							if (parsedPlanResult.plan) {
								currentAIPlanGenerationSuccessful = true;
								this._logStepProgress(
									0,
									0,
									`Applying correction plan for '${fileRelativePath}'.`,
									0,
									0
								);

								await this._executePlanSteps(
									parsedPlanResult.plan.steps!,
									rootUri,
									planContext,
									token,
									progress,
									originalUserInstruction
								);
							} else {
								currentAIPlanGenerationSuccessful = false;
								correctionFeedbackForHistory = {
									type: "parsing_failed",
									message:
										parsedPlanResult.error ||
										"Failed to parse the correction plan generated by AI.",
									details: {
										parsingError: parsedPlanResult.error,
										failedJson: correctionPlanJsonString,
									},
									issuesRemaining: lastAttemptForFile?.issuesRemaining ?? [],
								};
								console.error(
									`[MinovativeMind] Failed to parse AI correction plan for '${fileRelativePath}' (Attempt ${currentCorrectionAttempt}): ${parsedPlanResult.error}`
								);
								this._logStepProgress(
									0,
									0,
									formatUserFacingErrorMessage(
										new Error(
											parsedPlanResult.error ||
												"Failed to parse the correction plan."
										),
										`The AI generated an invalid final correction plan for '${fileRelativePath}'. Please check the Developer Tools console for more details.`,
										"AI correction error: ",
										rootUri
									),
									0,
									0,
									true
								);
								return { currentFileUri, needsCorrection: true }; // Continue correction for this file
							}
						} catch (correctionError: any) {
							if (correctionError.message === ERROR_OPERATION_CANCELLED) {
								throw correctionError;
							}

							this._logStepProgress(
								0,
								0,
								formatUserFacingErrorMessage(
									correctionError,
									`AI final self-correction failed for '${fileRelativePath}' due to an unexpected issue. Retry with /fix. Manual review may be required.`,
									"AI self-correction failed: ",
									rootUri
								),
								0,
								0,
								true
							);
							return { currentFileUri, needsCorrection: true }; // Continue correction for this file
						}
					}

					if (errorsFoundInCurrentFileBeforeAttempt) {
						await DiagnosticService.waitForDiagnosticsToStabilize(
							currentFileUri,
							token
						);
						const diagnosticsAfterCorrection =
							DiagnosticService.getDiagnosticsForUri(currentFileUri);
						const errorsAfterCorrection = diagnosticsAfterCorrection.filter(
							(d: vscode.Diagnostic) =>
								d.severity === vscode.DiagnosticSeverity.Error
						);

						const codeIssuesAfterCorrection: CodeIssue[] =
							errorsAfterCorrection.map((d) => this._diagnosticToCodeIssue(d));

						const currentFileAttemptSuccessful =
							codeIssuesAfterCorrection.length === 0 &&
							currentAIPlanGenerationSuccessful;

						const currentFileOutcome = {
							iteration: currentCorrectionAttempt,
							issuesRemaining: codeIssuesAfterCorrection,
							success: currentFileAttemptSuccessful,
							feedbackUsed: correctionFeedbackForHistory,
						};

						if (!this.fileCorrectionAttemptHistory.has(fileRelativePath)) {
							this.fileCorrectionAttemptHistory.set(fileRelativePath, []);
						}
						this.fileCorrectionAttemptHistory
							.get(fileRelativePath)!
							.push(currentFileOutcome);

						if (
							codeIssuesAfterCorrection.length > 0 ||
							!currentFileAttemptSuccessful
						) {
							console.log(
								`[MinovativeMind] Errors still present in '${path.relative(
									rootUri.fsPath,
									currentFileUri.fsPath
								)}' after correction attempt ${currentCorrectionAttempt}. Adding back for next round.`
							);
							return { currentFileUri, needsCorrection: true };
						} else {
							console.log(
								`[MinovativeMind] Errors resolved for '${path.relative(
									rootUri.fsPath,
									currentFileUri.fsPath
								)}' after correction attempt ${currentCorrectionAttempt}. Clearing history for this file.`
							);
							this._logStepProgress(
								0,
								0,
								`Correction successful for '${path.relative(
									rootUri.fsPath,
									currentFileUri.fsPath
								)}'.`,
								0,
								0,
								false
							);
							this.fileCorrectionAttemptHistory.delete(fileRelativePath);
							return { currentFileUri, needsCorrection: false };
						}
					} else {
						return { currentFileUri, needsCorrection: false };
					}
				} catch (fileProcError: any) {
					// Handle any unexpected errors during file processing (e.g., from diagnostic service)
					console.error(
						`[MinovativeMind] Error processing file ${fileRelativePath}:`,
						fileProcError
					);
					return { currentFileUri, needsCorrection: true }; // Force re-correction for this file
				}
			};

			const filesToProcessForParallel = Array.from(filesNeedingCorrection);
			const nextFilesNeedingCorrection = new Set<vscode.Uri>();
			let isAnyTaskCancelled = false; // Initialize flag

			const parallelResultsMap =
				await ParallelProcessor.processFilesInParallel<{
					currentFileUri: vscode.Uri;
					needsCorrection: boolean;
				}>(filesToProcessForParallel, fileProcessor, {
					maxConcurrency: 5,
					cancellationToken: token,
					// Potentially add defaultTimeout or defaultRetries here if appropriate
				});

			for (const [filePath, taskResult] of parallelResultsMap.entries()) {
				if (
					!taskResult.success &&
					taskResult.error === ERROR_OPERATION_CANCELLED
				) {
					isAnyTaskCancelled = true;
					this._logStepProgress(
						0,
						0,
						`Final code validation task for ${filePath} cancelled.`,
						0,
						0
					);
					this.fileCorrectionAttemptHistory.clear();
				} else if (taskResult.success && taskResult.result) {
					if (taskResult.result.needsCorrection) {
						nextFilesNeedingCorrection.add(taskResult.result.currentFileUri);
					}
				} else if (!taskResult.success) {
					// Task failed for reasons other than cancellation
					this._logStepProgress(
						0,
						0,
						`Final code validation for ${filePath} failed: ${taskResult.error}`,
						0,
						0,
						true
					);
				}
			}

			// If the overall operation was cancelled by a subtask, or directly
			if (isAnyTaskCancelled) {
				this._logStepProgress(
					0,
					0,
					`Final code validation cancelled due to one or more task cancellations.`,
					0,
					0
				);
				this.fileCorrectionAttemptHistory.clear();
				return false;
			}
			if (token.isCancellationRequested) {
				this._logStepProgress(0, 0, `Final code validation cancelled.`, 0, 0);
				this.fileCorrectionAttemptHistory.clear();
				return false;
			}

			filesNeedingCorrection = nextFilesNeedingCorrection;
			currentCorrectionAttempt++;
		}

		if (filesNeedingCorrection.size > 0) {
			this._logStepProgress(
				0,
				0,
				`Overall validation failed after ${this.MAX_CORRECTION_PLAN_ATTEMPTS} attempts to auto-correct errors in ${filesNeedingCorrection.size} file(s). Please review the affected files manually.`,
				0,
				0,
				true
			);
			return false;
		} else {
			this.fileCorrectionAttemptHistory.clear();
			return true;
		}
	}

	private async _performCommandCorrection(
		failedCommand: string,
		stdout: string,
		stderr: string,
		rootUri: vscode.Uri,
		token: vscode.CancellationToken,
		planContext: sidebarTypes.PlanGenerationContext,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		originalUserInstruction: string
	): Promise<boolean> {
		let currentCorrectionAttempt = 1;
		let lastCorrectionFeedbackForPrompt: CorrectionFeedback | undefined =
			undefined;

		while (currentCorrectionAttempt <= this.MAX_CORRECTION_PLAN_ATTEMPTS) {
			if (token.isCancellationRequested) {
				this._logStepProgress(0, 0, `Command correction cancelled.`, 0, 0);
				return false;
			}

			const commandFailureDetailsForPrompt = `The command \`${failedCommand}\` failed with exit code ${
				stdout === "" && stderr === "" ? "unknown" : "non-zero"
			}. Here's its output:\n\nSTDOUT:\n\`\`\`\n${stdout}\n\`\`\`\n\nSTDERR:\n\`\`\`\n${stderr}\n\`\`\`\n\nAnalyze this failure and generate a plan to correct the issue in the codebase. This might involve modifying files, creating new ones, or even running different commands. If the problem is environmental, suggest a fix by modifying files.`;

			let correctionPromptRetryReason: string | undefined;
			if (currentCorrectionAttempt === 1) {
				correctionPromptRetryReason = `Previous Command Execution Failure:\n${commandFailureDetailsForPrompt}`;
				lastCorrectionFeedbackForPrompt = {
					type: "command_failed",
					message: `Command execution failed: ${failedCommand}`,
					details: {
						stdout: stdout,
						stderr: stderr,
					},
					issuesRemaining: [],
				};
			} else {
				correctionPromptRetryReason = this._formatCorrectionFeedbackForPrompt(
					lastCorrectionFeedbackForPrompt
				);
			}

			this._logStepProgress(
				0,
				0,
				`Attempting AI correction for failed command (Attempt ${currentCorrectionAttempt}/${this.MAX_CORRECTION_PLAN_ATTEMPTS})...`,
				0,
				0,
				true,
				correctionPromptRetryReason
			);

			try {
				const jsonGenerationConfig: GenerationConfig = {
					responseMimeType: "application/json",
					temperature: sidebarConstants.TEMPERATURE,
				};

				const filesForCorrectionSnippets = Array.from(
					planContext.relevantFiles ?? []
				).map((uri) => path.relative(rootUri.fsPath, uri).replace(/\\/g, "/"));
				const dynamicallyGeneratedRelevantSnippets =
					await this._formatRelevantFilesForPrompt(
						filesForCorrectionSnippets,
						rootUri,
						token
					);

				const recentChanges = this.provider.changeLogger.getChangeLog();
				const formattedRecentChanges =
					this._formatRecentChangesForPrompt(recentChanges);

				let jsonEscapingInstructionsForPrompt = "";
				if (
					lastCorrectionFeedbackForPrompt?.type === "parsing_failed" &&
					lastCorrectionFeedbackForPrompt.details?.parsingError &&
					lastCorrectionFeedbackForPrompt.details.failedJson
				) {
					const failedJsonPreview =
						lastCorrectionFeedbackForPrompt.details.failedJson.substring(
							0,
							500
						);
					jsonEscapingInstructionsForPrompt = `CRITICAL: Your previous output was NOT valid JSON due to "${lastCorrectionFeedbackForPrompt.details.parsingError}". You MUST provide ONLY a valid JSON object that strictly adheres to the schema. Do NOT include markdown fences (e.g., \`\\\`json) or any additional text, comments, or explanations outside the JSON object itself. Your previous invalid JSON was (truncated): \`\\\`json\n${failedJsonPreview}\n\`\\\`. You MUST correct this.`;
				}

				const correctionPlanPrompt = createCorrectionPlanPrompt(
					originalUserInstruction,
					planContext.projectContext,
					undefined,
					[],
					dynamicallyGeneratedRelevantSnippets,
					commandFailureDetailsForPrompt,
					formattedRecentChanges,
					lastCorrectionFeedbackForPrompt,
					planContext.activeSymbolDetailedInfo,
					jsonEscapingInstructionsForPrompt
				);

				progress.report({
					message: `AI generating command correction plan (Attempt ${currentCorrectionAttempt}/${this.MAX_CORRECTION_PLAN_ATTEMPTS})...`,
				});

				let correctionPlanJsonString =
					await this.provider.aiRequestService.generateWithRetry(
						[{ text: correctionPlanPrompt }],
						sidebarConstants.DEFAULT_FLASH_LITE_MODEL,
						undefined,
						`command correction plan generation (attempt ${currentCorrectionAttempt})`,
						jsonGenerationConfig,
						undefined,
						token
					);

				correctionPlanJsonString = correctionPlanJsonString
					.replace(/^\s*/im, "")
					.replace(/\s*$/im, "")
					.trim();

				const parsedPlanResult: ParsedPlanResult = await parseAndValidatePlan(
					correctionPlanJsonString,
					rootUri
				);

				if (token.isCancellationRequested) {
					throw new Error(ERROR_OPERATION_CANCELLED);
				}

				if (parsedPlanResult.plan) {
					this._logStepProgress(
						0,
						0,
						`Applying command correction plan.`,
						0,
						0
					);

					lastCorrectionFeedbackForPrompt = undefined;

					await this._executePlanSteps(
						parsedPlanResult.plan.steps!,
						rootUri,
						planContext,
						token,
						progress,
						originalUserInstruction
					);
					this._logStepProgress(
						0,
						0,
						`Command correction plan applied.`,
						0,
						0,
						false
					);
					return true;
				} else {
					console.error(
						`[MinovativeMind] Failed to parse/validate AI command correction plan (Attempt ${currentCorrectionAttempt}): ${parsedPlanResult.error}`
					);
					this._logStepProgress(
						0,
						0,
						formatUserFacingErrorMessage(
							new Error(
								parsedPlanResult.error || "Failed to parse the correction plan."
							),
							"The AI generated an invalid command correction plan. Please check the Developer Tools console for more details.",
							"AI command correction error: ",
							rootUri
						),
						0,
						0,
						true
					);
					lastCorrectionFeedbackForPrompt = {
						type: "parsing_failed",
						message:
							parsedPlanResult.error ||
							"Failed to parse command correction plan.",
						details: {
							parsingError: parsedPlanResult.error,
							failedJson: correctionPlanJsonString,
						},
						issuesRemaining: [],
					};
				}
			} catch (correctionError: any) {
				if (correctionError.message === ERROR_OPERATION_CANCELLED) {
					throw correctionError;
				}
				this._logStepProgress(
					0,
					0,
					formatUserFacingErrorMessage(
						correctionError,
						"AI command self-correction failed due to an unexpected issue. Manual review may be required.",
						"AI command correction failed: ",
						rootUri
					),
					0,
					0,
					true
				);
				lastCorrectionFeedbackForPrompt = {
					type: "unknown",
					message: `An unexpected error occurred during command correction: ${correctionError.message}`,
					issuesRemaining: [],
				};
			}
			currentCorrectionAttempt++;
		}

		this._logStepProgress(
			0,
			0,
			`Command correction failed after ${this.MAX_CORRECTION_PLAN_ATTEMPTS} attempts. Manual intervention required.`,
			0,
			0,
			true
		);
		return false;
	}
}

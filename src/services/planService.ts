// src/services/planService.ts
import * as vscode from "vscode";
import * as path from "path";
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
} from "../ai/workflowPlanner";
import { generateFileChangeSummary } from "../utils/diffingUtils";
import { FileChangeEntry } from "../types/workflow";
import { GitConflictResolutionService } from "./gitConflictResolutionService";
import { applyAITextEdits } from "../utils/codeUtils";
import { DiagnosticService } from "../utils/diagnosticUtils";
import { formatUserFacingErrorMessage } from "../utils/errorFormatter";
import { showErrorNotification } from "../utils/notificationUtils";
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

export class PlanService {
	private readonly MAX_PLAN_PARSE_RETRIES = 3;
	private readonly MAX_TRANSIENT_STEP_RETRIES = 3;
	private readonly MAX_CORRECTION_PLAN_ATTEMPTS = 3; // Max attempts for AI to generate a valid correction *plan*
	private urlContextService: UrlContextService;
	private enhancedCodeGenerator: EnhancedCodeGenerator;
	// New private member to store correction attempt history per file
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

	// --- PLAN GENERATION & EXECUTION ---
	public async generateStructuredPlanAndExecute(
		planContext: sidebarTypes.PlanGenerationContext
	): Promise<void> {
		await this.provider.setPlanExecutionActive(true);
		this._postChatUpdateForPlanExecution({
			type: "appendRealtimeModelMessage",
			value: { text: `Generating detailed execution plan...` },
			isPlanStepUpdate: true,
		});

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
					this._postChatUpdateForPlanExecution({
						type: "appendRealtimeModelMessage",
						value: {
							text: `JSON plan parsing failed. Retrying (Attempt ${retryAttempt}/${this.MAX_PLAN_PARSE_RETRIES})...`,
							isError: true,
						},
						isPlanStepUpdate: true,
					});
					console.log(
						`JSON plan parsing failed. Retrying (Attempt ${retryAttempt}/${this.MAX_PLAN_PARSE_RETRIES})...`
					);
				} else {
					console.log(`Initial attempt to generate and parse structured plan.`);
				}

				// AI Request
				// Line 660: Modify first argument to wrap string prompt in HistoryEntryPart array
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
				const parsedPlanResult: ParsedPlanResult = await parseAndValidatePlan(
					structuredPlanJsonString,
					planContext.workspaceRootUri
				);

				if (parsedPlanResult.plan) {
					// Success! Assign plan and break the loop
					executablePlan = parsedPlanResult.plan;
					// ADDED CHECK: Ensure the plan has steps before proceeding
					if (executablePlan.steps.length === 0) {
						const errorMsg = `Correction plan generated with no executable steps. This is not allowed.`;
						console.error(`[PlanService] ${errorMsg}`);
						// Treat this as a parsing/validation failure to trigger retries or final error reporting
						lastParsingError = errorMsg;
						lastFailedJson = structuredPlanJsonString; // Capture the last valid-looking JSON
						retryAttempt++; // Increment attempt count
						// Re-prepare prompt for next attempt (if available)
						if (retryAttempt <= this.MAX_PLAN_PARSE_RETRIES) {
							// Logic to update currentJsonPlanningPrompt with error feedback
							currentJsonPlanningPrompt = createPlanningPrompt(
								planContext.type === "chat"
									? planContext.originalUserRequest
									: undefined,
								planContext.projectContext,
								planContext.type === "editor"
									? planContext.editorContext
									: undefined,
								`CRITICAL ERROR: Your previous JSON output resulted in an empty steps array. You MUST provide a plan with at least one step. (Attempt ${retryAttempt}/${this.MAX_PLAN_PARSE_RETRIES} to correct empty steps)`,
								planContext.chatHistory,
								planContext.textualPlanExplanation,
								formattedRecentChanges,
								urlContextString
							);
						}
						// Break from this specific 'if (parsedPlanResult.plan)' block to continue the retry loop
						continue;
					}

					break; // Exit retry loop if plan is valid and has steps
				} else {
					// Parsing failed, capture error and failed JSON
					lastParsingError =
						parsedPlanResult.error || "Failed to parse the JSON plan from AI.";
					lastFailedJson = structuredPlanJsonString;

					retryAttempt++; // Increment for the next potential attempt

					// If more retries are available, prepare for the next attempt
					if (retryAttempt <= this.MAX_PLAN_PARSE_RETRIES) {
						// Create feedback string for the AI
						// This feedback string is directly built into the prompt for general planning retries.
						// For correction plans, a structured CorrectionFeedback is used.
						// No change needed here for this instruction.

						// Update the prompt for the next iteration
						currentJsonPlanningPrompt = createPlanningPrompt(
							planContext.type === "chat"
								? planContext.originalUserRequest
								: undefined,
							planContext.projectContext,
							planContext.type === "editor"
								? planContext.editorContext
								: undefined,
							// Pass the error message as diagnostics/retry string for this general plan generation retry.
							// This is not using CorrectionFeedback type, but a direct string to the prompt.
							`CRITICAL ERROR: Your previous JSON output failed parsing/validation with the following error: "${lastParsingError}". You MUST correct this. Provide ONLY a valid JSON object according to the schema, with no additional text or explanations. Do not include markdown fences. (Attempt ${retryAttempt}/${this.MAX_PLAN_PARSE_RETRIES} to correct JSON)`,
							planContext.chatHistory,
							planContext.textualPlanExplanation,
							formattedRecentChanges,
							urlContextString
						);
					} else {
						// All retries exhausted, break loop to handle final failure after the loop
						break;
					}
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
				this._postChatUpdateForPlanExecution({
					type: "appendRealtimeModelMessage",
					value: { text: finalErrorMsg, isError: true },
					isPlanStepUpdate: true,
				});

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
				// this.provider.postMessageToWebview({ type: "reenableInput" }); //
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

		// Pre-compute relevant snippets once before the step execution loop.
		const relevantSnippets = await this._formatRelevantFilesForPrompt(
			context.relevantFiles ?? [],
			rootUri,
			combinedToken
		);

		let index = 0;
		while (index < totalSteps) {
			// Outer while loop
			const step = steps[index];
			let currentStepCompletedSuccessfullyOrSkipped = false;
			let currentTransientAttempt = 0;

			// Inner loop for auto-retries and user intervention for the *current* step
			while (!currentStepCompletedSuccessfullyOrSkipped) {
				if (combinedToken.isCancellationRequested) {
					throw new Error(ERROR_OPERATION_CANCELLED);
				}

				// Start of detailedStepDescription logic
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
									// Fallback if isCreateFileStep is true but neither generate_prompt nor content is present
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
				// End of detailedStepDescription logic

				this._postChatUpdateForPlanExecution({
					type: "appendRealtimeModelMessage",
					value: {
						text: `Step ${index + 1}/${totalSteps}: ${detailedStepDescription}${
							currentTransientAttempt > 0
								? ` (Auto-retry ${currentTransientAttempt}/${this.MAX_TRANSIENT_STEP_RETRIES})`
								: ""
						}`,
					},
					isPlanStepUpdate: true,
				});

				try {
					if (isCreateDirectoryStep(step)) {
						await vscode.workspace.fs.createDirectory(
							vscode.Uri.joinPath(rootUri, step.path)
						);
						changeLogger.logChange({
							filePath: step.path,
							changeType: "created",
							summary: `Created directory: '${step.path}'`,
							timestamp: Date.now(),
						});
						currentStepCompletedSuccessfullyOrSkipped = true;
					} else if (isCreateFileStep(step)) {
						const fileUri = vscode.Uri.joinPath(rootUri, step.path);
						let desiredContent: string | undefined = step.content; // Initialize with existing content if any

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
							// Attempt to stat the file to check for existence
							await vscode.workspace.fs.stat(fileUri);

							// If stat succeeds, the file exists
							const existingContent = Buffer.from(
								await vscode.workspace.fs.readFile(fileUri)
							).toString("utf-8");

							if (existingContent === cleanedDesiredContent) {
								// Content is identical, skip modification
								this._postChatUpdateForPlanExecution({
									type: "appendRealtimeModelMessage",
									value: {
										text: `Step ${index + 1} OK: File \`${
											step.path
										}\` already has the desired content. Skipping.`,
									},
									isPlanStepUpdate: true,
								});
								currentStepCompletedSuccessfullyOrSkipped = true;
							} else {
								// Content is different, treat as modification
								const document = await vscode.workspace.openTextDocument(
									fileUri
								);
								const editor = await vscode.window.showTextDocument(document);

								await applyAITextEdits(
									editor,
									existingContent,
									cleanedDesiredContent,
									combinedToken
								);
								const newContentAfterApply = editor.document.getText();

								const { formattedDiff, summary } =
									await generateFileChangeSummary(
										existingContent,
										newContentAfterApply,
										step.path
									);

								this._postChatUpdateForPlanExecution({
									type: "appendRealtimeModelMessage",
									value: {
										text: `Step ${index + 1} OK: Modified file \`${
											step.path
										}\` (See diff below)`,
									},
									diffContent: formattedDiff,
									isPlanStepUpdate: true,
								});
								this.provider.changeLogger.logChange({
									filePath: step.path,
									changeType: "modified",
									summary,
									diffContent: formattedDiff,
									timestamp: Date.now(),
									originalContent: existingContent,
									newContent: newContentAfterApply,
								});
								currentStepCompletedSuccessfullyOrSkipped = true;
							}
							affectedFileUris.add(fileUri); // Add to affected files in case of modification
						} catch (error: any) {
							if (
								error instanceof vscode.FileSystemError &&
								(error.code === "FileNotFound" ||
									error.code === "EntryNotFound")
							) {
								// File does not exist, proceed with creation
								await vscode.workspace.fs.writeFile(
									fileUri,
									Buffer.from(cleanedDesiredContent)
								);

								// Open and display the new file
								const document = await vscode.workspace.openTextDocument(
									fileUri
								);
								await vscode.window.showTextDocument(document);

								const { formattedDiff, summary } =
									await generateFileChangeSummary(
										"", // No original content for creation
										cleanedDesiredContent,
										step.path
									);

								this._postChatUpdateForPlanExecution({
									type: "appendRealtimeModelMessage",
									value: {
										text: `Step ${index + 1} OK: Created file \`${
											step.path
										}\` (See diff below)`,
									},
									diffContent: formattedDiff,
									isPlanStepUpdate: true,
								});
								this.provider.changeLogger.logChange({
									filePath: step.path,
									changeType: "created",
									summary,
									diffContent: formattedDiff,
									timestamp: Date.now(),
									originalContent: "",
									newContent: cleanedDesiredContent,
								});
								currentStepCompletedSuccessfullyOrSkipped = true;
								affectedFileUris.add(fileUri); // Add to affected files in case of creation
							} else {
								// Re-throw other errors (permissions, etc.)
								throw error;
							}
						}
					} else if (isModifyFileStep(step)) {
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

						// Ensure the file is open in an editor to apply precise edits
						let document: vscode.TextDocument;
						let editor: vscode.TextEditor;
						try {
							document = await vscode.workspace.openTextDocument(fileUri);
							editor = await vscode.window.showTextDocument(document);
						} catch (docError: any) {
							// If the document cannot be opened or shown, treat as an error and stop execution for this step
							throw new Error(
								`Failed to open document ${fileUri.fsPath} for modification: ${docError.message}`
							);
						}

						// Apply precise text edits using the utility function
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

						// New if condition: check for actual line changes reported by diffing utility
						if (addedLines.length > 0 || removedLines.length > 0) {
							affectedFileUris.add(fileUri);

							// Post-application logic, now unconditional after applyAITextEdits
							if (
								context.isMergeOperation &&
								context.editorContext &&
								fileUri.toString() ===
									context.editorContext.documentUri.toString()
							) {
								await this.gitConflictResolutionService.unmarkFileAsResolved(
									fileUri
								);
							}

							this._postChatUpdateForPlanExecution({
								type: "appendRealtimeModelMessage",
								value: {
									text: `Step ${index + 1} OK: Modified file \`${
										step.path
									}\` (See diff below)`,
								},
								diffContent: formattedDiff,
								isPlanStepUpdate: true,
							});
							// MODIFICATION: Pass existingContent and newContentAfterApply to logChange
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
							// If content is identical or only cosmetic changes, still count as success, but no diff/change log
							this._postChatUpdateForPlanExecution({
								type: "appendRealtimeModelMessage",
								value: {
									text: `Step ${index + 1} OK: File \`${
										step.path
									}\` content is already as desired, no substantial modifications needed.`,
								},
								isPlanStepUpdate: true,
							});
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
									combinedToken,
									this.provider.activeChildProcesses
								);

								if (commandResult.exitCode !== 0) {
									// Failure scenario
									const errorMessage = `Command \`${step.command}\` failed with exit code ${commandResult.exitCode}.
                                    \n--- STDOUT ---\n${commandResult.stdout}
                                    \n--- STDERR ---\n${commandResult.stderr}`;

									this._postChatUpdateForPlanExecution({
										type: "appendRealtimeModelMessage",
										value: {
											text: `Step ${
												index + 1
											} FAILED: Command execution error.`,
											isError: true,
										},
										diffContent: errorMessage,
										isPlanStepUpdate: true,
									});

									const correctionSuccessful =
										await this._performCommandCorrection(
											step.command,
											commandResult.stdout,
											commandResult.stderr,
											rootUri,
											combinedToken,
											context,
											progress,
											originalRootInstruction
										);

									if (!correctionSuccessful) {
										throw new Error(
											`Command execution failed and AI correction failed. Command: ${step.command}`
										);
									}
									currentStepCompletedSuccessfullyOrSkipped = true;
								} else {
									// Success scenario (exitCode === 0, potentially with warnings in stderr)
									const successMessage = `Command \`${step.command}\` executed successfully.
                                    \n--- STDOUT ---\n${commandResult.stdout}
                                    \n--- STDERR ---\n${commandResult.stderr}`;

									this._postChatUpdateForPlanExecution({
										type: "appendRealtimeModelMessage",
										value: { text: `Step ${index + 1} OK: Command executed.` },
										diffContent: successMessage,
										isPlanStepUpdate: true,
									});
									currentStepCompletedSuccessfullyOrSkipped = true;
								}
							} catch (commandExecError: any) {
								// Handle cancellation or other unexpected errors during executeCommand itself
								if (commandExecError.message === ERROR_OPERATION_CANCELLED) {
									throw commandExecError;
								}
								// Treat other errors during execution as a failure of the step
								let detailedError = `Error executing command \`${step.command}\`: ${commandExecError.message}`;
								this._postChatUpdateForPlanExecution({
									type: "appendRealtimeModelMessage",
									value: {
										text: `Step ${index + 1} FAILED: ${detailedError}`,
										isError: true,
									},
									isPlanStepUpdate: true,
								});
							}
						} else {
							currentStepCompletedSuccessfullyOrSkipped = true;
							this._postChatUpdateForPlanExecution({
								type: "appendRealtimeModelMessage",
								value: { text: `Step ${index + 1} SKIPPED by user.` },
								isPlanStepUpdate: true,
							});
						}
					}
				} catch (error: any) {
					let errorMsg = formatUserFacingErrorMessage(
						error,
						"Failed to execute plan step. Please review the details and try again.",
						"Step execution failed: ",
						rootUri
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

					// Auto-Retry Logic
					if (
						isRetryableTransientError &&
						currentTransientAttempt < this.MAX_TRANSIENT_STEP_RETRIES
					) {
						this._postChatUpdateForPlanExecution({
							type: "appendRealtimeModelMessage",
							value: {
								text: `Step ${
									index + 1
								} FAILED (transient, auto-retrying): ${errorMsg}`,
								isError: true,
							},
							isPlanStepUpdate: true,
						});
						console.warn(
							`Minovative Mind: Step ${
								index + 1
							} failed, auto-retrying due to transient error: ${errorMsg}`
						);
						await new Promise((resolve) =>
							setTimeout(resolve, 10000 + currentTransientAttempt * 5000)
						);
						currentTransientAttempt++;
					} else {
						// Fatal error, or transient retries exhausted, or user chose to skip command
						this._postChatUpdateForPlanExecution({
							type: "appendRealtimeModelMessage",
							value: {
								text: `Step ${
									index + 1
								} FAILED: ${errorMsg}. Requires user intervention.`,
								isError: true,
							},
							isPlanStepUpdate: true,
						});
						const userChoice = await showErrorNotification(
							error,
							`Step ${
								index + 1
							}/${totalSteps} failed. What would you like to do?`,
							`Plan Step Failed for '${step.description}': `,
							rootUri,
							"Retry Step",
							"Skip Step",
							"Cancel Plan"
						);

						if (userChoice === "Retry Step") {
							currentTransientAttempt = 0;
						} else if (userChoice === "Skip Step") {
							currentStepCompletedSuccessfullyOrSkipped = true;
							this._postChatUpdateForPlanExecution({
								type: "appendRealtimeModelMessage",
								value: { text: `Step ${index + 1} SKIPPED by user.` },
								isPlanStepUpdate: true,
							});
							console.log(
								`Minovative Mind: User chose to skip Step ${index + 1}.`
							);
						} else {
							// Cancel Plan or dialog was dismissed/closed
							throw new Error(ERROR_OPERATION_CANCELLED);
						}
					}
				}
			} // End of inner `while (!currentStepCompletedSuccessfullyOrSkipped)` loop

			index++;
		} // End of outer `while (index < totalSteps)` loop
		return affectedFileUris;
	}

	/**
	 * Reads the content of relevant files and formats them into Markdown fenced code blocks.
	 * Includes error handling for unreadable or binary files and checks for cancellation.
	 * @param relevantFiles An array of relative file paths.
	 * @param workspaceRootUri The URI of the workspace root.
	 * @param token A CancellationToken to observe cancellation requests.
	 * @returns A single concatenated string of all formatted snippets.
	 */
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
	// This function is based on assumptions about CodeIssue's structure,
	// as its definition is not available in the provided context.
	// It aims to extract common properties useful for AI feedback.
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
			// Assert to the type expected by CodeIssue, which does not include "hint".
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

	// Add new _performFinalValidationAndCorrection method
	private async _performFinalValidationAndCorrection(
		affectedFileUris: Set<vscode.Uri>,
		rootUri: vscode.Uri,
		token: vscode.CancellationToken,
		planContext: sidebarTypes.PlanGenerationContext,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		originalUserInstruction: string
	): Promise<boolean> {
		// Phase 1: Initialize filesNeedingCorrection Set
		// This set will track files that still contain errors and require correction.
		let filesNeedingCorrection = new Set<vscode.Uri>(affectedFileUris);

		if (filesNeedingCorrection.size === 0) {
			this._postChatUpdateForPlanExecution({
				type: "appendRealtimeModelMessage",
				value: {
					text: `No files were modified or created by the plan. Skipping final validation.`,
				},
				isPlanStepUpdate: true,
			});
			// Clear history if no files needed correction from the start.
			this.fileCorrectionAttemptHistory.clear();
			return true;
		}

		let currentCorrectionAttempt = 1;
		// Phase 2: Maintain Outer Correction Attempts Loop
		while (currentCorrectionAttempt <= this.MAX_CORRECTION_PLAN_ATTEMPTS) {
			// Phase 3: Add Early Exit Condition
			// If no files need correction, we can exit successfully.
			if (filesNeedingCorrection.size === 0) {
				console.log(
					`[MinovativeMind] All files corrected. Exiting validation loop.`
				);
				this.fileCorrectionAttemptHistory.clear();
				return true;
			}

			// Phase 4: Initialize nextFilesNeedingCorrection Set
			// This set will store files that still have errors after the current attempt.
			const nextFilesNeedingCorrection = new Set<vscode.Uri>();

			// Phase 5: Iterate Through filesNeedingCorrection
			for (const currentFileUri of filesNeedingCorrection) {
				if (token.isCancellationRequested) {
					console.log(
						`[MinovativeMind] Final validation and correction cancelled during file processing.`
					);
					this._postChatUpdateForPlanExecution({
						type: "appendRealtimeModelMessage",
						value: { text: `Final code validation cancelled.` },
						isPlanStepUpdate: true,
					});
					this.fileCorrectionAttemptHistory.clear();
					return false;
				}

				let errorsFoundInCurrentFileBeforeAttempt = false;
				let aggregatedFormattedDiagnosticsForFile = "";

				const fileRelativePath = path
					.relative(rootUri.fsPath, currentFileUri.fsPath)
					.replace(/\\/g, "/");

				// Retrieve previous attempt history for the current file
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

				// Check for specific feedback from the *last* attempt on this file
				if (lastAttemptForFile?.feedbackUsed?.type === "parsing_failed") {
					feedbackForPrompt = lastAttemptForFile.feedbackUsed;
					this._postChatUpdateForPlanExecution({
						type: "appendRealtimeModelMessage",
						value: {
							text: `Previous attempt for '${fileRelativePath}' failed parsing. Providing feedback for AI.`,
							isError: true,
						},
						isPlanStepUpdate: true,
					});
				} else if (lastAttemptForFile && secondLastAttemptForFile) {
					// Check for oscillation if there are at least two previous attempts
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
						this._postChatUpdateForPlanExecution({
							type: "appendRealtimeModelMessage",
							value: {
								text: `Detected oscillation for '${fileRelativePath}'. Providing feedback for AI.`,
								isError: true,
							},
							isPlanStepUpdate: true,
						});
					}
				}

				// Phase 6: Isolate Diagnostics for the Current File
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

					// Format diagnostics specifically for this file, focusing only on errors.
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

					this._postChatUpdateForPlanExecution({
						type: "appendRealtimeModelMessage",
						value: {
							text: `File '${fileRelativePath}' has ${errorsForFile.length} errors. Attempting AI correction (Attempt ${currentCorrectionAttempt}/${this.MAX_CORRECTION_PLAN_ATTEMPTS})...`,
							isError: true,
						},
						isPlanStepUpdate: true,
					});

					try {
						const jsonGenerationConfig: GenerationConfig = {
							responseMimeType: "application/json",
							temperature: sidebarConstants.TEMPERATURE,
						};

						// Phase 7: Generate File-Specific Correction Plan
						// Format only the current file as relevant for the prompt.
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

						// Prepare editorContext specific to the current file for the prompt.
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

						// Add logic to construct jsonEscapingInstructionsForPrompt
						let jsonEscapingInstructionsForPrompt = "";
						// Add explicit checks to ensure correctionFeedbackForHistory and its details are defined
						// Add logic to construct jsonEscapingInstructionsForPrompt
						// FIX: Use `feedbackForPrompt`, which holds the results from the *previous* attempt.
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

						// Construct the prompt, ensuring it focuses ONLY on the current file.
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
							jsonEscapingInstructionsForPrompt // Pass as the last argument
						);

						progress.report({
							message: `AI generating correction plan for '${fileRelativePath}' (Attempt ${currentCorrectionAttempt}/${this.MAX_CORRECTION_PLAN_ATTEMPTS})...`,
						});

						// Execute AI request for the correction plan
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
							this._postChatUpdateForPlanExecution({
								type: "appendRealtimeModelMessage",
								value: {
									text: `Applying correction plan for '${fileRelativePath}'.`,
								},
								isPlanStepUpdate: true,
							});

							// Phase 8: Execute the Generated Plan
							// The _executePlanSteps method processes the plan's steps.
							// We expect the AI to generate a plan targeting only the currentFileUri.
							// The return value `subPlanAffectedFiles` is tracked by the main `_executePlan` method.
							await this._executePlanSteps(
								parsedPlanResult.plan.steps!,
								rootUri,
								planContext,
								token,
								progress,
								originalUserInstruction
							);
							// Update the overall set of affected files from main _executePlan tracking.
							// This isn't directly used for `filesNeedingCorrection` logic here, but maintains consistency.
							// subPlanAffectedFiles.forEach((uri) => affectedFileUris.add(uri)); // This line was removed as subPlanAffectedFiles is not declared.
						} else {
							// Failed to parse plan for this file
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
							this._postChatUpdateForPlanExecution({
								type: "appendRealtimeModelMessage",
								value: {
									text: formatUserFacingErrorMessage(
										new Error(
											parsedPlanResult.error ||
												"Failed to parse the correction plan."
										),
										`The AI generated an invalid final correction plan for '${fileRelativePath}'. Please check the Developer Tools console for more details.`,
										"AI correction error: ",
										rootUri
									),
									isError: true,
								},
								isPlanStepUpdate: true,
							});
							nextFilesNeedingCorrection.add(currentFileUri);
						}
					} catch (correctionError: any) {
						nextFilesNeedingCorrection.add(currentFileUri);

						if (correctionError.message === ERROR_OPERATION_CANCELLED) {
							throw correctionError;
						}

						this._postChatUpdateForPlanExecution({
							type: "appendRealtimeModelMessage",
							value: {
								text: formatUserFacingErrorMessage(
									correctionError,
									`AI final self-correction failed for '${fileRelativePath}' due to an unexpected issue. Retry with /fix. Manual review may be required.`,
									"AI self-correction failed: ",
									rootUri
								),
								isError: true,
							},
							isPlanStepUpdate: true,
						});
					}
				} else {
					// No errors found in this file for this attempt, or it was already resolved.
					// File does not need correction in this round.
					// It will naturally be excluded from nextFilesNeedingCorrection.
					// We still need to update the overall success flag if this was the only file with issues.
				}

				// Phase 9: Re-validate the Corrected File and Record Outcome
				// Only re-validate if we actually attempted a correction in this iteration for this file (had errors initially and proceeded with correction).
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

					// Convert vscode.Diagnostic[] to CodeIssue[]
					const codeIssuesAfterCorrection: CodeIssue[] =
						errorsAfterCorrection.map((d) => this._diagnosticToCodeIssue(d));

					// Determine overall success for this file within this attempt (including AI generation/parsing)
					const currentFileAttemptSuccessful =
						codeIssuesAfterCorrection.length === 0 &&
						currentAIPlanGenerationSuccessful;

					// Record the outcome for the current file
					const currentFileOutcome = {
						iteration: currentCorrectionAttempt,
						issuesRemaining: codeIssuesAfterCorrection,
						success: currentFileAttemptSuccessful,
						feedbackUsed: correctionFeedbackForHistory,
					};

					// Initialize history entry if it doesn't exist
					if (!this.fileCorrectionAttemptHistory.has(fileRelativePath)) {
						this.fileCorrectionAttemptHistory.set(fileRelativePath, []);
					}
					this.fileCorrectionAttemptHistory
						.get(fileRelativePath)!
						.push(currentFileOutcome);

					// Phase 10: Update nextFilesNeedingCorrection
					if (
						codeIssuesAfterCorrection.length > 0 ||
						!currentFileAttemptSuccessful
					) {
						nextFilesNeedingCorrection.add(currentFileUri);
						console.log(
							`[MinovativeMind] Errors still present in '${path.relative(
								rootUri.fsPath,
								currentFileUri.fsPath
							)}' after correction attempt ${currentCorrectionAttempt}. Adding back for next round.`
						);
					} else {
						// No errors found after correction for this file, and the attempt was considered successful for this file.
						console.log(
							`[MinovativeMind] Errors resolved for '${path.relative(
								rootUri.fsPath,
								currentFileUri.fsPath
							)}' after correction attempt ${currentCorrectionAttempt}. Clearing history for this file.`
						);
						this._postChatUpdateForPlanExecution({
							type: "appendRealtimeModelMessage",
							value: {
								text: `Correction successful for '${path.relative(
									rootUri.fsPath,
									currentFileUri.fsPath
								)}'.`,
								isError: false,
							},
							isPlanStepUpdate: true,
						});
						this.fileCorrectionAttemptHistory.delete(fileRelativePath);
					}
				}
				// Phase 11: Handle Files Without Errors - implicitly handled as they are not added to nextFilesNeedingCorrection.
			} // End of for...of loop iterating through filesNeedingCorrection

			// Phase 12: Update filesNeedingCorrection for the next iteration.
			filesNeedingCorrection = nextFilesNeedingCorrection;
			currentCorrectionAttempt++;

			// The early exit condition at the start of the `while` loop handles the case where `filesNeedingCorrection.size` becomes 0.
		} // End of while loop for MAX_CORRECTION_PLAN_ATTEMPTS

		// Phase 14: Final Method Outcome
		// If the loop finishes (all attempts exhausted) and there are still files needing correction, it's a failure.
		if (filesNeedingCorrection.size > 0) {
			this._postChatUpdateForPlanExecution({
				type: "appendRealtimeModelMessage",
				value: {
					text: `Overall validation failed after ${this.MAX_CORRECTION_PLAN_ATTEMPTS} attempts to auto-correct errors in ${filesNeedingCorrection.size} file(s). Please review the affected files manually.`,
					isError: true,
				},
				isPlanStepUpdate: true,
			});
			// Do not clear history here, as the files are still uncorrected.
			return false;
		} else {
			// If the loop completed and `filesNeedingCorrection` is empty, it implies all files were resolved.
			// This path is typically handled by the early exit condition inside the loop, but this serves as a final check.
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
				this._postChatUpdateForPlanExecution({
					type: "appendRealtimeModelMessage",
					value: { text: `Command correction cancelled.` },
					isPlanStepUpdate: true,
				});
				return false;
			}

			// The core context for the AI is the command failure output
			const commandFailureDetailsForPrompt = `The command \`${failedCommand}\` failed with exit code ${
				stdout === "" && stderr === "" ? "unknown" : "non-zero"
			}. Here's its output:\n\nSTDOUT:\n\`\`\`\n${stdout}\n\`\`\`\n\nSTDERR:\n\`\`\`\n${stderr}\n\`\`\`\n\nAnalyze this failure and generate a plan to correct the issue in the codebase. This might involve modifying files, creating new ones, or even running different commands. If the problem is environmental, suggest a fix by modifying files.`;

			// For the first attempt, the specific 'command_failure' feedback is the primary prompt content.
			// For subsequent attempts, `lastCorrectionFeedbackForPrompt` holds the parsing error from the previous attempt.
			let correctionPromptRetryReason: string | undefined;
			if (currentCorrectionAttempt === 1) {
				// For the first attempt, we use the command failure details directly as the "reason".
				// We also initialize `lastCorrectionFeedbackForPrompt` so it can be used in subsequent retries if parsing fails.
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

			this._postChatUpdateForPlanExecution({
				type: "appendRealtimeModelMessage",
				value: {
					text: `Attempting AI correction for failed command (Attempt ${currentCorrectionAttempt}/${this.MAX_CORRECTION_PLAN_ATTEMPTS})...`,
					isError: true,
				},
				diffContent: correctionPromptRetryReason,
				isPlanStepUpdate: true,
			});

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

				// Add logic to construct jsonEscapingInstructionsForPrompt
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
					jsonEscapingInstructionsForPrompt // Pass as the last argument
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
					this._postChatUpdateForPlanExecution({
						type: "appendRealtimeModelMessage",
						value: { text: `Applying command correction plan.` },
						isPlanStepUpdate: true,
					});

					// Clear feedback for next attempt as this one was successful
					lastCorrectionFeedbackForPrompt = undefined;

					// Execute the generated correction plan.
					await this._executePlanSteps(
						parsedPlanResult.plan.steps!,
						rootUri,
						planContext,
						token,
						progress,
						originalUserInstruction
					);
					// After correction, consider the command issue resolved if the plan ran without immediate error.
					this._postChatUpdateForPlanExecution({
						type: "appendRealtimeModelMessage",
						value: { text: `Command correction plan applied.`, isError: false },
						isPlanStepUpdate: true,
					});
					return true;
				} else {
					// Plan parsing failed for the generated correction plan
					console.error(
						`[MinovativeMind] Failed to parse/validate AI command correction plan (Attempt ${currentCorrectionAttempt}): ${parsedPlanResult.error}`
					);
					this._postChatUpdateForPlanExecution({
						type: "appendRealtimeModelMessage",
						value: {
							text: formatUserFacingErrorMessage(
								new Error(
									parsedPlanResult.error ||
										"Failed to parse the correction plan."
								),
								"The AI generated an invalid command correction plan. Please check the Developer Tools console for more details.",
								"AI command correction error: ",
								rootUri
							),
							isError: true,
						},
						isPlanStepUpdate: true,
					});
					// Store this parsing error feedback for the next attempt
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
				this._postChatUpdateForPlanExecution({
					type: "appendRealtimeModelMessage",
					value: {
						text: formatUserFacingErrorMessage(
							correctionError,
							"AI command self-correction failed due to an unexpected issue. Manual review may be required.",
							"AI command correction failed: ",
							rootUri
						),
						isError: true,
					},
					isPlanStepUpdate: true,
				});
				// Store a generic "unknown" feedback for the next attempt if an exception occurs
				lastCorrectionFeedbackForPrompt = {
					type: "unknown",
					message: `An unexpected error occurred during command correction: ${correctionError.message}`,
					issuesRemaining: [],
				};
			}
			currentCorrectionAttempt++;
		}

		this._postChatUpdateForPlanExecution({
			type: "appendRealtimeModelMessage",
			value: {
				text: `Command correction failed after ${this.MAX_CORRECTION_PLAN_ATTEMPTS} attempts. Manual intervention required.`,
				isError: true,
			},
			isPlanStepUpdate: true,
		});
		return false;
	}
}

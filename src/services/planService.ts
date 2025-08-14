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
	CreateDirectoryStep,
	CreateFileStep,
	ModifyFileStep,
	RunCommandStep,
} from "../ai/workflowPlanner";
import { generateFileChangeSummary } from "../utils/diffingUtils";
import { FileChangeEntry } from "../types/workflow";
import { GitConflictResolutionService } from "./gitConflictResolutionService";
import { applyAITextEdits, cleanCodeOutput } from "../utils/codeUtils";
import { formatUserFacingErrorMessage } from "../utils/errorFormatter";
import { UrlContextService } from "./urlContextService";
import { EnhancedCodeGenerator } from "../ai/enhancedCodeGeneration";
import { executeCommand, CommandResult } from "../utils/commandExecution";
import {
	createInitialPlanningExplanationPrompt,
	createPlanningPrompt,
} from "../ai/prompts/planningPrompts";
import { repairJsonEscapeSequences } from "../utils/jsonUtils";

export class PlanService {
	// Audited retry constants and made configurable via VS Code settings
	private readonly MAX_PLAN_PARSE_RETRIES: number;
	private readonly MAX_TRANSIENT_STEP_RETRIES: number;
	private urlContextService: UrlContextService;
	private enhancedCodeGenerator: EnhancedCodeGenerator;

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

		let executablePlan: ExecutionPlan | null = null; // Declare executablePlan here

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

			// Generate a single, standard prompt for the AI.
			const promptForAI = createPlanningPrompt(
				planContext.type === "chat"
					? planContext.originalUserRequest
					: undefined,
				planContext.projectContext,
				planContext.type === "editor" ? planContext.editorContext : undefined,
				undefined, // Removed arguments related to retry attempts or previous errors
				planContext.chatHistory,
				planContext.textualPlanExplanation,
				formattedRecentChanges,
				urlContextString
			);

			console.log(`Attempting to generate and parse structured plan.`);

			// Single AI generation call
			structuredPlanJsonString =
				await this.provider.aiRequestService.generateWithRetry(
					[{ text: promptForAI }],
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
			if (!structuredPlanJsonString) {
				throw new Error("AI failed to generate any response for the plan.");
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

			// Perform single parsing and validation
			const { plan, error } = await this.parseAndValidatePlanWithFix(
				structuredPlanJsonString,
				planContext.workspaceRootUri
			);

			// Add error handling for single attempt
			if (error) {
				throw new Error(`Failed to parse or validate generated plan: ${error}`);
			}

			if (!plan || plan.steps.length === 0) {
				throw new Error(
					"AI generated plan content but it was empty or invalid after parsing."
				);
			}

			executablePlan = plan; // Assign the successfully parsed and validated plan

			// If we reached here, executablePlan is valid. Proceed with execution.
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

						await this._executePlanSteps(
							plan.steps!,
							rootUri,
							planContext,
							combinedToken,
							progress,
							originalRootInstruction
						);

						// If _executePlanSteps completes without throwing and token not cancelled, it's a success
						if (!combinedToken.isCancellationRequested) {
							this.provider.currentExecutionOutcome = "success";
						} else {
							this.provider.currentExecutionOutcome = "cancelled";
						}
					} catch (innerError: any) {
						if (innerError.message === ERROR_OPERATION_CANCELLED) {
							this.provider.currentExecutionOutcome = "cancelled";
						} else {
							this.provider.currentExecutionOutcome = "failed";
						}
						throw innerError;
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
							// If command failed, re-throw to outer error handler
							throw new Error(
								`Command execution failed for '${step.command}'.`
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

					throw new Error(
						`Command '${step.command}' failed. Output: ${errorMessage}`
					);
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
		const maxFileSizeForSnippet = sidebarConstants.DEFAULT_SIZE;

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
}

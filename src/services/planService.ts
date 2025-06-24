import * as vscode from "vscode";
import * as path from "path";
import { GenerationConfig } from "@google/generative-ai";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import { isFeatureAllowed } from "../sidebar/utils/featureGating";
import * as sidebarTypes from "../sidebar/common/sidebarTypes"; // Import sidebarTypes
import * as sidebarConstants from "../sidebar/common/sidebarConstants";
import {
	createInitialPlanningExplanationPrompt,
	createPlanningPrompt,
	createCorrectionPlanPrompt, // NEW: Import createCorrectionPlanPrompt
} from "../sidebar/services/aiInteractionService";
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
} from "../ai/workflowPlanner";
import { typeContentIntoEditor } from "../sidebar/services/planExecutionService";
import { generateFileChangeSummary } from "../utils/diffingUtils";
import { FileChangeEntry } from "../types/workflow";
import { GitConflictResolutionService } from "./gitConflictResolutionService";
import { sanitizeErrorMessagePaths } from "../utils/pathUtils";
import { applyAITextEdits } from "../utils/codeUtils"; // For applying precise text edits
import { DiagnosticService } from "../utils/diagnosticUtils"; // NEW: Import DiagnosticService

export class PlanService {
	private readonly MAX_PLAN_PARSE_RETRIES = 3;
	private readonly MAX_TRANSIENT_STEP_RETRIES = 3;
	private readonly MAX_CORRECTION_PLAN_ATTEMPTS = 3; // NEW: Max attempts for AI to generate a valid correction *plan*

	constructor(
		private provider: SidebarProvider,
		private workspaceRootUri: vscode.Uri | undefined, // Add workspaceRootUri
		private gitConflictResolutionService: GitConflictResolutionService // Add GitConflictResolutionService
	) {}

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
		const {
			currentUserTier,
			isSubscriptionActive,
			settingsManager,
			apiKeyManager,
			changeLogger,
		} = this.provider;
		const modelName = settingsManager.getSelectedModelName();
		const apiKey = apiKeyManager.getActiveApiKey();

		if (!apiKey) {
			this.provider.postMessageToWebview({
				type: "statusUpdate",
				value: "Cannot start plan: No active API Key.",
				isError: true,
			});
			return;
		}

		if (
			!isFeatureAllowed(currentUserTier, isSubscriptionActive, "plan_from_chat")
		) {
			const restrictedMessage =
				"This feature is available for Premium users. Please upgrade, on the website, for full functionality.";
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				error: restrictedMessage,
			});
			return;
		}

		// Removed this.provider.postMessageToWebview for type: "aiResponseStart" here.

		this.provider.activeOperationCancellationTokenSource =
			new vscode.CancellationTokenSource();
		const token = this.provider.activeOperationCancellationTokenSource.token;

		changeLogger.clear();

		const rootFolder = vscode.workspace.workspaceFolders?.[0];
		if (!rootFolder) {
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				error: "Error: No workspace folder open.",
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
					userRequest
				);
			const { contextString, relevantFiles } = buildContextResult;

			// Add new aiResponseStart message here with relevantFiles
			this.provider.postMessageToWebview({
				type: "aiResponseStart",
				value: { modelName, relevantFiles: relevantFiles },
			});

			if (contextString.startsWith("[Error")) {
				throw new Error(contextString);
			}

			const textualPlanPrompt = createInitialPlanningExplanationPrompt(
				contextString,
				userRequest,
				undefined,
				undefined,
				[...this.provider.chatHistoryManager.getChatHistory()]
			);

			let accumulatedTextualResponse = "";
			textualPlanResponse =
				await this.provider.aiRequestService.generateWithRetry(
					textualPlanPrompt,
					modelName,
					undefined,
					"initial plan explanation",
					undefined,
					{
						onChunk: (chunk: string) => {
							accumulatedTextualResponse += chunk;
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
				throw new Error(textualPlanResponse);
			}

			this.provider.chatHistoryManager.addHistoryEntry(
				"model",
				textualPlanResponse,
				undefined,
				relevantFiles,
				relevantFiles && relevantFiles.length <= 3
			);
			success = true;

			this.provider.pendingPlanGenerationContext = {
				type: "chat",
				originalUserRequest: userRequest,
				projectContext: contextString,
				relevantFiles,
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

			// Modified UI handling after plan generation
			await this._handlePostTextualPlanGenerationUI(
				this.provider.pendingPlanGenerationContext!
			);
		} catch (error: any) {
			finalErrorForDisplay = error.message;
		} finally {
			const isCancellation = finalErrorForDisplay === ERROR_OPERATION_CANCELLED;
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: success,
				error: isCancellation
					? "Plan generation cancelled."
					: finalErrorForDisplay,
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
		isMergeOperation: boolean = false // Added isMergeOperation parameter
	): Promise<sidebarTypes.PlanGenerationResult> {
		const { settingsManager, apiKeyManager, changeLogger, isUserSignedIn } =
			this.provider;
		const modelName = settingsManager.getSelectedModelName();
		const apiKey = apiKeyManager.getActiveApiKey();

		const rootFolder = vscode.workspace.workspaceFolders?.[0];
		if (!rootFolder) {
			initialProgress?.report({
				message: "Error: No workspace folder open.",
				increment: 100,
			});
			return { success: false, error: "No workspace folder open." };
		}

		if (!isUserSignedIn) {
			initialProgress?.report({
				message: "Please sign in to use this feature.",
				increment: 100,
			});
			return { success: false, error: "Please sign in to use this feature." };
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
			// Removed this.provider.postMessageToWebview for type: "aiResponseStart" here.
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
					diagnosticsString
				);
			const { contextString, relevantFiles } = buildContextResult;

			// Add new aiResponseStart message here with relevantFiles
			this.provider.postMessageToWebview({
				type: "aiResponseStart",
				value: { modelName, relevantFiles: relevantFiles },
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
			textualPlanResponse =
				await this.provider.aiRequestService.generateWithRetry(
					textualPlanPrompt,
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
				relevantFiles && relevantFiles.length <= 3
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

			// Removed UI handling block as per instructions

			finalResult = {
				success: true,
				textualPlanExplanation: textualPlanResponse,
				context: this.provider.pendingPlanGenerationContext,
			};
		} catch (genError: any) {
			const isCancellation = genError.message === ERROR_OPERATION_CANCELLED;
			finalResult = {
				success: false,
				error: isCancellation
					? "Plan generation cancelled."
					: genError instanceof Error
					? genError.message
					: String(genError),
			};
		} finally {
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: finalResult.success,
				error: finalResult.error,
			});
			disposable?.dispose();
			this.provider.activeOperationCancellationTokenSource?.dispose();
			this.provider.activeOperationCancellationTokenSource = undefined;
			return finalResult;
		}
	}

	// --- PLAN GENERATION & EXECUTION ---
	public async generateStructuredPlanAndExecute(
		planContext: sidebarTypes.PlanGenerationContext
	): Promise<void> {
		this.provider.postMessageToWebview({
			type: "statusUpdate",
			value: `Generating detailed execution plan (JSON)...`,
		});
		this.provider.chatHistoryManager.addHistoryEntry(
			"model",
			"User confirmed. Generating detailed execution plan (JSON)..."
		);

		let structuredPlanJsonString = "";
		const token = this.provider.activeOperationCancellationTokenSource?.token;

		// Initialize retry variables
		let retryAttempt = 0;
		let executablePlan: ExecutionPlan | null = null;
		let lastParsingError: string | undefined;
		let lastFailedJson: string | undefined;

		try {
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

			// Initial prompt creation outside the loop. This variable will be updated for retries.
			let currentJsonPlanningPrompt = createPlanningPrompt(
				planContext.type === "chat"
					? planContext.originalUserRequest
					: undefined,
				planContext.projectContext,
				planContext.type === "editor" ? planContext.editorContext : undefined,
				undefined, // No initial diagnostics/retry string
				planContext.chatHistory,
				planContext.textualPlanExplanation,
				formattedRecentChanges
			);

			// Start of the retry loop
			while (retryAttempt <= this.MAX_PLAN_PARSE_RETRIES) {
				if (token?.isCancellationRequested) {
					throw new Error(ERROR_OPERATION_CANCELLED);
				}

				// Inform the user about the attempt
				if (retryAttempt > 0) {
					this.provider.postMessageToWebview({
						type: "statusUpdate",
						value: `JSON plan parsing failed. Retrying (Attempt ${retryAttempt}/${this.MAX_PLAN_PARSE_RETRIES})...`,
						isError: true,
					});
					console.log(
						`JSON plan parsing failed. Retrying (Attempt ${retryAttempt}/${this.MAX_PLAN_PARSE_RETRIES})...`
					);
				} else {
					console.log(`Initial attempt to generate and parse structured plan.`);
				}

				// AI Request
				structuredPlanJsonString =
					await this.provider.aiRequestService.generateWithRetry(
						currentJsonPlanningPrompt, // Use the dynamically updated prompt
						planContext.modelName,
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
						`AI failed to generate structured plan: ${structuredPlanJsonString}`
					);
				}

				// Markdown stripping
				structuredPlanJsonString = structuredPlanJsonString
					.replace(/^```json\s*/im, "")
					.replace(/\s*```$/im, "")
					.trim();

				// JSON Parsing and Validation
				const parsedPlanResult: ParsedPlanResult = await parseAndValidatePlan(
					structuredPlanJsonString,
					planContext.workspaceRootUri
				);

				if (parsedPlanResult.plan) {
					// Success! Assign plan and break the loop
					executablePlan = parsedPlanResult.plan;
					break;
				} else {
					// Parsing failed, capture error and failed JSON
					lastParsingError =
						parsedPlanResult.error || "Failed to parse the JSON plan from AI.";
					lastFailedJson = structuredPlanJsonString;

					retryAttempt++; // Increment for the next potential attempt

					// If more retries are available, prepare for the next attempt
					if (retryAttempt <= this.MAX_PLAN_PARSE_RETRIES) {
						// Create feedback string for the AI
						const retryFeedbackString = `CRITICAL ERROR: Your previous JSON output failed parsing/validation with the following error: "${lastParsingError}". The problematic JSON was: \`\`\`${lastFailedJson}\`\`\`. You MUST correct this. Provide ONLY a valid JSON object according to the schema, with no additional text or explanations. Do not include markdown fences. (Attempt ${retryAttempt}/${this.MAX_PLAN_PARSE_RETRIES} to correct JSON)`;

						// Update the prompt for the next iteration
						currentJsonPlanningPrompt = createPlanningPrompt(
							planContext.type === "chat"
								? planContext.originalUserRequest
								: undefined,
							planContext.projectContext,
							planContext.type === "editor"
								? planContext.editorContext
								: undefined,
							retryFeedbackString, // Pass the retry feedback here for next AI call
							planContext.chatHistory,
							planContext.textualPlanExplanation,
							formattedRecentChanges
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
				vscode.window.showErrorMessage(
					`Minovative Mind: Failed to parse AI plan after ${this.MAX_PLAN_PARSE_RETRIES} attempts. Check sidebar for retry options.`
				);
				return; // Important: return here to stop further execution
			}

			// If we reached here, executablePlan is valid. Proceed with execution.
			this.provider.pendingPlanGenerationContext = null;
			await this._executePlan(
				executablePlan,
				planContext,
				token ?? new vscode.CancellationTokenSource().token
			);
		} catch (error: any) {
			const isCancellation = error.message === ERROR_OPERATION_CANCELLED;
			if (isCancellation) {
				this.provider.postMessageToWebview({
					type: "statusUpdate",
					value: "Structured plan generation cancelled.",
				});
			} else {
				this.provider.postMessageToWebview({
					type: "statusUpdate",
					value: `Error generating plan: ${error.message}`,
					isError: true,
				});
				this.provider.postMessageToWebview({ type: "reenableInput" });
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
							progress,
							combinedToken
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

			const outcome = this.provider.currentExecutionOutcome ?? "failed";
			await this._showPlanCompletionNotification(
				plan.planDescription || "Unnamed Plan",
				outcome
			);
			this.provider.postMessageToWebview({ type: "reenableInput" });
		}
	}

	private async _executePlanSteps(
		steps: PlanStep[],
		rootUri: vscode.Uri,
		context: sidebarTypes.PlanGenerationContext, // Renamed to context for clarity
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		combinedToken: vscode.CancellationToken
	): Promise<Set<vscode.Uri>> {
		let executionOk = true; // Still used for internal loop control and throwing on fatal error/cancellation
		const affectedFileUris = new Set<vscode.Uri>();
		const totalSteps = steps.length;
		const { settingsManager, changeLogger } = this.provider;

		let index = 0; // Initialize index for while loop
		while (index < totalSteps) {
			// Outer while loop
			const step = steps[index];
			let currentStepCompletedSuccessfullyOrSkipped = false; // Flag for current step's success/skip
			let currentTransientAttempt = 0; // Auto-retry counter for the current step

			// Inner loop for auto-retries and user intervention for the *current* step
			while (!currentStepCompletedSuccessfullyOrSkipped) {
				if (combinedToken.isCancellationRequested) {
					executionOk = false;
					throw new Error(ERROR_OPERATION_CANCELLED); // Plan cancelled
				}

				const stepMessageTitle = `Step ${index + 1}/${totalSteps}: ${
					step.description || step.action.replace(/_/g, " ")
				}`;
				progress.report({
					message: `${stepMessageTitle}${
						currentTransientAttempt > 0
							? ` (Auto-retry ${currentTransientAttempt}/${this.MAX_TRANSIENT_STEP_RETRIES})`
							: ""
					}...`,
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
					} else if (isCreateFileStep(step)) {
						const fileUri = vscode.Uri.joinPath(rootUri, step.path);
						// 1. Create the empty file
						await vscode.workspace.fs.writeFile(fileUri, Buffer.from(""));
						// 2. Open the newly created document
						const document = await vscode.workspace.openTextDocument(fileUri);
						// 3. Show the document in the editor
						const editor = await vscode.window.showTextDocument(document);

						let content = step.content;
						if (step.generate_prompt) {
							// Format relevant files for the prompt
							const relevantSnippets = await this._formatRelevantFilesForPrompt(
								context.relevantFiles ?? [], // Add nullish coalescing
								rootUri,
								combinedToken
							);

							const generationPrompt = `You are an expert senior software engineer. Your ONLY task is to generate the full file content. Do NOT include markdown code block formatting. Provide only the file content.\n\nThe generated code must be production-ready, robust, maintainable, and secure. Emphasize modularity, readability, efficiency, and adherence to industry best practices and clean code principles. Consider the existing project structure, dependencies, and conventions inferred from the broader project context.\n\nFile Path:\n${
								step.path
							}\n\nInstructions:\n${
								step.generate_prompt
							}\n\n--- Broader Project Context ---\n${
								context.projectContext
							}\n--- End Broader Project Context ---\n\n${
								context.editorContext
									? `--- Editor Context ---\n${JSON.stringify(
											context.editorContext,
											null,
											2
									  )}\n--- End Editor Context ---\n\n`
									: ""
							}${this._formatChatHistoryForPrompt(
								context.chatHistory
							)}\n\n--- Relevant Project Snippets (for context) ---\n${relevantSnippets}\n\nComplete File Content:`;
							content = await this.provider.aiRequestService.generateWithRetry(
								generationPrompt,
								settingsManager.getSelectedModelName(),
								undefined,
								`plan step ${index + 1}`,
								undefined,
								undefined,
								combinedToken
							);
						}
						await typeContentIntoEditor(editor, content ?? "", combinedToken);

						affectedFileUris.add(fileUri); // ADDED: Track affected file

						const { formattedDiff, summary } = await generateFileChangeSummary(
							"",
							content ?? "",
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
						});
						changeLogger.logChange({
							filePath: step.path,
							changeType: "created",
							summary,
							diffContent: formattedDiff,
							timestamp: Date.now(),
						});
					} else if (isModifyFileStep(step)) {
						const fileUri = vscode.Uri.joinPath(rootUri, step.path);
						const existingContent = Buffer.from(
							await vscode.workspace.fs.readFile(fileUri)
						).toString("utf-8");

						// Format relevant files for the prompt
						const relevantSnippets = await this._formatRelevantFilesForPrompt(
							context.relevantFiles ?? [], // Add nullish coalescing
							rootUri,
							combinedToken
						);

						const modificationPrompt = `You are an expert senior software engineer. Your ONLY task is to generate the *entire* modified content for the file. Do NOT include markdown code block formatting. Provide only the full, modified file content.\n\nThe modified code must be production-ready, robust, maintainable, and secure. Emphasize modularity, readability, efficiency, and adherence to industry best practices and clean code principles. Correctly integrate new code with existing structures and maintain functionality without introducing new bugs. Consider the existing project structure, dependencies, and conventions inferred from the broader project context.\n\nFile Path:\n${
							step.path
						}\n\nModification Instructions:\n${
							step.modification_prompt
						}\n\n--- Broader Project Context ---\n${
							context.projectContext
						}\n--- End Broader Project Context ---\n\n${
							context.editorContext
								? `--- Editor Context ---\n${JSON.stringify(
										context.editorContext,
										null,
										2
								  )}\n--- End Editor Context ---\n\n`
								: ""
						}${this._formatChatHistoryForPrompt(
							context.chatHistory
						)}\n\n--- Relevant Project Snippets (for context) ---\n${relevantSnippets}\n\n--- Existing File Content ---\n${existingContent}\n--- End Existing File Content ---\n\nComplete Modified File Content:`;

						let modifiedContent =
							await this.provider.aiRequestService.generateWithRetry(
								modificationPrompt,
								settingsManager.getSelectedModelName(),
								undefined,
								`plan step ${index + 1}`,
								undefined,
								undefined,
								combinedToken,
								context.isMergeOperation // Pass isMergeOperation
							);
						modifiedContent = modifiedContent
							.replace(/^```[a-z]*\n?/, "")
							.replace(/\n?```$/, "")
							.trim();

						if (modifiedContent !== existingContent) {
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
								editor.document.getText(), // CRITICAL CHANGE: Use current live content from editor for diffing
								modifiedContent,
								combinedToken
							);

							affectedFileUris.add(fileUri); // ADDED: Track affected file

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

							const { formattedDiff, summary } =
								await generateFileChangeSummary(
									existingContent,
									modifiedContent,
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
							});
							changeLogger.logChange({
								filePath: step.path,
								changeType: "modified",
								summary,
								diffContent: formattedDiff,
								timestamp: Date.now(),
							});
						} else {
							// If content is identical, still count as success, but no diff/change log
							this.provider.postMessageToWebview({
								type: "appendRealtimeModelMessage",
								value: {
									text: `Step ${index + 1} OK: File \`${
										step.path
									}\` content is already as desired, no modification applied.`,
								},
							});
						}
					} else if (isRunCommandStep(step)) {
						const userChoice = await vscode.window.showWarningMessage(
							`The plan wants to run a command: \`${step.command}\`\n\nAllow?`,
							{ modal: true },
							"Allow",
							"Skip"
						);
						if (userChoice === "Allow") {
							const term = vscode.window.createTerminal({
								name: `Minovative Mind Step ${index + 1}`,
								cwd: rootUri.fsPath,
							});
							term.show();
							term.sendText(step.command);
							// Consider adding a way to await command completion or handle its output
						} else {
							currentStepCompletedSuccessfullyOrSkipped = true; // User chose to skip the command
							this._postChatUpdateForPlanExecution({
								type: "appendRealtimeModelMessage",
								value: { text: `Step ${index + 1} SKIPPED by user.` },
							});
						}
					}
					currentStepCompletedSuccessfullyOrSkipped = true; // Step succeeded or was explicitly skipped (e.g., user skipped command)
				} catch (error: any) {
					let errorMsg = error instanceof Error ? error.message : String(error);
					// Sanitize the error message to display relative paths
					errorMsg = sanitizeErrorMessagePaths(errorMsg, rootUri);

					let isRetryableTransientError = false;

					if (errorMsg.includes(ERROR_OPERATION_CANCELLED)) {
						executionOk = false;
						throw error; // Propagate cancellation to outer handler
					}

					// Implement transient error identification
					if (
						errorMsg.includes("quota exceeded") ||
						errorMsg.includes("rate limit exceeded") ||
						errorMsg.includes("network error") ||
						errorMsg.includes("HTTP 50") ||
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
						});
						console.warn(
							`Minovative Mind: Step ${
								index + 1
							} failed, auto-retrying due to transient error: ${errorMsg}`
						);
						await new Promise((resolve) =>
							setTimeout(resolve, 10000 + currentTransientAttempt * 5000)
						); // Exponential back-off
						currentTransientAttempt++;
						// currentStepCompletedSuccessfullyOrSkipped remains false, so inner loop will continue
					}
					// User Intervention Prompt Logic
					else {
						// Fatal error, or transient retries exhausted, or user chose to skip command
						this._postChatUpdateForPlanExecution({
							type: "appendRealtimeModelMessage",
							value: {
								text: `Step ${
									index + 1
								} FAILED: ${errorMsg}. Requires user intervention.`,
								isError: true,
							},
						});
						const userChoice = await vscode.window.showErrorMessage(
							`Minovative Mind: Step ${
								index + 1
							}/${totalSteps} failed: ${errorMsg}\n\nWhat would you like to do?`,
							{ modal: true }, // Modal to block further interaction until decision
							"Retry Step",
							"Skip Step",
							"Cancel Plan"
						);

						if (userChoice === "Retry Step") {
							currentTransientAttempt = 0; // Reset auto-retry count for manual retry
							// currentStepCompletedSuccessfullyOrSkipped remains false, so inner loop will re-execute this step
							console.log(
								`Minovative Mind: User chose to retry Step ${index + 1}.`
							);
						} else if (userChoice === "Skip Step") {
							currentStepCompletedSuccessfullyOrSkipped = true; // Mark step as handled (skipped)
							this._postChatUpdateForPlanExecution({
								type: "appendRealtimeModelMessage",
								value: { text: `Step ${index + 1} SKIPPED by user.` },
							});
							console.log(
								`Minovative Mind: User chose to skip Step ${index + 1}.`
							);
						} else {
							// Cancel Plan or dialog was dismissed/closed
							executionOk = false; // Set to false to indicate failure before throwing
							throw new Error(ERROR_OPERATION_CANCELLED); // Abort the entire plan execution
						}
					}
				}
			} // End of inner `while (!currentStepCompletedSuccessfullyOrSkipped)` loop

			index++; // Increment outer loop index after current step is fully handled (succeeded or skipped).
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
		const maxFileSizeForSnippet = 1024 * 50; // 50KB limit per file to prevent prompt overflow

		for (const relativePath of relevantFiles) {
			if (token.isCancellationRequested) {
				return formattedSnippets.join("\n"); // Return what's processed so far
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
			} // License is usually just text

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
				const content = Buffer.from(contentBuffer).toString("utf8"); // Corrected conversion

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
				continue; // Skip to next file
			}

			if (fileContent !== null) {
				formattedSnippets.push(
					`--- Relevant File: ${relativePath} ---\n\`\`\`${languageId}\n${fileContent}\n\`\`\`\n`
				);
			}
		}

		return formattedSnippets.join("\n");
	}

	private async _handlePostTextualPlanGenerationUI(
		planContext: sidebarTypes.PlanGenerationContext
	): Promise<void> {
		if (this.provider.isSidebarVisible) {
			const planDataForRestore =
				planContext.type === "chat"
					? {
							type: "textualPlanPending",
							originalRequest: planContext.originalUserRequest,
							relevantFiles: planContext.relevantFiles,
					  }
					: {
							type: "textualPlanPending",
							originalInstruction: planContext.editorContext!.instruction,
							relevantFiles: planContext.relevantFiles,
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
			const notificationResult = await vscode.window.showInformationMessage(
				"Minovative Mind: A new plan is ready for review.",
				{ modal: false },
				"Open Sidebar & Review"
			);
			if (notificationResult === "Open Sidebar & Review") {
				await vscode.commands.executeCommand(
					"minovative-mind.activitybar.focus"
				);
			} else {
				this.provider.postMessageToWebview({
					type: "statusUpdate",
					value: "Plan generated, waiting for review in sidebar.",
				});
			}
		}
	}

	private _postChatUpdateForPlanExecution(message: {
		type: string;
		value: { text: string; isError?: boolean };
		diffContent?: string;
	}) {
		this.provider.chatHistoryManager.addHistoryEntry(
			"model",
			message.value.text,
			message.diffContent
		);
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

	private _formatChatHistoryForPrompt(
		chatHistory: sidebarTypes.HistoryEntry[] | undefined
	): string {
		if (!chatHistory || chatHistory.length === 0) {
			return "";
		}
		return `\n--- Recent Chat History (for additional context on user's train of thought and previous conversations with a AI model) ---\n${chatHistory
			.map(
				(entry) =>
					`Role: ${entry.role}\nContent:\n${entry.parts
						.map((p) => p.text)
						.join("\n")}`
			)
			.join("\n---\n")}\n--- End Recent Chat History ---`;
	}

	private async _showPlanCompletionNotification(
		description: string,
		outcome: sidebarTypes.ExecutionOutcome
	): Promise<void> {
		let message: string;
		let isError: boolean;

		switch (outcome) {
			case "success":
				message = `Plan for '${description}' completed successfully!`;
				isError = false;
				break;
			case "cancelled":
				message = `Plan for '${description}' was cancelled.`;
				isError = true;
				break;
			case "failed":
				message = `Plan for '${description}' failed. Check sidebar for details.`;
				isError = true;
				break;
		}

		this.provider.chatHistoryManager.addHistoryEntry("model", message);
		this.provider.chatHistoryManager.restoreChatHistoryToWebview();

		if (this.provider.isSidebarVisible === true) {
			this.provider.postMessageToWebview({
				type: "statusUpdate",
				value: message,
				isError: isError,
			});
		} else {
			let notificationFunction: (
				message: string,
				...items: string[]
			) => Thenable<string | undefined>;

			switch (outcome) {
				case "success":
					notificationFunction = vscode.window.showInformationMessage;
					break;
				case "cancelled":
					notificationFunction = vscode.window.showWarningMessage;
					break;
				case "failed":
					notificationFunction = vscode.window.showErrorMessage;
					break;
			}

			const result = await notificationFunction(message, "Open Sidebar");

			if (result === "Open Sidebar") {
				vscode.commands.executeCommand("minovative-mind.activitybar.focus");
			}
		}
	}

	// NEW: Add new _performFinalValidationAndCorrection method
	private async _performFinalValidationAndCorrection(
		affectedFileUris: Set<vscode.Uri>,
		rootUri: vscode.Uri,
		token: vscode.CancellationToken,
		planContext: sidebarTypes.PlanGenerationContext,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		originalUserInstruction: string
	): Promise<boolean> {
		if (affectedFileUris.size === 0) {
			this._postChatUpdateForPlanExecution({
				type: "appendRealtimeModelMessage",
				value: {
					text: `No files were modified or created by the plan. Skipping final validation.`,
				},
			});
			return true;
		}

		let currentCorrectionAttempt = 1;
		while (currentCorrectionAttempt <= this.MAX_CORRECTION_PLAN_ATTEMPTS) {
			if (token.isCancellationRequested) {
				console.log(
					`[MinovativeMind] Final validation and correction cancelled.`
				);
				this._postChatUpdateForPlanExecution({
					type: "appendRealtimeModelMessage",
					value: { text: `Final code validation cancelled.` },
				});
				return false;
			}

			// Give VS Code a moment to update diagnostics for all files
			await new Promise((resolve) => setTimeout(resolve, 500));

			let allErrorsAndWarnings: vscode.Diagnostic[] = [];
			let aggregatedFormattedDiagnostics = "";

			// Collect diagnostics from all affected files
			for (const fileUri of affectedFileUris) {
				const diagnosticsForFile =
					DiagnosticService.getDiagnosticsForUri(fileUri);
				const errorsAndWarningsForFile = diagnosticsForFile.filter(
					(d) =>
						d.severity === vscode.DiagnosticSeverity.Error ||
						d.severity === vscode.DiagnosticSeverity.Warning
				);

				if (errorsAndWarningsForFile.length > 0) {
					allErrorsAndWarnings.push(...errorsAndWarningsForFile);
					const formattedForFile =
						DiagnosticService.formatContextualDiagnostics(
							fileUri,
							rootUri,
							undefined,
							5000
						);
					if (formattedForFile) {
						aggregatedFormattedDiagnostics += formattedForFile + "\n";
					}
				}
			}

			if (allErrorsAndWarnings.length === 0) {
				const fileNames = Array.from(affectedFileUris)
					.map((uri) => path.relative(rootUri.fsPath, uri.fsPath))
					.join(", ");
				this._postChatUpdateForPlanExecution({
					type: "appendRealtimeModelMessage",
					value: {
						text: `All modifications validated successfully for: \`${fileNames}\`. No errors or warnings found.`,
					},
				});
				return true; // Success! All diagnostics resolved.
			} else {
				const fileNames = Array.from(affectedFileUris)
					.map((uri) => path.relative(rootUri.fsPath, uri.fsPath))
					.join(", ");
				this._postChatUpdateForPlanExecution({
					type: "appendRealtimeModelMessage",
					value: {
						text: `Final validation failed for files: \`${fileNames}\` (found ${allErrorsAndWarnings.length} issues). Attempting AI self-correction (Attempt ${currentCorrectionAttempt}/${this.MAX_CORRECTION_PLAN_ATTEMPTS})...`,
						isError: true,
					},
				});

				try {
					const jsonGenerationConfig: GenerationConfig = {
						responseMimeType: "application/json",
						temperature: sidebarConstants.TEMPERATURE,
					};

					const relevantSnippets = await this._formatRelevantFilesForPrompt(
						planContext.relevantFiles ?? [],
						rootUri,
						token
					);
					const formattedRecentChanges = this._formatRecentChangesForPrompt(
						this.provider.changeLogger.getChangeLog()
					);

					const correctionPlanPrompt = createCorrectionPlanPrompt(
						originalUserInstruction,
						planContext.projectContext,
						planContext.editorContext,
						planContext.chatHistory ?? [],
						relevantSnippets,
						aggregatedFormattedDiagnostics,
						formattedRecentChanges,
						currentCorrectionAttempt > 1
							? `Previous correction attempt (${
									currentCorrectionAttempt - 1
							  }) failed to resolve all diagnostics.`
							: undefined
					);

					progress.report({
						message: `AI generating overall correction plan (Attempt ${currentCorrectionAttempt}/${this.MAX_CORRECTION_PLAN_ATTEMPTS})...`,
					});

					let correctionPlanJsonString =
						await this.provider.aiRequestService.generateWithRetry(
							correctionPlanPrompt,
							planContext.modelName,
							undefined,
							`final correction plan generation (attempt ${currentCorrectionAttempt})`,
							jsonGenerationConfig,
							undefined,
							token
						);

					correctionPlanJsonString = correctionPlanJsonString
						.replace(/^```json\s*/im, "")
						.replace(/\s*```$/im, "")
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
							value: {
								text: `Applying final correction plan for diagnostics.`,
							},
						});

						// Execute the generated correction plan.
						// The `_executePlanSteps` function will log its changes and ensure the `changeLogger` is updated.
						// We pass `affectedFileUris` to `_executePlanSteps` but it will just ignore it and generate its own affectedFileUris internally.
						const subPlanAffectedFiles = await this._executePlanSteps(
							parsedPlanResult.plan.steps!,
							rootUri,
							planContext,
							progress,
							token
						);
						// Add any new files or modifications from the sub-plan to the overall set for re-validation
						subPlanAffectedFiles.forEach((uri) => affectedFileUris.add(uri));

						// If the sub-plan execution itself failed (e.g. user cancelled a command in it), treat as failure
						// Note: _executePlanSteps now returns affectedFileUris, so we need to check if the overall
						// execution of the sub-plan was successful or not. This requires a small adjustment if it can fail
						// silently. Given current _executePlanSteps returns Set<Uri>, it relies on caught exceptions.
						// For simplicity, we assume if no exception, sub-plan *execution* was successful, then re-validate.
						// If `_executePlanSteps` throws, it will be caught by the outer `try/catch` and stop the overall plan.
					} else {
						console.error(
							`[MinovativeMind] Failed to parse/validate AI final correction plan (Attempt ${currentCorrectionAttempt}): ${parsedPlanResult.error}`
						);
						this._postChatUpdateForPlanExecution({
							type: "appendRealtimeModelMessage",
							value: {
								text: `AI generated an invalid final correction plan (Attempt ${currentCorrectionAttempt}): ${parsedPlanResult.error}.`,
								isError: true,
							},
						});
					}
				} catch (correctionError: any) {
					const errorMsg =
						correctionError instanceof Error
							? correctionError.message
							: String(correctionError);
					console.error(
						`[MinovativeMind] AI final self-correction failed (Attempt ${currentCorrectionAttempt}): ${errorMsg}`
					);
					this._postChatUpdateForPlanExecution({
						type: "appendRealtimeModelMessage",
						value: {
							text: `AI final self-correction failed (Attempt ${currentCorrectionAttempt}): ${errorMsg}.`,
							isError: true,
						},
					});
				}
			}
			currentCorrectionAttempt++; // Increment for the next validation/correction attempt
		}

		// If loop finishes (all attempts exhausted) and diagnostics are still present
		this._postChatUpdateForPlanExecution({
			type: "appendRealtimeModelMessage",
			value: {
				text: `Overall validation failed after ${this.MAX_CORRECTION_PLAN_ATTEMPTS} attempts to auto-correct. Please review the affected files manually.`,
				isError: true,
			},
		});
		return false; // All attempts exhausted, still issues
	}
}

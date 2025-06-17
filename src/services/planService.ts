import * as vscode from "vscode";
import * as path from "path";
import { GenerationConfig } from "@google/generative-ai";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import { isFeatureAllowed } from "../sidebar/utils/featureGating";
import * as sidebarTypes from "../sidebar/common/sidebarTypes";
import * as sidebarConstants from "../sidebar/common/sidebarConstants";
import {
	createInitialPlanningExplanationPrompt,
	createPlanningPrompt,
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

export class PlanService {
	constructor(private provider: SidebarProvider) {}

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

		this.provider.postMessageToWebview({
			type: "aiResponseStart",
			value: { modelName },
		});

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

			const projectContext =
				await this.provider.contextService.buildProjectContext(
					token,
					userRequest
				);
			if (projectContext.startsWith("[Error")) {
				throw new Error(projectContext);
			}

			const textualPlanPrompt = createInitialPlanningExplanationPrompt(
				projectContext,
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
				textualPlanResponse
			);
			success = true;

			this.provider.pendingPlanGenerationContext = {
				type: "chat",
				originalUserRequest: userRequest,
				projectContext,
				initialApiKey: apiKey,
				modelName,
				chatHistory: [...this.provider.chatHistoryManager.getChatHistory()],
				textualPlanExplanation: textualPlanResponse,
				workspaceRootUri: rootFolder.uri,
			};
			this.provider.lastPlanGenerationContext = {
				...this.provider.pendingPlanGenerationContext,
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
		diagnosticsString?: string
	): Promise<sidebarTypes.PlanGenerationResult> {
		const {
			settingsManager,
			apiKeyManager,
			changeLogger,
			isUserSignedIn,
			currentUserTier,
		} = this.provider;
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
			this.provider.postMessageToWebview({
				type: "aiResponseStart",
				value: { modelName },
			});
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

			const projectContext =
				await this.provider.contextService.buildProjectContext(
					activeOpToken,
					editorCtx.instruction,
					editorCtx,
					diagnosticsString
				);
			if (projectContext.startsWith("[Error")) {
				throw new Error(projectContext);
			}

			const textualPlanPrompt = createInitialPlanningExplanationPrompt(
				projectContext,
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
				textualPlanResponse
			);
			initialProgress?.report({
				message: "Textual plan generated.",
				increment: 100,
			});

			this.provider.pendingPlanGenerationContext = {
				type: "editor",
				editorContext: editorCtx,
				projectContext,
				diagnosticsString,
				initialApiKey: apiKey!,
				modelName,
				chatHistory: [...this.provider.chatHistoryManager.getChatHistory()],
				textualPlanExplanation: textualPlanResponse,
				workspaceRootUri: rootFolder.uri,
			};
			this.provider.lastPlanGenerationContext = {
				...this.provider.pendingPlanGenerationContext,
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

			const jsonPlanningPrompt = createPlanningPrompt(
				planContext.type === "chat"
					? planContext.originalUserRequest
					: undefined,
				planContext.projectContext,
				planContext.type === "editor" ? planContext.editorContext : undefined,
				planContext.diagnosticsString,
				planContext.chatHistory,
				planContext.textualPlanExplanation,
				formattedRecentChanges
			);

			structuredPlanJsonString =
				await this.provider.aiRequestService.generateWithRetry(
					jsonPlanningPrompt,
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

			structuredPlanJsonString = structuredPlanJsonString
				.replace(/^```json\s*/im, "")
				.replace(/\s*```$/im, "")
				.trim();

			const parsedPlanResult: ParsedPlanResult = await parseAndValidatePlan(
				structuredPlanJsonString,
				planContext.workspaceRootUri
			);

			if (!parsedPlanResult.plan) {
				const errorDetail =
					parsedPlanResult.error || "Failed to parse the JSON plan from AI.";
				this.provider.postMessageToWebview({
					type: "structuredPlanParseFailed",
					value: { error: errorDetail, failedJson: structuredPlanJsonString },
				});
				this.provider.currentExecutionOutcome = "failed";
				vscode.window.showErrorMessage(
					`Minovative Mind: Failed to parse AI plan. Check sidebar for retry options.`
				);
				return;
			}

			const executablePlan = parsedPlanResult.plan;
			this.provider.pendingPlanGenerationContext = null;

			await this._executePlan(
				executablePlan,
				planContext.initialApiKey,
				planContext.modelName,
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
		initialApiKey: string,
		modelName: string,
		operationToken: vscode.CancellationToken
	): Promise<void> {
		this.provider.currentExecutionOutcome = undefined;
		let executionOk = true;
		this.provider.activeChildProcesses = [];

		const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
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

						executionOk = await this._executePlanSteps(
							plan.steps!,
							rootUri,
							progress,
							combinedToken
						);

						if (combinedToken.isCancellationRequested) {
							this.provider.currentExecutionOutcome = "cancelled";
						} else {
							this.provider.currentExecutionOutcome = executionOk
								? "success"
								: "failed";
						}
					} finally {
						opListener.dispose();
						progListener.dispose();
						combinedTokenSource.dispose();
					}
				}
			);
		} catch (error: any) {
			executionOk = false;
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
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		combinedToken: vscode.CancellationToken
	): Promise<boolean> {
		let executionOk = true;
		const totalSteps = steps.length;
		const { settingsManager, changeLogger } = this.provider;

		for (const [index, step] of steps.entries()) {
			if (combinedToken.isCancellationRequested) {
				return false;
			}

			const stepNumber = index + 1;
			const stepMessageTitle = `Step ${stepNumber}/${totalSteps}: ${
				step.description || step.action.replace(/_/g, " ")
			}`;
			progress.report({ message: `${stepMessageTitle}...` });

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
						const generationPrompt = `You are an expert software developer. Your ONLY task is to generate the full content for a file. Do NOT include markdown code block formatting. Provide only the file content.\nFile Path:\n${step.path}\n\nInstructions:\n${step.generate_prompt}\n\nComplete File Content:`;
						content = await this.provider.aiRequestService.generateWithRetry(
							generationPrompt,
							settingsManager.getSelectedModelName(),
							undefined,
							`plan step ${stepNumber}`,
							undefined,
							undefined,
							combinedToken
						);
					}
					await typeContentIntoEditor(editor, content ?? "", combinedToken);
					const { formattedDiff, summary } = await generateFileChangeSummary(
						"",
						content ?? "",
						step.path
					);
					this._postChatUpdateForPlanExecution({
						type: "appendRealtimeModelMessage",
						value: {
							text: `Step ${stepNumber} OK: Created file \`${step.path}\``,
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
					const modificationPrompt = `You are an expert software developer. Your ONLY task is to generate the *entire* modified content for the file. Do NOT include markdown code block formatting. Provide only the full, modified file content.\n\nFile Path:\n${step.path}\n\nModification Instructions:\n${step.modification_prompt}\n--- Existing File Content ---\n${existingContent}\n--- End Existing File Content ---\n\nComplete Modified File Content:`;

					let modifiedContent =
						await this.provider.aiRequestService.generateWithRetry(
							modificationPrompt,
							settingsManager.getSelectedModelName(),
							undefined,
							`plan step ${stepNumber}`,
							undefined,
							undefined,
							combinedToken
						);
					modifiedContent = modifiedContent
						.replace(/^```[a-z]*\n?/, "")
						.replace(/\n?```$/, "")
						.trim();

					if (modifiedContent !== existingContent) {
						const edit = new vscode.WorkspaceEdit();
						const document = await vscode.workspace.openTextDocument(fileUri);
						edit.replace(
							fileUri,
							new vscode.Range(
								document.positionAt(0),
								document.positionAt(document.getText().length)
							),
							modifiedContent
						);
						await vscode.workspace.applyEdit(edit);
						const { formattedDiff, summary } = await generateFileChangeSummary(
							existingContent,
							modifiedContent,
							step.path
						);
						this._postChatUpdateForPlanExecution({
							type: "appendRealtimeModelMessage",
							value: {
								text: `Step ${stepNumber} OK: Modified file \`${step.path}\``,
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
							name: `Minovative Mind Step ${stepNumber}`,
							cwd: rootUri.fsPath,
						});
						term.show();
						term.sendText(step.command);
					}
				}
			} catch (error: any) {
				executionOk = false;
				const errorMsg = error instanceof Error ? error.message : String(error);
				this._postChatUpdateForPlanExecution({
					type: "appendRealtimeModelMessage",
					value: {
						text: `Step ${stepNumber} FAILED: ${errorMsg}`,
						isError: true,
					},
				});
				break; // Stop execution on first error
			}
		}
		return executionOk;
	}

	// --- HELPERS ---
	private async _handlePostTextualPlanGenerationUI(
		planContext: sidebarTypes.PlanGenerationContext
	): Promise<void> {
		if (this.provider.isSidebarVisible) {
			const planDataForRestore =
				planContext.type === "chat"
					? {
							type: "textualPlanPending",
							originalRequest: planContext.originalUserRequest,
					  }
					: {
							type: "textualPlanPending",
							originalInstruction: planContext.editorContext!.instruction,
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
		this.provider.postMessageToWebview(message);
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
}

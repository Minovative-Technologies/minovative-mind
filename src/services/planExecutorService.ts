import * as vscode from "vscode";
import * as path from "path";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import * as sidebarTypes from "../sidebar/common/sidebarTypes";
import { ExtensionToWebviewMessages } from "../sidebar/common/sidebarTypes";
import { ERROR_OPERATION_CANCELLED } from "../ai/gemini";
import {
	ExecutionPlan,
	isCreateDirectoryStep,
	isCreateFileStep,
	isModifyFileStep,
	isRunCommandStep,
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
import * as sidebarConstants from "../sidebar/common/sidebarConstants"; // Needed for DEFAULT_SIZE

export class PlanExecutorService {
	constructor(
		private provider: SidebarProvider,
		private workspaceRootUri: vscode.Uri,
		private postMessageToWebview: (message: ExtensionToWebviewMessages) => void,
		private urlContextService: UrlContextService,
		private enhancedCodeGenerator: EnhancedCodeGenerator,
		private gitConflictResolutionService: GitConflictResolutionService,
		private readonly MAX_TRANSIENT_STEP_RETRIES: number
	) {}

	public async executePlan(
		plan: ExecutionPlan,
		planContext: sidebarTypes.PlanGenerationContext,
		operationToken: vscode.CancellationToken
	): Promise<void> {
		this.provider.currentExecutionOutcome = undefined;
		this.provider.activeChildProcesses = [];

		const rootUri = this.workspaceRootUri;

		// Notify webview that plan execution is starting - this will hide the stop button
		this.postMessageToWebview({
			type: "updateLoadingState",
			value: true,
		});

		// Notify webview that plan execution has started
		this.postMessageToWebview({
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
			this.postMessageToWebview({
				type: "updateLoadingState",
				value: false,
			});

			// Notify webview that plan execution has ended
			this.postMessageToWebview({
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
			this.postMessageToWebview({
				type: "planExecutionFinished",
				hasRevertibleChanges: this.provider.completedPlanChangeSets.length > 0,
			});

			// 6. Crucially, clear the in-memory log buffer for the next operation AFTER saving the changes
			this.provider.changeLogger.clear();

			// This should remain at the end of the finally block
			this.postMessageToWebview({ type: "resetCodeStreamingArea" });
		}
	}

	// --- Moved private handler methods ---
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
		const { changeLogger } = this.provider; // Access changeLogger via provider

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
							this.provider.settingsManager, // Access settingsManager via provider
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
						detailedStepDescription = `Modifying file: \`${step.path}\` (content modified by AI)`;
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
		// Construct the message object to be sent to both history and webview
		const appendMessage: sidebarTypes.AppendRealtimeModelMessage = {
			type: "appendRealtimeModelMessage",
			value: {
				text: message,
				isError: isError,
			},
			isPlanStepUpdate: true,
			diffContent: diffContent,
		};

		// Use the internal helper to post to webview AND add to chat history
		this._postChatUpdateForPlanExecution(appendMessage);

		// Keep console logs for internal debugging, separate from UI/history updates
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
		const maxFileSizeForSnippet = sidebarConstants.DEFAULT_SIZE; // Access sidebarConstants

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
		this.postMessageToWebview(message);
		this.provider.chatHistoryManager.restoreChatHistoryToWebview();
	}

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
					// Use injected enhancedCodeGenerator
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
				// Use injected enhancedCodeGenerator
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
				await this.gitConflictResolutionService.unmarkFileAsResolved(fileUri); // Use injected gitConflictResolutionService
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
					this.provider.activeChildProcesses // Access activeChildProcesses via provider
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
}

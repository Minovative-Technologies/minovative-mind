import * as vscode from "vscode";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import * as path from "path";
import { ToggleRelevantFilesDisplayMessage } from "../sidebar/common/sidebarTypes";
import { formatUserFacingErrorMessage } from "../utils/errorFormatter";

export async function handleWebviewMessage(
	data: any,
	provider: SidebarProvider
): Promise<void> {
	console.log(`[MessageHandler] Message received: ${data.type}`);

	// Handle cancellation messages first
	if (data.type === "cancelGeneration") {
		console.log("[MessageHandler] Cancelling current operation...");
		provider.cancelActiveOperation();
		return;
	}
	if (data.type === "cancelPlanExecution") {
		console.log("[MessageHandler] Cancelling pending plan confirmation...");
		provider.cancelPendingPlan();
		return;
	}

	// Prevent new operations if one is ongoing
	const allowedDuringBackground = [
		"webviewReady",
		"requestDeleteConfirmation",
		"clearChatRequest",
		"saveChatRequest",
		"loadChatRequest",
		"selectModel",
		"requestAuthState",
		"deleteSpecificMessage",
		"confirmCommit",
		"cancelCommit",
		"openExternalLink",
		"confirmPlanExecution", // Allowed as a follow-up
		"retryStructuredPlanGeneration", // Allowed as a follow-up
		"openFile", // Allowed as a direct user interaction
		"toggleRelevantFilesDisplay", // Allowed as a UI interaction
		"openSettingsPanel",
	];

	if (
		provider.isOperationInProgress() &&
		!allowedDuringBackground.includes(data.type)
	) {
		console.warn(
			`Message type "${data.type}" blocked because an operation is in progress.`
		);
		provider.postMessageToWebview({
			type: "statusUpdate",
			value:
				"An operation is already in progress. Please wait for it to complete or cancel it before starting a new one.",
			isError: true,
		});
		return;
	}

	switch (data.type) {
		case "webviewReady":
			console.log("[MessageHandler] Webview ready. Initializing UI state.");
			await provider.handleWebviewReady();
			break;

		case "requestAuthState":
			provider.postMessageToWebview({
				type: "authStateUpdate",
				value: provider.getAuthStatePayload(),
			});
			break;

		case "planRequest": {
			const userRequest = data.value;
			provider.chatHistoryManager.addHistoryEntry(
				"user",
				`/plan ${userRequest}`
			);
			provider.isGeneratingUserRequest = true;
			await provider.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				true
			);
			// The planService will handle the rest, including UI updates
			await provider.planService.handleInitialPlanRequest(userRequest);
			break;
		}

		case "confirmPlanExecution":
			// Ensure isGeneratingUserRequest is true at the very beginning
			provider.isGeneratingUserRequest = true;
			await provider.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				true
			);

			if (provider.pendingPlanGenerationContext) {
				const contextForExecution = {
					...provider.pendingPlanGenerationContext,
				};
				provider.pendingPlanGenerationContext = null;
				await provider.planService.generateStructuredPlanAndExecute(
					contextForExecution
				);
			} else {
				provider.postMessageToWebview({
					type: "statusUpdate",
					value:
						"No plan is currently awaiting confirmation. Please generate a new plan.",
					isError: true,
				});
				await provider.endUserOperation("failed"); // Signal failure and re-enable inputs
				return; // Add return to prevent further execution in this branch
			}
			break;

		case "retryStructuredPlanGeneration":
			// Ensure isGeneratingUserRequest is true at the very beginning
			provider.isGeneratingUserRequest = true;
			await provider.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				true
			);

			if (provider.lastPlanGenerationContext) {
				const contextForRetry = { ...provider.lastPlanGenerationContext };
				provider.chatHistoryManager.addHistoryEntry(
					"model",
					"User requested retry of structured plan generation."
				);
				await provider.planService.generateStructuredPlanAndExecute(
					contextForRetry
				);
			} else {
				provider.postMessageToWebview({
					type: "statusUpdate",
					value:
						"No previously generated plan is available for retry. Please initiate a new plan request.",
					isError: true,
				});
				await provider.endUserOperation("failed"); // Signal failure and re-enable inputs
				return; // Add return to prevent further execution in this branch
			}
			break;

		case "chatMessage": {
			const userMessage = data.value;
			if (userMessage.trim().toLowerCase() === "/commit") {
				// If a /commit command is sent via chat input,
				// ensure a cancellation token is prepared and passed.
				if (!provider.activeOperationCancellationTokenSource) {
					provider.activeOperationCancellationTokenSource =
						new vscode.CancellationTokenSource();
				}
				await provider.commitService.handleCommitCommand(
					provider.activeOperationCancellationTokenSource.token
				);
			} else {
				provider.chatHistoryManager.addHistoryEntry("user", userMessage);
				await provider.chatService.handleRegularChat(userMessage);
			}
			break;
		}

		case "commitRequest":
			// If a direct commitRequest message, ensure a cancellation token is prepared and passed.
			if (!provider.activeOperationCancellationTokenSource) {
				provider.activeOperationCancellationTokenSource =
					new vscode.CancellationTokenSource();
			}
			provider.isGeneratingUserRequest = true;
			await provider.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				true
			);
			await provider.commitService.handleCommitCommand(
				provider.activeOperationCancellationTokenSource.token
			);
			break;

		case "confirmCommit":
			const editedCommitMessage = data.value; // Retrieve the edited message
			if (typeof editedCommitMessage === "string") {
				// No explicit provider.endUserOperation() here; CommitService will handle it
				await provider.commitService.confirmCommit(editedCommitMessage);
			} else {
				console.error(
					"[MessageHandler] Invalid commit message received for confirmCommit."
				);
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: "Error: Invalid commit message received. Please try again.",
					isError: true,
				});
				provider.postMessageToWebview({ type: "reenableInput" }); // Re-enable if error
			}
			break;

		case "cancelCommit":
			// No explicit provider.endUserOperation() here; CommitService will handle it
			provider.commitService.cancelCommit();
			break;

		case "addApiKey":
			if (typeof data.value === "string") {
				await provider.apiKeyManager.addApiKey(data.value.trim());
			}
			break;

		case "requestDeleteConfirmation":
			const result = await vscode.window.showWarningMessage(
				"Are you sure you want to delete the active API key?",
				{ modal: true },
				"Yes",
				"No"
			);
			if (result === "Yes") {
				await provider.apiKeyManager.deleteActiveApiKey();
			} else {
				// User chose "No" or dismissed the dialog (result is undefined)
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: "API key deletion cancelled.",
				});
				provider.postMessageToWebview({ type: "reenableInput" });
			}
			break;

		case "switchToNextKey":
			await provider.apiKeyManager.switchToNextApiKey();
			break;

		case "switchToPrevKey":
			await provider.apiKeyManager.switchToPreviousApiKey();
			break;

		case "clearChatRequest":
			await provider.chatHistoryManager.clearChat();
			break;

		case "saveChatRequest":
			await provider.chatHistoryManager.saveChat();
			break;

		case "loadChatRequest":
			await provider.chatHistoryManager.loadChat();
			break;

		case "deleteSpecificMessage":
			provider.chatHistoryManager.deleteHistoryEntry(data.messageIndex);
			break;

		case "toggleRelevantFilesDisplay": {
			const toggleMessage = data as ToggleRelevantFilesDisplayMessage;
			provider.chatHistoryManager.updateMessageRelevantFilesExpandedState(
				toggleMessage.messageIndex,
				toggleMessage.isExpanded
			);
			break;
		}

		case "selectModel":
			if (typeof data.value === "string") {
				await provider.settingsManager.handleModelSelection(data.value);
			}
			break;

		case "openExternalLink": {
			const url = data.url as string;
			if (url) {
				await vscode.env.openExternal(vscode.Uri.parse(url, true));
			}
			break;
		}

		case "openSettingsPanel": {
			const panelId = data.panelId as string;
			if (panelId) {
				try {
					await vscode.commands.executeCommand(
						"minovative-mind.openSettingsPanel"
					);
					provider.postMessageToWebview({
						type: "statusUpdate",
						value: "Please open the Minovative Mind settings panel to sign in.",
					});
				} catch (error: any) {
					console.error(
						`[MessageHandler] Error opening settings panel ${panelId}:`,
						error
					);
					provider.postMessageToWebview({
						type: "statusUpdate",
						value: `Failed to open settings panel: ${
							error.message || String(error)
						}`,
						isError: true,
					});
				}
			} else {
				provider.postMessageToWebview({
					type: "statusUpdate",
					value:
						"Cannot open settings panel: No valid panel identifier was provided.",
					isError: true,
				});
			}
			break;
		}

		case "openFile": {
			const relativeFilePathFromWebview = data.value; // Rename for clarity

			// Crucial Security Check:
			// 1. Verify filePath is a string.
			if (
				typeof relativeFilePathFromWebview !== "string" ||
				relativeFilePathFromWebview.trim() === ""
			) {
				console.warn(
					`[MessageHandler] Security Alert: Invalid filePath received for openFile: "${relativeFilePathFromWebview}"`
				);
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: formatUserFacingErrorMessage(
						new Error(
							`The provided file path is invalid or malformed: "${relativeFilePathFromWebview}".`
						),
						"Security alert: The provided file path is invalid or malformed. Operation blocked.",
						"Security alert: ",
						vscode.workspace.workspaceFolders?.[0]?.uri
					),
					isError: true,
				});
				return;
			}

			let isPathWithinWorkspace = false;
			let absoluteFileUri: vscode.Uri | undefined;
			let workspaceRoot: string | undefined; // Declare to hold the normalized workspace root

			if (
				vscode.workspace.workspaceFolders &&
				vscode.workspace.workspaceFolders.length > 0
			) {
				const rootFolder = vscode.workspace.workspaceFolders[0]; // Assuming the first workspace folder is the relevant one
				workspaceRoot = path.normalize(rootFolder.uri.fsPath);

				try {
					// Resolve the relative path from webview against the workspace root
					absoluteFileUri = vscode.Uri.joinPath(
						rootFolder.uri,
						relativeFilePathFromWebview
					);
				} catch (uriError: any) {
					console.error(
						`[MessageHandler] Error resolving relative path to URI for ${relativeFilePathFromWebview}:`,
						uriError
					);
					provider.postMessageToWebview({
						type: "statusUpdate",
						value: formatUserFacingErrorMessage(
							uriError,
							"Error: The file path could not be resolved. Please ensure the path is valid and accessible.",
							"Error: ",
							vscode.workspace.workspaceFolders?.[0]?.uri
						),
						isError: true,
					});
					return;
				}

				// Normalize the absolute file path for comparison
				const absoluteNormalizedFilePath = path.normalize(
					absoluteFileUri.fsPath
				);

				// Check if the absolute normalized file path is identical to the workspace root,
				// or if it starts with the workspace root followed by a path separator.
				if (
					absoluteNormalizedFilePath === workspaceRoot ||
					absoluteNormalizedFilePath.startsWith(workspaceRoot + path.sep)
				) {
					isPathWithinWorkspace = true;
				}
			} else {
				// If no workspace is open, the file cannot be "within the current VS Code workspace".
				console.warn(
					`[MessageHandler] Security Alert: Cannot verify file path as no workspace is open. Attempted path: ${relativeFilePathFromWebview}`
				);
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: formatUserFacingErrorMessage(
						new Error("No VS Code workspace folder is currently open."),
						"Security alert: Cannot open file. No VS Code workspace is currently open. Please open a project folder to proceed.",
						"Security alert: "
					),
					isError: true,
				});
				return;
			}

			if (!isPathWithinWorkspace || !absoluteFileUri) {
				// Ensure absoluteFileUri is defined here
				console.warn(
					`[MessageHandler] Security Alert: Attempt to open file outside workspace: ${relativeFilePathFromWebview} (resolved to ${
						absoluteFileUri?.fsPath || "N/A"
					})`
				);
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: formatUserFacingErrorMessage(
						new Error(
							`Attempted to open a file located outside the current VS Code workspace: "${relativeFilePathFromWebview}".`
						),
						"Security alert: Attempted to open a file located outside the current VS Code workspace. This operation is blocked for security reasons.",
						"Security alert: ",
						vscode.workspace.workspaceFolders?.[0]?.uri
					),
					isError: true,
				});
				return;
			}

			// If the path passes the security check, execute the VS Code command to open the file
			try {
				await vscode.commands.executeCommand("vscode.open", absoluteFileUri); // Use the absolute URI here
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: `File opened successfully: ${path.basename(
						absoluteFileUri.fsPath
					)}`,
				});
			} catch (openError: any) {
				console.error(
					`[MessageHandler] Error opening file ${absoluteFileUri.fsPath} in VS Code:`,
					openError
				);
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: formatUserFacingErrorMessage(
						openError,
						"Error opening file: Failed to open the specified file.",
						"Error opening file: ",
						vscode.workspace.workspaceFolders?.[0]?.uri
					),
					isError: true,
				});
			}
			break;
		}

		case "aiResponseEnd": {
			// Stop typing animation is handled in webview's messageBusHandler.ts for this message.
			// This is just marking the end of generic generation from the extension's side.
			// Removed explicit isGeneratingUserRequest reset as per instructions.
			// Replaced with conditional calls to provider.endUserOperation
			if (data.success && data.isPlanResponse && data.requiresConfirmation) {
				await provider.endUserOperation("review");
			} else if (data.success) {
				await provider.endUserOperation("success");
			} else {
				await provider.endUserOperation("failed");
			}
			break;
		}

		case "structuredPlanParseFailed": {
			// This case indicates that AI generation for the plan has completed, but parsing failed.
			// Removed explicit isGeneratingUserRequest reset as per instructions.
			const { error, failedJson } = data.value; // Keep extracting error/failedJson for potential logging/debugging
			console.log("Received structuredPlanParseFailed.");
			await provider.endUserOperation("failed"); // Add this call as per instructions
			// The webview's messageBusHandler.ts will show the error UI based on this message.
			break;
		}

		case "commitReview": {
			// This case indicates that AI generation for the commit message has completed and is ready for review.
			// Removed explicit isGeneratingUserRequest reset as per instructions.
			console.log("Received commitReview message:", data.value);
			if (
				!data.value ||
				typeof data.value.commitMessage !== "string" ||
				!Array.isArray(data.value.stagedFiles)
			) {
				console.error(
					"[MessageHandler] Invalid 'commitReview' message value:",
					data.value
				);
				await provider.endUserOperation("failed"); // Signal failure if data is bad
				return; // Stop processing this case if data is invalid
			}
			await provider.endUserOperation("review"); // Add this call as per instructions
			// The webview's messageBusHandler.ts will show the commit review UI based on this message.
			break;
		}

		default:
			console.warn(`Unknown message type received: ${data.type}`);
	}
}

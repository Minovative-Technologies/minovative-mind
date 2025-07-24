import * as vscode from "vscode";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import * as path from "path";
import {
	ToggleRelevantFilesDisplayMessage,
	EditChatMessage,
	ImageInlineData, // NEW: Added import for ImageInlineData
	WebviewToExtensionChatMessageType, // NEW: Added import for WebviewToExtensionChatMessageType
	HistoryEntryPart, // Ensure HistoryEntryPart is imported for type safety
} from "../sidebar/common/sidebarTypes";
import { formatUserFacingErrorMessage } from "../utils/errorFormatter";
import { ERROR_OPERATION_CANCELLED } from "../ai/gemini"; // CRITICAL: Added import for ERROR_OPERATION_CANCELLED
import { DEFAULT_FLASH_LITE_MODEL } from "../sidebar/common/sidebarConstants";
import { generateLightweightPlanPrompt } from "../ai/prompts/lightweightPrompts";

export async function handleWebviewMessage(
	data: any,
	provider: SidebarProvider
): Promise<void> {
	console.log(`[MessageHandler] Message received: ${data.type}`);

	// Prevent new operations if one is ongoing
	const allowedDuringBackground = [
		"webviewReady",
		"requestDeleteConfirmation",
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
		"universalCancel", // New universal cancellation message, must be allowed during background operations
		"editChatMessage", // 1. Added "editChatMessage" to the allowedDuringBackground array
		"getTokenStatistics", // Allow token statistics requests during background operations
		"getCurrentTokenEstimates", // Allow current token estimates during background operations
		"openSidebar", // Allow opening sidebar during background operations
		"generatePlanPromptFromAIMessage", // CRITICAL CHANGE: Allow this new message type during background operations
		"revertRequest",
		"requestClearChatConfirmation", // New: Allowed for user confirmation flow
		"confirmClearChatAndRevert", // New: Allowed as a direct user interaction during clear chat flow
		"cancelClearChat", // New: Allowed as a direct user interaction during clear chat flow
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
		case "universalCancel":
			console.log("[MessageHandler] Received universal cancellation request.");
			await provider.triggerUniversalCancellation();
			break;

		case "webviewReady":
			console.log("[MessageHandler] Webview ready. Initializing UI state.");
			await provider.handleWebviewReady();
			break;

		case "planRequest": {
			const userRequest = data.value;
			// This addHistoryEntry call might need to be updated to support HistoryEntryPart[] if userRequest is changed to such.
			// For now, it remains as a string because /plan is a command, not multi-modal input.
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
				// This addHistoryEntry call remains as a string because it's an internal message.
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

		case "revertRequest":
			console.log("[MessageHandler] Received revertRequest.");
			await provider.revertLastPlanChanges();
			break;

		case "chatMessage": {
			// Cast incoming data to the specific message type
			const chatMessageData = data as WebviewToExtensionChatMessageType;
			const userMessageText = chatMessageData.value;
			const groundingEnabled = !!chatMessageData.groundingEnabled;
			const incomingImageParts = chatMessageData.imageParts; // Array of ImageInlineData | undefined

			// Handle /commit command first (existing logic)
			if (userMessageText.trim().toLowerCase() === "/commit") {
				if (!provider.activeOperationCancellationTokenSource) {
					provider.activeOperationCancellationTokenSource =
						new vscode.CancellationTokenSource();
				}
				await provider.commitService.handleCommitCommand(
					provider.activeOperationCancellationTokenSource.token
				);
				break; // Exit case after handling /commit
			}

			// Construct userHistoryParts array
			const userHistoryParts: HistoryEntryPart[] = [];

			// Add the user's text message if not empty, or a default message if only images
			if (userMessageText.trim() !== "") {
				userHistoryParts.push({ text: userMessageText });
			} else if (incomingImageParts && incomingImageParts.length > 0) {
				// Prepend text if only images are provided, for context
				userHistoryParts.push({ text: "Here are some images for context." });
			}

			// If incomingImageParts exist, iterate and push them as inlineData parts
			if (incomingImageParts && incomingImageParts.length > 0) {
				for (const img of incomingImageParts) {
					userHistoryParts.push({ inlineData: img });
				}
			}

			// Handle cases where no text or images are provided
			if (userHistoryParts.length === 0) {
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: "Please provide a message or images to send.",
					isError: true,
				});
				await provider.endUserOperation("failed");
				break;
			}

			// Update the provider.chatHistoryManager.addHistoryEntry call
			// Pass userHistoryParts to addHistoryEntry
			provider.chatHistoryManager.addHistoryEntry("user", userHistoryParts);

			// Update the await provider.chatService.handleRegularChat call
			// Pass userHistoryParts as the first argument instead of userMessage
			await provider.chatService.handleRegularChat(
				userHistoryParts,
				groundingEnabled
			);
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

		case "getTokenStatistics":
			// Send token statistics to webview
			const stats = provider.tokenTrackingService.getFormattedStatistics();
			provider.postMessageToWebview({
				type: "updateTokenStatistics",
				value: stats,
			});
			break;

		case "getCurrentTokenEstimates":
			// Send current token estimates for streaming responses
			const { inputText, outputText } = data.value;
			const currentEstimates =
				provider.tokenTrackingService.getCurrentStreamingEstimates(
					inputText || "",
					outputText || ""
				);
			provider.postMessageToWebview({
				type: "updateCurrentTokenEstimates",
				value: currentEstimates,
			});
			break;

		case "openSidebar":
			// Open the Minovative Mind sidebar when a plan is completed
			try {
				await vscode.commands.executeCommand(
					"minovative-mind.activitybar.focus"
				);
				console.log(
					"[MessageHandler] Sidebar opened automatically after plan completion."
				);
			} catch (error) {
				console.error("[MessageHandler] Failed to open sidebar:", error);
			}
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

		// New cases for clear chat confirmation flow
		case "requestClearChatConfirmation":
			console.log("[MessageHandler] Received requestClearChatConfirmation.");
			provider.postMessageToWebview({ type: "requestClearChatConfirmation" });
			break;

		case "confirmClearChatAndRevert":
			console.log("[MessageHandler] Received confirmClearChatAndRevert.");
			try {
				// Clear chat history
				await provider.chatHistoryManager.clearChat();
				// Clear project change logger history (all completed plans)
				provider.changeLogger.clearAllCompletedPlanChanges();
				// Clear persisted completed change sets from workspace state
				await provider.updatePersistedCompletedPlanChangeSets(null);

				// Send success messages to webview
				provider.postMessageToWebview({ type: "chatCleared" }); // Triggers UI clear
				provider.postMessageToWebview({
					type: "planExecutionFinished",
					hasRevertibleChanges: false,
				}); // Updates revert button state
				provider.postMessageToWebview({
					type: "statusUpdate",
					value:
						"Chat history cleared and all past changes reverted successfully.",
				});
				provider.postMessageToWebview({ type: "reenableInput" });

				// Show VS Code notification
				vscode.window.showInformationMessage(
					"Chat history cleared and all past changes reverted!"
				);
				console.log(
					"[MessageHandler] Chat history cleared and all past changes reverted successfully."
				);
			} catch (error: any) {
				console.error(
					"[MessageHandler] Error clearing chat or reverting changes:",
					error
				);
				const errorMessage = `Failed to clear chat and revert changes: ${
					error.message || String(error)
				}`;

				// Send error messages to webview
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: errorMessage,
					isError: true,
				});
				provider.postMessageToWebview({ type: "reenableInput" });

				// Show VS Code error notification
				vscode.window.showErrorMessage(errorMessage);
			}
			break;

		case "cancelClearChat":
			console.log("[MessageHandler] Received cancelClearChat.");
			provider.postMessageToWebview({
				type: "statusUpdate",
				value: "Chat clear operation cancelled.",
			});
			provider.postMessageToWebview({ type: "reenableInput" });
			break;

		// Old "clearChatRequest" case removed from here

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
				const formattedError = formatUserFacingErrorMessage(
					openError,
					"Error opening file: Failed to open the specified file.",
					"Error opening file: ",
					vscode.workspace.workspaceFolders?.[0]?.uri
				);
				console.error(
					`[MessageHandler] Error opening file ${absoluteFileUri.fsPath} in VS Code:`,
					openError
				);
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: formattedError,
					isError: true,
				});
			}
			break;
		}

		case "editChatMessage": {
			// 2. Add a new case for "editChatMessage"
			const { messageIndex, newContent } = data as EditChatMessage; // 3.a. Destructure data

			// 3.b. Add basic type and content validation
			if (
				typeof messageIndex !== "number" ||
				!Number.isInteger(messageIndex) ||
				messageIndex < 0 ||
				typeof newContent !== "string" ||
				newContent.trim() === ""
			) {
				console.error(
					"[MessageHandler] Invalid data for editChatMessage: messageIndex must be a non-negative integer and newContent a non-empty string.",
					data
				);
				provider.postMessageToWebview({
					type: "statusUpdate",
					value:
						"Error: Invalid message edit request. Please provide a valid message index and non-empty content.",
					isError: true,
				});
				return;
			}

			console.log(
				`[MessageHandler] Received editChatMessage for index ${messageIndex}: "${newContent.substring(
					0,
					50
				)}..."`
			);

			// 3.c. Call provider.triggerUniversalCancellation()
			provider.isEditingMessageActive = true;
			await provider.triggerUniversalCancellation();
			provider.isGeneratingUserRequest = true;
			await provider.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				true
			);

			// 3.d. Post a statusUpdate message to the webview
			provider.postMessageToWebview({
				type: "statusUpdate",
				value: "Message edited. Processing new request...",
			});

			// 3.e. Call provider.chatHistoryManager.editMessageAndTruncate()
			provider.chatHistoryManager.editMessageAndTruncate(
				messageIndex,
				newContent
			);

			const lowerCaseNewContent = newContent.trim().toLowerCase();

			if (lowerCaseNewContent.startsWith("/plan ")) {
				const planRequest = newContent.trim().substring("/plan ".length);
				if (!planRequest) {
					provider.postMessageToWebview({
						type: "statusUpdate",
						value: "Please provide a description for the plan after /plan.",
						isError: true,
					});
					// Re-enable inputs, as an invalid command was given
					await provider.endUserOperation(
						"failed",
						"Invalid /plan command: missing description."
					);
					return;
				}
				// Trigger the plan generation flow, similar to a fresh "/plan" command
				await provider.planService.handleInitialPlanRequest(planRequest);
			} else if (lowerCaseNewContent === "/commit") {
				// Ensure activeOperationCancellationTokenSource is re-initialized if it was disposed by triggerUniversalCancellation()
				if (!provider.activeOperationCancellationTokenSource) {
					provider.activeOperationCancellationTokenSource =
						new vscode.CancellationTokenSource();
				}
				// Handle /commit command from an edit (if applicable, based on project needs)
				await provider.commitService.handleCommitCommand(
					provider.activeOperationCancellationTokenSource.token
				);
			} else {
				// If it's not a recognized command, proceed with regular chat message regeneration
				await provider.chatService.regenerateAiResponseFromHistory(
					messageIndex
				);
			}
			break; // 3.g. Include break;
		}

		case "generatePlanPromptFromAIMessage": {
			const messageIndex = data.payload.messageIndex;

			const historyEntry =
				provider.chatHistoryManager.getChatHistory()[messageIndex];

			if (!historyEntry || historyEntry.role !== "model") {
				console.error(
					`[MessageHandler] Invalid history entry for index ${messageIndex} or not an AI message.`
				);
				provider.postMessageToWebview({
					type: "statusUpdate",
					value:
						"Error: Could not generate plan prompt. Invalid AI message context.",
					isError: true,
				});
				await provider.endUserOperation("failed");
				break;
			}

			// Concatenate all parts to get the full AI message content
			const aiMessageContent = historyEntry.parts
				.map((part) => ("text" in part && part.text ? part.text : ""))
				.filter((text) => text.length > 0) // Filter out empty strings from non-text parts
				.join("\n");

			if (!aiMessageContent || aiMessageContent.trim() === "") {
				console.error(
					`[MessageHandler] AI message content is empty for index ${messageIndex}.`
				);
				provider.postMessageToWebview({
					type: "statusUpdate",
					value:
						"Error: AI message content is empty, cannot generate plan prompt.",
					isError: true,
				});
				await provider.endUserOperation("failed");
				break;
			}

			// 1. Before the `try` block, add:
			provider.activeOperationCancellationTokenSource =
				new vscode.CancellationTokenSource();
			const token = provider.activeOperationCancellationTokenSource.token;

			try {
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: "Generating plan prompt from AI message...",
				});

				// 2. Modify the call to `generateLightweightPlanPrompt` inside the `try` block to pass the `token` as the fourth argument
				const generatedPlanText = await generateLightweightPlanPrompt(
					aiMessageContent,
					DEFAULT_FLASH_LITE_MODEL,
					provider.aiRequestService,
					token // Pass the cancellation token
				);

				// 3. Immediately after the `await generateLightweightPlanPrompt(...)` call, add an `if` condition to check for cancellation:
				if (token.isCancellationRequested) {
					console.log(
						"[MessageHandler] generatePlanPromptFromAIMessage: Operation cancelled after generation but before pre-fill."
					);
					await provider.endUserOperation("cancelled");
					return; // Crucially, exit the handler early.
				}

				provider.postMessageToWebview({
					type: "PrefillChatInput",
					payload: { text: generatedPlanText },
				});
				provider.postMessageToWebview({
					type: "statusUpdate",
					value: "Plan prompt generated and pre-filled into chat input.",
				});
				await provider.endUserOperation("success");
				provider.postMessageToWebview({
					type: "updateLoadingState",
					value: false,
				}); // Added
				// 4. Refine the `catch (error: any)` block:
			} catch (error: any) {
				const isCancellation = error.message === ERROR_OPERATION_CANCELLED;
				if (isCancellation) {
					console.log(
						"[MessageHandler] generatePlanPromptFromAIMessage: Operation cancelled during generation."
					);
					await provider.endUserOperation("cancelled");
					// If it's a cancellation, `universalCancel` will handle UI reset, so suppress further status updates here.
				} else {
					console.error(
						`[MessageHandler] Error generating lightweight plan prompt:`,
						error
					);
					provider.postMessageToWebview({
						type: "statusUpdate",
						value: `Error generating plan prompt: ${
							error.message || String(error)
						}`,
						isError: true,
					});
					await provider.endUserOperation("failed");
				}
				// 5. Add a `finally` block after the `try...catch` block (before `break;`)
			} finally {
				if (provider.activeOperationCancellationTokenSource) {
					provider.activeOperationCancellationTokenSource.dispose();
					provider.activeOperationCancellationTokenSource = undefined;
				}
			}
			break; // break from the switch case
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

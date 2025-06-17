// src/services/webviewMessageHandler.ts
import * as vscode from "vscode";
import { SidebarProvider } from "../sidebar/SidebarProvider";

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
			value: "Another operation is in progress. Please wait or cancel.",
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
			// The planService will handle the rest, including UI updates
			await provider.planService.handleInitialPlanRequest(userRequest);
			break;
		}

		case "confirmPlanExecution":
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
					value: "Error: No pending plan to confirm.",
					isError: true,
				});
				provider.postMessageToWebview({ type: "reenableInput" });
			}
			break;

		case "retryStructuredPlanGeneration":
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
					value: "Error: No previous plan to retry.",
					isError: true,
				});
				provider.postMessageToWebview({ type: "reenableInput" });
			}
			break;

		case "chatMessage": {
			const userMessage = data.value;
			if (userMessage.trim().toLowerCase() === "/commit") {
				await provider.commitService.handleCommitCommand();
			} else {
				provider.chatHistoryManager.addHistoryEntry("user", userMessage);
				await provider.chatService.handleRegularChat(userMessage);
			}
			break;
		}

		case "commitRequest":
			await provider.commitService.handleCommitCommand();
			break;

		case "confirmCommit":
			await provider.commitService.confirmCommit();
			break;

		case "cancelCommit":
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

		default:
			console.warn(`Unknown message type received: ${data.type}`);
	}
}

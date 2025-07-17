import * as vscode from "vscode";
import { ChildProcess } from "child_process";

// Managers
import { ApiKeyManager } from "./managers/apiKeyManager";
import { SettingsManager } from "./managers/settingsManager";
import { ChatHistoryManager } from "./managers/chatHistoryManager";

// Other Imports
import { ProjectChangeLogger } from "../workflow/ProjectChangeLogger";
import { getHtmlForWebview } from "./ui/webviewHelper";
import * as sidebarConstants from "./common/sidebarConstants";
import * as sidebarTypes from "./common/sidebarTypes";
import { AIRequestService } from "../services/aiRequestService";
import { ContextService } from "../services/contextService";
import { handleWebviewMessage } from "../services/webviewMessageHandler";
import { PlanService } from "../services/planService";
import { ChatService } from "../services/chatService";
import { CommitService } from "../services/commitService";
import { GitConflictResolutionService } from "../services/gitConflictResolutionService";
import { TokenTrackingService } from "../services/tokenTrackingService";
import {
	showInfoNotification,
	showWarningNotification,
	showErrorNotification,
} from "../utils/notificationUtils"; // Add this import

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "minovativeMindSidebarView";

	// --- PUBLIC STATE (for services to access) ---
	public _view?: vscode.WebviewView;
	public readonly extensionUri: vscode.Uri;
	public readonly secretStorage: vscode.SecretStorage;
	public readonly workspaceState: vscode.Memento;
	public readonly workspaceRootUri: vscode.Uri | undefined; // Make it readonly and optional

	// New getter
	public get isSidebarVisible(): boolean {
		return !!this._view && this._view.visible;
	}

	// State
	public activeOperationCancellationTokenSource:
		| vscode.CancellationTokenSource
		| undefined;
	public activeChildProcesses: ChildProcess[] = [];
	public pendingPlanGenerationContext: sidebarTypes.PlanGenerationContext | null =
		null;
	public lastPlanGenerationContext: sidebarTypes.PlanGenerationContext | null =
		null;
	public currentExecutionOutcome: sidebarTypes.ExecutionOutcome | undefined;
	public currentAiStreamingState: sidebarTypes.AiStreamingState | null = null;
	public pendingCommitReviewData: {
		commitMessage: string;
		stagedFiles: string[];
	} | null = null;
	public isGeneratingUserRequest: boolean = false; // Added property
	public isEditingMessageActive: boolean = false;
	private _persistedPendingPlanData: sidebarTypes.PersistedPlanData | null =
		null; // New private property

	// --- MANAGERS & SERVICES ---
	public apiKeyManager: ApiKeyManager;
	public settingsManager: SettingsManager;
	public chatHistoryManager: ChatHistoryManager;
	public changeLogger: ProjectChangeLogger;

	// Services
	public aiRequestService: AIRequestService;
	public contextService: ContextService;
	public planService: PlanService;
	public chatService: ChatService;
	public commitService: CommitService;
	public gitConflictResolutionService: GitConflictResolutionService; // Service instance
	public tokenTrackingService: TokenTrackingService;

	constructor(
		extensionUri: vscode.Uri,
		context: vscode.ExtensionContext,
		workspaceRootUri: vscode.Uri | undefined
	) {
		// Add workspaceRootUri
		this.extensionUri = extensionUri;
		this.secretStorage = context.secrets;
		this.workspaceState = context.workspaceState;
		this.workspaceRootUri = workspaceRootUri; // Assign workspaceRootUri

		// Initialize persisted pending plan data from workspace state
		this._persistedPendingPlanData =
			context.workspaceState.get<sidebarTypes.PersistedPlanData | null>(
				"minovativeMind.persistedPendingPlanData",
				null
			);

		// Instantiate managers
		this.apiKeyManager = new ApiKeyManager(
			this.secretStorage,
			this.postMessageToWebview.bind(this)
		);
		this.settingsManager = new SettingsManager(
			this.workspaceState,
			this.postMessageToWebview.bind(this)
		);
		this.chatHistoryManager = new ChatHistoryManager(
			this.workspaceState,
			this.postMessageToWebview.bind(this)
		);
		this.changeLogger = new ProjectChangeLogger();

		// Initialize token tracking service
		this.tokenTrackingService = new TokenTrackingService();

		// Register for real-time token updates
		this.tokenTrackingService.onTokenUpdate((stats) => {
			this.postMessageToWebview({
				type: "updateTokenStatistics",
				value: this.tokenTrackingService.getFormattedStatistics(),
			});
		});

		// Load persistent state for isGeneratingUserRequest
		this.isGeneratingUserRequest = context.workspaceState.get<boolean>(
			"minovativeMind.isGeneratingUserRequest",
			false
		);

		// Instantiate services, passing dependencies
		this.aiRequestService = new AIRequestService(
			this.apiKeyManager,
			this.postMessageToWebview.bind(this),
			this.tokenTrackingService
		);
		this.contextService = new ContextService(
			this.settingsManager,
			this.chatHistoryManager,
			this.changeLogger,
			this.aiRequestService,
			this.postMessageToWebview.bind(this)
		);

		this.gitConflictResolutionService = new GitConflictResolutionService(
			context
		); // Instantiate before PlanService

		// These services need access to the provider's state and other services.
		// You would create these files following the same pattern.
		this.planService = new PlanService(
			this,
			this.workspaceRootUri, // Pass workspaceRootUri
			this.gitConflictResolutionService // Pass the GitConflictResolutionService
		);
		this.chatService = new ChatService(this);
		this.commitService = new CommitService(this);

		// Listen for secret changes to reload API keys
		context.secrets.onDidChange((e) => {
			if (
				e.key === sidebarConstants.GEMINI_API_KEYS_LIST_SECRET_KEY ||
				e.key === sidebarConstants.GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
			) {
				this.apiKeyManager.loadKeysFromStorage();
			}
		});
	}

	public async initialize(): Promise<void> {
		await this.apiKeyManager.initialize();
		this.settingsManager.initialize();
	}

	// --- WEBVIEW ---
	public async resolveWebviewView(
		webviewView: vscode.WebviewView
	): Promise<void> {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, "dist"),
				vscode.Uri.joinPath(this.extensionUri, "media"),
				vscode.Uri.joinPath(this.extensionUri, "src", "sidebar", "webview"),
			],
		};

		const logoUri = webviewView.webview.asWebviewUri(
			vscode.Uri.joinPath(
				this.extensionUri,
				"media",
				"minovative-logo-192x192.png"
			)
		);
		webviewView.webview.html = await getHtmlForWebview(
			webviewView.webview,
			this.extensionUri,
			sidebarConstants.AVAILABLE_GEMINI_MODELS,
			this.settingsManager.getSelectedModelName(),
			logoUri
		);

		webviewView.webview.onDidReceiveMessage(async (data) => {
			await handleWebviewMessage(data, this);
		});
	}

	public postMessageToWebview(message: Record<string, unknown>): void {
		if (this._view && this._view.visible) {
			this._view.webview.postMessage(message).then(undefined, (err) => {
				console.warn("Failed to post message to webview:", message.type, err);
			});
		}
	}

	public async updatePersistedPendingPlanData(
		data: sidebarTypes.PersistedPlanData | null
	): Promise<void> {
		this._persistedPendingPlanData = data;
		await this.workspaceState.update(
			"minovativeMind.persistedPendingPlanData",
			data
		);
		console.log(
			`[SidebarProvider] Persisted pending plan data updated to: ${
				data ? "present" : "null"
			}`
		);
	}

	public async handleWebviewReady(): Promise<void> {
		this.apiKeyManager.loadKeysFromStorage();
		this.settingsManager.updateWebviewModelList();
		this.chatHistoryManager.restoreChatHistoryToWebview();

		// 1. Prioritize pending plan confirmation (generation *complete*, awaiting review) from PERSISTED DATA
		if (this._persistedPendingPlanData) {
			console.log(
				"[SidebarProvider] Restoring pending plan confirmation to webview from persisted data."
			);
			const planCtx = this._persistedPendingPlanData; // Use the persisted data
			const planDataForRestore = {
				originalRequest: planCtx.originalUserRequest,
				originalInstruction: planCtx.originalInstruction,
				type: "textualPlanPending",
				relevantFiles: planCtx.relevantFiles,
				textualPlanExplanation: planCtx.textualPlanExplanation, // Crucially, pass the actual plan text
			};

			this.postMessageToWebview({
				type: "restorePendingPlanConfirmation",
				value: planDataForRestore,
			});
			// Generation is complete, inputs should be re-enabled for user interaction with the review UI
			this.postMessageToWebview({ type: "updateLoadingState", value: false });
			// Ensure the general generation flag is reset as we're now in a review state
			this.isGeneratingUserRequest = false;
			await this.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				false
			);
		}
		// 2. Then, check for active AI streaming progress (e.g., for long chat responses)
		else if (
			this.currentAiStreamingState &&
			!this.currentAiStreamingState.isComplete
		) {
			console.log(
				"[SidebarProvider] Restoring active AI streaming progress to webview."
			);
			this.postMessageToWebview({
				type: "restoreStreamingProgress",
				value: this.currentAiStreamingState,
			});
			this.postMessageToWebview({ type: "updateLoadingState", value: true }); // Ensure inputs are disabled
		}
		// 3. Then, check for pending commit review (generation *complete*, awaiting review)
		else if (this.pendingCommitReviewData) {
			console.log(
				"[SidebarProvider] Restoring pending commit review to webview."
			);
			this.postMessageToWebview({
				type: "restorePendingCommitReview",
				value: this.pendingCommitReviewData,
			});
			// Generation is complete, inputs should be re-enabled for user interaction with the review UI
			this.isGeneratingUserRequest = false;
			await this.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				false
			);
		}
		// 4. Check for a stale generic AI generation in progress (isGeneratingUserRequest is true but no other specific state is active)
		else if (this.isGeneratingUserRequest) {
			console.log(
				"[SidebarProvider] Detected stale generic loading state (isGeneratingUserRequest is true, but no active streaming or pending review). Resetting."
			);
			// If isGeneratingUserRequest is true but no streaming, pending plan, or pending commit
			// review state is found, it indicates an interrupted or lost operation.
			// Reset the flag and re-enable inputs, providing a status update.
			await this.endUserOperation("cancelled", "Inputs re-enabled.");
			// The call to endUserOperation already posts 'reenableInput' and 'statusUpdate'.
			// No need to send 'showGenericLoadingMessage' here.
		}
		// 5. Default: No active operations, re-enable inputs
		else {
			this.postMessageToWebview({ type: "reenableInput" });
			this.clearActiveOperationState();
		}
	}

	// --- OPERATION & STATE HELPERS ---
	public isOperationInProgress(): boolean {
		return (
			!!this.activeOperationCancellationTokenSource ||
			this.activeChildProcesses.length > 0
		);
	}

	/**
	 * Clears the active operation state, including the cancellation token source
	 * and any pending review or streaming data.
	 */
	public clearActiveOperationState(): void {
		if (this.activeOperationCancellationTokenSource) {
			console.log(
				"[SidebarProvider] Disposing activeOperationCancellationTokenSource."
			);
			this.activeOperationCancellationTokenSource.dispose();
			this.activeOperationCancellationTokenSource = undefined;
		}
		this.pendingCommitReviewData = null; // Clear any pending commit data
		this.currentAiStreamingState = null; // Clear streaming state when operation ends
	}

	/**
	 * Resets all state related to a user-initiated AI operation,
	 * ensures UI inputs are re-enabled, and provides an optional status update.
	 * This method centralizes the logic for ending user operations (success, failure, cancellation, or review transition).
	 * @param outcome The final outcome of the operation, or "review" if transitioning to a review state.
	 * @param customStatusMessage An optional custom message to display instead of the default outcome-based message.
	 */
	public async endUserOperation(
		outcome: sidebarTypes.ExecutionOutcome | "review",
		customStatusMessage?: string // Added optional parameter
	): Promise<void> {
		console.log(
			`[SidebarProvider] Ending user operation with outcome: ${outcome}`
		);

		// 1. Reset isGeneratingUserRequest and persist
		this.isGeneratingUserRequest = false;
		await this.workspaceState.update(
			"minovativeMind.isGeneratingUserRequest",
			false
		);

		// 2. Clear active operation state (cancellation token, streaming state, pendingCommitReviewData)
		this.clearActiveOperationState();

		// 3. Explicitly clear all pending context data not handled by clearActiveOperationState
		this.pendingPlanGenerationContext = null;
		this.lastPlanGenerationContext = null;
		// pendingCommitReviewData is cleared by clearActiveOperationState

		// Critical for UI synchronization: ensures the chat history and overall UI state are up-to-date after any operation concludes.
		// During an edit operation, the webview handles the initial visual update,
		// so we skip restoring the entire chat history from the backend at this early stage.
		if (!this.isEditingMessageActive) {
			this.chatHistoryManager.restoreChatHistoryToWebview();
		} else {
			console.log(
				"[SidebarProvider] Skipping restoreChatHistoryToWebview during active message edit."
			);
		}

		// 4. Re-enable input in the webview
		this.postMessageToWebview({ type: "reenableInput" });

		// 5. Post optional status update to the webview and chat history
		let statusMessage = "";
		let isError = false;

		if (customStatusMessage) {
			// If a custom message is provided, use it and determine isError based on outcome
			statusMessage = customStatusMessage;
			isError = outcome === "cancelled" || outcome === "failed";
		} else {
			// Fallback to existing switch logic if no custom message
			switch (outcome) {
				case "success":
					statusMessage = "Operation completed successfully.";
					break;
				case "cancelled":
					statusMessage = "Operation cancelled.";
					isError = true;
					break;
				case "failed":
					statusMessage = "Operation failed. Check sidebar for details.";
					isError = true;
					break;
				case "review":
					statusMessage =
						"Operation paused for user review. Please review the proposed changes.";
					break;
				default:
					statusMessage = `Operation ended with unknown outcome: ${outcome}.`;
					isError = true;
					break;
			}
		}

		if (statusMessage) {
			// CONDITIONALLY ADD to chat history: ONLY if the operation was NOT cancelled
			if (outcome !== "cancelled") {
				this.chatHistoryManager.addHistoryEntry("model", statusMessage);
			}
			this.postMessageToWebview({
				type: "statusUpdate",
				value: statusMessage,
				isError: isError,
			});
		}
	}

	public async triggerUniversalCancellation(): Promise<void> {
		console.log("[SidebarProvider] Triggering universal cancellation...");

		// Immediately cancel the active operation
		if (this.activeOperationCancellationTokenSource) {
			this.activeOperationCancellationTokenSource.cancel();
		}

		// Kill all child processes immediately
		this.activeChildProcesses.forEach((cp) => {
			console.log(
				`[SidebarProvider] Killing child process with PID: ${cp.pid}`
			);
			cp.kill();
		});
		this.activeChildProcesses = [];

		// Clear all pending state immediately
		this.pendingPlanGenerationContext = null;
		await this.updatePersistedPendingPlanData(null); // Clear persisted context as well
		this.lastPlanGenerationContext = null;
		this.pendingCommitReviewData = null;
		this.currentAiStreamingState = null;

		// Reset the general generation flag and persist it.
		// This is part of clearing the state on the backend.
		this.isGeneratingUserRequest = false;
		await this.workspaceState.update(
			"minovativeMind.isGeneratingUserRequest",
			false
		);
		this.isEditingMessageActive = false;

		console.log("[SidebarProvider] Universal cancellation complete.");
	}

	public async cancelActiveOperation(): Promise<void> {
		await this.triggerUniversalCancellation();
	}

	public async cancelPendingPlan(): Promise<void> {
		await this.triggerUniversalCancellation();
	}

	public async showPlanCompletionNotification(
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

		// The chat history entry and status update for 'cancelled' will be handled by endUserOperation
		// when it's called after this notification function completes, ensuring no duplication.
		// For 'success' and 'failed', the message is still relevant to add to history here.
		if (outcome !== "cancelled") {
			this.chatHistoryManager.addHistoryEntry("model", message);
		}
		// Ensures the final notification and overall chat history state are immediately reflected in the UI.
		this.chatHistoryManager.restoreChatHistoryToWebview();

		if (this.isSidebarVisible === true) {
			// For 'cancelled' outcome, these lines are removed as per instruction.
			// For 'success' and 'failed', we still post the status update to webview.
			if (outcome !== "cancelled") {
				this.postMessageToWebview({
					type: "statusUpdate",
					value: message,
					isError: isError,
				});
			}
		} else {
			let notificationFunction: (
				message: string,
				...items: string[]
			) => Thenable<string | undefined>;

			switch (outcome) {
				case "success":
					notificationFunction = showInfoNotification; // Use new utility
					break;
				case "cancelled":
					notificationFunction = showWarningNotification; // Use new utility
					break;
				case "failed":
					// For failed outcomes, only update status within sidebar, no additional native pop-up
					// This ensures any specific error already reported is the sole native notification
					this.postMessageToWebview({
						type: "statusUpdate",
						value: message,
						isError: true,
					});
					return;
			}

			const result = await notificationFunction(
				message,
				"Open Sidebar",
				"Cancel Plan"
			); // Pass message and items

			if (result === "Open Sidebar") {
				vscode.commands.executeCommand("minovative-mind.activitybar.focus");
			} else if (result === "Cancel Plan") {
				// User clicked 'Cancel Plan' on the native notification
				console.log(
					"[SidebarProvider] Native notification 'Cancel Plan' clicked. Triggering universal cancellation."
				);
				await this.triggerUniversalCancellation();
				// as triggerUniversalCancellation already handles endUserOperation.
				return; // Exit the function immediately
			}
		}
	}
}

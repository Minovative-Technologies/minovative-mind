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

		// Load persistent state for isGeneratingUserRequest
		this.isGeneratingUserRequest = context.workspaceState.get<boolean>(
			"minovativeMind.isGeneratingUserRequest",
			false
		);

		// Instantiate services, passing dependencies
		this.aiRequestService = new AIRequestService(
			this.apiKeyManager,
			this.postMessageToWebview.bind(this)
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

	public async handleWebviewReady(): Promise<void> {
		this.apiKeyManager.loadKeysFromStorage();
		this.settingsManager.updateWebviewModelList();
		this.chatHistoryManager.restoreChatHistoryToWebview();

		// 1. Prioritize active AI streaming progress (e.g., for long chat responses)
		if (
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
		// 2. Then, check for pending plan confirmation (generation *complete*, awaiting review)
		else if (this.pendingPlanGenerationContext) {
			console.log(
				"[SidebarProvider] Restoring pending plan confirmation to webview."
			);
			const planCtx = this.pendingPlanGenerationContext;
			const planDataForRestore =
				planCtx.type === "chat"
					? {
							originalRequest: planCtx.originalUserRequest,
							type: "textualPlanPending",
							relevantFiles: planCtx.relevantFiles,
					  }
					: {
							originalInstruction: planCtx.editorContext?.instruction,
							type: "textualPlanPending",
							relevantFiles: planCtx.relevantFiles,
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
			this.postMessageToWebview({ type: "updateLoadingState", value: false });
			// Ensure the general generation flag is reset as we're now in a review state
			this.isGeneratingUserRequest = false;
			await this.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				false
			);
		}
		// 4. Finally, check for a generic AI generation in progress (e.g., initial /plan, /commit before review UI)
		else if (this.isGeneratingUserRequest) {
			console.log(
				"[SidebarProvider] Restoring generic loading state for user request."
			);
			// Send a specific message to the webview to show the generic "Generating..." message
			this.postMessageToWebview({ type: "showGenericLoadingMessage" });
			this.postMessageToWebview({ type: "updateLoadingState", value: true }); // Ensure main controls are disabled
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
			this.chatHistoryManager.addHistoryEntry("model", statusMessage);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: statusMessage,
				isError: isError,
			});
		}
	}

	public async triggerUniversalCancellation(): Promise<void> {
		console.log("[SidebarProvider] Triggering universal cancellation...");
		this.activeOperationCancellationTokenSource?.cancel();
		this.activeChildProcesses.forEach((cp) => {
			console.log(
				`[SidebarProvider] Killing child process with PID: ${cp.pid}`
			);
			cp.kill();
		});
		this.activeChildProcesses = [];
		this.pendingPlanGenerationContext = null;
		this.lastPlanGenerationContext = null;
		this.pendingCommitReviewData = null;
		this.currentAiStreamingState = null;
		await this.endUserOperation("cancelled");
		console.log("[SidebarProvider] Universal cancellation complete.");
	}

	public async cancelActiveOperation(): Promise<void> {
		await this.triggerUniversalCancellation();
	}

	public async cancelPendingPlan(): Promise<void> {
		await this.triggerUniversalCancellation();
	}
}

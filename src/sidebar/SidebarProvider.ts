// src/sidebar/SidebarProvider.ts
import * as vscode from "vscode";
import { ChildProcess } from "child_process";

// Managers
import { ApiKeyManager } from "./managers/apiKeyManager";
import { SettingsManager } from "./managers/settingsManager";
import { ChatHistoryManager } from "./managers/chatHistoryManager";

// Other Imports
import { ProjectChangeLogger } from "../workflow/ProjectChangeLogger";
import { RevertService } from "../services/RevertService";
import { RevertibleChangeSet } from "../types/workflow";
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
} from "../utils/notificationUtils";
// Added: Imports for missing services
import { CodeValidationService } from "../services/codeValidationService";
import { ContextRefresherService } from "../services/contextRefresherService";
import { EnhancedCodeGenerator } from "../ai/enhancedCodeGeneration";

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
	public completedPlanChangeSets: RevertibleChangeSet[] = []; // New public property
	public isPlanExecutionActive: boolean = false; // New public property

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
	private enhancedCodeGenerator: EnhancedCodeGenerator;
	public revertService: RevertService; // New public property
	// Added: Properties for missing services
	private codeValidationService: CodeValidationService;
	private contextRefresherService: ContextRefresherService;

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

		this.completedPlanChangeSets = context.workspaceState.get<
			RevertibleChangeSet[]
		>("minovativeMind.completedPlanChangeSets", []);

		// Initialize isPlanExecutionActive from workspace state
		this.isPlanExecutionActive = context.workspaceState.get<boolean>(
			"minovativeMind.isPlanExecutionActive",
			false
		);
		console.log(
			`[SidebarProvider] isPlanExecutionActive initialized to: ${this.isPlanExecutionActive}`
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

		this.gitConflictResolutionService = new GitConflictResolutionService(
			context
		); // Instantiate before PlanService

		// In src/sidebar/SidebarProvider.ts constructor...
		// Moved: Instantiate this.contextService immediately after this.gitConflictResolutionService
		this.contextService = new ContextService(
			this.settingsManager,
			this.chatHistoryManager,
			this.changeLogger,
			this.aiRequestService,
			this.postMessageToWebview.bind(this)
		);

		// Added: Instantiate missing services
		this.codeValidationService = new CodeValidationService(
			this.workspaceRootUri || vscode.Uri.file("/")
		);
		// FIXED: Provide all required arguments to the ContextRefresherService constructor.
		this.contextRefresherService = new ContextRefresherService(
			this.contextService,
			this.changeLogger,
			this.workspaceRootUri || vscode.Uri.file("/") // Ensure Uri is passed
		);

		// Correctly instantiate EnhancedCodeGenerator with all dependencies in the right order.
		this.enhancedCodeGenerator = new EnhancedCodeGenerator(
			this.aiRequestService, // 1. AIRequestService
			this.postMessageToWebview.bind(this), // 2. postMessageToWebview function
			this.changeLogger, // 3. ProjectChangeLogger
			this.codeValidationService, // 4. CodeValidationService
			this.contextRefresherService, // 5. ContextRefresherService
			{
				// 6. Config object
				enableRealTimeFeedback: true,
				maxFeedbackIterations: 5,
			}
		);

		// Instantiate RevertService
		this.revertService = new RevertService(
			this.workspaceRootUri || vscode.Uri.file("/"),
			this.changeLogger
		);

		// These services need access to the provider's state and other services.
		this.planService = new PlanService(
			this,
			this.workspaceRootUri, // Pass workspaceRootUri
			this.gitConflictResolutionService, // Pass the GitConflictResolutionService
			this.enhancedCodeGenerator, // Pass the instance here
			this.postMessageToWebview.bind(this)
		);
		this.chatService = new ChatService(this);
		this.commitService = new CommitService(this);

		// Listen for secret changes to reload API keys
		context.secrets.onDidChange((e) => {
			if (e.key === sidebarConstants.GEMINI_API_KEY_SECRET_KEY) {
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

		const fileUri = vscode.Uri.parse("file://");
		const message = { type: "fileUriLoaded", uri: fileUri.toString() };
		webviewView.webview.postMessage(message);

		webviewView.webview.onDidReceiveMessage(async (data) => {
			await handleWebviewMessage(data, this);
		});
	}

	public postMessageToWebview(
		message: sidebarTypes.ExtensionToWebviewMessages
	): void {
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

	public async updatePersistedCompletedPlanChangeSets(
		data: RevertibleChangeSet[] | null
	): Promise<void> {
		this.completedPlanChangeSets = data || [];
		await this.workspaceState.update(
			"minovativeMind.completedPlanChangeSets", // New key
			this.completedPlanChangeSets // Persist the entire stack
		);
		console.log(
			`[SidebarProvider] Persisted completed plan change sets updated to: ${
				this.completedPlanChangeSets.length > 0 ? "present" : "null"
			}`
		);
	}

	public async setPlanExecutionActive(isActive: boolean): Promise<void> {
		this.isPlanExecutionActive = isActive;
		await this.workspaceState.update(
			"minovativeMind.isPlanExecutionActive",
			isActive
		);
		console.log(`[SidebarProvider] isPlanExecutionActive set to: ${isActive}`);
	}

	public async handleWebviewReady(): Promise<void> {
		let isAnyOperationBeingRestored = false;

		if (this.isPlanExecutionActive) {
			console.log(
				"[SidebarProvider] Detected active plan execution. Restoring UI state."
			);
			this.postMessageToWebview({ type: "updateLoadingState", value: true });
			this.postMessageToWebview({ type: "planExecutionStarted" });
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "A plan execution is currently in progress. Please wait.",
			});
		}

		this.apiKeyManager.loadKeysFromStorage();
		this.settingsManager.updateWebviewModelList();
		this.chatHistoryManager.restoreChatHistoryToWebview();

		if (this._persistedPendingPlanData) {
			console.log(
				"[SidebarProvider] Restoring pending plan confirmation to webview from persisted data."
			);
			const planCtx = this._persistedPendingPlanData;
			const planDataForRestore = {
				originalRequest: planCtx.originalUserRequest,
				originalInstruction: planCtx.originalInstruction,
				type: planCtx.type,
				relevantFiles: planCtx.relevantFiles,
				textualPlanExplanation: planCtx.textualPlanExplanation,
			};

			this.postMessageToWebview({
				type: "restorePendingPlanConfirmation",
				value: planDataForRestore,
			});
			this.postMessageToWebview({ type: "updateLoadingState", value: false });
			this.isGeneratingUserRequest = false;
			await this.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				false
			);
			isAnyOperationBeingRestored = true;
		} else if (
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
			this.postMessageToWebview({ type: "updateLoadingState", value: true });
			isAnyOperationBeingRestored = true;
		} else if (this.pendingCommitReviewData) {
			console.log(
				"[SidebarProvider] Restoring pending commit review to webview."
			);
			this.postMessageToWebview({
				type: "restorePendingCommitReview",
				value: this.pendingCommitReviewData,
			});
			this.isGeneratingUserRequest = false;
			await this.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				false
			);
			isAnyOperationBeingRestored = true;
		} else if (this.isGeneratingUserRequest) {
			console.log(
				"[SidebarProvider] Detected stale generic loading state (isGeneratingUserRequest is true, but no active streaming or pending review). Resetting."
			);
			await this.endUserOperation("success", "Inputs re-enabled.");
		} else {
			this.postMessageToWebview({ type: "reenableInput" });
			this.clearActiveOperationState();
		}

		if (!isAnyOperationBeingRestored) {
			if (this.isPlanExecutionActive) {
				console.log(
					"[SidebarProvider] No specific operation restored. Resetting stale isPlanExecutionActive flag."
				);
				await this.setPlanExecutionActive(false);
				this.postMessageToWebview({ type: "updateLoadingState", value: false });
				this.postMessageToWebview({ type: "reenableInput" });
				this.postMessageToWebview({ type: "statusUpdate", value: "" });
			}
		}

		const hasRevertibleChanges = this.completedPlanChangeSets.length > 0;
		this.postMessageToWebview({
			type: "planExecutionFinished",
			hasRevertibleChanges: hasRevertibleChanges,
		});
	}

	// --- OPERATION & STATE HELPERS ---
	public isOperationInProgress(): boolean {
		return (
			!!this.activeOperationCancellationTokenSource ||
			this.activeChildProcesses.length > 0
		);
	}

	public clearActiveOperationState(): void {
		if (this.activeOperationCancellationTokenSource) {
			console.log(
				"[SidebarProvider] Disposing activeOperationCancellationTokenSource."
			);
			this.activeOperationCancellationTokenSource.dispose();
			this.activeOperationCancellationTokenSource = undefined;
		}
		this.currentAiStreamingState = null;
	}

	public async endUserOperation(
		outcome: sidebarTypes.ExecutionOutcome | "review",
		customStatusMessage?: string,
		shouldReenableInputs: boolean = true
	): Promise<void> {
		console.log(
			`[SidebarProvider] Ending user operation with outcome: ${outcome}`
		);

		this.isGeneratingUserRequest = false;
		await this.workspaceState.update(
			"minovativeMind.isGeneratingUserRequest",
			false
		);

		// State cleanup: This also handles activeOperationCancellationTokenSource disposal/reset and currentAiStreamingState = null
		this.clearActiveOperationState();
		this.pendingPlanGenerationContext = null;
		this.lastPlanGenerationContext = null;
		// Clear pendingCommitReviewData ONLY if not pausing for review
		if (outcome !== "review") {
			this.pendingCommitReviewData = null;
		}

		if (!this.isEditingMessageActive) {
			this.chatHistoryManager.restoreChatHistoryToWebview();
		} else {
			console.log(
				"[SidebarProvider] Skipping restoreChatHistoryToWebview during active message edit."
			);
		}

		// UI feedback after state cleanup
		if (shouldReenableInputs) {
			this.postMessageToWebview({ type: "reenableInput" });
		}

		let statusMessage = "";
		let isError = false;

		if (customStatusMessage) {
			statusMessage = customStatusMessage;
			isError = outcome === "cancelled" || outcome === "failed";
		} else {
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
			if (
				outcome !== "cancelled" &&
				statusMessage !== "Operation completed successfully."
			) {
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

		// 1. Cancel the active operation, then dispose and clear the token source
		if (this.activeOperationCancellationTokenSource) {
			this.activeOperationCancellationTokenSource.cancel(); // Signal cancellation
			const wasAiGenerationInProgress =
				!!this.currentAiStreamingState &&
				!this.currentAiStreamingState.isComplete;
			// The clearActiveOperationState() method handles disposing and nullifying the token source,
			// as well as setting currentAiStreamingState to null.
			this.clearActiveOperationState();
		}

		// 2. Terminate any active child processes
		this.activeChildProcesses.forEach((cp) => {
			console.log(
				`[SidebarProvider] Killing child process with PID: ${cp.pid}`
			);
			cp.kill();
		});
		this.activeChildProcesses = []; // Clear the list of child processes

		// 3. Reset all other relevant state variables to a quiescent state
		await this.setPlanExecutionActive(false); // Update plan execution status

		this.pendingPlanGenerationContext = null;
		await this.updatePersistedPendingPlanData(null); // Clear persisted data
		this.lastPlanGenerationContext = null;
		this.pendingCommitReviewData = null; // Ensure this is cleared upon universal cancellation
		// this.currentAiStreamingState = null; // Removed: Handled by clearActiveOperationState()

		this.isGeneratingUserRequest = false; // Reset generation flag
		await this.workspaceState.update(
			"minovativeMind.isGeneratingUserRequest",
			false
		); // Persist the reset flag
		this.isEditingMessageActive = false; // Reset editing flag

		// 4. Call endUserOperation to finalize UI state and send status updates.
		// This ensures "reenableInput" and "statusUpdate" are sent after all core state cleanup.
		const wasAiGenerationInProgress =
			!!this.currentAiStreamingState &&
			!this.currentAiStreamingState.isComplete;
		await this.endUserOperation(
			"cancelled",
			undefined,
			!wasAiGenerationInProgress
		);

		// 5. Send a specific confirmation message to the webview, after all other messages
		this.postMessageToWebview({
			type: "operationCancelledConfirmation",
		});
	}

	public async cancelActiveOperation(): Promise<void> {
		await this.triggerUniversalCancellation();
	}

	public async cancelPendingPlan(): Promise<void> {
		await this.triggerUniversalCancellation();
	}

	public async revertLastPlanChanges(): Promise<void> {
		if (this.completedPlanChangeSets.length === 0) {
			vscode.window.showWarningMessage(
				"No completed workflow changes to revert."
			);
			return;
		}

		const mostRecentChangeSet = this.completedPlanChangeSets.pop();
		if (!mostRecentChangeSet) {
			vscode.window.showWarningMessage(
				"No completed workflow changes to revert."
			);
			return;
		}

		let revertSuccessful: boolean = false;
		let revertErrorMessage: string = "";
		let finalStatusMessage: string = "";
		let isErrorStatus: boolean = false;

		const confirmation = await vscode.window.showWarningMessage(
			"Are you sure you want to revert the changes from the most recent workflow?",
			{ modal: true },
			"Yes, Revert Changes",
			"No, Cancel"
		);

		if (confirmation === "Yes, Revert Changes") {
			try {
				this.postMessageToWebview({ type: "updateLoadingState", value: true });
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Reverting most recent workflow changes...",
				});
				console.log(
					"[SidebarProvider] Starting revert of most recent workflow changes..."
				);

				await this.revertService.revertChanges(mostRecentChangeSet.changes);

				revertSuccessful = true;
				finalStatusMessage =
					"Most recent workflow changes reverted successfully!";
				showInfoNotification(finalStatusMessage);
				console.log(
					"[SidebarProvider] Most recent workflow changes reverted successfully."
				);
			} catch (error: any) {
				revertSuccessful = false;
				revertErrorMessage = `Failed to revert most recent workflow changes: ${
					error.message || String(error)
				}`;
				finalStatusMessage = revertErrorMessage;
				isErrorStatus = true;
				showErrorNotification(
					error,
					"Failed to revert most recent workflow changes.",
					"Revert Error: ",
					this.workspaceRootUri
				);
				console.error(
					"[SidebarProvider] Error reverting most recent workflow changes:",
					error
				);
				this.completedPlanChangeSets.push(mostRecentChangeSet);
			}
		} else {
			revertSuccessful = false;
			revertErrorMessage = "Revert operation cancelled by user.";
			finalStatusMessage = "Revert operation cancelled.";
			isErrorStatus = false;
			vscode.window.showInformationMessage(finalStatusMessage);
			console.log("[SidebarProvider] Revert operation cancelled by user.");

			this.completedPlanChangeSets.push(mostRecentChangeSet);
		}

		await this.updatePersistedCompletedPlanChangeSets(
			this.completedPlanChangeSets
		);

		const stillHasRevertibleChanges = this.completedPlanChangeSets.length > 0;

		this.postMessageToWebview({
			type: "planExecutionFinished",
			hasRevertibleChanges: stillHasRevertibleChanges,
		});

		this.postMessageToWebview({
			type: "statusUpdate",
			value: finalStatusMessage,
			isError: isErrorStatus,
		});

		this.postMessageToWebview({ type: "updateLoadingState", value: false });
		this.postMessageToWebview({ type: "reenableInput" });
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

		if (outcome !== "cancelled") {
			this.chatHistoryManager.addHistoryEntry("model", message);
		}
		this.chatHistoryManager.restoreChatHistoryToWebview();

		if (this.isSidebarVisible === true) {
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
					notificationFunction = showInfoNotification;
					break;
				case "cancelled":
					notificationFunction = showWarningNotification;
					break;
				case "failed":
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
			);

			if (result === "Open Sidebar") {
				vscode.commands.executeCommand("minovative-mind.activitybar.focus");
			} else if (result === "Cancel Plan") {
				console.log(
					"[SidebarProvider] Native notification 'Cancel Plan' clicked. Triggering universal cancellation."
				);
				await this.triggerUniversalCancellation();
				return;
			}
		}
	}
}

// src/sidebar/SidebarProvider.ts
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
import { FirebaseUser } from "../firebase/firebaseService";
import { AIRequestService } from "../services/aiRequestService";
import { ContextService } from "../services/contextService";
import { handleWebviewMessage } from "../services/webviewMessageHandler";
import { PlanService } from "../services/planService";
import { ChatService } from "../services/chatService";
import { CommitService } from "../services/commitService";
import { AuthService } from "../services/authService";

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "minovativeMindSidebarView";

	// --- PUBLIC STATE (for services to access) ---
	public _view?: vscode.WebviewView;
	public readonly extensionUri: vscode.Uri;
	public readonly secretStorage: vscode.SecretStorage;
	public readonly workspaceState: vscode.Memento;

	// New getter
	public get isSidebarVisible(): boolean {
		return !!this._view && this._view.visible;
	}

	// Auth State Events
	private _onDidAuthStateChange: vscode.EventEmitter<sidebarTypes.AuthStateUpdatePayload> =
		new vscode.EventEmitter<sidebarTypes.AuthStateUpdatePayload>();
	public readonly onDidAuthStateChange: vscode.Event<sidebarTypes.AuthStateUpdatePayload> =
		this._onDidAuthStateChange.event;

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
	public pendingCommitReviewData: {
		commitMessage: string;
		stagedFiles: string[];
	} | null = null;

	// Auth State
	public isUserSignedIn: boolean = false;
	public currentUserTier: sidebarTypes.UserTier = "free";
	public isSubscriptionActive: boolean = false;
	public userUid: string | undefined;
	public userEmail: string | undefined;

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
	public authService: AuthService;

	constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
		this.extensionUri = extensionUri;
		this.secretStorage = context.secrets;
		this.workspaceState = context.workspaceState;

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

		// These services need access to the provider's state and other services.
		// You would create these files following the same pattern.
		this.planService = new PlanService(this);
		this.chatService = new ChatService(this);
		this.commitService = new CommitService(this);
		this.authService = new AuthService(this);

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

	// --- AUTH & USER STATE METHODS ---
	public updateUserAuthAndTierFromFirebase(
		user: FirebaseUser | null,
		subscriptionData: sidebarTypes.UserSubscriptionData | null
	): void {
		this.isUserSignedIn = user !== null;
		this.userUid = user?.uid;
		this.userEmail = user?.email || undefined;

		if (
			user &&
			(subscriptionData?.subscriptionStatus === "active" ||
				subscriptionData?.subscriptionStatus === "trialing")
		) {
			this.isSubscriptionActive = true;
			this.currentUserTier = "pro";
		} else {
			this.isSubscriptionActive = false;
			this.currentUserTier = "free";
		}

		console.log(
			`[SidebarProvider] Auth State Updated: SignedIn=${this.isUserSignedIn}, Tier=${this.currentUserTier}`
		);
		this.postMessageToWebview({
			type: "authStateUpdate",
			value: this.getAuthStatePayload(),
		});
		this._onDidAuthStateChange.fire(this.getAuthStatePayload());
	}

	public getAuthStatePayload(): sidebarTypes.AuthStateUpdatePayload {
		return {
			isSignedIn: this.isUserSignedIn,
			uid: this.userUid,
			email: this.userEmail,
			tier: this.currentUserTier,
			isSubscriptionActive: this.isSubscriptionActive,
		};
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
		this.postMessageToWebview({
			type: "authStateUpdate",
			value: this.getAuthStatePayload(),
		});

		if (this.pendingPlanGenerationContext) {
			// Logic to restore pending plan UI
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
		} else {
			this.postMessageToWebview({ type: "reenableInput" });
		}
	}

	// --- OPERATION & STATE HELPERS ---
	public isOperationInProgress(): boolean {
		return (
			!!this.activeOperationCancellationTokenSource ||
			this.activeChildProcesses.length > 0
		);
	}

	public cancelActiveOperation(): void {
		this.activeOperationCancellationTokenSource?.cancel();
		this.activeChildProcesses.forEach((cp) => cp.kill());
		this.activeChildProcesses = [];
		this.chatHistoryManager.addHistoryEntry(
			"model",
			"Operation cancelled by user."
		);
		this.postMessageToWebview({
			type: "statusUpdate",
			value: "Operation cancelled.",
		});
	}

	public cancelPendingPlan(): void {
		this.pendingPlanGenerationContext = null;
		this.lastPlanGenerationContext = null;
		vscode.window.showInformationMessage(
			"Minovative Mind: Plan review cancelled."
		);
		this.postMessageToWebview({
			type: "statusUpdate",
			value: "Pending plan cancelled.",
		});
		this.chatHistoryManager.addHistoryEntry(
			"model",
			"Pending plan cancelled by user."
		);
		this.postMessageToWebview({ type: "reenableInput" });
	}
}

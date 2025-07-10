import { VsCodeWebviewApi } from "../vscode.d";

export interface VsCodeApi extends VsCodeWebviewApi {}

export interface RequiredDomElements {
	chatContainer: HTMLDivElement;
	chatInput: HTMLTextAreaElement;
	sendButton: HTMLButtonElement;
	statusArea: HTMLDivElement;
	modelSelect: HTMLSelectElement;
	currentKeyDisplay: HTMLSpanElement;
	prevKeyButton: HTMLButtonElement;
	nextKeyButton: HTMLButtonElement;
	deleteKeyButton: HTMLButtonElement;
	addKeyInput: HTMLInputElement;
	addKeyButton: HTMLButtonElement;
	apiKeyStatusDiv: HTMLDivElement;
	clearChatButton: HTMLButtonElement;
	saveChatButton: HTMLButtonElement;
	loadChatButton: HTMLButtonElement;
	cancelGenerationButton: HTMLButtonElement;
	planConfirmationContainer: HTMLDivElement;
	confirmPlanButton: HTMLButtonElement;
	cancelPlanButton: HTMLButtonElement;
	planParseErrorContainer: HTMLDivElement;
	planParseErrorDisplay: HTMLParagraphElement;
	failedJsonDisplay: HTMLElement;
	retryGenerationButton: HTMLButtonElement;
	cancelParseErrorButton: HTMLButtonElement;
	commitReviewContainer: HTMLDivElement;
	commitMessageTextarea: HTMLTextAreaElement;
	stagedFilesList: HTMLOListElement;
	confirmCommitButton: HTMLButtonElement;
	cancelCommitButton: HTMLButtonElement;
	emptyChatPlaceholder: HTMLDivElement;

	chatInputControlsWrapper: HTMLDivElement;
	commandSuggestionsContainer: HTMLDivElement;
	groundingToggle: HTMLInputElement;
}

export interface PendingPlanData {
	type: string;
	originalRequest?: string;
	originalInstruction?: string;
	relevantFiles?: string[];
}

export interface PendingCommitReviewData {
	commitMessage: string;
	stagedFiles: string[];
}

/**
 * Message type sent from webview to extension when a chat message is edited.
 */
export interface EditChatMessage {
	type: "editChatMessage";
	messageIndex: number; // The index of the message in the chat history array
	newContent: string; // The new, edited content of the message
}

export interface WebviewAppState {
	currentAiMessageContentElement: HTMLSpanElement | null;
	currentAccumulatedText: string;
	typingBuffer: string;
	typingTimer: ReturnType<typeof setInterval> | null;
	TYPING_SPEED_MS: number;
	CHARS_PER_INTERVAL: number;
	activeCommandIndex: number;
	filteredCommands: string[];
	isCommandSuggestionsVisible: boolean;
	planConfirmationContainer: HTMLDivElement | null;
	confirmPlanButton: HTMLButtonElement | null;
	cancelPlanButton: HTMLButtonElement | null;
	pendingPlanData: PendingPlanData | null;
	pendingCommitReviewData: PendingCommitReviewData | null;
	isApiKeySet: boolean;
	isLoading: boolean;
	isCommitActionInProgress: boolean;
	isCancellationInProgress: boolean;
	isPlanExecutionInProgress: boolean; // New property to track plan execution state
	totalKeys: number;
}

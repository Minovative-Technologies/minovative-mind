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
	planConfirmationContainer: HTMLDivElement | null;
	confirmPlanButton: HTMLButtonElement | null;
	cancelPlanButton: HTMLButtonElement | null;
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
	// groundingToggle: HTMLInputElement;

	// Token usage display elements
	tokenUsageContainer: HTMLDivElement;
	tokenUsageDisplay: HTMLDivElement;
	tokenUsageToggle: HTMLButtonElement;
	revertChangesButton: HTMLButtonElement;

	// Clear chat confirmation
	chatClearConfirmationContainer: HTMLDivElement | null;
	confirmClearChatButton: HTMLButtonElement | null;
	cancelClearChatButton: HTMLButtonElement | null;

	// Image upload
	imageUploadInput: HTMLInputElement;
	attachImageButton: HTMLButtonElement;
	imagePreviewsContainer: HTMLDivElement;
	clearImagesButton: HTMLButtonElement;
}

export interface PendingPlanData {
	type: string;
	originalRequest?: string;
	originalInstruction?: string;
	relevantFiles?: string[];
	textualPlanExplanation?: string; // ADDED
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

/**
 * Represents the state of an image file selected for upload in the webview.
 */
export interface ImageUploadState {
	file: File;
	mimeType: string;
	data: string; // Base64 encoded string of the image
	previewElement: HTMLDivElement; // Reference to the DOM element displaying the preview
}

export type SuggestionType = "command" | "file" | "loading" | "none";

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
	isAwaitingUserReview: boolean;
	isCommitActionInProgress: boolean;
	isCancellationInProgress: boolean;
	isPlanExecutionInProgress: boolean; // Track plan execution state
	hasRevertibleChanges: boolean;
	totalKeys: number;
	isTokenUsageVisible: boolean; // Track token usage visibility
	nextMessageIndex: number;
	selectedImages: ImageUploadState[];
	allWorkspaceFiles: string[];
	isRequestingWorkspaceFiles: boolean;
	currentSuggestionType: SuggestionType;
}

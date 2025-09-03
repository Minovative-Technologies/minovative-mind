import { WebviewAppState } from "../types/webviewTypes";

/**
 * appState.ts
 *
 * This file centralizes the mutable application state for the webview.
 * It holds references to dynamically created DOM elements and various
 * UI and operational flags that were previously scattered as global
 * `let` variables in `main.ts`.
 *
 * By consolidating these into a single `appState` object, we improve
 * maintainability, readability, and allow for clearer data flow
 * when other modules need to access or modify shared state.
 */

export const appState: WebviewAppState = {
	currentAiMessageContentElement: null,
	currentAccumulatedText: "",
	typingBuffer: "",
	typingTimer: null, // In browser environment, `setInterval` returns a number (NodeJS.Timeout is for Node.js)
	TYPING_SPEED_MS: 0,
	CHARS_PER_INTERVAL: 5,
	activeCommandIndex: -1,
	filteredCommands: [],
	isCommandSuggestionsVisible: false,
	planConfirmationContainer: null,
	confirmPlanButton: null,
	cancelPlanButton: null,
	pendingPlanData: null,
	pendingCommitReviewData: null,
	isApiKeySet: false,
	/**
	 * Indicates if an AI generation operation is actively in progress.
	 * This should strictly reflect active *generation* and *not* be set to `true` during cancellation; it should be `false` when cancellation begins.
	 */
	isLoading: false,
	isAwaitingUserReview: false,
	isCancelling: false,
	isCommitActionInProgress: false,
	isCancellationInProgress: false,
	isPlanExecutionInProgress: false,
	hasRevertibleChanges: false,
	totalKeys: 0,
	isTokenUsageVisible: false,
	nextMessageIndex: 0,
	selectedImages: [],
	allWorkspaceFiles: [],
	isRequestingWorkspaceFiles: false,
	currentSuggestionType: "none",
	editingMessageIndex: null,
	isEditingMessage: false,
	currentActiveOperationId: null,
};

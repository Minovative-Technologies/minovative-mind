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
	isLoading: false,
	isAwaitingUserReview: false,
	isCommitActionInProgress: false, // Added as per instruction
	isCancellationInProgress: false, // Initialize the new flag
	isPlanExecutionInProgress: false, // Initialize plan execution tracking
	hasRevertibleChanges: false,
	totalKeys: 0,
	isTokenUsageVisible: false, // Initialize token usage visibility
	nextMessageIndex: 0,
	selectedImages: [], // Initialize the new property
};

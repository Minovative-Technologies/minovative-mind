import { postMessageToExtension } from "./utils/vscodeApi";
import { initializeDomElements } from "./state/domElements";
import { appState } from "./state/appState";
import { initializeButtonEventListeners } from "./eventHandlers/buttonEventHandlers";
import { initializeInputEventListeners } from "./eventHandlers/inputEventHandlers";
import { initializeMessageBusHandler } from "./eventHandlers/messageBusHandler";
import {
	updateEmptyChatPlaceholderVisibility,
	updateStatus,
} from "./ui/statusManager";
import {
	createPlanConfirmationUI,
	createClearChatConfirmationUI, // Add this import
} from "./ui/confirmationAndReviewUIs";
import {
	reenableAllMessageActionButtons,
	setGlobalSetLoadingState,
} from "./ui/chatMessageRenderer";
import { RequiredDomElements } from "./types/webviewTypes";
import { setIconForButton } from "./utils/iconHelpers";
import { faChartLine } from "./utils/iconHelpers";

/**
 * Updates token usage display with current statistics
 */
function updateTokenUsageDisplay(elements: RequiredDomElements): void {
	// Request token statistics from extension
	postMessageToExtension({ type: "getTokenStatistics" });
}

/**
 * Toggles token usage display visibility
 */
function toggleTokenUsageDisplay(elements: RequiredDomElements): void {
	appState.isTokenUsageVisible = !appState.isTokenUsageVisible;
	elements.tokenUsageContainer.style.display = appState.isTokenUsageVisible
		? "block"
		: "none";

	if (appState.isTokenUsageVisible) {
		updateTokenUsageDisplay(elements);
	}
}

/**
 * Updates the loading state of the webview UI, controlling the visibility and
 * disabled status of various elements based on the current application state.
 *
 * @param loading - A boolean indicating whether the webview is in a loading state.
 * @param elements - An object containing references to all required DOM elements.
 */
function setLoadingState(
	loading: boolean,
	elements: RequiredDomElements
): void {
	console.log(
		`[setLoadingState] Call: loading=${loading}, current isLoading=${appState.isLoading}, current isApiKeySet=${appState.isApiKeySet}, current isCommandSuggestionsVisible=${appState.isCommandSuggestionsVisible}`
	);
	appState.isLoading = loading;
	const loadingMsg = elements.chatContainer.querySelector(".loading-message");
	if (loadingMsg) {
		loadingMsg.remove();
	}

	// Determine visibility of complex UI containers
	const planConfirmationVisible =
		elements.planConfirmationContainer.style.display !== "none";
	const planParseErrorVisible =
		elements.planParseErrorContainer.style.display !== "none";
	const commitReviewVisible =
		elements.commitReviewContainer.style.display !== "none";
	// Introduce new variable for clear chat confirmation visibility
	const chatClearConfirmationVisible =
		elements.chatClearConfirmationContainer.style.display !== "none";

	// Introduce new constants for granular control
	const canInteractWithMainChatControls =
		!loading &&
		appState.isApiKeySet &&
		!appState.isAwaitingUserReview && // Refactored
		!appState.isCancellationInProgress;

	const canSendCurrentInput =
		canInteractWithMainChatControls && !appState.isCommandSuggestionsVisible;

	console.log(
		`[setLoadingState] UI Display States: planConfirmationContainer=${elements.planConfirmationContainer.style.display}, planParseErrorContainer=${elements.planParseErrorContainer.style.display}, commitReviewContainer=${elements.commitReviewContainer.style.display}, chatClearConfirmationContainer=${elements.chatClearConfirmationContainer.style.display}, isCommandSuggestionsVisible=${appState.isCommandSuggestionsVisible}`
	);

	// Determine enablement for chat history management buttons
	const canInteractWithChatHistoryButtons =
		!loading &&
		!appState.isAwaitingUserReview && // Refactored
		!appState.isCommandSuggestionsVisible &&
		!appState.isCancellationInProgress;

	console.log(
		`[setLoadingState] Final computed canInteractWithMainChatControls=${canInteractWithMainChatControls}, canSendCurrentInput=${canSendCurrentInput}, canInteractWithChatHistoryButtons=${canInteractWithChatHistoryButtons}`
	);

	// Apply disabled states to main chat interface elements
	elements.chatInput.disabled = !canInteractWithMainChatControls;
	elements.modelSelect.disabled = !canInteractWithMainChatControls;
	elements.sendButton.disabled = !canSendCurrentInput;

	// Apply disabled states to API key management controls
	const enableApiKeyControls =
		!appState.isLoading &&
		!appState.isAwaitingUserReview && // Refactored
		!appState.isCommandSuggestionsVisible &&
		appState.totalKeys > 0;
	elements.prevKeyButton.disabled =
		!enableApiKeyControls || appState.totalKeys <= 1;
	elements.nextKeyButton.disabled =
		!enableApiKeyControls || appState.totalKeys <= 1;
	elements.deleteKeyButton.disabled =
		!enableApiKeyControls || !appState.isApiKeySet;

	const enableAddKeyInputControls =
		!loading &&
		!appState.isAwaitingUserReview && // Refactored
		!appState.isCommandSuggestionsVisible;
	elements.addKeyInput.disabled = !enableAddKeyInputControls;
	elements.addKeyButton.disabled = !enableAddKeyInputControls;

	// Determine if there are actual messages in the chat (excluding loading messages)
	const hasMessages =
		elements.chatContainer.childElementCount > 0 &&
		!elements.chatContainer.querySelector(".loading-message");

	// Apply disabled states to chat history buttons
	elements.loadChatButton.disabled = !canInteractWithChatHistoryButtons;
	elements.saveChatButton.disabled =
		!canInteractWithChatHistoryButtons || !hasMessages;
	elements.clearChatButton.disabled =
		!canInteractWithChatHistoryButtons || !hasMessages;

	// Apply disabled state for confirm commit button
	elements.confirmCommitButton.disabled =
		loading ||
		!commitReviewVisible ||
		elements.commitMessageTextarea.value.trim() === "";

	console.log(
		`[setLoadingState] Status: loading=${loading}, planConfVis=${planConfirmationVisible}, planParseErrVis=${planParseErrorVisible}, commitRevVis=${commitReviewVisible}`
	);
	console.log(
		`[setLoadingState] Chat: childCount=${elements.chatContainer.childElementCount}, hasMessages=${hasMessages}`
	);
	console.log(
		`[setLoadingState] Buttons: saveDisabled=${elements.saveChatButton.disabled}, clearDisabled=${elements.clearChatButton.disabled}`
	);

	// Control visibility of the cancel generation button
	if (
		loading &&
		!appState.isAwaitingUserReview && // Refactored
		!appState.isCancellationInProgress &&
		!appState.isPlanExecutionInProgress // Hide stop button during plan execution
	) {
		elements.cancelGenerationButton.style.display = "inline-flex";
	} else {
		elements.cancelGenerationButton.style.display = "none";
	}

	// Control visibility of the revert changes button
	if (!loading && appState.hasRevertibleChanges) {
		elements.revertChangesButton.style.display = "inline-flex";
	} else {
		elements.revertChangesButton.style.display = "none";
	}

	// Hide confirmation/error/review UIs if a new loading operation starts
	if (loading && planConfirmationVisible) {
		elements.planConfirmationContainer.style.display = "none";
		appState.pendingPlanData = null; // Clear pending plan data if a new request starts
		updateStatus(
			elements,
			"New request initiated, pending plan confirmation cancelled.",
			false
		);
	}

	if (loading && planParseErrorVisible) {
		elements.planParseErrorContainer.style.display = "none";
		if (elements.planParseErrorDisplay) {
			elements.planParseErrorDisplay.textContent = "";
		}
		if (elements.failedJsonDisplay) {
			elements.failedJsonDisplay.textContent = "";
		}
		updateStatus(
			elements,
			"New request initiated, parse error UI hidden.",
			false
		);
	}
	if (loading && commitReviewVisible) {
		elements.commitReviewContainer.style.display = "none";
		updateStatus(
			elements,
			"New request initiated, commit review UI hidden.",
			false
		);
	}
	// Add conditional block to hide clear chat confirmation UI
	if (loading && chatClearConfirmationVisible) {
		elements.chatClearConfirmationContainer.style.display = "none";
		updateStatus(
			elements,
			"New request initiated, clear chat confirmation UI hidden.",
			false
		);
	}

	// Update empty chat placeholder visibility only when not loading
	if (!loading) {
		updateEmptyChatPlaceholderVisibility(elements);
		// Re-enable all message action buttons when loading becomes false
		reenableAllMessageActionButtons(elements);
	}
}

/**
 * Initializes the webview by acquiring DOM elements, setting initial UI states,
 * and attaching all necessary event listeners.
 */
function initializeWebview(): void {
	const elements = initializeDomElements();
	if (!elements) {
		console.error(
			"Critical DOM elements not found. Exiting webview initialization."
		);
		// Error message to the user is handled within initializeDomElements.
		return;
	}

	// Post webviewReady message to the extension
	postMessageToExtension({ type: "webviewReady" });
	console.log("Webview sent ready message.");

	// Set initial focus to the chat input
	elements.chatInput.focus();

	// Set initial disabled states and display styles for various UI elements
	elements.chatInput.disabled = true;
	elements.sendButton.disabled = true;
	elements.modelSelect.disabled = true;

	elements.clearChatButton.disabled = true;
	elements.saveChatButton.disabled = true;
	elements.loadChatButton.disabled = false; // Load chat button is typically active from start

	elements.prevKeyButton.disabled = true;
	elements.nextKeyButton.disabled = true;
	elements.deleteKeyButton.disabled = true;

	elements.cancelGenerationButton.style.display = "none";
	elements.planParseErrorContainer.style.display = "none";
	elements.commitReviewContainer.style.display = "none";
	elements.confirmCommitButton.disabled = true;
	elements.commandSuggestionsContainer.style.display = "none";
	elements.revertChangesButton.style.display = "none"; // Set initial display for revertChangesButton

	// Initialize all event listeners for buttons, inputs, and the message bus
	initializeInputEventListeners(elements, setLoadingState);
	initializeButtonEventListeners(elements, setLoadingState);
	initializeMessageBusHandler(elements, setLoadingState);

	// Add token usage toggle event listener
	elements.tokenUsageToggle.addEventListener("click", () => {
		toggleTokenUsageDisplay(elements);
	});

	// Set icon for token usage button
	setIconForButton(elements.tokenUsageToggle, faChartLine);

	// Perform initial UI setup for dynamically created components or visibility
	createPlanConfirmationUI(
		elements,
		postMessageToExtension,
		updateStatus,
		setLoadingState
	);
	// Add call to createClearChatConfirmationUI
	createClearChatConfirmationUI(elements, postMessageToExtension);
	updateEmptyChatPlaceholderVisibility(elements);

	// Apply the initial loading state (which is typically false on startup)
	// This will correctly enable/disable buttons based on initial appState values
	// (e.g., isApiKeySet is likely false initially).
	setLoadingState(false, elements);

	// Set up global reference to setLoadingState for use in chatMessageRenderer
	setGlobalSetLoadingState(setLoadingState);
}

// Ensure the webview is initialized once the DOM is fully loaded.
document.addEventListener("DOMContentLoaded", initializeWebview);

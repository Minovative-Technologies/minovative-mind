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
import { createPlanConfirmationUI } from "./ui/confirmationAndReviewUIs";
import { RequiredDomElements } from "./types/webviewTypes";

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

	console.log(
		`[setLoadingState] UI Display States: planConfirmationContainer=${elements.planConfirmationContainer.style.display}, planParseErrorContainer=${elements.planParseErrorContainer.style.display}, commitReviewContainer=${elements.commitReviewContainer.style.display}, isCommandSuggestionsVisible=${appState.isCommandSuggestionsVisible}`
	);

	// Determine enablement for core chat controls (send button, chat input, model select)
	const enableSendControls =
		!loading &&
		appState.isApiKeySet &&
		!planConfirmationVisible &&
		!planParseErrorVisible &&
		!commitReviewVisible &&
		!appState.isCommandSuggestionsVisible;

	// Determine enablement for chat history management buttons
	const canInteractWithChatHistoryButtons =
		!loading &&
		!planConfirmationVisible &&
		!planParseErrorVisible &&
		!commitReviewVisible &&
		!appState.isCommandSuggestionsVisible;

	console.log(
		`[setLoadingState] Final computed enableSendControls=${enableSendControls}, canInteractWithChatHistoryButtons=${canInteractWithChatHistoryButtons}`
	);

	// Apply disabled states to main chat interface elements
	elements.sendButton.disabled = !enableSendControls;
	elements.chatInput.disabled = loading;
	elements.modelSelect.disabled =
		!!appState.isLoading ||
		!!planConfirmationVisible ||
		!!planParseErrorVisible ||
		!!commitReviewVisible ||
		!!appState.isCommandSuggestionsVisible;

	// Apply disabled states to API key management controls
	const enableApiKeyControls =
		!appState.isLoading &&
		!planConfirmationVisible &&
		!planParseErrorVisible &&
		!commitReviewVisible &&
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
		!planConfirmationVisible &&
		!planParseErrorVisible &&
		!commitReviewVisible &&
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
		!planConfirmationVisible &&
		!planParseErrorVisible &&
		!commitReviewVisible
	) {
		elements.cancelGenerationButton.style.display = "inline-flex";
	} else {
		elements.cancelGenerationButton.style.display = "none";
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

	// Update empty chat placeholder visibility only when not loading
	if (!loading) {
		updateEmptyChatPlaceholderVisibility(elements);
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

	// Initialize all event listeners for buttons, inputs, and the message bus
	initializeInputEventListeners(elements, setLoadingState);
	initializeButtonEventListeners(elements, setLoadingState);
	initializeMessageBusHandler(elements, setLoadingState);

	// Perform initial UI setup for dynamically created components or visibility
	createPlanConfirmationUI(
		elements,
		postMessageToExtension,
		updateStatus,
		setLoadingState
	);
	updateEmptyChatPlaceholderVisibility(elements);

	// Apply the initial loading state (which is typically false on startup)
	// This will correctly enable/disable buttons based on initial appState values
	// (e.g., isApiKeySet is likely false initially).
	setLoadingState(false, elements);
}

// Ensure the webview is initialized once the DOM is fully loaded.
document.addEventListener("DOMContentLoaded", initializeWebview);

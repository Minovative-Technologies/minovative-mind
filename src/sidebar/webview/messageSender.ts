import { postMessageToExtension } from "./utils/vscodeApi";
import { appState } from "./state/appState";
import { appendMessage } from "./ui/chatMessageRenderer";
import { MINOVATIVE_COMMANDS } from "../common/sidebarConstants";
import { updateStatus } from "./ui/statusManager";
import { RequiredDomElements } from "./types/webviewTypes";

/**
 * Sends a chat message or command to the VS Code extension.
 * This function handles parsing user input for special commands like /plan and /commit,
 * updates the UI with the user's message, and manages the loading state.
 *
 * @param elements - An object containing references to all required DOM elements.
 * @param setLoadingState A callback function to update the global loading state of the UI.
 */
export function sendMessage(
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void // Updated signature to consistently pass 'elements'
): void {
	// Replace direct accesses to DOM elements with 'elements' properties
	const fullMessage = elements.chatInput.value.trim();
	elements.chatInput.value = ""; // Clear input immediately

	// Replace direct DOM checks and global state with 'elements' and 'appState'
	if (
		appState.isLoading ||
		elements.sendButton.disabled || // Added check for sendButton disabled state
		elements.planConfirmationContainer.style.display !== "none" ||
		elements.planParseErrorContainer.style.display !== "none" ||
		elements.commitReviewContainer.style.display !== "none" ||
		appState.isCommandSuggestionsVisible
	) {
		console.log(
			"Send button disabled: isLoading",
			appState.isLoading,
			"sendButton.disabled",
			elements.sendButton.disabled, // Log the new condition
			"planConfirmationVisible",
			elements.planConfirmationContainer.style.display !== "none",
			"planParseErrorVisible",
			elements.planParseErrorContainer.style.display !== "none",
			"commitReviewVisible",
			elements.commitReviewContainer.style.display !== "none",
			"isCommandSuggestionsVisible:",
			appState.isCommandSuggestionsVisible
		);
		return;
	}

	if (!fullMessage) {
		console.log("[MessageSender] Empty message, not sending.");
		return;
	}

	if (!appState.isApiKeySet) {
		// Ensure appendMessage passes 'elements' as its first argument
		appendMessage(
			elements,
			"System",
			"Please add or select a valid API Key first in the settings panel.",
			"error-message",
			true
		);
		// Ensure setLoadingState call passes 'elements'
		setLoadingState(false, elements);
		return;
	}

	// Set loading state to true as a message is about to be sent.
	// The `setLoadingState` function is responsible for disabling inputs and buttons.
	// Ensure setLoadingState call passes 'elements'
	setLoadingState(true, elements);

	const lowerMessage = fullMessage.toLowerCase();

	if (lowerMessage.startsWith(MINOVATIVE_COMMANDS[0] + " ")) {
		// Handles /plan command
		const planRequest = fullMessage
			.substring(MINOVATIVE_COMMANDS[0].length + 1)
			.trim();
		if (!planRequest) {
			// Ensure setLoadingState call passes 'elements'
			setLoadingState(false, elements); // Re-enable inputs if command is invalid
			// Ensure appendMessage passes 'elements' as its first argument
			appendMessage(
				elements,
				"System",
				`Please provide a description for the plan after ${MINOVATIVE_COMMANDS[0]}.`,
				"error-message",
				true
			);
			return;
		}
		// Ensure appendMessage and updateStatus pass 'elements' as their first argument
		appendMessage(elements, "You", fullMessage, "user-message", true);
		updateStatus(elements, "Requesting plan generation...");
		postMessageToExtension({ type: "planRequest", value: planRequest });
	} else if (lowerMessage === MINOVATIVE_COMMANDS[1]) {
		// Handles /commit command
		// Ensure appendMessage and updateStatus pass 'elements' as their first argument
		appendMessage(elements, "You", fullMessage, "user-message", true);
		updateStatus(elements, "Requesting commit message generation...");
		postMessageToExtension({ type: "commitRequest" });
	} else {
		// Regular chat message
		// Ensure appendMessage and updateStatus pass 'elements' as their first argument
		appendMessage(elements, "You", fullMessage, "user-message", true);
		updateStatus(elements, "Sending message to AI...");
		const groundingEnabled = elements.groundingToggle?.checked ?? false;
		postMessageToExtension({
			type: "chatMessage",
			value: fullMessage,
			groundingEnabled,
		});
	}

	console.log("[MessageSender] Message sent to extension.");
}

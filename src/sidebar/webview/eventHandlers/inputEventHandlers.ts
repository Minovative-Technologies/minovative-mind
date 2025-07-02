import { sendMessage } from "../messageSender";
import {
	showCommandSuggestions,
	hideCommandSuggestions,
	selectCommand,
	highlightCommand,
	isInputtingCompleteCommand,
} from "../ui/commandSuggestions";
import { MINOVATIVE_COMMANDS } from "../../common/sidebarConstants";
import { appState } from "../state/appState";
import { RequiredDomElements } from "../types/webviewTypes";

/**
 * Initializes all event listeners related to the chat input field and command suggestions.
 * @param elements The necessary DOM elements, encapsulated in RequiredDomElements.
 * @param setLoadingState A callback function to update the global loading state in the main application.
 */
export function initializeInputEventListeners(
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	const { chatInput } = elements;

	if (!chatInput) {
		console.error(
			"Chat input element not found. Cannot initialize input event listeners."
		);
		return;
	}
	// commandSuggestionsContainer and chatInputControlsWrapper are accessed via elements object now.

	// Event listener for input changes in the chat input field (for command suggestions)
	chatInput.addEventListener("input", () => {
		const text = chatInput.value;

		if (text.startsWith("/")) {
			// If the user has typed a complete command (e.g., "/plan " or just "/commit")
			if (isInputtingCompleteCommand(text)) {
				// Hide suggestions as the command is complete
				hideCommandSuggestions(elements, setLoadingState);
				return;
			}

			// Otherwise, show command suggestions based on current input query
			const query = text.substring(1).toLowerCase();
			const matches = MINOVATIVE_COMMANDS.filter((cmd: string) =>
				cmd.toLowerCase().includes(query)
			);

			showCommandSuggestions(matches, elements, setLoadingState);
		} else {
			// If the input doesn't start with '/', hide any visible suggestions
			hideCommandSuggestions(elements, setLoadingState);
		}
	});

	// Event listener for keydown events in the chat input field
	chatInput.addEventListener("keydown", (e) => {
		const isCommandSuggestionsCurrentlyVisible =
			appState.isCommandSuggestionsVisible;
		const currentFilteredCommands = appState.filteredCommands;
		let currentActiveCommandIndex = appState.activeCommandIndex;

		// If command suggestions are not visible, handle Enter key for sending messages
		if (!isCommandSuggestionsCurrentlyVisible) {
			if (e.key === "Enter" && !e.shiftKey) {
				console.log("Chat input Enter key pressed (no suggestions visible).");
				e.preventDefault(); // Prevent new line in textarea
				sendMessage(elements, setLoadingState);
			}
			return; // No further command suggestion handling needed if not visible
		}

		// Handle key presses when command suggestions ARE visible
		if (currentFilteredCommands.length === 0) {
			// If suggestions are visible but there are no matches, pressing Enter should still be prevented
			// to avoid sending an incomplete command or empty message.
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				console.log(
					"Enter pressed with visible but empty suggestions. Not sending message."
				);
			}
			return;
		}

		const numCommands = currentFilteredCommands.length;

		if (e.key === "ArrowDown") {
			e.preventDefault(); // Prevent cursor movement in textarea
			currentActiveCommandIndex = (currentActiveCommandIndex + 1) % numCommands;
			appState.activeCommandIndex = currentActiveCommandIndex; // Update the state
			highlightCommand(currentActiveCommandIndex, elements);
		} else if (e.key === "ArrowUp") {
			e.preventDefault(); // Prevent cursor movement in textarea
			currentActiveCommandIndex =
				(currentActiveCommandIndex - 1 + numCommands) % numCommands;
			appState.activeCommandIndex = currentActiveCommandIndex; // Update the state
			highlightCommand(currentActiveCommandIndex, elements);
		} else if (e.key === "Enter") {
			e.preventDefault(); // Prevent new line in textarea and form submission

			if (currentActiveCommandIndex !== -1) {
				// Select the highlighted command
				const selectedCmd = currentFilteredCommands[currentActiveCommandIndex];
				selectCommand(selectedCmd, elements, setLoadingState);
			} else {
				console.log(
					"Enter pressed with suggestions visible but no command highlighted. Not sending message."
				);
			}
		} else if (e.key === "Escape") {
			e.preventDefault(); // Prevent default browser behavior (e.g., closing popups)
			// Hide command suggestions
			hideCommandSuggestions(elements, setLoadingState);
		}
	});

	// Blur event listener for the chat input field
	// Use a small timeout to allow click events on command suggestions to fire first,
	// before the blur event hides the suggestions. This prevents the suggestions from
	// disappearing before a click registers on them.
	chatInput.addEventListener("blur", () => {
		setTimeout(() => {
			// Only hide if the input value does not start with '/',
			// otherwise, it indicates the user might still be typing a command
			// or has just selected one, in which case the `selectCommand` function
			// will handle hiding the suggestions already.
			if (chatInput && !chatInput.value.startsWith("/")) {
				hideCommandSuggestions(elements, setLoadingState);
			}
		}, 150); // 150ms delay to allow click event to propagate
	});
}

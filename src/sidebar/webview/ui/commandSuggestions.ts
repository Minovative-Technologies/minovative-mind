import { appState } from "../state/appState";
import { MINOVATIVE_COMMANDS } from "../../common/sidebarConstants";
import { RequiredDomElements, SuggestionType } from "../types/webviewTypes"; // Import the type for DOM elements and new SuggestionType

/**
 * Displays suggestions in the UI.
 * @param suggestions The list of suggestions (commands or file paths) to display.
 * @param type The type of suggestions being displayed ("command" or "file").
 * @param elements DOM elements required for displaying suggestions.
 * @param setLoadingState A callback function to update the global loading state.
 */
export function showSuggestions(
	suggestions: string[],
	type: SuggestionType,
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	const { commandSuggestionsContainer, chatInputControlsWrapper } = elements;

	if (type === "loading") {
		commandSuggestionsContainer.innerHTML = "";
		const loadingItem = document.createElement("div");
		loadingItem.classList.add("command-item", "no-matches");
		loadingItem.textContent = "Loading workspace files...";
		commandSuggestionsContainer.appendChild(loadingItem);
		appState.currentSuggestionType = "loading";
		appState.isCommandSuggestionsVisible = true;
		commandSuggestionsContainer.style.display = "flex";
		setLoadingState(appState.isLoading, elements);
		return;
	}

	appState.filteredCommands = suggestions; // 'filteredCommands' now holds generic suggestions
	appState.currentSuggestionType = type; // Set the current suggestion type
	commandSuggestionsContainer.innerHTML = "";
	appState.activeCommandIndex = -1;

	if (suggestions.length === 0) {
		const noMatchesItem = document.createElement("div");
		noMatchesItem.classList.add("command-item", "no-matches");
		let noMatchesText = "No matches";
		if (type === "command") {
			noMatchesText = "No matching commands";
		} else if (type === "file") {
			noMatchesText = "No matching files";
		}
		noMatchesItem.textContent = noMatchesText;
		commandSuggestionsContainer.appendChild(noMatchesItem);
	} else {
		suggestions.forEach((suggestion) => {
			const suggestionItem = document.createElement("div");
			suggestionItem.classList.add("command-item");
			suggestionItem.textContent = suggestion;
			suggestionItem.dataset.suggestion = suggestion; // Renamed from dataset.command
			suggestionItem.dataset.type = type; // Store the type for the click handler
			suggestionItem.addEventListener("click", () => {
				selectSuggestion(suggestion, type, elements, setLoadingState);
			});
			commandSuggestionsContainer.appendChild(suggestionItem);
		});
	}

	commandSuggestionsContainer.style.display = "flex";
	appState.isCommandSuggestionsVisible = true;
	setLoadingState(appState.isLoading, elements); // Call setLoadingState after updating visibility state

	chatInputControlsWrapper.style.zIndex = "100";
	console.log(`[Suggestions] Suggestions shown (${type}):`, suggestions);
}

/**
 * Hides suggestions from the UI.
 * @param elements DOM elements required for hiding suggestions.
 * @param setLoadingState A callback function to update the global loading state.
 */
export function hideSuggestions(
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	const { commandSuggestionsContainer, chatInputControlsWrapper } = elements;

	appState.isCommandSuggestionsVisible = false;
	appState.currentSuggestionType = "none"; // Set current suggestion type to none
	commandSuggestionsContainer.style.display = "none";
	setLoadingState(appState.isLoading, elements); // Call setLoadingState after updating visibility state

	commandSuggestionsContainer.innerHTML = ""; // Clear existing suggestions
	appState.activeCommandIndex = -1; // Reset active index
	appState.filteredCommands = []; // Clear filtered suggestions from state

	chatInputControlsWrapper.style.zIndex = ""; // Reset z-index
	console.log("[Suggestions] Suggestions hidden.");
}

/**
 * Selects a suggestion, populating the chat input and hiding suggestions.
 * @param suggestion The suggestion (command or file path) to select.
 * @param type The type of suggestion being selected ("command" or "file").
 * @param elements DOM elements required for accessing chat input and hiding suggestions.
 * @param setLoadingState A callback function to update the global loading state.
 */

export function selectSuggestion(
	suggestion: string,
	type: SuggestionType,
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	const { chatInput } = elements;
	if (!chatInput) {
		console.error("Chat input element not found in selectSuggestion.");
		return;
	}

	const currentText = chatInput.value;
	let replacementStartIndex = -1;

	// Re-evaluate the trigger condition to find where to replace
	const lastAtIndex = currentText.lastIndexOf("@");
	if (
		lastAtIndex === 0 ||
		(lastAtIndex > 0 && currentText[lastAtIndex - 1] === " ")
	) {
		replacementStartIndex = lastAtIndex;
	}

	if (type === "file") {
		if (replacementStartIndex !== -1) {
			// Replace "@" trigger and query with the suggestion, wrapped in backticks
			chatInput.value =
				currentText.substring(0, replacementStartIndex) + `\`${suggestion}\``;
		} else {
			// Fallback: If the "@" trigger cannot be found for replacement,
			// replace the entire input with the suggestion, wrapped in backticks.
			console.warn(
				`[@File Suggestion Selection] Could not find valid '@' trigger in "${currentText}". Replacing entire input with "${suggestion}" wrapped in backticks.`
			);
			chatInput.value = `\`${suggestion}\``;
		}

		chatInput.focus();
		// Set cursor to the end of the input field
		chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
		hideSuggestions(elements, setLoadingState);
		console.log(`[Suggestions] Suggestion selected (${type}): ${suggestion}`);
	} else if (type === "command") {
		// Existing logic for command selection (no change needed for this request)
		chatInput.value = suggestion + " ";
		chatInput.focus();
		chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
		hideSuggestions(elements, setLoadingState);
		console.log(`[Suggestions] Suggestion selected (${type}): ${suggestion}`);
	} else {
		// Fallback for unexpected types
		chatInput.value = suggestion;
		chatInput.focus();
		chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
		hideSuggestions(elements, setLoadingState);
		console.log(`[Suggestions] Suggestion selected (${type}): ${suggestion}`);
	}
}

/**
 * Highlights a command item in the suggestions list.
 * @param index The index of the command to highlight.
 * @param elements DOM elements required for accessing the command suggestions container.
 */
export function highlightCommand(
	index: number,
	elements: RequiredDomElements
): void {
	const { commandSuggestionsContainer } = elements;

	const items = Array.from(
		commandSuggestionsContainer.children
	) as HTMLDivElement[];
	// Remove 'active' class from all items
	items.forEach((item) => item.classList.remove("active"));

	// Add 'active' class to the item at the specified index and scroll into view
	if (index >= 0 && index < items.length) {
		items[index].classList.add("active");
		items[index].scrollIntoView({ block: "nearest" });
		console.log(`[Suggestions] Highlighted item at index: ${index}`);
	} else {
		console.log(
			`[Suggestions] Attempted to highlight invalid index: ${index}. No item highlighted.`
		);
	}
}

/**
 * Checks if the input text represents a complete Minovative command.
 * A command is considered complete if it matches exactly or is followed by a space.
 * @param text The current text in the chat input.
 * @returns True if the text is a complete command, false otherwise.
 */
export function isInputtingCompleteCommand(text: string): boolean {
	for (const cmd of MINOVATIVE_COMMANDS) {
		if (text.startsWith(cmd)) {
			// A command is complete if:
			// 1. The input text is exactly the command (e.g., "/plan")
			// 2. The command is followed by a space (e.g., "/plan ")
			if (text.length === cmd.length || text[cmd.length] === " ") {
				return true;
			}
		}
	}
	return false;
}

import { appState } from "../state/appState";
import { MINOVATIVE_COMMANDS } from "../../common/sidebarConstants"; // Corrected import path
import { RequiredDomElements } from "../types/webviewTypes"; // Import the type for DOM elements

/**
 * Displays command suggestions in the UI.
 * @param commands The list of commands to display.
 * @param elements DOM elements required for displaying suggestions.
 * @param setLoadingState A callback function to update the global loading state.
 */
export function showCommandSuggestions(
	commands: string[],
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	const { commandSuggestionsContainer, chatInputControlsWrapper } = elements;

	appState.filteredCommands = commands;
	commandSuggestionsContainer.innerHTML = "";
	appState.activeCommandIndex = -1;

	if (commands.length === 0) {
		const noMatchesItem = document.createElement("div");
		noMatchesItem.classList.add("command-item", "no-matches");
		noMatchesItem.textContent = "No matching commands";
		commandSuggestionsContainer.appendChild(noMatchesItem);
	} else {
		commands.forEach((command) => {
			const commandItem = document.createElement("div");
			commandItem.classList.add("command-item");
			commandItem.textContent = command;
			commandItem.dataset.command = command;
			commandItem.addEventListener("click", () => {
				selectCommand(command, elements, setLoadingState);
			});
			commandSuggestionsContainer.appendChild(commandItem);
		});
	}

	commandSuggestionsContainer.style.display = "flex";
	appState.isCommandSuggestionsVisible = true;
	setLoadingState(appState.isLoading, elements); // Call setLoadingState after updating visibility state

	chatInputControlsWrapper.style.zIndex = "100";
	console.log("[CommandSuggestions] Suggestions shown:", commands);
}

/**
 * Hides command suggestions from the UI.
 * @param elements DOM elements required for hiding suggestions.
 * @param setLoadingState A callback function to update the global loading state.
 */
export function hideCommandSuggestions(
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	const { commandSuggestionsContainer, chatInputControlsWrapper } = elements;

	appState.isCommandSuggestionsVisible = false;
	commandSuggestionsContainer.style.display = "none";
	setLoadingState(appState.isLoading, elements); // Call setLoadingState after updating visibility state

	commandSuggestionsContainer.innerHTML = ""; // Clear existing suggestions
	appState.activeCommandIndex = -1; // Reset active index
	appState.filteredCommands = []; // Clear filtered commands from state

	chatInputControlsWrapper.style.zIndex = ""; // Reset z-index
	console.log("[CommandSuggestions] Suggestions hidden.");
}

/**
 * Selects a command, populating the chat input and hiding suggestions.
 * @param command The command to select.
 * @param elements DOM elements required for accessing chat input and hiding suggestions.
 * @param setLoadingState A callback function to update the global loading state.
 */
export function selectCommand(
	command: string,
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	const { chatInput } = elements;

	chatInput.value = command + " ";
	chatInput.focus();
	// Set cursor to the end of the input field
	chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
	hideCommandSuggestions(elements, setLoadingState);
	console.log(`[CommandSuggestions] Command selected: ${command}`);
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
		console.log(`[CommandSuggestions] Highlighted command at index: ${index}`);
	} else {
		console.log(
			`[CommandSuggestions] Attempted to highlight invalid index: ${index}. No item highlighted.`
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

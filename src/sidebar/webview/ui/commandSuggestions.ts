import { appState } from "../state/appState";
import { MINOVATIVE_COMMANDS } from "../../common/sidebarConstants";
import { RequiredDomElements, SuggestionType } from "../types/webviewTypes";

/**
 * Filters and renders file suggestions based on the current search query.
 * @param elements DOM elements required for displaying suggestions.
 * @param setLoadingState A callback function to update the global loading state.
 */
function renderFileSuggestionsList(
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	const { commandSuggestionsContainer } = elements;

	// Clear existing suggestion items, preserving the search input wrapper if it exists
	Array.from(commandSuggestionsContainer.children).forEach((child) => {
		if (child.id !== "fileSearchInputWrapper") {
			child.remove();
		}
	});

	const query = appState.currentFileSearchQuery.toLowerCase();
	const filteredFiles = appState.allWorkspaceFiles.filter((file) =>
		file.toLowerCase().includes(query)
	);

	appState.filteredCommands = filteredFiles; // Update filteredCommands with file paths
	appState.activeCommandIndex = -1; // Reset active index for the new list

	if (filteredFiles.length === 0) {
		const noMatchesItem = document.createElement("div");
		noMatchesItem.classList.add("command-item", "no-matches");
		noMatchesItem.textContent = "No matching files";
		commandSuggestionsContainer.appendChild(noMatchesItem);
	} else {
		filteredFiles.forEach((suggestion) => {
			const suggestionItem = document.createElement("div");
			suggestionItem.classList.add("command-item");
			suggestionItem.textContent = suggestion;
			suggestionItem.dataset.suggestion = suggestion;
			suggestionItem.dataset.type = "file";
			suggestionItem.addEventListener("click", () => {
				selectSuggestion(suggestion, "file", elements, setLoadingState);
			});
			commandSuggestionsContainer.appendChild(suggestionItem);
		});
	}

	commandSuggestionsContainer.style.display = "flex";
	appState.isCommandSuggestionsVisible = true;
	setLoadingState(appState.isLoading, elements);
	console.log(
		`[Suggestions] File suggestions rendered. Query: "${query}", Matches: ${filteredFiles.length}`
	);
}

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

	appState.currentSuggestionType = type;
	// Clear existing suggestions for all types initially, but do not clear the file search input wrapper if it exists for type 'file'.
	if (type !== "file") {
		commandSuggestionsContainer.innerHTML = "";
	} else {
		// For 'file' type, ensure only suggestion items are cleared, not the search input wrapper.
		Array.from(commandSuggestionsContainer.children).forEach((child) => {
			if (child.id !== "fileSearchInputWrapper") {
				child.remove();
			}
		});
	}
	appState.activeCommandIndex = -1;

	if (type === "file") {
		let fileSearchInputWrapper =
			commandSuggestionsContainer.querySelector<HTMLDivElement>(
				"#fileSearchInputWrapper"
			);
		let fileSearchInput: HTMLInputElement;
		let escIndicator: HTMLSpanElement;

		if (!fileSearchInputWrapper) {
			// Create elements if they don't exist
			fileSearchInputWrapper = document.createElement("div");
			fileSearchInputWrapper.id = "fileSearchInputWrapper";
			fileSearchInputWrapper.classList.add("file-search-input-wrapper");

			fileSearchInput = document.createElement("input");
			fileSearchInput.id = "fileSearchInput";
			fileSearchInput.type = "text";
			fileSearchInput.placeholder = "Search files...";
			fileSearchInput.classList.add("file-search-input");

			escIndicator = document.createElement("span");
			escIndicator.classList.add("esc-indicator");
			escIndicator.textContent = "ESC";

			fileSearchInputWrapper.appendChild(fileSearchInput);
			fileSearchInputWrapper.appendChild(escIndicator);
			commandSuggestionsContainer.appendChild(fileSearchInputWrapper);

			// Attach event listeners only during initial creation
			fileSearchInput.addEventListener("input", () => {
				appState.currentFileSearchQuery = fileSearchInput.value;
				renderFileSuggestionsList(elements, setLoadingState);
			});

			fileSearchInput.addEventListener("keydown", (e) => {
				const numSuggestions = appState.filteredCommands.length;
				let currentActiveSuggestionIndex = appState.activeCommandIndex;

				if (e.key === "Escape") {
					e.preventDefault();
					hideSuggestions(elements, setLoadingState);
				} else if (e.key === "Tab") {
					e.preventDefault(); // Prevent default tab behavior
					if (numSuggestions === 0) {
						return;
					}

					if (e.shiftKey) {
						// Shift + Tab: navigate up
						currentActiveSuggestionIndex =
							(currentActiveSuggestionIndex - 1 + numSuggestions) %
							numSuggestions;
					} else {
						// Tab: navigate down
						currentActiveSuggestionIndex =
							(currentActiveSuggestionIndex + 1) % numSuggestions;
					}
					appState.activeCommandIndex = currentActiveSuggestionIndex;
					highlightCommand(currentActiveSuggestionIndex, elements);
				} else if (e.key === "Enter") {
					e.preventDefault(); // Prevent new line in textarea and form submission

					if (
						currentActiveSuggestionIndex !== -1 &&
						appState.currentSuggestionType === "file"
					) {
						const selectedSuggestion =
							appState.filteredCommands[currentActiveSuggestionIndex];
						selectSuggestion(
							selectedSuggestion,
							appState.currentSuggestionType,
							elements,
							setLoadingState
						);
					}
				}
			});
		} else {
			// Retrieve existing elements
			fileSearchInput = fileSearchInputWrapper.querySelector(
				"#fileSearchInput"
			) as HTMLInputElement;
			escIndicator = fileSearchInputWrapper.querySelector(
				".esc-indicator"
			) as HTMLSpanElement;

			// Ensure escIndicator's text content is correct
			escIndicator.textContent = "ESC";
		}

		// Always update value and focus
		fileSearchInput.value = appState.currentFileSearchQuery;
		fileSearchInput.focus();

		// Ensure searchInputWrapper is the first child
		if (
			commandSuggestionsContainer.firstChild !== fileSearchInputWrapper &&
			fileSearchInputWrapper.parentNode === commandSuggestionsContainer
		) {
			commandSuggestionsContainer.prepend(fileSearchInputWrapper);
		}

		commandSuggestionsContainer.style.display = "flex";
		appState.isCommandSuggestionsVisible = true;
		setLoadingState(appState.isLoading, elements);
		renderFileSuggestionsList(elements, setLoadingState);
	} else {
		// Set UI visibility and focus logic for "command" or other types
		commandSuggestionsContainer.style.display = "flex";
		appState.isCommandSuggestionsVisible = true;
		setLoadingState(appState.isLoading, elements);

		// type === "command" or other types, use the provided 'suggestions' list
		appState.filteredCommands = suggestions; // 'filteredCommands' now holds generic suggestions for commands

		if (suggestions.length === 0) {
			const noMatchesItem = document.createElement("div");
			noMatchesItem.classList.add("command-item", "no-matches");
			let noMatchesText = "No matches";
			if (type === "command") {
				noMatchesText = "No matching commands";
			}
			noMatchesItem.textContent = noMatchesText;
			commandSuggestionsContainer.appendChild(noMatchesItem);
		} else {
			suggestions.forEach((suggestion) => {
				const suggestionItem = document.createElement("div");
				suggestionItem.classList.add("command-item");
				suggestionItem.textContent = suggestion;
				suggestionItem.dataset.suggestion = suggestion;
				suggestionItem.dataset.type = type;
				suggestionItem.addEventListener("click", () => {
					selectSuggestion(suggestion, type, elements, setLoadingState);
				});
				commandSuggestionsContainer.appendChild(suggestionItem);
			});
		}
	}

	chatInputControlsWrapper.style.zIndex = "100";
	// Log the actual filtered suggestions from appState, which is the source of truth for rendered items.
	console.log(
		`[Suggestions] Suggestions shown (${type}):`,
		appState.filteredCommands
	);
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
	appState.currentFileSearchQuery = ""; // Reset file search query
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

	if (type === "file") {
		const cursorPosition = chatInput.selectionStart ?? 0;
		const currentValue = chatInput.value;
		const insertedText = `\`${suggestion}\``;

		const newValue =
			currentValue.substring(0, cursorPosition) +
			insertedText +
			currentValue.substring(cursorPosition);

		chatInput.value = newValue;
		const newCursorPosition = cursorPosition + insertedText.length;
		chatInput.setSelectionRange(newCursorPosition, newCursorPosition);

		chatInput.focus();
		hideSuggestions(elements, setLoadingState);
		console.log(`[Suggestions] Suggestion selected (${type}): ${suggestion}`);
	} else if (type === "command") {
		// Existing logic for command selection
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

	// The 'fileSearchInputWrapper' is now a direct child. We need to get the actual command items.
	const items = Array.from(commandSuggestionsContainer.children);

	// Filter out the fileSearchInputWrapper if it exists, and any non-suggestion items.
	// Suggestion items will have the class "command-item".
	const actualSuggestionItems = items.filter(
		(item) =>
			item.id !== "fileSearchInputWrapper" &&
			item.classList.contains("command-item")
	) as HTMLDivElement[];

	// Remove 'active' class from all (actual) suggestion items
	actualSuggestionItems.forEach((item) => item.classList.remove("active"));

	// Add 'active' class to the item at the specified index and scroll into view
	if (index >= 0 && index < actualSuggestionItems.length) {
		actualSuggestionItems[index].classList.add("active");
		actualSuggestionItems[index].scrollIntoView({ block: "nearest" });
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

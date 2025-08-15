import { sendMessage } from "../messageSender";
import { postMessageToExtension } from "../utils/vscodeApi";
import {
	showSuggestions, // Renamed from showCommandSuggestions
	hideSuggestions, // Renamed from hideCommandSuggestions
	selectSuggestion, // Renamed from selectCommand
	highlightCommand,
	isInputtingCompleteCommand,
} from "../ui/commandSuggestions";
import { updateStatus } from "../ui/statusManager";
import { MINOVATIVE_COMMANDS } from "../../common/sidebarConstants";
import { appState } from "../state/appState";
import { RequiredDomElements } from "../types/webviewTypes";
import {
	readFileAsBase64,
	displayImagePreview,
	clearImagePreviews,
} from "../utils/imageUtils";
import {
	appendMessage,
	sendEditedMessageToExtension,
} from "../ui/chatMessageRenderer";
import { startTypingAnimation } from "../ui/typingAnimation";

/**
 * Initializes all event listeners related to the chat input field and command suggestions,
 * and now also image file uploads.
 * @param elements The necessary DOM elements, encapsulated in RequiredDomElements.
 * @param setLoadingState A callback function to update the global loading state in the main application.
 */
export function initializeInputEventListeners(
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	const { chatInput } = elements;
	// Assuming these elements are now part of RequiredDomElements for compilation
	// If not, a TypeScript error will occur here, implying that RequiredDomElements needs to be updated.
	// Also assuming appState.selectedImages is an array of { file: File, mimeType: string, data: string, previewElement: HTMLElement }
	// If not, a TypeScript error will occur here, implying that WebviewAppState needs to be updated.
	const imageUploadInput = elements.imageUploadInput;
	const clearImagesButton = elements.clearImagesButton;
	const imagePreviewsContainer = elements.imagePreviewsContainer!; // Use non-null assertion as per instruction to address diagnostic

	if (!chatInput) {
		console.error(
			"Chat input element not found. Cannot initialize input event listeners."
		);
		return;
	}
	if (!imageUploadInput || !clearImagesButton || !imagePreviewsContainer) {
		console.error(
			"Image upload related DOM elements not found. Cannot initialize image upload event listeners."
		);
		return;
	}
	// commandSuggestionsContainer and chatInputControlsWrapper are accessed via elements object now.

	/**
	 * Clears the editing state, hiding the cancel button and resetting the input field.
	 * @param els The necessary DOM elements.
	 * @param shouldRefocus Optional boolean to control if the chat input should regain focus. Defaults to true.
	 */
	const clearEditingState = (
		els: RequiredDomElements,
		shouldRefocus: boolean = true
	) => {
		console.log("[inputEventHandlers] Clearing editing state.");
		appState.isEditingMessage = false;
		appState.editingMessageIndex = null;
		els.chatInput.value = "";
		if (els.cancelEditButton) {
			// Added null check
			els.cancelEditButton.style.display = "none"; // Hide cancel button
		}
		els.chatInputControlsWrapper.classList.remove("editing-mode-active"); // Remove editing mode visual
		if (els.editMessageHelpText) {
			// Added null check
			els.editMessageHelpText.style.display = "none"; // Hide help text
		}
		if (shouldRefocus) {
			els.chatInput.focus(); // Return focus to input
		}
	};

	// Add event listener to cancelEditButton
	if (elements.cancelEditButton) {
		elements.cancelEditButton.addEventListener("click", () => {
			clearEditingState(elements);
		});
	}

	// Event listener for input changes in the chat input field (for command suggestions)
	chatInput.addEventListener("input", () => {
		const text = chatInput.value;

		// 1. Declare local flags:
		let commandSuggestionsActive = false;
		let fileSuggestionsActive = false;

		// 2. Command Suggestion Handling:
		if (text.startsWith("/")) {
			if (!isInputtingCompleteCommand(text)) {
				const commandQuery = text.substring(1).toLowerCase();
				const matches = MINOVATIVE_COMMANDS.filter((cmd: string) =>
					cmd.toLowerCase().includes(commandQuery)
				);
				showSuggestions(matches, "command", elements, setLoadingState);
				commandSuggestionsActive = true;
			} else {
				// If it's a complete command, hide command suggestions.
				// Crucially, do not return; allow execution to proceed to file suggestion handling.
				hideSuggestions(elements, setLoadingState);
				commandSuggestionsActive = false;
			}
		} else {
			// If the input does NOT start with '/', hide command suggestions.
			hideSuggestions(elements, setLoadingState);
			commandSuggestionsActive = false;
		}

		// 3. File Suggestion Handling:
		// This section must execute independently of the command block, after command processing.
		const currentInputText = chatInput.value;
		const lastAtSymbolIndex = currentInputText.lastIndexOf("@");

		let isAtTriggerValid = false;
		let queryPart = "";
		if (
			lastAtSymbolIndex !== -1 &&
			currentInputText.length > lastAtSymbolIndex + 1 &&
			currentInputText[lastAtSymbolIndex + 1] !== " "
		) {
			const textBeforeAt = currentInputText.substring(0, lastAtSymbolIndex);
			const backtickCountBeforeAt = (textBeforeAt.match(/`/g) || []).length;

			if (backtickCountBeforeAt % 2 === 0) {
				// Even backticks means it's not inside a code block
				queryPart = currentInputText
					.substring(lastAtSymbolIndex + 1)
					.trim()
					.toLowerCase();
				if (queryPart.length > 0) {
					// Only valid if there's a non-empty query part after '@'
					isAtTriggerValid = true;
				}
			}
		}

		if (isAtTriggerValid) {
			if (
				appState.allWorkspaceFiles.length === 0 &&
				!appState.isRequestingWorkspaceFiles
			) {
				appState.isRequestingWorkspaceFiles = true;
				postMessageToExtension({ type: "requestWorkspaceFiles" });
				showSuggestions([], "loading", elements, setLoadingState);
				fileSuggestionsActive = true;
			} else {
				const filteredFiles = appState.allWorkspaceFiles.filter((file) =>
					file.toLowerCase().includes(queryPart)
				);
				showSuggestions(filteredFiles, "file", elements, setLoadingState);
				fileSuggestionsActive = true;
			}
		}

		// 4. Final Conditional Hiding:
		if (!commandSuggestionsActive && !fileSuggestionsActive) {
			hideSuggestions(elements, setLoadingState);
		}
	});

	// Event listener for keydown events in the chat input field
	chatInput.addEventListener("keydown", (e) => {
		const isCommandOrFileSuggestionsCurrentlyVisible =
			appState.isCommandSuggestionsVisible;
		const currentFilteredSuggestions = appState.filteredCommands; // Renamed to be more generic
		let currentActiveSuggestionIndex = appState.activeCommandIndex; // Renamed to be more generic

		// If suggestions are not visible, handle Enter key for sending messages
		if (!isCommandOrFileSuggestionsCurrentlyVisible) {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault(); // Prevent new line in textarea

				if (appState.isEditingMessage) {
					console.log("Chat input Enter key pressed (editing message).");
					const newContent = chatInput.value.trim();
					// 1. Before the 'clearEditingState(elements);' call, add the following line to capture the current index:
					const originalEditingIndex = appState.editingMessageIndex;

					// 2. Update the validation condition
					if (
						newContent &&
						originalEditingIndex !== null &&
						originalEditingIndex >= 0
					) {
						clearEditingState(elements); // Resets input, hides cancel button etc.

						// Visually update the message element in the DOM (handled by subsequent message processing)
						// Find the message element being edited
						// 3. Update the 'editedMessageElement' query selector
						const editedMessageElement = elements.chatContainer.querySelector(
							`.message[data-message-index="${originalEditingIndex}"]`
						) as HTMLElement | null;

						if (editedMessageElement) {
							// Remove subsequent messages
							let nextSibling = editedMessageElement.nextElementSibling;
							while (nextSibling) {
								const toRemove = nextSibling;
								nextSibling = toRemove.nextElementSibling; // Get next before removing
								toRemove.remove();
							}
							elements.chatContainer.scrollTop =
								elements.chatContainer.scrollHeight; // Scroll to bottom after clearing
						} else {
							// 4. Update the 'console.warn' message
							console.warn(
								`Edited message element for index ${originalEditingIndex} not found. Subsequent messages might not be cleared.`
							);
						}

						// Append a loading indicator
						appendMessage(
							elements,
							"Model",
							"",
							"ai-message loading-message",
							false
						);

						// Call typing animation
						startTypingAnimation(elements);

						// Set global loading state to true
						setLoadingState(true, elements);

						// Call the refactored sendEditedMessageToExtension
						// 5. Update the call to 'sendEditedMessageToExtension'
						sendEditedMessageToExtension(
							elements,
							originalEditingIndex,
							newContent
						);
					} else {
						console.warn(
							"Attempted to send edited message without valid content or index. Reverting edit."
						);
						updateStatus(
							elements,
							"Please enter content for the edited message.",
							true
						);
						clearEditingState(elements); // Clean up editing state on validation failure
					}
				} else {
					// If appState.isEditingMessage is false, proceed with the existing new message sending logic
					console.log(
						"Chat input Enter key pressed (no suggestions visible, new message)."
					);
					sendMessage(elements, setLoadingState);
				}
			}
			return; // No further suggestion handling needed if not visible
		}

		// Handle key presses when suggestions ARE visible
		if (currentFilteredSuggestions.length === 0) {
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

		const numSuggestions = currentFilteredSuggestions.length; // Renamed to be more generic

		if (e.key === "ArrowDown") {
			e.preventDefault(); // Prevent cursor movement in textarea
			currentActiveSuggestionIndex =
				(currentActiveSuggestionIndex + 1) % numSuggestions;
			appState.activeCommandIndex = currentActiveSuggestionIndex; // Update the state
			highlightCommand(currentActiveSuggestionIndex, elements);
		} else if (e.key === "ArrowUp") {
			e.preventDefault(); // Prevent cursor movement in textarea
			currentActiveSuggestionIndex =
				(currentActiveSuggestionIndex - 1 + numSuggestions) % numSuggestions;
			appState.activeCommandIndex = currentActiveSuggestionIndex; // Update the state
			highlightCommand(currentActiveSuggestionIndex, elements);
		} else if (e.key === "Enter") {
			e.preventDefault(); // Prevent new line in textarea and form submission

			if (
				currentActiveSuggestionIndex !== -1 &&
				appState.currentSuggestionType
			) {
				// Select the highlighted suggestion based on its type
				const selectedSuggestion =
					currentFilteredSuggestions[currentActiveSuggestionIndex];
				selectSuggestion(
					selectedSuggestion,
					appState.currentSuggestionType, // Pass the type
					elements,
					setLoadingState
				); // Corrected call: parameter order
			} else {
				console.log(
					"Enter pressed with suggestions visible but no suggestion highlighted or type unknown. Not sending message."
				);
			}
		} else if (e.key === "Escape") {
			e.preventDefault(); // Prevent default browser behavior (e.g., closing popups)
			// Hide suggestions
			hideSuggestions(elements, setLoadingState); // Renamed call
		}
	});

	// Blur event listener for the chat input field
	// Use a small timeout to allow click events on command suggestions to fire first,
	// before the blur event hides the suggestions. This prevents the suggestions from
	// disappearing before a click registers on them.
	chatInput.addEventListener("blur", () => {
		setTimeout(() => {
			if (!chatInput) {
				return;
			}

			if (appState.isEditingMessage) {
				clearEditingState(elements, false);
				console.log("Message edit cancelled due to blur.");
			}

			// Capture the state of currentSuggestionType at the beginning of this blur event processing.
			const originalSuggestionType = appState.currentSuggestionType;

			// Condition to NOT hide suggestions:
			// If suggestions are currently visible AND the current suggestion type is 'file'
			// AND the chat input value still starts with '@'
			const shouldKeepFileSuggestionsVisible =
				appState.isCommandSuggestionsVisible &&
				originalSuggestionType === "file" &&
				chatInput.value.includes("@"); // Changed from startsWith('@') to includes('@') for more robust blur behavior

			if (shouldKeepFileSuggestionsVisible) {
				// Do NOT hide suggestions as per instruction.
				console.log("[Blur] Keeping file suggestions visible due to @ input.");
			} else {
				// Otherwise, call hideSuggestions.
				console.log("[Blur] Hiding suggestions as per general rule.");
				hideSuggestions(elements, setLoadingState);
				// Note: hideSuggestions internally sets appState.currentSuggestionType to 'none'.
			}

			// Additionally, if the input no longer contains '@' and the current suggestion type *was* 'file',
			// reset appState.currentSuggestionType to 'none'.
			// This handles cases where file suggestions might have been active, and the '@' was removed,
			// requiring a state cleanup even if `hideSuggestions` wasn't called by the main branch (which it would be).
			// This explicitly follows the instruction for robustness.
			if (
				!chatInput.value.includes("@") && // Changed from startsWith('@') to includes('@') for consistency
				originalSuggestionType === "file"
			) {
				console.log(
					"[Blur] Additional cleanup: Resetting currentSuggestionType from 'file' to 'none' as @ removed."
				);
				appState.currentSuggestionType = "none";
			}
		}, 150); // 150ms delay to allow click event to propagate
	});

	// Event listener for image file selection
	imageUploadInput.addEventListener("change", async (event: Event) => {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) {
			console.log("No files selected.");
			// Clear existing previews if input becomes empty (e.g., user cancels file selection)
			clearImagePreviews(imagePreviewsContainer);
			appState.selectedImages = [];
			input.value = ""; // Reset the input value so selecting the same file again triggers 'change'
			clearImagesButton.style.display = "none";
			setLoadingState(appState.isLoading, elements); // Call after clearing images to update preview area visibility
			return;
		}

		const files = Array.from(input.files);

		// Clear any previously selected images and state
		clearImagePreviews(imagePreviewsContainer);
		appState.selectedImages = [];

		for (const file of files) {
			try {
				const base64Data = await readFileAsBase64(file);
				const mimeType = file.type;

				const removeImageCallback = (elToRemove: HTMLDivElement) => {
					// Remove from appState.selectedImages
					appState.selectedImages = appState.selectedImages.filter(
						(img) => img.previewElement !== elToRemove
					);
					// Remove from DOM
					elToRemove.remove();
					elements.imageUploadInput.value = ""; // Reset the input value after an image is removed
					setLoadingState(appState.isLoading, elements); // CRITICAL REQ: Call after removal
					// Update button visibility
					clearImagesButton.style.display =
						appState.selectedImages.length > 0 ? "inline-flex" : "none";
				};

				const previewElement = displayImagePreview(
					file,
					imagePreviewsContainer,
					removeImageCallback
				);

				// Push file, mimeType, data, and previewElement into appState.selectedImages
				appState.selectedImages.push({
					file: file,
					mimeType: mimeType,
					data: base64Data.data,
					previewElement: previewElement, // Store reference to the DOM element for easy removal
				});
			} catch (error) {
				console.error(`Error reading or displaying file ${file.name}:`, error);
				// Optionally display an error message to the user
			}
		}

		// CRITICAL REQ: Call after the loop to update the overall image preview area visibility
		setLoadingState(appState.isLoading, elements);
		// Show clearImagesButton if images are selected, otherwise hide it.
		clearImagesButton.style.display =
			appState.selectedImages.length > 0 ? "inline-flex" : "none";
	});

	// PASTE EVENT LISTENER FOR CHAT INPUT
	elements.chatInput.addEventListener(
		"paste",
		async (event: ClipboardEvent) => {
			const clipboardItems = event.clipboardData?.items;
			if (!clipboardItems) {
				return;
			}

			let imageFile: File | null = null;

			for (let i = 0; i < clipboardItems.length; i++) {
				const item = clipboardItems[i];
				if (item.kind === "file" && item.type.startsWith("image/")) {
					const file = item.getAsFile();
					if (file) {
						imageFile = file;
						event.preventDefault(); // Stop default paste behavior for images
						break; // Only handle the first image found
					}
				}
			}

			if (imageFile) {
				// Clear any previously selected images and state
				clearImagePreviews(imagePreviewsContainer);
				appState.selectedImages = [];
				elements.imageUploadInput.value = ""; // Clear the file input for consistency

				const removeImageCallback = (elToRemove: HTMLDivElement) => {
					// Remove from appState.selectedImages
					appState.selectedImages = appState.selectedImages.filter(
						(img) => img.previewElement !== elToRemove
					);
					// Remove from DOM
					elToRemove.remove();
					elements.imageUploadInput.value = ""; // Reset the input value after an image is removed
					setLoadingState(appState.isLoading, elements); // CRITICAL REQ: Call after removal
					// Update button visibility
					clearImagesButton.style.display =
						appState.selectedImages.length > 0 ? "inline-flex" : "none";
				};

				try {
					const base64Data = await readFileAsBase64(imageFile);
					const mimeType = imageFile.type;

					const previewElement = displayImagePreview(
						imageFile,
						imagePreviewsContainer,
						removeImageCallback
					);

					appState.selectedImages.push({
						file: imageFile,
						mimeType: mimeType,
						data: base64Data.data,
						previewElement: previewElement,
					});

					elements.clearImagesButton.style.display = "inline-flex";
					setLoadingState(appState.isLoading, elements); // Update UI after successful image paste
				} catch (error) {
					console.error("Error processing pasted image:", error);
					updateStatus(
						elements,
						"Failed to paste image. Please try again.",
						true
					);
					// Reset the image state to prevent partial uploads
					clearImagePreviews(imagePreviewsContainer);
					appState.selectedImages = [];
					elements.imageUploadInput.value = "";
					elements.clearImagesButton.style.display = "none";
					setLoadingState(appState.isLoading, elements); // Update UI after error
				}
			} else {
				return; // No image file found in clipboard
			}
		}
	);
}

import {
	faCheck,
	faTimes,
	faRedo,
	faStop,
	faCopy,
	faTrashCan,
	faPaperPlane,
	faFloppyDisk,
	faFolderOpen,
	faChevronLeft,
	faChevronRight,
	faPlus,
} from "@fortawesome/free-solid-svg-icons";
import { setIconForButton } from "../utils/iconHelpers";
import { postMessageToExtension } from "../utils/vscodeApi";
import { updateStatus, updateApiKeyStatus } from "../ui/statusManager";
import { appState } from "../state/appState";
import { sendMessage } from "../messageSender";
import { appendMessage } from "../ui/chatMessageRenderer";
import {
	hideCommitReviewUI,
	hidePlanParseErrorUI,
	// createPlanConfirmationUI, // This function creates the UI and attaches internal confirmation event listeners - not used directly here
} from "../ui/confirmationAndReviewUIs";
import { stopTypingAnimation } from "../ui/typingAnimation";
import { RequiredDomElements } from "../types/webviewTypes"; // Correct import path

/**
 * Initializes all button and interactive element event listeners in the webview.
 * @param elements An object containing all required DOM elements.
 * @param setLoadingState A callback function to update the global loading state.
 */
export function initializeButtonEventListeners(
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	const {
		sendButton,
		modelSelect,
		addKeyButton,
		addKeyInput,
		prevKeyButton,
		nextKeyButton,
		deleteKeyButton,
		clearChatButton,
		saveChatButton,
		loadChatButton,
		retryGenerationButton,
		cancelParseErrorButton,
		commitMessageTextarea,
		confirmCommitButton,
		cancelCommitButton,
		signUpButton,
		signInButton,
		cancelGenerationButton,
		chatContainer,
		// planParseErrorContainer, // Handled by hidePlanParseErrorUI
		// planParseErrorDisplay,   // Handled by hidePlanParseErrorUI
		// failedJsonDisplay,       // Handled by hidePlanParseErrorUI
		// commitReviewContainer,   // Handled by hideCommitReviewUI
	} = elements;

	// Initial icon setup for buttons
	setIconForButton(sendButton, faPaperPlane);
	setIconForButton(saveChatButton, faFloppyDisk);
	setIconForButton(loadChatButton, faFolderOpen);
	setIconForButton(clearChatButton, faTrashCan);
	setIconForButton(prevKeyButton, faChevronLeft);
	setIconForButton(nextKeyButton, faChevronRight);
	setIconForButton(deleteKeyButton, faTrashCan);
	setIconForButton(addKeyButton, faPlus);
	setIconForButton(retryGenerationButton, faRedo);
	setIconForButton(cancelParseErrorButton, faTimes);
	setIconForButton(cancelGenerationButton, faStop);
	setIconForButton(confirmCommitButton, faCheck);
	setIconForButton(cancelCommitButton, faTimes);
	// `createPlanConfirmationUI` is called during webview initialization (e.g., in main.ts)
	// and it handles its own button icon setup internally.

	// Send Button
	sendButton.addEventListener("click", () => {
		console.log("Send button clicked.");
		// sendMessage now takes elements and setLoadingState as parameters for consistency
		sendMessage(elements, setLoadingState);
	});

	// Model Select
	modelSelect.addEventListener("change", () => {
		const selectedModel = modelSelect.value;
		postMessageToExtension({ type: "selectModel", value: selectedModel });
		updateStatus(elements, `Requesting switch to model: ${selectedModel}...`); // Pass elements
	});

	// Add API Key Button
	addKeyButton.addEventListener("click", () => {
		const apiKey = addKeyInput.value.trim();
		if (apiKey) {
			postMessageToExtension({ type: "addApiKey", value: apiKey });
			addKeyInput.value = "";
			updateApiKeyStatus(elements, "Adding key..."); // Pass elements
		} else {
			updateApiKeyStatus(elements, "Error: Please enter an API key to add."); // Pass elements
		}
	});

	// Add Key Input (Enter key)
	addKeyInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			addKeyButton.click();
		}
	});

	// Previous Key Button
	prevKeyButton.addEventListener("click", () => {
		postMessageToExtension({ type: "switchToPrevKey" });
		updateApiKeyStatus(elements, "Switching key..."); // Pass elements
	});

	// Next Key Button
	nextKeyButton.addEventListener("click", () => {
		postMessageToExtension({ type: "switchToNextKey" });
		updateApiKeyStatus(elements, "Switching key..."); // Pass elements
	});

	// Delete Key Button
	deleteKeyButton.addEventListener("click", () => {
		postMessageToExtension({ type: "requestDeleteConfirmation" });
		updateApiKeyStatus(elements, "Waiting for delete confirmation..."); // Pass elements
	});

	// Clear Chat Button
	clearChatButton.addEventListener("click", () => {
		console.log("Clear Chat button clicked.");
		postMessageToExtension({ type: "clearChatRequest" });
	});

	// Save Chat Button
	saveChatButton.addEventListener("click", () => {
		console.log("Save Chat button clicked.");
		postMessageToExtension({ type: "saveChatRequest" });
		updateStatus(elements, "Requesting chat save..."); // Pass elements
	});

	// Load Chat Button
	loadChatButton.addEventListener("click", () => {
		console.log("Load Chat button clicked.");
		postMessageToExtension({ type: "loadChatRequest" });
		updateStatus(elements, "Requesting chat load..."); // Pass elements
	});

	// Retry Generation Button (for plan parse error)
	retryGenerationButton.addEventListener("click", () => {
		console.log("Retry Generation button clicked.");
		// The hidePlanParseErrorUI function already handles setting display: none and clearing content
		hidePlanParseErrorUI(elements);
		postMessageToExtension({ type: "retryStructuredPlanGeneration" });
		setLoadingState(true, elements);
		updateStatus(elements, "Retrying structured plan generation..."); // Pass elements
	});

	// Cancel Parse Error Button
	cancelParseErrorButton.addEventListener("click", () => {
		console.log("Cancel Parse Error button clicked.");
		// The hidePlanParseErrorUI function already handles setting display: none and clearing content
		hidePlanParseErrorUI(elements);
		postMessageToExtension({ type: "cancelPlanExecution" });
		updateStatus(elements, "Plan generation retry cancelled."); // Pass elements
		setLoadingState(false, elements);
	});

	// Commit Review UI - Commit Message Textarea input listener (for button state)
	commitMessageTextarea.addEventListener("input", () => {
		if (confirmCommitButton) {
			const trimmedMessage = commitMessageTextarea.value.trim();
			confirmCommitButton.disabled = trimmedMessage === "";
		}
	});

	// Confirm Commit Button
	confirmCommitButton.addEventListener("click", () => {
		console.log("Confirm Commit button clicked.");
		hideCommitReviewUI(elements); // Use the helper to hide UI elements
		const editedMessage = commitMessageTextarea.value || "";
		postMessageToExtension({ type: "confirmCommit", value: editedMessage });
		updateStatus(elements, "Committing changes...", false); // Pass elements
		setLoadingState(true, elements);
	});

	// Cancel Commit Button
	cancelCommitButton.addEventListener("click", () => {
		console.log("Cancel Commit button clicked.");
		hideCommitReviewUI(elements); // Use the helper to hide UI elements
		postMessageToExtension({ type: "cancelCommit" });
		updateStatus(elements, "Commit cancelled by user.", false); // Pass elements
		setLoadingState(false, elements);
	});

	// Sign Up Button
	signUpButton.addEventListener("click", () => {
		console.log(
			"[buttonEventHandlers] Sign Up button clicked. Posting openExternalLink message."
		);
		postMessageToExtension({
			type: "openExternalLink",
			url: "https://www.minovativemind.dev/registration/signin",
		});
	});

	// Sign In Button
	signInButton.addEventListener("click", () => {
		console.log(
			"[buttonEventHandlers] Sign In button clicked. Posting openSettingsPanel message."
		);
		postMessageToExtension({
			type: "openSettingsPanel",
			panelId: "minovativeMindSidebarViewSettings",
		});
	});

	// Cancel Generation Button
	cancelGenerationButton.addEventListener("click", () => {
		console.log("Cancel Generation button clicked.");
		postMessageToExtension({ type: "cancelGeneration" });
		updateStatus(elements, "Cancelling operation..."); // Pass elements
		// After cancelling, immediately disable the button and set loading to false.
		// The `reenableInput` message from the extension might also do this, but
		// a quick UI response is good.
		setLoadingState(false, elements); // This will hide the cancel button itself too
		stopTypingAnimation(); // Ensure typing animation stops
		// Clear any current streaming message content if it was interrupted
		if (appState.currentAiMessageContentElement) {
			appState.currentAccumulatedText += appState.typingBuffer;
			// Simple text content as markdown rendering might be incomplete
			appState.currentAiMessageContentElement.textContent =
				appState.currentAccumulatedText;
			appState.currentAiMessageContentElement = null;
			appState.typingBuffer = "";
			appState.currentAccumulatedText = "";
		}
	});

	// Chat Container (for message actions: copy, delete, open file)
	chatContainer.addEventListener("click", async (event) => {
		const target = event.target as HTMLElement;
		const copyButton = target.closest(
			".copy-button"
		) as HTMLButtonElement | null;
		const deleteButton = target.closest(
			".delete-button"
		) as HTMLButtonElement | null;
		const fileItem = target.closest(
			".context-file-item[data-filepath]"
		) as HTMLLIElement | null;

		if (fileItem) {
			event.preventDefault();
			const filePath = fileItem.dataset.filepath;
			if (filePath) {
				postMessageToExtension({ type: "openFile", value: filePath });
				updateStatus(elements, `Opening file: ${filePath}`); // Pass elements
			}
			return;
		}

		if (copyButton && !copyButton.disabled) {
			const messageElement = copyButton.closest(".message");
			if (messageElement) {
				const textElement = messageElement.querySelector(
					".message-text-content"
				) as HTMLSpanElement | null;

				if (textElement) {
					const textToCopyHTML = textElement.innerHTML;

					// Create a temporary div to parse HTML and extract text, handling newlines
					const tempDiv = document.createElement("div");
					tempDiv.innerHTML = textToCopyHTML;

					// Add newlines before block-level elements for better copy-paste
					Array.from(
						tempDiv.querySelectorAll(
							"p, pre, ul, ol, li, div, br, h1, h2, h3, h4, h5, h6, blockquote, table, tr"
						)
					).forEach((el) => {
						if (el.tagName === "BR") {
							el.replaceWith("\n");
						} else if (el.tagName === "LI") {
							// Ensure new line before each list item, except the first one
							if (el.previousElementSibling) {
								el.prepend("\n");
							}
						} else {
							// Append newline to other block elements
							el.append("\n");
						}
					});

					let textToCopy = tempDiv.textContent || tempDiv.innerText || "";
					// Clean up excessive newlines and trim
					textToCopy = textToCopy.replace(/\n{3,}/g, "\n\n"); // Reduce 3+ newlines to 2
					textToCopy = textToCopy.replace(/^\n+/, ""); // Remove leading newlines
					textToCopy = textToCopy.replace(/\n+$/, ""); // Remove trailing newlines
					textToCopy = textToCopy.trim(); // Final trim

					textToCopy = textToCopy.replace(/\n\s*\n/g, "\n\n"); // Clean up blank lines

					try {
						await navigator.clipboard.writeText(textToCopy);
						console.log("Text copied to clipboard.");

						const originalIconHTML = copyButton.innerHTML;
						setIconForButton(copyButton, faCheck);
						copyButton.title = "Copied!";

						setTimeout(() => {
							copyButton.innerHTML = originalIconHTML;
							copyButton.title = "Copy Message";
						}, 1500);
					} catch (err) {
						console.error("Failed to copy text: ", err);
						let errorMessage = "Failed to copy text.";
						if (err instanceof Error && err.message) {
							errorMessage += ` Details: ${err.message}`;
						}
						updateStatus(elements, errorMessage, true); // Pass elements
					}
				} else {
					console.warn("Could not find text span for copy button.");
					updateStatus(elements, "Error: Could not find text to copy.", true); // Pass elements
				}
			} else {
				console.warn(
					"Copy button clicked, but parent message element not found."
				);
			}
		} else if (deleteButton && !deleteButton.disabled) {
			const messageElementToDelete = deleteButton.closest(
				".message[data-is-history='true']"
			);
			if (messageElementToDelete) {
				// Find all history messages to determine the index
				const allHistoryMessages = Array.from(
					chatContainer.querySelectorAll(".message[data-is-history='true']")
				);
				const messageIndex = allHistoryMessages.indexOf(messageElementToDelete);

				if (messageIndex !== -1) {
					postMessageToExtension({
						type: "deleteSpecificMessage",
						messageIndex: messageIndex,
					});
					updateStatus(elements, "Requesting message deletion..."); // Pass elements
				} else {
					console.warn(
						"Could not find index of history message to delete (after data-is-history filter)."
					);
				}
			} else {
				console.warn(
					"Delete button clicked, but target is not a history-backed message."
				);
			}
		}
	});

	// `createPlanConfirmationUI` should be called once as part of the overall webview initialization
	// (e.g., in `main.ts`'s `initializeWebview` function). It internally handles its own event listeners.
	// Its inclusion in the imports list for `buttonEventHandlers` mainly signifies that this module
	// is aware of its existence and its role in the UI, even if this module doesn't directly call it
	// for initial setup of the element itself, only interacts with it (e.g. `hidePlanConfirmationUI`).
}

// Note: `updateEmptyChatPlaceholderVisibility` is also imported but not directly called here,
// as its primary use is within message rendering and overall state updates.
// `showCommitReviewUI` and `showPlanParseErrorUI` are also imported but not used directly here;
// their counterparts `hideCommitReviewUI` and `hidePlanParseErrorUI` are used.
// The `sendMessage` function is passed `elements` and `setLoadingState` because it needs
// access to DOM elements and the loading state setter.

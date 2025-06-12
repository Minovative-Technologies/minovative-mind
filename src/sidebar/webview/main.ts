// --- Font Awesome Imports ---
import { library, icon } from "@fortawesome/fontawesome-svg-core";
import {
	faPaperPlane,
	faFloppyDisk,
	faFolderOpen,
	faTrashCan,
	faChevronLeft,
	faChevronRight,
	faPlus,
	faCheck,
	faTimes,
	faRedo,
	faStop,
	faCopy,
	faExclamationTriangle,
} from "@fortawesome/free-solid-svg-icons";
import MarkdownIt from "markdown-it";

library.add(
	faPaperPlane,
	faFloppyDisk,
	faFolderOpen,
	faTrashCan,
	faChevronLeft,
	faChevronRight,
	faPlus,
	faCheck,
	faTimes,
	faRedo,
	faStop,
	faCopy,
	faExclamationTriangle
);
// --- End Font Awesome Imports ---

interface VsCodeApi {
	postMessage(message: any): void;
	getState(): any;
	setState(newState: any): void;
}
declare const acquireVsCodeApi: () => VsCodeApi;
const vscode = acquireVsCodeApi();

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

// --- Global variables for streaming responses ---
let currentAiMessageContentElement: HTMLSpanElement | null = null;
let currentAccumulatedText: string = "";
let typingBuffer: string = "";
let typingTimer: NodeJS.Timeout | null = null;
const TYPING_SPEED_MS: number = 0;
const CHARS_PER_INTERVAL: number = 5;
// --- End Global variables for streaming responses ---

// --- DOM Elements ---
const sendButton = document.getElementById(
	"send-button"
) as HTMLButtonElement | null;
const chatInput = document.getElementById(
	"chat-input"
) as HTMLTextAreaElement | null;
const chatContainer = document.getElementById(
	"chat-container"
) as HTMLDivElement | null;
const modelSelect = document.getElementById(
	"model-select"
) as HTMLSelectElement | null;
const addKeyInput = document.getElementById(
	"add-key-input"
) as HTMLInputElement | null;
const addKeyButton = document.getElementById(
	"add-key-button"
) as HTMLButtonElement | null;
const prevKeyButton = document.getElementById(
	"prev-key-button"
) as HTMLButtonElement | null;
const nextKeyButton = document.getElementById(
	"next-key-button"
) as HTMLButtonElement | null;
const deleteKeyButton = document.getElementById(
	"delete-key-button"
) as HTMLButtonElement | null;
const currentKeyDisplay = document.getElementById(
	"current-key-display"
) as HTMLSpanElement | null;
const apiKeyStatusDiv = document.getElementById(
	"api-key-status"
) as HTMLDivElement | null;
const saveChatButton = document.getElementById(
	"save-chat-button"
) as HTMLButtonElement | null;
const loadChatButton = document.getElementById(
	"load-chat-button"
) as HTMLButtonElement | null;
const clearChatButton = document.getElementById(
	"clear-chat-button"
) as HTMLButtonElement | null;
const statusArea = document.getElementById(
	"status-area"
) as HTMLDivElement | null;
const emptyChatPlaceholder = document.getElementById(
	"empty-chat-placeholder"
) as HTMLDivElement | null; // Declare new DOM element variable for the #empty-chat-placeholder div.
// Get reference to the new #cancel-generation-button
const cancelGenerationButton = document.getElementById(
	"cancel-generation-button"
) as HTMLButtonElement | null;
// END MODIFICATION

let planConfirmationContainer: HTMLDivElement | null = null;
let confirmPlanButton: HTMLButtonElement | null = null;
let cancelPlanButton: HTMLButtonElement | null = null;

// Declare new DOM element variables for the parse error UI
const planParseErrorContainer = document.getElementById(
	"plan-parse-error-container"
) as HTMLDivElement | null;
const planParseErrorDisplay = document.getElementById(
	"plan-parse-error-display"
) as HTMLParagraphElement | null;
const failedJsonDisplay = document.getElementById(
	"failed-json-display"
) as HTMLElement | null;
const retryGenerationButton = document.getElementById(
	"retry-generation-button"
) as HTMLButtonElement | null;
const cancelParseErrorButton = document.getElementById(
	"cancel-parse-error-button"
) as HTMLButtonElement | null; // Added cancel button for parse error
// END Declare new DOM element variables for the parse error UI

// State
let isApiKeySet = false;
let isLoading = false;
let totalKeys = 0;
// MODIFIED: pendingPlanData now stores the simplified object from the provider
// when a textual plan is awaiting confirmation.
let pendingPlanData: {
	type: string;
	originalRequest?: string;
	originalInstruction?: string;
} | null = null;

console.log("Webview script loaded.");

function stopTypingAnimation() {
	if (typingTimer !== null) {
		clearInterval(typingTimer);
		typingTimer = null;
		console.log("[Webview] Typing animation stopped.");
	}
}

function typeNextCharacters() {
	if (!currentAiMessageContentElement) {
		stopTypingAnimation();
		console.warn(
			"[Webview] No currentAiMessageContentElement found, stopping typing animation."
		);
		return;
	}
	if (typingBuffer.length === 0 && !isLoading) {
		// Only stop if buffer is empty AND not actively loading (e.g., if a new chunk is expected soon)
		stopTypingAnimation();
		return;
	}
	const charsToType = Math.min(CHARS_PER_INTERVAL, typingBuffer.length);
	if (charsToType > 0) {
		currentAccumulatedText += typingBuffer.substring(0, charsToType);
		typingBuffer = typingBuffer.substring(charsToType);
		currentAiMessageContentElement.innerHTML = md.render(
			currentAccumulatedText
		);
		if (chatContainer) {
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}
	}
}

function startTypingAnimation() {
	if (typingTimer === null) {
		typingTimer = setInterval(typeNextCharacters, TYPING_SPEED_MS);
		console.log("[Webview] Typing animation started.");
	}
}

// new DOM elements to the critical elements null check
if (
	!sendButton ||
	!chatInput ||
	!chatContainer ||
	!modelSelect ||
	!addKeyInput ||
	!addKeyButton ||
	!prevKeyButton ||
	!nextKeyButton ||
	!deleteKeyButton ||
	!currentKeyDisplay ||
	!apiKeyStatusDiv ||
	!saveChatButton ||
	!loadChatButton ||
	!clearChatButton ||
	!statusArea ||
	!cancelGenerationButton || // Added cancelGenerationButton to critical elements check
	!planParseErrorContainer || // Added planParseErrorContainer to critical elements check
	!planParseErrorDisplay || // Added planParseErrorDisplay to critical elements check
	!failedJsonDisplay || // Added failedJsonDisplay to critical elements check
	!retryGenerationButton || // Added retryGenerationButton to critical elements check
	!cancelParseErrorButton || // Added cancelParseErrorButton to critical elements check
	!emptyChatPlaceholder // Added emptyChatPlaceholder to critical elements check
) {
	// END Add new DOM elements to the critical elements null check
	console.error("Required DOM elements not found!");
	const body = document.querySelector("body");
	if (body) {
		body.innerHTML =
			'<p style="color: var(--vscode-errorForeground); font-weight: bold;">Error initializing webview UI. Please check console (Developer: Open Webview Developer Tools).</p>';
	}
} else {
	// Modified appendMessage to handle stream initialization and add copy button for AI messages
	function appendMessage(
		sender: string,
		text: string,
		className: string = "",
		isHistoryMessage: boolean = false,
		diffContent?: string // NEW: Add diffContent parameter
	) {
		if (chatContainer) {
			// Handle the "Creating..." loading message
			if (className === "loading-message") {
				if (chatContainer.querySelector(".loading-message")) {
					// If one already exists, update it or just skip if content is identical
					const existingLoadingMsg = chatContainer.querySelector(
						".loading-message"
					) as HTMLDivElement;
					if (existingLoadingMsg && existingLoadingMsg.textContent !== text) {
						existingLoadingMsg.textContent = text;
					}
					return; // Don't add another loading message
				}
			} else {
				// If this is any other message, remove any existing general "loading-message".
				const loadingMsg = chatContainer.querySelector(".loading-message");
				if (loadingMsg) {
					loadingMsg.remove();
				}
			}

			const messageElement = document.createElement("div");
			messageElement.classList.add("message");
			if (className) {
				className
					.split(" ")
					.forEach((cls) => messageElement.classList.add(cls));
			}
			if (isHistoryMessage) {
				// NEW: Add dataset.isHistory attribute
				messageElement.dataset.isHistory = "true";
			}

			const senderElement = document.createElement("strong");
			// a non-breaking space after the sender name
			senderElement.textContent = `${sender}:\u00A0`; // non-breaking space
			messageElement.appendChild(senderElement);

			// Conditionally add error icon
			if (className.includes("error-message")) {
				const errorIconContainer = document.createElement("span");
				errorIconContainer.classList.add("error-icon");
				errorIconContainer.title = "Error";
				try {
					const errorIconHTML = icon(faExclamationTriangle, {
						classes: ["fa-icon"], // Use base icon class
					}).html[0];
					if (errorIconHTML) {
						errorIconContainer.innerHTML = errorIconHTML;
						messageElement.appendChild(errorIconContainer); // Append icon before text
					} else {
						console.error("Failed to generate Font Awesome error icon HTML.");
						// Optional: Add text fallback like "(Error)"
					}
				} catch (e) {
					console.error("Error setting Font Awesome error icon", e);
					// Optional: Add text fallback like "(Error)"
				}
			}
			// END MODIFICATION

			const textElement = document.createElement("span");
			textElement.classList.add("message-text-content"); // class to identify the text span
			messageElement.appendChild(textElement); // Always append text element

			// Refactor the existing `if (diffContent)` block within the `appendMessage` function.
			// It should now always create a `diff-container` div with class `diff-container` and append it to `messageElement`.
			// Inside `diff-container`, create and append a `diff-header` div with class `diff-header`.
			// Set its `textContent` to 'Code Changes:' if `diffContent` is not empty (after trimming whitespace using `diffContent.trim() !== ''`).
			// If `diffContent` IS empty or just whitespace, set `diff-header`'s `textContent` to 'No Code Changes Detected (or no diff provided)' and add the class `no-diff-content` to the `diff-container`.
			// The `pre` and `code` elements containing the actual diff lines (`span` elements with specific classes for added/removed/equal lines) should only be appended to `diff-container` if `diffContent` is non-empty, otherwise omit them.
			// Ensure `br` elements are added after each span for line breaks.
			if (diffContent !== undefined) {
				const diffContainer = document.createElement("div");
				diffContainer.classList.add("diff-container");

				const diffHeader = document.createElement("div");
				diffHeader.classList.add("diff-header");

				const trimmedDiffContent = diffContent.trim();

				if (trimmedDiffContent !== "") {
					diffHeader.textContent = "Code Changes:";

					const preCode = document.createElement("pre");
					preCode.classList.add("diff-code");

					const lines = diffContent.split("\n");
					lines.forEach((line) => {
						const span = document.createElement("span");
						span.textContent = line;
						if (line.startsWith("+ ")) {
							span.classList.add("diff-line-added");
						} else if (line.startsWith("- ")) {
							span.classList.add("diff-line-removed");
						} else if (line.startsWith("  ")) {
							span.classList.add("diff-line-equal");
						}
						preCode.appendChild(span);
						preCode.appendChild(document.createElement("br")); // Add <br> after each line
					});

					// Remove the last <br> if it exists
					if (
						preCode.lastChild instanceof Element &&
						preCode.lastChild.tagName === "BR"
					) {
						preCode.removeChild(preCode.lastChild);
					}

					diffContainer.appendChild(diffHeader);
					diffContainer.appendChild(preCode);
				} else {
					diffHeader.textContent =
						"No Code Changes Detected (or no diff provided)";
					diffContainer.classList.add("no-diff-content");
					diffContainer.appendChild(diffHeader);
					// pre and code elements are omitted as per instruction
				}

				messageElement.appendChild(diffContainer);
			}
			// END NEW DIFF CONTENT ADDITION

			let copyButton: HTMLButtonElement | null = null;
			let deleteButton: HTMLButtonElement | null = null;

			// The entire block for creating/appending copyButton, deleteButton, and messageActions
			// must be wrapped in `if (isHistoryMessage)`
			if (isHistoryMessage) {
				// NEW PRIMARY CONDITION
				// Only history messages get buttons and are involved in streaming logic
				if (
					className.includes("user-message") ||
					className.includes("ai-message")
				) {
					// Existing condition, now nested
					// Create copy button
					copyButton = document.createElement("button");
					copyButton.classList.add("copy-button");
					copyButton.title = "Copy Message";
					setIconForButton(copyButton, faCopy);

					// Create delete button
					deleteButton = document.createElement("button");
					deleteButton.classList.add("delete-button");
					deleteButton.title = "Delete Message";
					setIconForButton(deleteButton, faTrashCan);

					// Create actions container
					const messageActions = document.createElement("div");
					messageActions.classList.add("message-actions");
					messageActions.appendChild(copyButton);
					messageActions.appendChild(deleteButton);

					messageElement.appendChild(messageActions); // Append actions container to messageElement

					// Keep logic for disabling button during AI streaming specific to 'ai-message'
					if (
						sender === "Model" && // This condition ensures it only applies to Model messages
						text === "" &&
						className.includes("ai-message") &&
						!className.includes("error-message")
					) {
						// This is the start of an AI stream for a HISTORY message (e.g., from aiResponseStart)
						console.log(
							"Appending start of AI stream message (isHistoryMessage)."
						); // Modified log
						currentAiMessageContentElement = textElement;
						currentAccumulatedText = ""; // Initialize accumulated text
						typingBuffer = ""; // Clear typing buffer
						startTypingAnimation(); // Start the typing animation

						// a loading indicator within the text element
						textElement.innerHTML =
							'<span class="loading-text">Thinking<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';

						// Disable copy and delete buttons while content is loading/streaming
						if (copyButton) {
							copyButton.disabled = true;
						}
						if (deleteButton) {
							deleteButton.disabled = true;
						}
					} else {
						// This is a complete HISTORY message (user message or complete AI message from history/aiResponseEnd)
						stopTypingAnimation(); // Stop any ongoing typing animation
						typingBuffer = ""; // Clear typing buffer
						currentAiMessageContentElement = null; // Clear AI streaming state if it was active
						currentAccumulatedText = "";

						const renderedHtml = md.render(text);
						textElement.innerHTML = renderedHtml;
						// For complete messages (user or non-streaming AI), buttons are enabled immediately
						if (copyButton) {
							copyButton.disabled = false;
						}
						if (deleteButton) {
							deleteButton.disabled = false;
						}
					}
				} else {
					// This is a system message (or other non-user/AI message) that IS part of history
					// (e.g., restored system messages). No buttons.
					console.log(
						"Appending history-backed non-user/AI message (no buttons)."
					); // Added log
					const renderedHtml = md.render(text);
					textElement.innerHTML = renderedHtml;
					// Ensure streaming state is reset here as it's a complete message.
					stopTypingAnimation();
					typingBuffer = "";
					currentAiMessageContentElement = null;
					currentAccumulatedText = "";
				}
			} else {
				// NEW ELSE BLOCK for !isHistoryMessage (no buttons, direct render, state reset)
				// For non-history messages (e.g., real-time status updates from Model), no copy/delete buttons
				console.log("Appending non-history message (no buttons)."); // Added log
				const renderedHtml = md.render(text);
				textElement.innerHTML = renderedHtml;
				// Ensure streaming state is reset for these complete messages.
				stopTypingAnimation();
				typingBuffer = "";
				currentAiMessageContentElement = null;
				currentAccumulatedText = "";
			}
			// END Add copy button for AI messages

			chatContainer.appendChild(messageElement);
			chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll to bottom
			updateEmptyChatPlaceholderVisibility(); // Call after any message is appended
		}
	}

	function updateApiKeyStatus(text: string) {
		if (apiKeyStatusDiv) {
			const sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
			apiKeyStatusDiv.textContent = sanitizedText;
			const lowerText = text.toLowerCase();
			if (lowerText.startsWith("error:")) {
				apiKeyStatusDiv.style.color = "var(--vscode-errorForeground)";
			} else if (
				lowerText.startsWith("info:") ||
				lowerText.includes("success") ||
				lowerText.includes("key added") ||
				lowerText.includes("key deleted") ||
				lowerText.includes("using key") ||
				lowerText.includes("switched to key") ||
				lowerText.startsWith("adding") ||
				lowerText.startsWith("switching") ||
				lowerText.startsWith("waiting") ||
				lowerText.endsWith("cancelled.")
			) {
				apiKeyStatusDiv.style.color = "var(--vscode-editorInfo-foreground)";
			} else {
				apiKeyStatusDiv.style.color = "var(--vscode-descriptionForeground)";
			}
		}
	}

	function updateStatus(text: string, isError = false) {
		if (statusArea) {
			const sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
			statusArea.textContent = sanitizedText;
			statusArea.style.color = isError
				? "var(--vscode-errorForeground)"
				: "var(--vscode-descriptionForeground)";
			// Clear after a delay unless it's an error
			if (!isError) {
				setTimeout(() => {
					if (statusArea.textContent === sanitizedText) {
						statusArea.textContent = "";
					}
				}, 15000);
			} else {
				setTimeout(() => {
					if (statusArea.textContent === sanitizedText) {
						statusArea.textContent = "";
					}
				}, 30000);
			}
		}
	}

	function sendMessage() {
		// Allow sending only if not currently loading and no blocking UI is visible
		const planConfirmationVisible =
			planConfirmationContainer &&
			planConfirmationContainer.style.display !== "none";
		const planParseErrorVisible =
			planParseErrorContainer &&
			planParseErrorContainer.style.display !== "none";

		if (
			isLoading ||
			planConfirmationVisible ||
			planParseErrorVisible ||
			!chatInput ||
			!sendButton
		) {
			console.log(
				"Send button disabled: isLoading",
				isLoading,
				"planConfirmationVisible",
				planConfirmationVisible,
				"planParseErrorVisible",
				planParseErrorVisible
			);
			return;
		}

		const fullMessage = chatInput.value.trim();
		chatInput.value = "";
		if (!fullMessage) {
			return;
		}

		if (!isApiKeySet) {
			appendMessage(
				"System",
				"Please add or select a valid API Key first.",
				"error-message",
				true // System messages are part of history
			);
			return;
		}

		// Set loading state to true immediately upon sending
		setLoadingState(true);

		const lowerMessage = fullMessage.toLowerCase();
		if (lowerMessage.startsWith("/plan ")) {
			const planRequest = fullMessage.substring(6).trim();
			if (!planRequest) {
				// If command is invalid, re-enable input
				setLoadingState(false);
				appendMessage(
					"System",
					"Please provide a description for the plan after /plan.",
					"error-message",
					true // System messages are part of history
				);
				return;
			}
			appendMessage("You", fullMessage, "user-message", true);
			vscode.postMessage({ type: "planRequest", value: planRequest });
		} else if (lowerMessage === "/commit") {
			appendMessage("You", fullMessage, "user-message", true);
			vscode.postMessage({ type: "commitRequest" });
		} else {
			// Regular chat message
			appendMessage("You", fullMessage, "user-message", true);
			vscode.postMessage({ type: "chatMessage", value: fullMessage });
		}
	}

	// Modified setLoadingState to control button states based on loading and UI visibility
	function setLoadingState(loading: boolean) {
		isLoading = loading; // Keep track of overall loading state
		const loadingMsg = chatContainer?.querySelector(".loading-message");
		if (loadingMsg) {
			loadingMsg.remove();
		}
		console.log("setLoadingState:", loading); // ADDED console.log here

		// Check visibility of blocking UI elements
		const planConfirmationVisible =
			planConfirmationContainer &&
			planConfirmationContainer.style.display !== "none";
		const planParseErrorVisible =
			planParseErrorContainer &&
			planParseErrorContainer.style.display !== "none";

		// Determine if general chat/send controls should be enabled
		// Enabled only if not loading AND API key is set AND neither blocking UI is visible
		const enableSendControls =
			!loading &&
			isApiKeySet &&
			!planConfirmationVisible &&
			!planParseErrorVisible;

		if (sendButton) {
			sendButton.disabled = !enableSendControls;
		}
		if (chatInput) {
			chatInput.disabled = !enableSendControls;
		}
		// Model selection should also be disabled while any operation is running or UI is blocked
		if (modelSelect) {
			modelSelect.disabled =
				!!isLoading || !!planConfirmationVisible || !!planParseErrorVisible;
		}
		// API key management buttons should also be disabled while any operation is running or UI is blocked
		const enableApiKeyControls =
			!isLoading &&
			!planConfirmationVisible &&
			!planParseErrorVisible &&
			totalKeys > 0;
		if (prevKeyButton) {
			prevKeyButton.disabled = !enableApiKeyControls || totalKeys <= 1;
		}
		if (nextKeyButton) {
			nextKeyButton.disabled = !enableApiKeyControls || totalKeys <= 1;
		}
		if (deleteKeyButton) {
			deleteKeyButton.disabled = !enableApiKeyControls || !isApiKeySet;
		}
		const enableAddKeyInputControls =
			!loading && !planConfirmationVisible && !planParseErrorVisible;
		if (addKeyInput) {
			addKeyInput.disabled = !enableAddKeyInputControls;
		}
		if (addKeyButton) {
			addKeyButton.disabled = !enableAddKeyInputControls;
		}

		// Determine if chat history buttons can be interacted with
		// Enabled only if not loading AND neither blocking UI is visible
		const canInteractWithChatHistoryButtons =
			!loading && !planConfirmationVisible && !planParseErrorVisible;

		// Determine if there are messages in the chat container
		const hasMessages = chatContainer
			? chatContainer.childElementCount > 0 &&
			  !chatContainer.querySelector(".loading-message") // Don't count the loading message as content
			: false;

		if (loadChatButton) {
			// loadChatButton is disabled if loading or a blocking UI is visible. Otherwise, it's enabled.
			loadChatButton.disabled = !canInteractWithChatHistoryButtons;
		}
		if (saveChatButton) {
			// saveChatButton is disabled if loading or a blocking UI is visible OR there are no messages.
			saveChatButton.disabled =
				!canInteractWithChatHistoryButtons || !hasMessages;
		}
		if (clearChatButton) {
			// clearChatButton is disabled if loading or a blocking UI is visible OR there are no messages.
			clearChatButton.disabled =
				!canInteractWithChatHistoryButtons || !hasMessages;
		}
		// END USER REQUESTED MODIFICATION

		// new console.log statements here
		console.log(
			`[setLoadingState] Status: loading=${loading}, planConfVis=${planConfirmationVisible}, planParseErrVis=${planParseErrorVisible}`
		);
		console.log(
			`[setLoadingState] Chat: childCount=${chatContainer?.childElementCount}, hasMessages=${hasMessages}`
		);
		console.log(
			`[setLoadingState] Buttons: saveDisabled=${saveChatButton?.disabled}, clearDisabled=${clearChatButton?.disabled}`
		);

		// Manage cancel generation button visibility based on loading AND blocking UI state
		if (cancelGenerationButton) {
			// The button should be visible ONLY when loading is true AND neither
			// plan confirmation container NOR plan parse error container is visible.
			if (loading && !planConfirmationVisible && !planParseErrorVisible) {
				cancelGenerationButton.style.display = "inline-flex"; // Show the cancel button
			} else {
				// Hide the cancel button if not loading, or if a specific UI block is active
				cancelGenerationButton.style.display = "none"; // Hide the cancel button
			}
		}
		// END Manage cancel generation button visibility

		if (loading) {
			if (
				!currentAiMessageContentElement &&
				!chatContainer?.querySelector(".loading-message")
			) {
				appendMessage("Model", "Generating...", "loading-message", false); // Loading messages are not history
			}
		} else {
			updateEmptyChatPlaceholderVisibility(); // Call when isLoading becomes false
		}

		// If a new request starts (setLoadingState(true)) while a plan is awaiting confirmation,
		// hide the confirmation UI and reset pending plan data.
		if (
			loading &&
			planConfirmationContainer &&
			planConfirmationContainer.style.display !== "none"
		) {
			planConfirmationContainer.style.display = "none";
			pendingPlanData = null;
			updateStatus(
				"New request initiated, pending plan confirmation cancelled."
			);
			// No need to explicitly re-enable buttons here; setLoadingState(true) will handle disabling them correctly.
		}

		// Hide planParseErrorContainer if a new message is sent (loading becomes true)
		if (
			loading &&
			planParseErrorContainer &&
			planParseErrorContainer.style.display !== "none"
		) {
			planParseErrorContainer.style.display = "none";
			if (planParseErrorDisplay) {
				planParseErrorDisplay.textContent = "";
			}
			if (failedJsonDisplay) {
				failedJsonDisplay.textContent = "";
			}
			// Optionally provide a status update
			updateStatus("New request initiated, parse error UI hidden.");
			// No need to explicitly re-enable buttons here; setLoadingState(true) will handle disabling them correctly.
		}
		// END MODIFICATION
	}

	// New modular function: updateEmptyChatPlaceholderVisibility
	function updateEmptyChatPlaceholderVisibility() {
		console.log("[DEBUG] updateEmptyChatPlaceholderVisibility called.");
		if (!chatContainer || !emptyChatPlaceholder) {
			// console.warn("chatContainer or emptyChatPlaceholder not found. Cannot update visibility.");
			return;
		}

		// Count actual chat messages, excluding temporary .loading-message
		// A message is any .message div that is NOT also .loading-message
		const actualMessages = Array.from(chatContainer.children).filter(
			(child) =>
				child.classList.contains("message") &&
				!child.classList.contains("loading-message")
		);

		if (actualMessages.length > 0) {
			emptyChatPlaceholder.style.display = "none";
			chatContainer.style.display = "flex"; // Show chat container
		} else {
			emptyChatPlaceholder.style.display = "flex"; // Set the display style of #empty-chat-placeholder to flex if there are no messages.
			chatContainer.style.display = "none"; // Hide chat container
		}
		console.log(
			`[DEBUG] actualMessages.length: ${actualMessages.length}, emptyChatPlaceholder.style.display: ${emptyChatPlaceholder.style.display}`
		);
	}

	function createPlanConfirmationUI() {
		if (!planConfirmationContainer) {
			planConfirmationContainer = document.createElement("div");
			planConfirmationContainer.id = "plan-confirmation-container";
			planConfirmationContainer.style.display = "none"; // Initially hidden

			const textElement = document.createElement("p");
			textElement.textContent = "Review plan and confirm to proceed?"; // Modified text for clarity

			confirmPlanButton = document.createElement("button");
			confirmPlanButton.id = "confirm-plan-button";
			confirmPlanButton.title = "Confirm Plan";

			cancelPlanButton = document.createElement("button");
			cancelPlanButton.id = "cancel-plan-button";
			cancelPlanButton.title = "Cancel Plan";

			planConfirmationContainer.appendChild(textElement);
			planConfirmationContainer.appendChild(confirmPlanButton);
			planConfirmationContainer.appendChild(cancelPlanButton);

			chatContainer?.insertAdjacentElement(
				"afterend",
				planConfirmationContainer
			);

			setIconForButton(confirmPlanButton, faCheck);
			setIconForButton(cancelPlanButton, faTimes);

			// Review Point 3: Verify this listener setup.
			planConfirmationContainer.addEventListener(
				"click",
				(event: MouseEvent) => {
					const target = event.target as HTMLElement;
					if (
						target.id === "confirm-plan-button" ||
						target.closest("#confirm-plan-button")
					) {
						console.log("Confirm Plan button clicked."); // ADDED console.log here
						if (pendingPlanData) {
							vscode.postMessage({
								type: "confirmPlanExecution",
								value: pendingPlanData,
							});
							updateStatus("Requesting plan execution...");
							// Correctly hides the confirmation UI
							planConfirmationContainer!.style.display = "none";
							// Correctly clears pending plan data
							pendingPlanData = null;
							// Correctly sets loading state while structured plan is generated/executed
							setLoadingState(true); // This call now correctly manages all button states
						} else {
							updateStatus("Error: No pending plan data to confirm.", true);
						}
					} /* else if (
						// This is the #cancel-plan-button logic being reviewed
						target.id === "cancel-plan-button" ||
						target.closest("#cancel-plan-button")
					) {
						console.log("Cancel Plan button clicked."); // ADDED console.log here
						// Correctly sends the cancel message
						vscode.postMessage({ type: "cancelPlanExecution" });
						updateStatus("Plan cancelled.");
						// Correctly hides the confirmation UI
						planConfirmationContainer!.style.display = "none";
						// Correctly clears pending plan data
						pendingPlanData = null;
						// Correctly re-enables inputs as plan flow is cancelled
						setLoadingState(false); // This call now correctly manages all button states
					} */
				}
			);
		}
	}

	// Helper function to set Font Awesome icon on a button
	function setIconForButton(
		button: HTMLButtonElement | null,
		iconDefinition: any
	) {
		if (button) {
			try {
				const iconHTML = icon(iconDefinition, {
					classes: ["fa-icon"],
				}).html[0];
				if (iconHTML) {
					button.innerHTML = iconHTML;
				} else {
					button.innerHTML = "?"; // Fallback
					console.error(
						"Failed to generate Font Awesome icon HTML for:",
						iconDefinition.iconName
					);
				}
			} catch (e) {
				console.error(
					"Error setting Font Awesome icon",
					iconDefinition.iconName,
					e
				);
				button.innerHTML = "!"; // Fallback on error
			}
		}
	}

	// --- Event Listeners ---
	// Note: Placing general listeners here, and specific UI listeners (like cancel buttons) within initializeWebview
	// ensures they are set up after DOM checks and UI creation (if any).

	sendButton.addEventListener("click", () => {
		console.log("Send button clicked.");
		sendMessage();
	}); // ADDED console.log here
	chatInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			console.log("Chat input Enter key pressed."); // ADDED console.log here
			e.preventDefault();
			sendMessage();
		}
	});
	modelSelect.addEventListener("change", () => {
		// Disable controls temporarily while switch is requested
		// These will be re-enabled by updateModelList + setLoadingState
		const enableSendControls =
			!isLoading &&
			isApiKeySet &&
			!(
				planConfirmationContainer &&
				planConfirmationContainer.style.display !== "none"
			) &&
			!(
				planParseErrorContainer &&
				planParseErrorContainer.style.display !== "none"
			);

		if (sendButton) {
			sendButton.disabled = true;
		}
		if (chatInput) {
			chatInput.disabled = true;
		}
		if (modelSelect) {
			modelSelect.disabled = true;
		}
		if (prevKeyButton) {
			prevKeyButton.disabled = true;
		}
		if (nextKeyButton) {
			nextKeyButton.disabled = true;
		}
		if (deleteKeyButton) {
			deleteKeyButton.disabled = true;
		}
		if (addKeyInput) {
			addKeyInput.disabled = true;
		}
		if (addKeyButton) {
			addKeyButton.disabled = true;
		}
		if (loadChatButton) {
			loadChatButton.disabled = true;
		}
		if (saveChatButton) {
			saveChatButton.disabled = true;
		}
		if (clearChatButton) {
			clearChatButton.disabled = true;
		}

		const selectedModel = modelSelect.value;
		vscode.postMessage({ type: "selectModel", value: selectedModel });
		updateStatus(`Requesting switch to model: ${selectedModel}...`);
	});
	addKeyButton.addEventListener("click", () => {
		const apiKey = addKeyInput!.value.trim();
		if (apiKey) {
			// Disable controls temporarily while adding/switching is requested
			const enableSendControls =
				!isLoading &&
				isApiKeySet &&
				!(
					planConfirmationContainer &&
					planConfirmationContainer.style.display !== "none"
				) &&
				!(
					planParseErrorContainer &&
					planParseErrorContainer.style.display !== "none"
				);

			if (sendButton) {
				sendButton.disabled = true;
			}
			if (chatInput) {
				chatInput.disabled = true;
			}
			if (modelSelect) {
				modelSelect.disabled = true;
			}
			if (prevKeyButton) {
				prevKeyButton.disabled = true;
			}
			if (nextKeyButton) {
				nextKeyButton.disabled = true;
			}
			if (deleteKeyButton) {
				deleteKeyButton.disabled = true;
			}
			if (addKeyInput) {
				addKeyInput.disabled = true;
			}
			if (addKeyButton) {
				addKeyButton.disabled = true;
			}
			if (loadChatButton) {
				loadChatButton.disabled = true;
			}
			if (saveChatButton) {
				saveChatButton.disabled = true;
			}
			if (clearChatButton) {
				clearChatButton.disabled = true;
			}

			vscode.postMessage({ type: "addApiKey", value: apiKey });
			addKeyInput!.value = "";
			updateApiKeyStatus("Adding key...");
		} else {
			updateApiKeyStatus("Error: Please enter an API key to add.");
		}
	});
	addKeyInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			addKeyButton!.click();
		}
	});
	prevKeyButton.addEventListener("click", () => {
		// Disable controls temporarily while switching is requested
		const enableSendControls =
			!isLoading &&
			isApiKeySet &&
			!(
				planConfirmationContainer &&
				planConfirmationContainer.style.display !== "none"
			) &&
			!(
				planParseErrorContainer &&
				planParseErrorContainer.style.display !== "none"
			);

		if (sendButton) {
			sendButton.disabled = true;
		}
		if (chatInput) {
			chatInput.disabled = true;
		}
		if (modelSelect) {
			modelSelect.disabled = true;
		}
		if (prevKeyButton) {
			prevKeyButton.disabled = true;
		}
		if (nextKeyButton) {
			nextKeyButton.disabled = true;
		}
		if (deleteKeyButton) {
			deleteKeyButton.disabled = true;
		}
		if (addKeyInput) {
			addKeyInput.disabled = true;
		}
		if (addKeyButton) {
			addKeyButton.disabled = true;
		}
		if (loadChatButton) {
			loadChatButton.disabled = true;
		}
		if (saveChatButton) {
			saveChatButton.disabled = true;
		}
		if (clearChatButton) {
			clearChatButton.disabled = true;
		}

		vscode.postMessage({ type: "switchToPrevKey" });
		updateApiKeyStatus("Switching key...");
	});
	nextKeyButton.addEventListener("click", () => {
		// Disable controls temporarily while switching is requested
		const enableSendControls =
			!isLoading &&
			isApiKeySet &&
			!(
				planConfirmationContainer &&
				planConfirmationContainer.style.display !== "none"
			) &&
			!(
				planParseErrorContainer &&
				planParseErrorContainer.style.display !== "none"
			);

		if (sendButton) {
			sendButton.disabled = true;
		}
		if (chatInput) {
			chatInput.disabled = true;
		}
		if (modelSelect) {
			modelSelect.disabled = true;
		}
		if (prevKeyButton) {
			prevKeyButton.disabled = true;
		}
		if (nextKeyButton) {
			nextKeyButton.disabled = true;
		}
		if (deleteKeyButton) {
			deleteKeyButton.disabled = true;
		}
		if (addKeyInput) {
			addKeyInput.disabled = true;
		}
		if (addKeyButton) {
			addKeyButton.disabled = true;
		}
		if (loadChatButton) {
			loadChatButton.disabled = true;
		}
		if (saveChatButton) {
			saveChatButton.disabled = true;
		}
		if (clearChatButton) {
			clearChatButton.disabled = true;
		}

		vscode.postMessage({ type: "switchToNextKey" });
		updateApiKeyStatus("Switching key...");
	});
	deleteKeyButton.addEventListener("click", () => {
		// Disable controls temporarily while action is pending confirmation
		const enableSendControls =
			!isLoading &&
			isApiKeySet &&
			!(
				planConfirmationContainer &&
				planConfirmationContainer.style.display !== "none"
			) &&
			!(
				planParseErrorContainer &&
				planParseErrorContainer.style.display !== "none"
			);

		if (sendButton) {
			sendButton.disabled = true;
		}
		if (chatInput) {
			chatInput.disabled = true;
		}
		if (modelSelect) {
			modelSelect.disabled = true;
		}
		if (prevKeyButton) {
			prevKeyButton.disabled = true;
		}
		if (nextKeyButton) {
			nextKeyButton.disabled = true;
		}
		if (deleteKeyButton) {
			deleteKeyButton.disabled = true;
		}
		if (addKeyInput) {
			addKeyInput.disabled = true;
		}
		if (addKeyButton) {
			addKeyButton.disabled = true;
		}
		if (loadChatButton) {
			loadChatButton.disabled = true;
		}
		if (saveChatButton) {
			saveChatButton.disabled = true;
		}
		if (clearChatButton) {
			clearChatButton.disabled = true;
		}

		vscode.postMessage({ type: "requestDeleteConfirmation" });
		updateApiKeyStatus("Waiting for delete confirmation...");
	});
	// Clear/Save/Load listeners are correct, they trigger actions handled elsewhere.
	// Button disabled states are managed by setLoadingState.
	clearChatButton.addEventListener("click", () => {
		console.log("Clear Chat button clicked."); // ADDED console.log here
		vscode.postMessage({ type: "clearChatRequest" });
	});
	saveChatButton.addEventListener("click", () => {
		console.log("Save Chat button clicked."); // ADDED console.log here
		vscode.postMessage({ type: "saveChatRequest" });
		updateStatus("Requesting chat save...");
	});
	loadChatButton.addEventListener("click", () => {
		console.log("Load Chat button clicked."); // ADDED console.log here
		vscode.postMessage({ type: "loadChatRequest" });
		updateStatus("Requesting chat load...");
	});

	// event listener for retryGenerationButton
	if (retryGenerationButton) {
		retryGenerationButton.addEventListener("click", () => {
			console.log("Retry Generation button clicked."); // ADDED console.log here
			// Hide the error container
			if (planParseErrorContainer) {
				planParseErrorContainer.style.display = "none";
			}
			// Send message to extension to retry generation
			vscode.postMessage({ type: "retryStructuredPlanGeneration" });
			// Set loading state to true as a new generation attempt is starting
			setLoadingState(true); // This call now correctly manages all button states
			// Clear the error display fields
			if (planParseErrorDisplay) {
				planParseErrorDisplay.textContent = "";
			}
			if (failedJsonDisplay) {
				failedJsonDisplay.textContent = "";
			}
			updateStatus("Retrying structured plan generation...");

			// --- USER REQUESTED MODIFICATION ---
			// These lines are redundant as setLoadingState(true) handles disabling buttons. Removed.
			// --- END USER REQUESTED MODIFICATION ---
		});
	}
	// END MODIFICATION

	window.addEventListener("message", (event: MessageEvent) => {
		const message = event.data;
		console.log("Received message:", event.data); // ADDED console.log here
		console.log("[Webview] Message received from extension:", message.type);

		switch (message.type) {
			// Case for non-streamed, complete AI responses.
			// Can also handle plans that require confirmation if message includes relevant flags.
			case "aiResponse": {
				// This message type is now primarily used for final non-streamed responses or error messages.
				// Streamed responses use aiResponseStart, aiResponseChunk, aiResponseEnd.
				// Ensure the message is appended and handle error state if provided.
				// The copy button logic for 'ai-message' is handled inside appendMessage.
				// Pass multiple classes as a string.
				appendMessage(
					"Model",
					message.value,
					`ai-message ${message.isError ? "error-message" : ""}`.trim(),
					true // `aiResponse` is a complete message meant for history
				);

				// Handle plan confirmation if this non-streamed message requires it.
				// Note: Plan confirmation UI is typically triggered by aiResponseEnd for streamed plans,
				// but this might still be used for non-streamed plan explanations if that flow is re-introduced.
				if (
					message.isPlanResponse &&
					message.requiresConfirmation &&
					message.planData
				) {
					console.log("Received aiResponse with confirmable plan.");
					createPlanConfirmationUI();
					if (planConfirmationContainer) {
						pendingPlanData = message.planData as {
							type: string;
							originalRequest?: string;
							originalInstruction?: string;
						};
						planConfirmationContainer.style.display = "flex";
						updateStatus(
							"Textual plan generated. Review and confirm to proceed."
						);

						// Disable chat inputs and other controls while plan confirmation is visible.
						setLoadingState(false); // This will trigger setLoadingState(false) which then sees planConfirmationVisible and disables accordingly.
						// Hide cancel button when plan confirmation shows
						if (cancelGenerationButton) {
							cancelGenerationButton.style.display = "none";
						}
						// END MODIFICATION
					} else {
						console.error(
							"Plan confirmation container failed to create or find for non-streamed plan!"
						);
						updateStatus("Error: UI for plan confirmation is missing.", true);
						setLoadingState(false); // Fallback to re-enable if UI failed to show.
					}
				} else if (message.isLoading === false) {
					// If this is a regular non-streamed message and isLoading is explicitly false, operation is complete.
					setLoadingState(false); // This call now correctly manages all button states.
				}
				// If isLoading is true (or not specified) and it's not a confirmable plan, loading state persists.
				break;
			}

			// --- New handlers for streamed responses ---
			case "aiResponseStart": {
				isLoading = true;
				setLoadingState(true);
				// ADDED: Reset typing state
				currentAccumulatedText = "";
				typingBuffer = "";
				stopTypingAnimation(); // Ensure no old timer is running
				console.log(
					"Received aiResponseStart. Starting stream via appendMessage."
				); // ADDED: Specific console log
				// Point 1.c (from review instructions): Ensure any generic "Creating..." or similar loading message is removed.
				// Point 1.b (from review instructions): Ensure appendMessage("Model", "", "ai-message") is called.
				// It leads to the initialization/reset of currentAiMessageContentElement and currentAccumulatedText
				// within the appendMessage function (see its definition) for a new AI stream.
				// Note: aiResponseStart is only sent for *successful* starts. Errors would come as aiResponseEnd with !success.
				appendMessage("Model", "", "ai-message", true); // This is a history message
				// setLoadingState(true) was called when the user sent the message.
				// We are now in the process of receiving the response, so loading is still active.
				// No need to call setLoadingState(false) here. Button states are already handled by the initial setLoadingState(true).
				break;
			}
			case "aiResponseChunk": {
				// Point 2.a, 2.b, 2.c (from review instructions) are handled within appendMessage now.
				// This message type is only for streaming content chunks.
				if (message.value !== undefined) {
					typingBuffer += message.value; // REPLACED: currentAccumulatedText update with typingBuffer
					if (typingTimer === null) {
						// ADDED: Defensive start
						startTypingAnimation();
					}
					// The actual DOM update and scrolling are now handled by typeNextCharacters in the interval.
				}
				break;
			}
			case "aiResponseEnd": {
				stopTypingAnimation(); // ADDED: Stop typing animation
				console.log("Received aiResponseEnd. Stream finished.");
				// After stream ends, finalize the message content and handle UI updates
				if (currentAiMessageContentElement) {
					currentAccumulatedText += typingBuffer; // ADDED: Append any remaining buffered text
					// Finalize the content in the DOM using the accumulated text
					const renderedHtml = md.render(currentAccumulatedText);
					currentAiMessageContentElement.innerHTML = renderedHtml;

					// Find the copy and delete buttons for this message and enable them
					const messageElement = currentAiMessageContentElement.parentElement;
					if (messageElement) {
						const copyButton = messageElement.querySelector(
							".copy-button"
						) as HTMLButtonElement | null;
						if (copyButton) {
							copyButton.disabled = false; // Enable the copy button
						}
						const deleteButton = messageElement.querySelector(
							".delete-button"
						) as HTMLButtonElement | null;
						if (deleteButton) {
							deleteButton.disabled = false; // Enable the delete button
						}
					}
				} else {
					// Handle cases where stream ended but we somehow lost the element reference
					console.warn(
						"aiResponseEnd received but currentAiMessageContentElement is null. Attempting to clear state." // MODIFIED: More specific warning
					);
				}

				// Point 3.c (from review instructions): Confirm that currentAiMessageContentElement = null; and currentAccumulatedText = ""; are always called
				// to reset state for the next stream.
				typingBuffer = ""; // ADDED: Clear typingBuffer here
				currentAiMessageContentElement = null;
				currentAccumulatedText = "";

				// Handle error display if !message.success && message.error.
				if (!message.success && message.error) {
					const errorMessageContent =
						typeof message.error === "string"
							? message.error
							: "Unknown error occurred during AI response streaming.";
					// Append the error message as a new system message or update status
					// The provider's finally block often adds a history entry for errors,
					// potentially including the failed response text. Appending here might be redundant
					// or cause double messages depending on provider logic. Let's rely on provider adding history.
					// Just update status for immediate feedback.
					updateStatus(`AI Stream Error: ${errorMessageContent}`, true);
				}

				// Handle plan confirmation if the stream was successful and resulted in a plan.
				if (message.success && message.isPlanResponse && message.planData) {
					console.log("aiResponseEnd indicates confirmable plan.");
					createPlanConfirmationUI(); // Ensure UI elements for confirmation are ready.
					if (planConfirmationContainer) {
						pendingPlanData = message.planData as {
							// Store plan data.
							type: string;
							originalRequest?: string;
							originalInstruction?: string;
						};

						planConfirmationContainer.style.display = "flex"; // Show confirmation UI.
						updateStatus(
							"Textual plan generated. Review and confirm to proceed."
						);

						// Disable chat inputs while plan confirmation is visible.
						// Call setLoadingState(false) which will trigger setLoadingState(false) which then sees planConfirmationVisible and disables accordingly.
						setLoadingState(false);
						// Hide cancel button when plan confirmation shows
						if (cancelGenerationButton) {
							cancelGenerationButton.style.display = "none";
						}
						// END MODIFICATION
					} else {
						// Fallback if UI creation failed.
						console.error(
							"Plan confirmation container failed to create or find!"
						);
						updateStatus("Error: UI for plan confirmation is missing.", true);
						setLoadingState(false); // Fallback to re-enable if UI failed to show.
					}
				} else if (message.success) {
					console.log("aiResponseEnd indicates successful chat response.");
					// This is a successful streamed response that is NOT a plan requiring confirmation.
					// Inputs should be re-enabled.
					setLoadingState(false); // This call now correctly manages all button states
					updateEmptyChatPlaceholderVisibility(); // this line
				} else {
					console.log("aiResponseEnd indicates failed streaming operation.");
					// If !message.success and message.error was handled above, or if it's a non-plan failure.
					// Inputs should be re-enabled.
					setLoadingState(false); // This call handles re-enabling inputs/buttons.
				}
				break;
			}
			// --- End new handlers for streamed responses ---

			// new case for 'structuredPlanParseFailed'
			case "structuredPlanParseFailed": {
				const { error, failedJson } = message.value;
				console.log("Received structuredPlanParseFailed.");

				if (
					planParseErrorContainer &&
					planParseErrorDisplay &&
					failedJsonDisplay &&
					retryGenerationButton &&
					cancelParseErrorButton // Added cancel button check
				) {
					// Display the error and the failed JSON
					planParseErrorDisplay.textContent = error;
					failedJsonDisplay.textContent = failedJson; // Full JSON for potential copy/debug

					// Show the error container
					planParseErrorContainer.style.display = "block"; // Or "flex" depending on its CSS

					// AI generation is done, awaiting user action (retry or new plan)
					// Set loading state to false. This will remove the chat loading message
					// and re-evaluate button states based on the now-visible parse error UI.
					setLoadingState(false); // This call now correctly manages all button states
					// Input states will be disabled because planParseErrorVisible is true.

					updateStatus(
						"Structured plan parsing failed. Review error and retry or cancel.",
						true
					);

					// --- USER REQUESTED MODIFICATION ---
					// These lines are redundant as setLoadingState(false) handles enabling buttons. Removed.
					// --- END USER REQUESTED MODIFICATION ---
				} else {
					// Fallback if UI elements are missing
					console.error(
						"Parse error UI elements not found. Cannot display structured plan parse failure."
					);
					appendMessage(
						"System",
						`Structured plan parsing failed: ${error}. Failed JSON: \n\`\`\`json\n${failedJson}\n\`\`\`. Error UI missing.`,
						"error-message",
						true // System messages are part of history
					);
					setLoadingState(false); // Still set loading to false, manages buttons based on no UI block.
				}
				break;
			}
			// END MODIFICATION

			// new case for 'restorePendingPlanConfirmation'
			case "restorePendingPlanConfirmation":
				if (message.value) {
					console.log("Received restorePendingPlanConfirmation.");
					pendingPlanData = message.value as {
						// Cast to expected type
						type: string;
						originalRequest?: string;
						originalInstruction?: string;
					};

					createPlanConfirmationUI(); // Ensure UI elements are created

					if (planConfirmationContainer) {
						planConfirmationContainer.style.display = "flex"; // Show the confirmation UI
						updateStatus(
							"Pending plan confirmation restored. Review and confirm to proceed."
						);

						// Hide cancel button when plan confirmation shows on restore
						if (cancelGenerationButton) {
							cancelGenerationButton.style.display = "none";
						}
						// END MODIFICATION
						isLoading = false; // Ensure loading indicator is not active
						// Call setLoadingState(false) to correctly manage button states based on the now visible plan confirmation UI.
						setLoadingState(false); // This call will see planConfirmationVisible is true and disable inputs/buttons correctly.
					} else {
						// Fallback if UI creation or finding failed
						console.error(
							"Error: Plan confirmation container not found during restore. Cannot display pending plan."
						);
						updateStatus(
							"Error: Failed to restore pending plan UI. Inputs re-enabled.",
							true
						);
						pendingPlanData = null; // Clear data as it cannot be confirmed
						// Ensure inputs are re-enabled as a fallback
						setLoadingState(false); // This call will see no blocking UI and re-enable inputs/buttons based on API key.
					}
				} else {
					console.warn(
						"restorePendingPlanConfirmation received without message.value. No action taken."
					);
					// Ensure inputs are in a sensible state if this happens unexpectedly
					setLoadingState(false);
				}
				break;
			// END Add new case for 'restorePendingPlanConfirmation'

			// new case for 'appendRealtimeModelMessage'
			case "appendRealtimeModelMessage":
				// This case handles messages that should be directly appended to the chat as if they were from the Model.
				// It's intended for real-time updates or messages from the model that are not part of a typical streaming response (e.g., step OK/FAIL, command output).
				if (message.value && typeof message.value.text === "string") {
					// Append the message. The 'ai-message' class includes copy button logic.
					// If message.value.isError is true, add 'error-message' class as well.
					appendMessage(
						"Model",
						message.value.text,
						`ai-message ${message.value.isError ? "error-message" : ""}`.trim(),
						true, // Changed to true based on instructions
						message.value.diffContent // NEW: Pass diffContent
					);
					// After adding a message, update button states based on content count, but only if not blocked
					// Calling setLoadingState(isLoading) re-evaluates button states based on current state and UI visibility
					// This also ensures save/clear buttons become active if this message is the first content.
					setLoadingState(isLoading); // Call setLoadingState with its current value to re-trigger UI update
				} else {
					console.warn(
						"Received 'appendRealtimeModelMessage' with invalid value:",
						message.value
					);
				}
				break;
			// END MODIFICATION

			case "apiKeyStatus": {
				if (typeof message.value === "string") {
					updateApiKeyStatus(message.value);
					// Re-evaluate input states after API key status update
					setLoadingState(isLoading); // Call setLoadingState with its current value
				}
				break;
			}
			case "statusUpdate": {
				if (typeof message.value === "string") {
					updateStatus(message.value, message.isError ?? false);
					// No change to input state here, status updates don't block input flow.
				}
				break;
			}
			case "updateKeyList": {
				if (message.value && Array.isArray(message.value.keys)) {
					const updateData = message.value as {
						keys: any[];
						activeIndex: number;
						totalKeys: number;
					};

					totalKeys = updateData.totalKeys;
					isApiKeySet = updateData.activeIndex !== -1;

					if (
						updateData.activeIndex !== -1 &&
						updateData.keys[updateData.activeIndex]
					) {
						currentKeyDisplay!.textContent =
							updateData.keys[updateData.activeIndex].maskedKey;
					} else {
						currentKeyDisplay!.textContent = "No Active Key";
						updateApiKeyStatus("Please add an API key.");
					}
					// Button states are now managed by setLoadingState
					setLoadingState(isLoading); // This call now correctly updates inputs/buttons based on the new isApiKeySet value and existing state.
				} else {
					console.error("Invalid 'updateKeyList' message received:", message);
				}
				break;
			}
			case "updateModelList": {
				if (
					message.value &&
					Array.isArray(message.value.availableModels) &&
					typeof message.value.selectedModel === "string"
				) {
					const { availableModels, selectedModel } = message.value;
					modelSelect!.innerHTML = "";
					availableModels.forEach((modelName: string) => {
						const option = document.createElement("option");
						option.value = modelName;
						option.textContent = modelName;
						if (modelName === selectedModel) {
							option.selected = true;
						}
						modelSelect!.appendChild(option);
					});
					modelSelect!.value = selectedModel;
					console.log(
						"Model list updated in webview. Selected:",
						selectedModel
					);
					// Re-evaluate input states based on current UI state
					setLoadingState(isLoading); // This call correctly updates inputs/buttons based on existing state.
				} else {
					console.error("Invalid 'updateModelList' message received:", message);
				}
				break;
			}
			case "chatCleared": {
				if (chatContainer) {
					chatContainer.innerHTML = "";
				}
				// setLoadingState(false) will now handle disabling clear/save buttons correctly based on empty chat
				setLoadingState(false); // Ensure loading state is reset and buttons updated.
				// Reset streaming globals in case a clear happens mid-stream (unlikely but safe)
				stopTypingAnimation();
				typingBuffer = "";
				currentAiMessageContentElement = null;
				currentAccumulatedText = "";
				// If plan confirmation was active, hide it
				if (
					planConfirmationContainer &&
					planConfirmationContainer.style.display !== "none"
				) {
					planConfirmationContainer.style.display = "none";
					pendingPlanData = null;
				}
				// If plan parse error UI was active, hide it
				if (
					planParseErrorContainer &&
					planParseErrorContainer.style.display !== "none"
				) {
					planParseErrorContainer.style.display = "none";
					if (planParseErrorDisplay) {
						planParseErrorDisplay.textContent = "";
					}
					if (failedJsonDisplay) {
						failedJsonDisplay.textContent = "";
					}
				}
				updateEmptyChatPlaceholderVisibility(); // Call after chatCleared is processed (to show the placeholder).
				break;
			}
			case "restoreHistory": {
				if (chatContainer && Array.isArray(message.value)) {
					chatContainer.innerHTML = ""; // Clear existing messages before restoring
					message.value.forEach((msg: any) => {
						if (
							msg &&
							typeof msg.sender === "string" &&
							typeof msg.text === "string"
						) {
							// For restored messages, they are complete, so no streaming logic applies here.
							// appendMessage will correctly add the copy button for AI messages here
							appendMessage(
								msg.sender,
								msg.text,
								msg.className || "",
								true,
								msg.diffContent
							); // NEW: Pass diffContent
						}
					});
					updateStatus("Chat history restored.");
					// setLoadingState(false) will now handle enabling/disabling save/clear based on restored messages
				} else {
					updateStatus(
						"Error: Failed to restore chat history due to invalid format.",
						true
					);
				}
				setLoadingState(false); // Ensure loading state is reset and buttons updated based on restored content.
				// If plan confirmation was active, hide it
				if (
					planConfirmationContainer &&
					planConfirmationContainer.style.display !== "none"
				) {
					planConfirmationContainer.style.display = "none";
					pendingPlanData = null;
				}
				// If plan parse error UI was active, hide it
				if (
					planParseErrorContainer &&
					planParseErrorContainer.style.display !== "none"
				) {
					planParseErrorContainer.style.display = "none";
					if (planParseErrorDisplay) {
						planParseErrorDisplay.textContent = "";
					}
					if (failedJsonDisplay) {
						failedJsonDisplay.textContent = "";
					}
				}
				updateEmptyChatPlaceholderVisibility(); // Call after restoreHistory is processed (to show/hide based on loaded history).

				document.documentElement.scrollTop = 0;

				break;
			}
			// Modify 'reenableInput' handler
			case "reenableInput": {
				console.log("Received reenableInput request from provider.");
				// This message signals an operation was cancelled or an-error occurred requiring input re-enabling.

				// Always set isLoading to false, as the operation that was loading is now considered finished or cancelled.
				isLoading = false;
				stopTypingAnimation(); // ADDED: Stop typing animation

				// Remove any general "Creating..." or "Loading..." message from chat, similar to setLoadingState(false) logic.
				// The loading message removal is handled by setLoadingState(false).

				// Ensure streaming state is also reset if this happens unexpectedly mid-stream
				if (currentAiMessageContentElement) {
					console.warn(
						"reenableInput received mid-stream. Resetting stream state."
					);
					// Finalize the current message with accumulated text before clearing state
					currentAccumulatedText += typingBuffer; // ADDED: Append any remaining buffered text
					const renderedHtml = md.render(currentAccumulatedText);
					currentAiMessageContentElement.innerHTML = renderedHtml;
					const messageElement = currentAiMessageContentElement.parentElement;
					if (messageElement) {
						const copyButton = messageElement.querySelector(
							".copy-button"
						) as HTMLButtonElement | null;
						if (copyButton) {
							copyButton.disabled = false;
						}
						const deleteButton = messageElement.querySelector(
							".delete-button"
						) as HTMLButtonElement | null;
						if (deleteButton) {
							deleteButton.disabled = false;
						}
					}
				}

				// Clear all streaming state variables regardless of whether currentAiMessageContentElement was active
				typingBuffer = ""; // ADDED: Clear typingBuffer
				currentAiMessageContentElement = null;
				currentAccumulatedText = "";

				// Call setLoadingState(false) to re-evaluate all input and button states based on the new isLoading=false,
				// current API key status, and visibility of blocking UI elements.
				setLoadingState(false); // This call now correctly manages all button states.

				// Check if plan confirmation UI is currently active and visible.
				const planConfirmationActive =
					planConfirmationContainer &&
					planConfirmationContainer.style.display !== "none";

				// If plan confirmation UI is not active, but there was pendingPlanData (e.g., from a cancelled flow before UI showed),
				// clear it as `reenableInput` implies a reset to a normal interactive state.
				if (!planConfirmationActive && pendingPlanData) {
					pendingPlanData = null;
					updateStatus(
						"Inputs re-enabled; any non-visible pending plan confirmation has been cleared."
					);
				} else if (!planConfirmationActive) {
					// If plan confirmation is not active and no pending data was cleared
					updateStatus("Inputs re-enabled."); // Generic message
				}
				// If planConfirmationActive is true, inputs remain disabled by setLoadingState,
				// and the status message reflects that state or the user interacts with the confirmation UI.
				break;
			}
			// END Modify 'reenableInput' handler
			default:
				console.warn(
					"[Webview] Received unknown message type from extension:",
					message.type
				);
		}
	});

	function initializeWebview() {
		vscode.postMessage({ type: "webviewReady" });
		console.log("Webview sent ready message.");
		chatInput?.focus();

		// USER REQUESTED Initial button states
		// Disabled until API key is confirmed and not loading and no blocking UI
		// These initial states are now handled by the initial call to setLoadingState(false)
		// triggered by the 'webviewReady' message handler after receiving updateKeyList/updateModelList.
		// It's safer to let the state management function handle initialization based on loaded config.
		// Keep them here as belt-and-subspenders initial DOM state, but main control is setLoadingState.
		if (chatInput) {
			chatInput.disabled = true;
		}
		if (sendButton) {
			sendButton.disabled = true;
		}
		if (modelSelect) {
			modelSelect.disabled = true;
		}

		// Disabled initially because there are no messages
		if (clearChatButton) {
			clearChatButton.disabled = true;
		}
		if (saveChatButton) {
			saveChatButton.disabled = true;
		}

		// Enabled initially as loading history is always possible unless loading/blocked
		if (loadChatButton) {
			loadChatButton.disabled = false;
		}

		// Key navigation buttons disabled initially until key list is loaded
		if (prevKeyButton) {
			prevKeyButton.disabled = true;
		}
		if (nextKeyButton) {
			nextKeyButton.disabled = true;
		}
		if (deleteKeyButton) {
			deleteKeyButton.disabled = true;
		}

		// Set initial display state for the cancel button
		if (cancelGenerationButton) {
			cancelGenerationButton.style.display = "none";
		}
		// Ensure parse error container is hidden initially (should also be in CSS)
		if (planParseErrorContainer) {
			planParseErrorContainer.style.display = "none";
		}

		// Set icons for buttons
		setIconForButton(sendButton, faPaperPlane);
		setIconForButton(saveChatButton, faFloppyDisk);
		setIconForButton(loadChatButton, faFolderOpen);
		setIconForButton(clearChatButton, faTrashCan);
		setIconForButton(prevKeyButton, faChevronLeft);
		setIconForButton(nextKeyButton, faChevronRight);
		setIconForButton(deleteKeyButton, faTrashCan);
		setIconForButton(addKeyButton, faPlus);
		setIconForButton(retryGenerationButton, faRedo); // faRedo imported for this
		setIconForButton(cancelParseErrorButton, faTimes); // Set icon for the cancel parse error button (faTimes imported)
		// Set icon for the cancel generation button
		setIconForButton(cancelGenerationButton, faStop); // faStop imported for this
		// END MODIFICATION

		// click event listener for cancelParseErrorButton as requested
		// This listener is added within initializeWebview as part of UI setup.
		if (cancelParseErrorButton) {
			cancelParseErrorButton.addEventListener("click", () => {
				console.log("Cancel Parse Error button clicked."); // ADDED console.log here
				// 2a. Hide the error container
				if (planParseErrorContainer) {
					planParseErrorContainer.style.display = "none";
				}
				// 2b. Clear the error display fields
				if (planParseErrorDisplay) {
					planParseErrorDisplay.textContent = "";
				}
				if (failedJsonDisplay) {
					failedJsonDisplay.textContent = "";
				}
				// 2c. Inform the extension that the plan execution (and thus retry) is cancelled
				vscode.postMessage({ type: "cancelPlanExecution" }); // This message type already handles necessary provider-side cleanup
				updateStatus("Plan generation retry cancelled.");
				// 2d. Re-enable general inputs and update button states
				// Calling setLoadingState(false) handles re-enabling based on API key status
				// and ensures the chat loading message is removed if present.
				setLoadingState(false); // This call now correctly manages all button states based on the hidden UI.
			});
		}
		// END Add click event listener for cancelParseErrorButton

		// click event listener for cancelGenerationButton
		if (cancelGenerationButton) {
			cancelGenerationButton.addEventListener("click", () => {
				console.log("Cancel Generation button clicked."); // ADDED console.log here
				// 1. Hide the button immediately (redundant as setLoadingState will hide it, but good for instant feedback)
				// cancelGenerationButton.style.display = "none"; // Removed - setLoadingState(false) handles this
				// 2. Send message to extension to cancel
				vscode.postMessage({ type: "cancelGeneration" });
				// 3. Call setLoadingState(false) to re-enable other inputs and clean up loading state
				// The reenableInput message from the provider is the most reliable signal
				// that cancellation has been fully processed. Removing this immediate setLoadingState(false)
				// call here to avoid potential race conditions and rely on the provider's message.
				// setLoadingState(false); // Removed - Rely on 'reenableInput' message

				// Update status immediately
				updateStatus("Cancelling operation...");
				// The 'reenableInput' message from the provider will trigger the final setLoadingState(false)
				// and the "Operation cancelled by user." chat message and status update.
			});
		}
		// END Add click event listener for cancelGenerationButton

		// event delegation listener for copy buttons on chatContainer
		if (chatContainer) {
			chatContainer.addEventListener("click", async (event) => {
				const target = event.target as HTMLElement;
				const copyButton = target.closest(
					".copy-button"
				) as HTMLButtonElement | null;
				const deleteButton = target.closest(
					".delete-button"
				) as HTMLButtonElement | null;

				// Check if a copy button was clicked and it's enabled
				if (copyButton && !copyButton.disabled) {
					const messageElement = copyButton.closest(".message");
					if (messageElement) {
						// Find the text content element (the span with class 'message-text-content')
						const textElement = messageElement.querySelector(
							".message-text-content"
						) as HTMLSpanElement | null;

						if (textElement) {
							// Get the rendered HTML content of the text element
							// This captures markdown formatting like code blocks correctly
							const textToCopyHTML = textElement.innerHTML;

							// Use a temporary element to convert HTML to plain text while preserving newlines from <br> and block elements
							const tempDiv = document.createElement("div");
							tempDiv.innerHTML = textToCopyHTML;

							// Convert block elements and <br> to newlines
							Array.from(
								tempDiv.querySelectorAll(
									"p, pre, ul, ol, li, div, br, h1, h2, h3, h4, h5, h6, blockquote, table, tr"
								)
							).forEach((el) => {
								if (el.tagName === "BR") {
									el.replaceWith("\n");
								} else if (el.tagName === "LI") {
									// newline before list items, unless it's the first item in its parent
									if (el.previousElementSibling) {
										el.prepend("\n");
									}
								} else if (el.tagName === "TR") {
									// newline before table rows, unless it's the first row in its parent
									if (el.previousElementSibling) {
										el.prepend("\n");
									}
								} else {
									el.append("\n"); // newline after most block elements
								}
							});

							// Get the text content and clean up extra newlines
							let textToCopy = tempDiv.textContent || tempDiv.innerText || ""; // Use textContent or innerText
							textToCopy = textToCopy.replace(/\n{3,}/g, "\n\n"); // Reduce multiple newlines to max two
							textToCopy = textToCopy.replace(/^\n+/, ""); // Remove leading newlines
							textToCopy = textToCopy.replace(/\n+$/, ""); // Remove trailing newlines
							textToCopy = textToCopy.trim(); // Trim leading/trailing whitespace (redundant after newline trim?)

							// Additional cleanup for lists/tables where prepending newlines might create issues
							textToCopy = textToCopy.replace(/\n\s*\n/g, "\n\n"); // Replace newline + whitespace + newline with just two newlines

							try {
								await navigator.clipboard.writeText(textToCopy);
								console.log("Text copied to clipboard.");

								// Visual feedback: Temporarily change icon
								const originalIconHTML = copyButton.innerHTML; // Store original icon HTML
								setIconForButton(copyButton, faCheck); // Change to check icon
								copyButton.title = "Copied!";

								// Revert icon after a delay
								setTimeout(() => {
									copyButton.innerHTML = originalIconHTML; // Restore original icon HTML
									copyButton.title = "Copy Message"; // Restore tooltip
								}, 1500); // 1.5 seconds delay
							} catch (err) {
								console.error("Failed to copy text: ", err);
								// Check if clipboard API is supported or permission denied
								let errorMessage = "Failed to copy text.";
								if (err instanceof Error && err.message) {
									errorMessage += ` Details: ${err.message}`;
								}
								updateStatus(errorMessage, true);
							}
						} else {
							console.warn("Could not find text span for copy button.");
							updateStatus("Error: Could not find text to copy.", true);
						}
					} else {
						console.warn(
							"Copy button clicked, but parent message element not found."
						);
					}
				} else if (deleteButton && !deleteButton.disabled) {
					// New logic for delete button
					const messageElementToDelete = deleteButton.closest(
						".message[data-is-history='true']"
					); // MODIFIED: Filter by data-is-history attribute
					if (messageElementToDelete) {
						// Get all .message elements within chatContainer that are history messages
						const allHistoryMessages = Array.from(
							chatContainer.querySelectorAll(".message[data-is-history='true']") // MODIFIED: Filter by data-is-history attribute
						);
						const messageIndex = allHistoryMessages.indexOf(
							messageElementToDelete
						); // MODIFIED: Use allHistoryMessages

						if (messageIndex !== -1) {
							vscode.postMessage({
								type: "deleteSpecificMessage",
								messageIndex: messageIndex,
							});
							updateStatus("Requesting message deletion...");
						} else {
							console.warn(
								"Could not find index of history message to delete (after data-is-history filter)."
							); // NEW console.warn
						}
					} else {
						console.warn(
							"Delete button clicked, but target is not a history-backed message."
						); // NEW console.warn
					}
				}
			});
		}
		// END Add event delegation listener for copy buttons

		// Create plan confirmation UI elements (initially hidden)
		createPlanConfirmationUI();
		// Note: Plan parse error UI elements are expected to be in the HTML.
		// Their container (planParseErrorContainer) should be initially hidden via CSS (e.g., style="display: none;").

		updateEmptyChatPlaceholderVisibility(); // Call immediately after the DOM elements are initialized.
		console.log("[DEBUG] initializeWebview completed.");
	}

	initializeWebview();
}

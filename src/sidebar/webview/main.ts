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
	faCheck, // Already imported for confirmation button, also used for copy feedback
	faTimes, // Already imported for cancel buttons
	faRedo, // Already imported for retry button
	faStop, // Already imported for cancel generation button
	faCopy, // Added for copy message button
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
	faRedo, // Added new icon to library
	faStop, // Added new icon to library
	faCopy // Added copy icon to library
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
// START MODIFICATION: Get reference to the new #cancel-generation-button
const cancelGenerationButton = document.getElementById(
	"cancel-generation-button"
) as HTMLButtonElement | null;
// END MODIFICATION

let planConfirmationContainer: HTMLDivElement | null = null;
let confirmPlanButton: HTMLButtonElement | null = null;
let cancelPlanButton: HTMLButtonElement | null = null;

// START MODIFICATION: Declare new DOM element variables for the parse error UI
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
// END MODIFICATION: Declare new DOM element variables for the parse error UI

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

// START MODIFICATION: Add new DOM elements to the critical elements null check
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
	!cancelParseErrorButton // Added cancelParseErrorButton to critical elements check
) {
	// END MODIFICATION: Add new DOM elements to the critical elements null check
	console.error("Required DOM elements not found!");
	const body = document.querySelector("body");
	if (body) {
		body.innerHTML =
			'<p style="color: var(--vscode-errorForeground); font-weight: bold;">Error initializing webview UI. Please check console (Developer: Open Webview Developer Tools).</p>';
	}
} else {
	// Modified appendMessage to handle stream initialization and add copy button for AI messages
	function appendMessage(sender: string, text: string, className: string = "") {
		if (chatContainer) {
			// If this call is to add a "loading-message"
			if (className === "loading-message") {
				if (chatContainer.querySelector(".loading-message")) {
					// If one already exists
					return; // Don't add another
				}
			} else {
				// If this is any other message (not a loading message itself),
				// remove any existing general "loading-message".
				// This is also handled by aiResponseStart specifically for AI streams.
				const loadingMsg = chatContainer.querySelector(".loading-message");
				if (loadingMsg) {
					loadingMsg.remove();
				}
			}

			const messageElement = document.createElement("div");
			messageElement.classList.add("message");
			if (className) {
				messageElement.classList.add(className);
			}

			const senderElement = document.createElement("strong");
			senderElement.textContent = `${sender}: `;
			messageElement.appendChild(senderElement);

			const textElement = document.createElement("span");
			messageElement.appendChild(textElement); // Always append text element

			let copyButton: HTMLButtonElement | null = null;

			// START MODIFICATION: Add copy button for AI messages
			if (sender === "Model" && className === "ai-message") {
				copyButton = document.createElement("button");
				copyButton.classList.add("copy-button");
				copyButton.title = "Copy Message";
				messageElement.appendChild(copyButton); // Append button after the text element
				setIconForButton(copyButton, faCopy); // Set the initial copy icon

				if (text === "") {
					// This is the start of a stream (called by aiResponseStart)
					currentAiMessageContentElement = textElement;
					currentAccumulatedText = ""; // text is already empty string from aiResponseStart
					// Set initial HTML to the loading indicator
					textElement.innerHTML =
						'<span class="loading-text">Loading<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';
					// Disable copy button while content is loading/streaming
					copyButton.disabled = true;
				} else {
					// This is a complete non-streamed AI message
					const renderedHtml = md.render(text);
					textElement.innerHTML = renderedHtml;
					// For non-streaming AI message, button is enabled immediately (assuming appendMessage is called after content is ready)
					copyButton.disabled = false;
				}
			} else {
				// For user messages, system messages, etc.
				const renderedHtml = md.render(text);
				textElement.innerHTML = renderedHtml;
				// No copy button for non-AI messages
			}
			// END MODIFICATION: Add copy button for AI messages

			chatContainer.appendChild(messageElement);
			chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll to bottom

			// The button states related to chat content count are now managed primarily by setLoadingState
			// and potentially during history restoration, but this simple check here is still helpful
			// immediately after a message is added to potentially enable them if they were previously disabled
			// due to an empty chat *and* the UI is not blocked.
			// However, relying solely on setLoadingState(false) calls after operations finish is more robust.
			// Let's remove this redundant update here and rely on explicit setLoadingState calls.
			/*
			const hasMessages = chatContainer.childElementCount > 0;
			if (clearChatButton && saveChatButton) {
				clearChatButton.disabled = !hasMessages;
				saveChatButton.disabled = !hasMessages;
			}
			*/
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
			setTimeout(() => {
				if (statusArea.textContent === sanitizedText) {
					statusArea.textContent = "";
				}
			}, 5000);
		}
	}

	function sendMessage() {
		if (isLoading || !chatInput || !sendButton) {
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
				"error-message"
			);
			return;
		}

		// setLoadingState(true) will be called, which now handles hiding planParseErrorContainer
		if (fullMessage.toLowerCase().startsWith("/plan ")) {
			const planRequest = fullMessage.substring(6).trim();
			if (!planRequest) {
				appendMessage(
					"System",
					"Please provide a description for the plan after /plan.",
					"error-message"
				);
				return;
			}
			appendMessage("You", fullMessage, "user-message");
			vscode.postMessage({ type: "planRequest", value: planRequest });
			setLoadingState(true);
		} else if (fullMessage.toLowerCase().startsWith("/commit")) {
			appendMessage("You", fullMessage, "user-message");
			vscode.postMessage({ type: "commitRequest" });
			setLoadingState(true);
		} else {
			appendMessage("You", fullMessage, "user-message");
			vscode.postMessage({ type: "chatMessage", value: fullMessage });
			setLoadingState(true);
		}
	}

	// Modified setLoadingState to control button states based on loading and UI visibility
	function setLoadingState(loading: boolean) {
		isLoading = loading; // Keep track of overall loading state

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
		if (modelSelect) {
			modelSelect.disabled = !enableSendControls;
		}

		// START USER REQUESTED MODIFICATION: Control load/save/clear buttons
		// Determine if chat history buttons can be interacted with
		// Enabled only if not loading AND neither blocking UI is visible
		const canInteractWithChatHistoryButtons =
			!loading && !planConfirmationVisible && !planParseErrorVisible;

		// Determine if there are messages in the chat container
		const hasMessages = chatContainer
			? chatContainer.childElementCount > 0
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

		// START MODIFICATION: Manage cancel generation button visibility
		if (cancelGenerationButton) {
			// Button should be visible only when loading is true AND neither
			// plan confirmation nor plan parse error UI is currently active.
			if (loading && !planConfirmationVisible && !planParseErrorVisible) {
				// Show the cancel button
				cancelGenerationButton.style.display = "inline-flex"; // Or 'block' depending on desired layout
			} else {
				// Hide the cancel button if not loading, or if a specific UI block is active
				cancelGenerationButton.style.display = "none";
			}
		}
		// END MODIFICATION

		if (loading) {
			// Point 4.a (from review instructions): When loading is true, append "Creating..." message if appropriate.
			// This is for the initial user send, before the AI stream begins.
			// Point 4.c (from review instructions): The aiResponseStart handler will reliably remove this "Creating..."
			// message when the actual AI stream begins.
			if (
				!currentAiMessageContentElement && // Check if not already actively streaming an AI response
				!chatContainer?.querySelector(".loading-message") // And if a loading message isn't already present
			) {
				appendMessage(
					"Model",
					"Creating...Don't change the file view while plan execution is in progress...Sit tight while Minovative Mind work for you",
					"loading-message"
				);
			}
		} else {
			// Point 4.b (from review instructions): If loading is set to false, ensure any "Creating..." message is removed.
			const loadingMsg = chatContainer?.querySelector(".loading-message");
			if (loadingMsg) {
				loadingMsg.remove();
			}
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

		// START MODIFICATION: Hide planParseErrorContainer if a new message is sent (loading becomes true)
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
					} else if (
						// This is the #cancel-plan-button logic being reviewed
						target.id === "cancel-plan-button" ||
						target.closest("#cancel-plan-button")
					) {
						// Correctly sends the cancel message
						vscode.postMessage({ type: "cancelPlanExecution" });
						updateStatus("Plan cancelled.");
						// Correctly hides the confirmation UI
						planConfirmationContainer!.style.display = "none";
						// Correctly clears pending plan data
						pendingPlanData = null;
						// Correctly re-enables inputs as plan flow is cancelled
						setLoadingState(false); // This call now correctly manages all button states
					}
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

	sendButton.addEventListener("click", sendMessage);
	chatInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	});
	modelSelect.addEventListener("change", () => {
		const selectedModel = modelSelect.value;
		vscode.postMessage({ type: "selectModel", value: selectedModel });
		updateStatus(`Requesting switch to model: ${selectedModel}...`);
	});
	addKeyButton.addEventListener("click", () => {
		const apiKey = addKeyInput!.value.trim();
		if (apiKey) {
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
		vscode.postMessage({ type: "switchToPrevKey" });
		updateApiKeyStatus("Switching key...");
	});
	nextKeyButton.addEventListener("click", () => {
		vscode.postMessage({ type: "switchToNextKey" });
		updateApiKeyStatus("Switching key...");
	});
	deleteKeyButton.addEventListener("click", () => {
		vscode.postMessage({ type: "requestDeleteConfirmation" });
		updateApiKeyStatus("Waiting for delete confirmation...");
	});
	// Clear/Save/Load listeners are correct, they trigger actions handled elsewhere.
	// Button disabled states are managed by setLoadingState.
	clearChatButton.addEventListener("click", () => {
		vscode.postMessage({ type: "clearChatRequest" });
	});
	saveChatButton.addEventListener("click", () => {
		vscode.postMessage({ type: "saveChatRequest" });
		updateStatus("Requesting chat save...");
	});
	loadChatButton.addEventListener("click", () => {
		vscode.postMessage({ type: "loadChatRequest" });
		updateStatus("Requesting chat load...");
	});

	// START MODIFICATION: Add event listener for retryGenerationButton
	if (retryGenerationButton) {
		retryGenerationButton.addEventListener("click", () => {
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

			// --- START USER REQUESTED MODIFICATION ---
			// These lines are redundant as setLoadingState(true) handles disabling buttons. Removed.
			// --- END USER REQUESTED MODIFICATION ---
		});
	}
	// END MODIFICATION

	window.addEventListener("message", (event: MessageEvent) => {
		const message = event.data;
		console.log("[Webview] Message received from extension:", message.type);

		switch (message.type) {
			// Case for non-streamed, complete AI responses.
			// Can also handle plans that require confirmation if message includes relevant flags.
			case "aiResponse": {
				// First, append the message content from the AI.
				// Assumes message.value contains the textual content to display.
				appendMessage(
					"Model",
					message.value,
					message.isError ? "error-message" : "ai-message"
				);

				// Then, handle plan confirmation or loading state.
				if (
					message.isPlanResponse &&
					message.requiresConfirmation &&
					message.planData
				) {
					// This part handles non-streamed AI responses that are plans requiring user confirmation.
					createPlanConfirmationUI(); // Ensure UI elements for confirmation are ready.
					if (planConfirmationContainer) {
						pendingPlanData = message.planData as {
							// Store the plan data for later execution.
							type: string;
							originalRequest?: string;
							originalInstruction?: string;
						};
						planConfirmationContainer.style.display = "flex"; // Show the confirmation UI.
						updateStatus(
							"Textual plan generated. Review and confirm to proceed."
						);

						// Disable chat inputs while plan confirmation is visible.
						// These will be disabled by the setLoadingState call in the confirm/cancel listeners,
						// but explicitly setting them here ensures they are disabled immediately upon showing the plan confirmation UI.
						// Also, setLoadingState is *not* called with false here, so global state remains "not loading" but UI is blocked.
						if (chatInput) {
							chatInput.disabled = true;
						}
						if (sendButton) {
							sendButton.disabled = true;
						}
						if (modelSelect) {
							modelSelect.disabled = true;
						}
						// START MODIFICATION: Hide cancel button when plan confirmation shows
						if (cancelGenerationButton) {
							cancelGenerationButton.style.display = "none";
						}
						// END MODIFICATION
						// Button states for save/load/clear will be correctly disabled because planConfirmationVisible is true.
					} else {
						// Fallback if UI creation failed.
						console.error(
							"Plan confirmation container failed to create or find for non-streamed plan!"
						);
						updateStatus("Error: UI for plan confirmation is missing.", true);
						setLoadingState(false); // Set loading to false as plan confirmation cannot be shown. This will also manage buttons.
					}
				} else if (message.isLoading === false) {
					// This handles regular non-streamed messages or non-confirmable parts of plans.
					// If message.isLoading is explicitly false, it means the AI operation is complete.
					setLoadingState(false); // This call now correctly manages all button states
				}
				// If message.isLoading is true (or not provided) and it's not a confirmable plan,
				// setLoadingState is NOT called, meaning loading state persists (or wasn't set true initially).
				break;
			}

			// --- New handlers for streamed responses ---
			case "aiResponseStart": {
				// Point 1.c (from review instructions): Ensure any generic "Creating..." or similar loading message is removed.
				const loadingMsg = chatContainer?.querySelector(".loading-message");
				if (loadingMsg) {
					loadingMsg.remove();
				}
				// Point 1.b (from review instructions): Ensure appendMessage("Model", "", "ai-message") is called.
				// This call also handles Point 1.a:
				// It leads to the initialization/reset of currentAiMessageContentElement and currentAccumulatedText
				// within the appendMessage function (see its definition) for a new AI stream.
				// START MODIFICATION: appendMessage now adds a disabled copy button for streaming messages
				appendMessage("Model", "", "ai-message");
				// END MODIFICATION
				// setLoadingState(true) was called when the user sent the message.
				// We are now in the process of receiving the response, so loading is still active.
				// No need to call setLoadingState(false) here. Button states are already handled by the initial setLoadingState(true).
				break;
			}
			case "aiResponseChunk": {
				if (currentAiMessageContentElement && message.value !== undefined) {
					// Point 2.a (from review instructions): Correctly appends message.value to currentAccumulatedText.
					currentAccumulatedText += message.value;
					// Point 2.b (from review instructions): Updates currentAiMessageContentElement.innerHTML with rendered markdown.
					currentAiMessageContentElement.innerHTML = md.render(
						currentAccumulatedText
					);
					if (chatContainer) {
						// Point 2.c (from review instructions): chatContainer.scrollTop = chatContainer.scrollHeight is called.
						chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll to keep latest content visible
					}
				}
				break;
			}
			case "aiResponseEnd": {
				// MODIFICATION START: Introduce planConfirmationWasShown flag
				let planConfirmationWasShown = false;
				// MODIFICATION END

				// After stream ends, finalize the message content and handle UI updates
				if (currentAiMessageContentElement) {
					// Finalize the content in the DOM
					const renderedHtml = md.render(currentAccumulatedText);
					currentAiMessageContentElement.innerHTML = renderedHtml;

					// Find the copy button for this message and enable it
					const messageElement = currentAiMessageContentElement.parentElement;
					if (messageElement) {
						const copyButton = messageElement.querySelector(
							".copy-button"
						) as HTMLButtonElement | null;
						if (copyButton) {
							copyButton.disabled = false; // Enable the copy button
						}
					}
				}

				// Point 3.a (from review instructions): Verify error display if !message.success && message.error.
				// Condition changed to use !message.success and message.error.
				if (!message.success && message.error) {
					const errorMessageContent =
						typeof message.error === "string"
							? message.error
							: "Unknown error from AI response end.";

					// MODIFICATION 2: Updated error handling logic for currentAiMessageContentElement
					// If there was an active stream, append error to it. Otherwise, add a new system message.
					if (
						currentAiMessageContentElement &&
						currentAiMessageContentElement.parentElement
					) {
						const errorHtml = `<p style="color: var(--vscode-errorForeground);"><strong>Error:</strong> ${md.renderInline(
							errorMessageContent
						)}</p>`;
						// Always append error if stream element exists, regardless of text length,
						// as the loading spinner was replaced by the final content just above.
						currentAiMessageContentElement.innerHTML += `<br>${errorHtml}`;
					} else {
						// If no stream was active or element is gone, append as a new system error message.
						appendMessage(
							"System",
							`Error during response: ${errorMessageContent}`,
							"error-message"
						);
					}
					// If there was an error, we should definitely set loading to false and re-enable inputs.
					setLoadingState(false); // This call now correctly manages all button states
				}
				// Handle plan confirmation if the stream was successful and resulted in a plan.
				// Condition changed to use message.success.
				else if (
					message.success &&
					message.isPlanResponse &&
					message.planData
				) {
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
						// As in aiResponse, these are explicitly disabled here upon showing the UI.
						if (chatInput) {
							chatInput.disabled = true;
						}
						if (sendButton) {
							sendButton.disabled = true;
						}
						if (modelSelect) {
							modelSelect.disabled = true;
						}
						// MODIFICATION START: Hide cancel button when plan confirmation shows
						if (cancelGenerationButton) {
							cancelGenerationButton.style.display = "none";
						}
						// MODIFICATION END
						// MODIFICATION START: Set planConfirmationWasShown to true
						planConfirmationWasShown = true;
						// MODIFICATION END
						// Button states for save/load/clear will be correctly disabled because planConfirmationVisible is true.
						// setLoadingState(false) is *not* called here, as the state is now awaiting confirmation.
					} else {
						// Fallback if UI creation failed.
						console.error(
							"Plan confirmation container failed to create or find!"
						);
						updateStatus("Error: UI for plan confirmation is missing.", true);
						// planConfirmationWasShown remains false, so setLoadingState(false) will be called below.
						setLoadingState(false); // Fallback to re-enable if UI failed to show.
					}
				} else if (message.success) {
					// This is a successful streamed response that is NOT a plan requiring confirmation.
					// Inputs should be re-enabled.
					setLoadingState(false); // This call now correctly manages all button states
				}
				// If !message.success but no message.error (shouldn't happen but defensive),
				// or if message.success is false and message.error exists (handled above), setLoadingState(false) is called.
				// If message.success is true and it's a confirmable plan (handled above), setLoadingState(false) is NOT called.
				// If message.success is true and NOT a confirmable plan (handled above), setLoadingState(false) IS called.

				// Point 3.c (from review instructions): Confirm that currentAiMessageContentElement = null; and currentAccumulatedText = ""; are always called
				// to reset state for the next stream.
				currentAiMessageContentElement = null;
				currentAccumulatedText = "";
				break;
			}
			// --- End new handlers for streamed responses ---

			// START MODIFICATION: Add new case for 'structuredPlanParseFailed'
			case "structuredPlanParseFailed": {
				const { error, failedJson } = message.value;

				if (
					planParseErrorContainer &&
					planParseErrorDisplay &&
					failedJsonDisplay &&
					retryGenerationButton
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

					// --- START USER REQUESTED MODIFICATION ---
					// These lines are redundant as setLoadingState(false) handles enabling buttons. Removed.
					// --- END USER REQUESTATION MODIFICATION ---
				} else {
					// Fallback if UI elements are missing
					console.error(
						"Parse error UI elements not found. Cannot display structured plan parse failure."
					);
					appendMessage(
						"System",
						`Structured plan parsing failed: ${error}. Failed JSON: ${failedJson}. Error UI missing.`,
						"error-message"
					);
					setLoadingState(false); // Still set loading to false, manages buttons based on no UI block.
				}
				break;
			}
			// END MODIFICATION

			// START MODIFICATION: Add new case for 'restorePendingPlanConfirmation'
			case "restorePendingPlanConfirmation":
				if (message.value) {
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

						// START MODIFICATION: Hide cancel button when plan confirmation shows on restore
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
			// END MODIFICATION: Add new case for 'restorePendingPlanConfirmation'

			// START MODIFICATION: Add new case for 'appendRealtimeModelMessage'
			case "appendRealtimeModelMessage":
				// This case handles messages that should be directly appended to the chat as if they were from the Model.
				// It's intended for real-time updates or messages from the model that are not part of a typical streaming response.
				if (message.value && typeof message.value.text === "string") {
					appendMessage("Model", message.value.text, "ai-message");
					// After adding a message, update button states based on content count, but only if not blocked
					// Calling setLoadingState(isLoading) re-evaluates button states based on current state and UI visibility
					setLoadingState(isLoading);
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
				}
				break;
			}
			case "statusUpdate": {
				if (typeof message.value === "string") {
					updateStatus(message.value, message.isError ?? false);
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
					prevKeyButton!.disabled = totalKeys <= 1;
					nextKeyButton!.disabled = totalKeys <= 1;
					deleteKeyButton!.disabled = updateData.activeIndex === -1;

					// Re-evaluate input states based on API key status and current UI state
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
				// After potentially hiding UI and setting loading=false, setLoadingState was called,
				// which correctly updates all button states including save/clear based on the empty chat.
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
							appendMessage(msg.sender, msg.text, msg.className || "");
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
				// After potentially hiding UI and setting loading=false, setLoadingState was called,
				// which correctly updates all button states including save/clear based on the restored chat content.
				break;
			}
			// START MODIFICATION: Modify 'reenableInput' handler
			case "reenableInput": {
				console.log("Received reenableInput request from provider.");
				// This message signals an operation was cancelled or an error occurred requiring input re-enabling.

				// Always set isLoading to false, as the operation that was loading is now considered finished or cancelled.
				isLoading = false;

				// Remove any general "Creating..." or "Loading..." message from chat, similar to setLoadingState(false) logic.
				const loadingMsg = chatContainer?.querySelector(".loading-message");
				if (loadingMsg) {
					loadingMsg.remove();
				}

				// Ensure streaming state is also reset if this happens unexpectedly mid-stream
				if (currentAiMessageContentElement) {
					console.warn(
						"reenableInput received mid-stream. Resetting stream state."
					);
					currentAiMessageContentElement = null;
					currentAccumulatedText = "";
				}

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
			// END MODIFICATION: Modify 'reenableInput' handler
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

		// START USER REQUESTED MODIFICATION: Initial button states
		// Disabled until API key is confirmed and not loading and no blocking UI
		chatInput!.disabled = true;
		sendButton!.disabled = true;
		modelSelect!.disabled = true;

		// Disabled initially because there are no messages
		clearChatButton!.disabled = true;
		saveChatButton!.disabled = true;

		// Enabled initially as loading history is always possible unless loading/blocked
		loadChatButton!.disabled = false;

		// Key navigation buttons
		prevKeyButton!.disabled = true;
		nextKeyButton!.disabled = true;
		deleteKeyButton!.disabled = true;

		// END USER REQUESTED MODIFICATION

		// START MODIFICATION: Set initial display state for the cancel button
		if (cancelGenerationButton) {
			cancelGenerationButton.style.display = "none";
		}
		// END MODIFICATION

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
		// START MODIFICATION: Set icon for the cancel generation button
		setIconForButton(cancelGenerationButton, faStop); // faStop imported for this
		// END MODIFICATION

		// START MODIFICATION: Add click event listener for cancelParseErrorButton as requested
		// This listener is added within initializeWebview as part of UI setup.
		if (cancelParseErrorButton) {
			cancelParseErrorButton.addEventListener("click", () => {
				console.log("Cancel Parse Error button clicked.");
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
		// END MODIFICATION: Add click event listener for cancelParseErrorButton

		// START MODIFICATION: Add click event listener for cancelGenerationButton
		if (cancelGenerationButton) {
			cancelGenerationButton.addEventListener("click", () => {
				console.log("Cancel Generation button clicked.");
				// 1. Hide the button immediately (redundant as setLoadingState will hide it, but good for instant feedback)
				cancelGenerationButton.style.display = "none";
				// 2. Send message to extension to cancel
				vscode.postMessage({ type: "cancelGeneration" });
				// 3. Call setLoadingState(false) to re-enable other inputs and clean up loading state
				setLoadingState(false); // This will correctly re-enable inputs/buttons based on no longer being isLoading and no blocking UI.
				updateStatus("Generation cancelled.");
			});
		}
		// END MODIFICATION: Add click event listener for cancelGenerationButton

		// START MODIFICATION: Add event delegation listener for copy buttons on chatContainer
		if (chatContainer) {
			chatContainer.addEventListener("click", async (event) => {
				const target = event.target as HTMLElement;
				const copyButton = target.closest(
					".copy-button"
				) as HTMLButtonElement | null;

				if (copyButton && !copyButton.disabled) {
					// Ensure the button is clickable
					const messageElement = copyButton.closest(".message");
					if (messageElement) {
						// The text content is in the span right before the copy button within the message div
						// Querying for the first span within the message should get the text element
						const textElement = messageElement.querySelector("span");
						// Also ensure the span is not the copy button itself, although querySelector should prevent this
						if (textElement && textElement !== copyButton) {
							// Get the raw text content from the span
							const textToCopy = textElement.textContent || "";

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
				}
			});
		}
		// END MODIFICATION: Add event delegation listener for copy buttons

		// Create plan confirmation UI elements (initially hidden)
		createPlanConfirmationUI();
		// Note: Plan parse error UI elements are expected to be in the HTML.
		// Their container (planParseErrorContainer) should be initially hidden via CSS (e.g., style="display: none;").
	}

	initializeWebview();
}

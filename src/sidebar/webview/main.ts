// src/sidebar/webview/main.ts

interface VsCodeApi {
	postMessage(message: any): void;
	getState(): any;
	setState(newState: any): void;
}
declare const acquireVsCodeApi: () => VsCodeApi;
const vscode = acquireVsCodeApi();

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
// Key Management Elements
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
// Chat Action Buttons
const saveChatButton = document.getElementById(
	"save-chat-button"
) as HTMLButtonElement | null;
const loadChatButton = document.getElementById(
	"load-chat-button"
) as HTMLButtonElement | null;
const clearChatButton = document.getElementById(
	"clear-chat-button"
) as HTMLButtonElement | null;
// Status Area
const statusArea = document.getElementById(
	"status-area"
) as HTMLDivElement | null;

// State
let isApiKeySet = false;
let isLoading = false;
let totalKeys = 0;

console.log("Webview script loaded.");

// Check for essential elements (now includes new buttons)
if (
	!sendButton ||
	!chatInput ||
	!chatContainer ||
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
	!statusArea // Add statusArea check
) {
	console.error("Required DOM elements not found!");
	const body = document.querySelector("body");
	if (body) {
		body.innerHTML =
			'<p style="color: var(--vscode-errorForeground); font-weight: bold;">Error initializing webview UI. Please check console (Developer: Open Webview Developer Tools).</p>';
	}
} else {
	// --- Event Listeners ---
	sendButton.addEventListener("click", sendMessage);
	chatInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	});

	// Key Management Listeners (keep existing)
	addKeyButton.addEventListener("click", () => {
		const apiKey = addKeyInput.value.trim();
		if (apiKey) {
			vscode.postMessage({ type: "addApiKey", value: apiKey });
			addKeyInput.value = "";
			updateApiKeyStatus("Adding key..."); // Give immediate feedback
		} else {
			updateApiKeyStatus("Error: Please enter an API key to add.");
		}
	});
	addKeyInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			addKeyButton.click();
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
		console.log(
			"[Webview] Delete button clicked. Sending 'requestDeleteConfirmation'."
		);
		vscode.postMessage({ type: "requestDeleteConfirmation" });
		updateApiKeyStatus("Waiting for delete confirmation..."); // Immediate feedback
	});

	// New Chat Action Listeners
	clearChatButton.addEventListener("click", () => {
		vscode.postMessage({ type: "clearChatRequest" });
		// Don't clear UI immediately, wait for confirmation message ('chatCleared')
	});
	saveChatButton.addEventListener("click", () => {
		vscode.postMessage({ type: "saveChatRequest" });
		updateStatus("Requesting chat save..."); // Use general status area
	});
	loadChatButton.addEventListener("click", () => {
		vscode.postMessage({ type: "loadChatRequest" });
		updateStatus("Requesting chat load..."); // Use general status area
	});

	// --- Core Functions ---
	function sendMessage() {
		// ... (keep existing sendMessage logic, but remove the apiKeyStatus update)
		if (isLoading) {
			return;
		}
		const message = chatInput?.value.trim();
		if (chatInput) {
			chatInput.value = "";
		} // Clear input *after* getting value
		if (message) {
			if (!isApiKeySet) {
				appendMessage(
					"System",
					"Please add or select a valid API Key first.",
					"error-message" // Use error class
				);
				return;
			}
			appendMessage("You", message, "user-message");
			vscode.postMessage({ type: "chatMessage", value: message });
			setLoadingState(true);
		} else {
			console.log("Empty message submitted.");
		}
	}

	function setLoadingState(loading: boolean) {
		// ... (keep existing setLoadingState logic, but use correct element IDs/classes)
		isLoading = loading;
		if (sendButton && chatInput) {
			sendButton.disabled = loading;
			chatInput.disabled = loading;
			if (loading) {
				// Ensure we don't add multiple "Thinking..." messages
				const lastMessage = chatContainer?.lastElementChild;
				if (
					!lastMessage ||
					!lastMessage.classList.contains("loading-message")
				) {
					appendMessage("Gemini", "Thinking...", "loading-message");
				}
			} else {
				// Remove "Thinking..." message if it's the last one
				const lastMessage = chatContainer?.lastElementChild;
				if (lastMessage && lastMessage.classList.contains("loading-message")) {
					lastMessage.remove();
				}
			}
		}
	}

	// --- Message Handling from Extension Host ---
	window.addEventListener("message", (event: MessageEvent) => {
		const message = event.data;
		console.log("Message received from extension:", message.type); // Log type

		switch (message.type) {
			case "aiResponse": {
				setLoadingState(false);
				appendMessage(
					"Gemini",
					message.value,
					message.isError ? "error-message" : "ai-message"
				);
				break;
			}
			case "apiKeyStatus": {
				if (typeof message.value === "string") {
					updateApiKeyStatus(message.value);
				}
				break;
			}
			case "statusUpdate": {
				// Handle general status updates
				if (typeof message.value === "string") {
					updateStatus(message.value);
				}
				break;
			}
			case "updateKeyList": {
				// ... (keep existing key list update logic)
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
						currentKeyDisplay.textContent =
							updateData.keys[updateData.activeIndex].maskedKey;
						updateApiKeyStatus(
							`Using key ${updateData.activeIndex + 1} of ${totalKeys}.`
						); // Use the dedicated status div
					} else {
						currentKeyDisplay.textContent = "No active key";
						updateApiKeyStatus("Please add an API key.");
						apiKeyStatusDiv.style.color = "var(--vscode-errorForeground)"; // Set error color here too
					}

					prevKeyButton.disabled = totalKeys <= 1;
					nextKeyButton.disabled = totalKeys <= 1;
					deleteKeyButton.disabled = updateData.activeIndex === -1;
					chatInput.disabled = !isApiKeySet || isLoading;
					sendButton.disabled = !isApiKeySet || isLoading;
					// Enable chat action buttons if there's history potentially
					clearChatButton.disabled = chatContainer.childElementCount === 0;
					saveChatButton.disabled = chatContainer.childElementCount === 0;
					// Load button is always enabled
				} else {
					console.error("Invalid 'updateKeyList' message received:", message);
				}
				break;
			}
			// --- New Handlers ---
			case "chatCleared": {
				if (chatContainer) {
					chatContainer.innerHTML = ""; // Clear the display
				}
				appendMessage("System", "Chat history cleared.", "system-message");
				// Update button states after clearing
				clearChatButton.disabled = true;
				saveChatButton.disabled = true;
				break;
			}
			case "restoreHistory": {
				if (chatContainer && Array.isArray(message.value)) {
					chatContainer.innerHTML = ""; // Clear existing messages first
					message.value.forEach((msg: any) => {
						// Add type safety check if possible
						if (msg && msg.sender && msg.text) {
							appendMessage(msg.sender, msg.text, msg.className || "");
						}
					});
					updateStatus("Chat history restored.");
					// Update button states after loading
					const hasMessages = chatContainer.childElementCount > 0;
					clearChatButton.disabled = !hasMessages;
					saveChatButton.disabled = !hasMessages;
				} else {
					updateStatus("Error: Failed to restore chat history format.");
				}
				break;
			}
		}
	});

	// --- Helper Functions ---
	function appendMessage(sender: string, text: string, className: string = "") {
		if (chatContainer) {
			// Remove previous loading message *only* if this isn't another loading msg
			if (className !== "loading-message") {
				const lastMessage = chatContainer.lastElementChild;
				if (lastMessage && lastMessage.classList.contains("loading-message")) {
					lastMessage.remove();
				}
			} else if (chatContainer.querySelector(".loading-message")) {
				// If a loading message already exists, don't add another one
				return;
			}

			const messageElement = document.createElement("div"); // Use div for easier styling/structure
			messageElement.classList.add("message");
			if (className) {
				messageElement.classList.add(className);
			}

			const senderElement = document.createElement("strong");
			senderElement.textContent = `${sender}: `;
			messageElement.appendChild(senderElement);

			const textElement = document.createElement("span");
			// Basic sanitization
			const sanitizedText = text.replace(/</g, "<").replace(/>/g, ">");
			// Convert markdown-like newlines (\n) to <br> for display
			textElement.innerHTML = sanitizedText.replace(/\n/g, "<br>");
			messageElement.appendChild(textElement);

			chatContainer.appendChild(messageElement);

			// Scroll logic (only scroll if near the bottom)
			const isScrolledToBottom =
				chatContainer.scrollHeight - chatContainer.clientHeight <=
				chatContainer.scrollTop + 50; // Add some tolerance

			if (isScrolledToBottom || className === "user-message") {
				// Always scroll for user's own messages
				chatContainer.scrollTop = chatContainer.scrollHeight;
			}

			// Update button states based on whether messages exist
			const hasMessages = chatContainer.childElementCount > 0;
			if (clearChatButton && saveChatButton) {
				clearChatButton.disabled = !hasMessages;
				saveChatButton.disabled = !hasMessages;
			}
		}
	}

	function updateApiKeyStatus(text: string) {
		// ... (keep existing updateApiKeyStatus logic)
		if (apiKeyStatusDiv) {
			const sanitizedText = text.replace(/</g, "<").replace(/>/g, ">");
			apiKeyStatusDiv.textContent = sanitizedText;

			const lowerText = text.toLowerCase();
			if (lowerText.startsWith("error:")) {
				apiKeyStatusDiv.style.color = "var(--vscode-errorForeground)";
			} else if (
				lowerText.startsWith("info:") ||
				lowerText.includes("success") ||
				lowerText.includes("key added") || // More specific checks
				lowerText.includes("key deleted") ||
				lowerText.includes("using key") ||
				lowerText.startsWith("waiting")
			) {
				apiKeyStatusDiv.style.color = "var(--vscode-editorInfo-foreground)";
			} else {
				apiKeyStatusDiv.style.color = "var(--vscode-descriptionForeground)";
			}
		}
	}

	// New function for general status updates
	function updateStatus(text: string, isError = false) {
		if (statusArea) {
			const sanitizedText = text.replace(/</g, "<").replace(/>/g, ">");
			statusArea.textContent = sanitizedText;
			statusArea.style.color = isError
				? "var(--vscode-errorForeground)"
				: "var(--vscode-descriptionForeground)";
			// Optional: fade out the message after a few seconds
			setTimeout(() => {
				if (statusArea.textContent === sanitizedText) {
					// Avoid clearing if a new message arrived
					statusArea.textContent = "";
				}
			}, 5000); // Clear after 5 seconds
		}
	}

	// --- Initialization ---
	function initializeWebview() {
		// Don't add welcome message here, let history restore handle it or show empty state
		vscode.postMessage({ type: "webviewReady" });
		console.log("Webview sent ready message.");
		updateApiKeyStatus("Initializing..."); // Request initial status
		chatInput?.focus();

		if (
			prevKeyButton &&
			nextKeyButton &&
			deleteKeyButton &&
			chatInput &&
			sendButton &&
			clearChatButton &&
			saveChatButton &&
			loadChatButton
		) {
			// Initial button states
			prevKeyButton.disabled = true;
			nextKeyButton.disabled = true;
			deleteKeyButton.disabled = true;
			chatInput.disabled = true;
			sendButton.disabled = true;
			clearChatButton.disabled = true; // Disabled until history loads
			saveChatButton.disabled = true; // Disabled until history loads
			loadChatButton.disabled = false; // Load is always possible
		}
	}

	initializeWebview();
} // Close the 'else' block for element checks

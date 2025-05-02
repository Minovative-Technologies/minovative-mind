// src/sidebar/webview/main.ts

// Type definition for the VS Code API provided by acquireVsCodeApi
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
const saveKeyButton = document.getElementById(
	"save-key-button"
) as HTMLButtonElement | null;
const apiKeyInput = document.getElementById(
	"api-key-input"
) as HTMLInputElement | null;

// State
let isApiKeySet = false; // True if at least one key exists and is active
let isLoading = false;
let totalKeys = 0; // Cache total number of keys

console.log("Webview script loaded.");

// Check for essential elements
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
	!apiKeyStatusDiv
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
		// Send on Enter, newline on Shift+Enter
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault(); // Prevent default newline insertion
			sendMessage();
		}
	});

	// Key Management Listeners
	addKeyButton.addEventListener("click", () => {
		const apiKey = addKeyInput.value.trim();
		if (apiKey) {
			vscode.postMessage({ type: "addApiKey", value: apiKey });
			addKeyInput.value = "";
		} else {
			// Keep this error message for immediate feedback
			updateApiKeyStatus("Error: Please enter an API key to add.");
		}
	});

	addKeyInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			addKeyButton.click(); // Trigger button click on Enter
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
		// --- DIAGNOSTIC LOG (Webview) ---
		console.log(
			"[Webview] Delete button clicked. Sending 'requestDeleteConfirmation' message."
		);
		// REMOVE the confirm() call entirely
		// Just send a request to the provider to show the confirmation
		vscode.postMessage({ type: "requestDeleteConfirmation" });
		// Optional: Give some immediate feedback, though the modal dialog is better
		// updateApiKeyStatus('Waiting for confirmation...');
	});

	saveKeyButton?.addEventListener("click", () => {
		const apiKey = apiKeyInput?.value.trim();
		if (apiKey && apiKeyInput) {
			vscode.postMessage({ type: "apiKeyUpdate", value: apiKey });
			apiKeyInput.value = "";
			updateApiKeyStatus("Attempting to save key...");
		} else {
			updateApiKeyStatus("Error: Please enter an API key.");
		}
	});

	// --- Core Functions ---
	function sendMessage() {
		if (isLoading) {
			return;
		} // Prevent sending multiple messages while waiting

		const message = chatInput?.value.trim();

		if (chatInput) {
			chatInput.value = "";
		} // Clear input immediately after getting value

		if (message) {
			// Check if message had content *before* clearing
			if (!isApiKeySet) {
				appendMessage(
					"System",
					"Please save a valid API Key first.",
					"system-message"
				);
				return;
			}
			appendMessage("You", message, "user-message"); // Add user message to chat
			vscode.postMessage({ type: "chatMessage", value: message });
			// chatInput.value = ""; // <--- REMOVE FROM HERE ---
			setLoadingState(true); // Show loading indicator
		} else {
			// If message was empty after trim, do nothing (or maybe give feedback)
			console.log("Empty message submitted.");
		}
	}

	function setLoadingState(loading: boolean) {
		isLoading = loading;
		if (sendButton && chatInput) {
			sendButton.disabled = loading;
			chatInput.disabled = loading;
			if (loading) {
				appendMessage("Gemini", "Thinking...", "loading-message");
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
		console.log("Message received from extension:", message);

		switch (message.type) {
			case "aiResponse": {
				setLoadingState(false); // Hide loading indicator
				// Simple check if response indicates an error
				const isError =
					typeof message.value === "string" &&
					message.value.toLowerCase().startsWith("error:");
				appendMessage(
					"Gemini",
					message.value,
					isError ? "error-message" : "ai-message"
				);
				break;
			}
			case "apiKeyStatus": {
				// General status updates
				if (typeof message.value === "string") {
					// ALWAYS update the status div with the message from the provider
					updateApiKeyStatus(message.value);
				}
				break;
			}
			case "updateKeyList": {
				// Handle the detailed key list update
				if (message.value && Array.isArray(message.value.keys)) {
					const updateData = message.value as {
						keys: any[];
						activeIndex: number;
						totalKeys: number;
					};
					totalKeys = updateData.totalKeys;
					isApiKeySet = updateData.activeIndex !== -1; // API is set if there's an active key

					if (
						updateData.activeIndex !== -1 &&
						updateData.keys[updateData.activeIndex]
					) {
						currentKeyDisplay.textContent =
							updateData.keys[updateData.activeIndex].maskedKey;
						apiKeyStatusDiv.textContent = `Using key ${
							updateData.activeIndex + 1
						} of ${totalKeys}.`;
						apiKeyStatusDiv.style.color = "var(--vscode-descriptionForeground)"; // Reset color
					} else {
						currentKeyDisplay.textContent = "No active key";
						apiKeyStatusDiv.textContent = "Please add an API key.";
						apiKeyStatusDiv.style.color = "var(--vscode-errorForeground)";
					}

					// Enable/disable buttons based on state
					prevKeyButton.disabled = totalKeys <= 1;
					nextKeyButton.disabled = totalKeys <= 1;
					deleteKeyButton.disabled = updateData.activeIndex === -1; // Disable if no key active
					// Enable chat input only if a key is set and active
					chatInput.disabled = !isApiKeySet || isLoading;
					sendButton.disabled = !isApiKeySet || isLoading;
				} else {
					console.error("Invalid 'updateKeyList' message received:", message);
				}
				break;
			}
		}
	});

	// --- Helper Functions ---
	function appendMessage(sender: string, text: string, className: string = "") {
		if (chatContainer) {
			// Remove previous loading message before adding new message
			if (className !== "loading-message") {
				const lastMessage = chatContainer.lastElementChild;
				if (lastMessage && lastMessage.classList.contains("loading-message")) {
					lastMessage.remove();
				}
			}

			const messageElement = document.createElement("p");
			if (className) {
				messageElement.classList.add(className);
			}
			// Basic sanitization (replace < and > to prevent simple HTML injection)
			// Consider a more robust library (like DOMPurify) if handling complex/untrusted HTML
			const sanitizedText = text.replace(/</g, "<").replace(/>/g, ">");
			// Convert markdown-like newlines (\n) to <br> tags for display
			const formattedText = sanitizedText.replace(/\n/g, "<br>");

			messageElement.innerHTML = `<strong>${sender}:</strong> ${formattedText}`;
			chatContainer.appendChild(messageElement);
			// Scroll to the bottom only if the user isn't scrolled up
			if (
				chatContainer.scrollHeight - chatContainer.scrollTop <=
				chatContainer.clientHeight + 100
			) {
				chatContainer.scrollTop = chatContainer.scrollHeight;
			}
		}
	}

	function updateApiKeyStatus(text: string) {
		// This function now *always* displays the text received
		// in the apiKeyStatus div. Styling is applied based on content.
		if (apiKeyStatusDiv) {
			const sanitizedText = text.replace(/</g, "<").replace(/>/g, ">");
			apiKeyStatusDiv.textContent = sanitizedText; // Set the text directly

			// Apply color based on common prefixes/keywords
			const lowerText = text.toLowerCase();
			if (lowerText.startsWith("error:")) {
				apiKeyStatusDiv.style.color = "var(--vscode-errorForeground)";
			} else if (
				lowerText.startsWith("info:") ||
				lowerText.includes("success") ||
				lowerText.includes(" key added") ||
				lowerText.includes(" deleted")
			) {
				apiKeyStatusDiv.style.color = "var(--vscode-editorInfo-foreground)"; // Use info color for success/info
			} else {
				apiKeyStatusDiv.style.color = "var(--vscode-descriptionForeground)"; // Default color
			}
		}
	}

	// --- Initialization ---
	function initializeWebview() {
		appendMessage(
			"System",
			"Welcome! Manage Gemini API keys below and start chatting.",
			"system-message"
		);
		vscode.postMessage({ type: "webviewReady" }); // Inform extension host
		console.log("Webview sent ready message.");
		updateApiKeyStatus("Initializing key status..."); // Initial status check request
		chatInput?.focus(); // Focus input field on load

		// Initial button state
		if (
			prevKeyButton &&
			nextKeyButton &&
			deleteKeyButton &&
			chatInput &&
			sendButton
		) {
			prevKeyButton.disabled = true;
			nextKeyButton.disabled = true;
			deleteKeyButton.disabled = true;
			chatInput.disabled = true;
			sendButton.disabled = true;
		}
	}

	initializeWebview();
} // Close the 'else' block for element checks

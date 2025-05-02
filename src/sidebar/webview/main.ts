// src/sidebar/webview/main.ts

// Type definition for the VS Code API provided by acquireVsCodeApi
interface VsCodeApi {
	postMessage(message: any): void;
	getState(): any;
	setState(newState: any): void;
}
declare const acquireVsCodeApi: () => VsCodeApi;
const vscode = acquireVsCodeApi();

// DOM Elements
const sendButton = document.getElementById(
	"send-button"
) as HTMLButtonElement | null;
const chatInput = document.getElementById(
	"chat-input"
) as HTMLTextAreaElement | null;
const chatContainer = document.getElementById(
	"chat-container"
) as HTMLDivElement | null;
const saveKeyButton = document.getElementById(
	"save-key-button"
) as HTMLButtonElement | null;
const apiKeyInput = document.getElementById(
	"api-key-input"
) as HTMLInputElement | null;
const apiKeyStatusDiv = document.getElementById(
	"api-key-status"
) as HTMLDivElement | null;

// State
let isApiKeySet = false; // Track if API key is confirmed set
let isLoading = false; // Track if AI is processing

console.log("Webview script loaded.");

// Check for essential elements
if (
	!sendButton ||
	!chatInput ||
	!chatContainer ||
	!saveKeyButton ||
	!apiKeyInput ||
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

	saveKeyButton.addEventListener("click", () => {
		const apiKey = apiKeyInput.value.trim();
		if (apiKey) {
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
		if (message && chatInput) {
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
			chatInput.value = ""; // Clear input
			setLoadingState(true); // Show loading indicator
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
				if (typeof message.value === "string") {
					updateApiKeyStatus(message.value);
					// Update internal state based on status message
					isApiKeySet =
						message.value.toLowerCase().includes("api key is set") ||
						message.value.toLowerCase().includes("saved successfully");
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
		if (apiKeyStatusDiv) {
			const sanitizedText = text.replace(/</g, "<").replace(/>/g, ">");
			apiKeyStatusDiv.innerHTML = `Status: ${sanitizedText}`;

			if (text.toLowerCase().includes("error")) {
				apiKeyStatusDiv.style.color = "var(--vscode-errorForeground)";
			} else if (
				text.toLowerCase().includes("success") ||
				text.toLowerCase().includes("api key is set")
			) {
				apiKeyStatusDiv.style.color = "var(--vscode-editorInfo-foreground)";
			} else {
				apiKeyStatusDiv.style.color = "var(--vscode-descriptionForeground)";
			}
		}
	}

	// --- Initialization ---
	appendMessage(
		"System",
		"Welcome! Enter your Gemini API key below and start chatting.",
		"system-message"
	);
	vscode.postMessage({ type: "webviewReady" }); // Inform extension host
	console.log("Webview sent ready message.");
	updateApiKeyStatus("Checking key status..."); // Initial status check request
	chatInput.focus(); // Focus input field on load
} // Close the 'else' block for element checks

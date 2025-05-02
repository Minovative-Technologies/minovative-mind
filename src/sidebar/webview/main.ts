// src/sidebar/webview/main.ts

declare const acquireVsCodeApi: <T = { [key: string]: any }>() => {
	postMessage: (message: any) => void;
	getState: () => T | undefined;
	setState: (newState: T) => void;
};
const vscode = acquireVsCodeApi();

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
) as HTMLDivElement | null; // Get status div

console.log("Webview script loaded.");

if (
	!sendButton ||
	!chatInput ||
	!chatContainer ||
	!saveKeyButton ||
	!apiKeyInput ||
	!apiKeyStatusDiv
) {
	// Check status div
	console.error("Required DOM elements not found!");
	// Maybe display an error in the webview itself
	const body = document.querySelector("body");
	if (body) {
		body.innerHTML =
			'<p style="color: red; font-weight: bold;">Error initializing webview UI. Please check console (Developer: Open Webview Developer Tools).</p>';
	}
} else {
	// --- Event Listeners ---
	sendButton.addEventListener("click", () => {
		const message = chatInput.value.trim();
		if (message) {
			appendMessage("You", message);
			vscode.postMessage({ type: "chatMessage", value: message });
			chatInput.value = "";
		}
	});

	saveKeyButton.addEventListener("click", () => {
		const apiKey = apiKeyInput.value.trim();
		if (apiKey) {
			vscode.postMessage({ type: "apiKeyUpdate", value: apiKey });
			apiKeyInput.value = "";
			// Display interim status locally immediately
			updateApiKeyStatus("Attempting to save key...");
		} else {
			updateApiKeyStatus("Please enter an API key.");
		}
	});

	// --- Message Handling from Extension Host ---
	window.addEventListener("message", (event: MessageEvent) => {
		const message = event.data;
		console.log("Message received from extension:", message);

		switch (message.type) {
			case "aiResponse": {
				if (typeof message.value === "string") {
					appendMessage("Gemini", message.value);
				} else {
					console.warn(
						"Received AI response with non-string value:",
						message.value
					);
					appendMessage("Gemini", JSON.stringify(message.value));
				}
				break;
			}
			case "apiKeyStatus": {
				// Update the status text in the UI
				if (typeof message.value === "string") {
					updateApiKeyStatus(message.value);
				}
				break;
			}
		}
	});

	// --- Helper Functions ---
	function appendMessage(sender: string, text: string) {
		// Keep existing appendMessage function
		if (chatContainer) {
			const messageElement = document.createElement("p");
			// Basic sanitization (replace < and > to prevent HTML injection)
			const sanitizedText = text.replace(/</g, "<").replace(/>/g, ">");
			messageElement.innerHTML = `<strong>${sender}:</strong> ${sanitizedText}`;
			chatContainer.appendChild(messageElement);
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}
	}

	function updateApiKeyStatus(text: string) {
		if (apiKeyStatusDiv) {
			// Sanitize text before setting as innerHTML
			const sanitizedText = text.replace(/</g, "<").replace(/>/g, ">");
			apiKeyStatusDiv.innerHTML = `Status: ${sanitizedText}`;
			// Optional: add styling based on success/error
			if (text.toLowerCase().includes("error")) {
				apiKeyStatusDiv.style.color = "var(--vscode-errorForeground)";
			} else if (text.toLowerCase().includes("success")) {
				apiKeyStatusDiv.style.color = "var(--vscode-editorInfo-foreground)"; // Or a green color
			} else {
				apiKeyStatusDiv.style.color = "var(--vscode-descriptionForeground)"; // Default color
			}
		}
	}

	// Inform extension host that webview is ready
	vscode.postMessage({ type: "webviewReady" });
	console.log("Webview sent ready message.");
	updateApiKeyStatus("Checking key status..."); // Initial status
} // Close the 'else' block

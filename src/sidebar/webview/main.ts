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
// Model Selection Element
const modelSelect = document.getElementById(
	"model-select"
) as HTMLSelectElement | null; // <-- Add model select element
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

let planConfirmationContainer: HTMLDivElement | null = null;

// State
let isApiKeySet = false;
let isLoading = false;
let totalKeys = 0;
let pendingPlanData: any = null;

console.log("Webview script loaded.");

// Check for essential elements (including modelSelect)
if (
	!sendButton ||
	!chatInput ||
	!chatContainer ||
	!modelSelect || // <-- Check model select
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
	!statusArea
) {
	console.error("Required DOM elements not found!");
	const body = document.querySelector("body");
	if (body) {
		body.innerHTML =
			'<p style="color: var(--vscode-errorForeground); font-weight: bold;">Error initializing webview UI. Please check console (Developer: Open Webview Developer Tools).</p>';
	}
} else {
	// --- Helper Functions ---
	// (appendMessage, updateApiKeyStatus, updateStatus - keep existing)

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

			const messageElement = document.createElement("div");
			messageElement.classList.add("message");
			if (className) {
				messageElement.classList.add(className);
			}

			const senderElement = document.createElement("strong");
			senderElement.textContent = `${sender}: `;
			messageElement.appendChild(senderElement);

			const textElement = document.createElement("span");
			const sanitizedText = text; // Keep basic sanitization for now

			// Simple Markdown-like rendering (keep existing logic)
			let htmlContent = sanitizedText
				.replace(/</g, "&lt;") // Basic HTML entity escaping first
				.replace(/>/g, "&gt;")
				.replace(
					/```(json|typescript|javascript|python|html|css|plaintext|\w*)?\n([\s\S]*?)\n```/g, // Allow more languages or none
					(match, lang, code) =>
						`<pre><code class="language-${lang || "plaintext"}">${code
							.trim()
							.replace(/</g, "&lt;")
							.replace(/>/g, "&gt;")}</code></pre>`
				) // Handle fenced code blocks
				.replace(/`([^`]+)`/g, "<code>$1</code>") // Handle inline code
				.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") // Handle bold
				.replace(/\*(.*?)\*/g, "<em>$1</em>") // Handle italics (Ensure it doesn't conflict with bold)
				.replace(/(\r\n|\r|\n)/g, "<br>"); // Handle all newline types

			textElement.innerHTML = htmlContent;
			messageElement.appendChild(textElement);

			chatContainer.appendChild(messageElement);

			// Scroll logic (keep existing)
			const isScrolledToBottom =
				chatContainer.scrollHeight - chatContainer.clientHeight <=
				chatContainer.scrollTop + 50;
			if (isScrolledToBottom || sender === "You") {
				chatContainer.scrollTop = chatContainer.scrollHeight;
			}

			// Update button states (keep existing)
			const hasMessages = chatContainer.childElementCount > 0;
			if (clearChatButton && saveChatButton) {
				clearChatButton.disabled = !hasMessages;
				saveChatButton.disabled = !hasMessages;
			}
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
			console.log("Empty message submitted.");
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

		if (fullMessage.toLowerCase().startsWith("@plan ")) {
			const planRequest = fullMessage.substring(6).trim();
			if (!planRequest) {
				appendMessage(
					"System",
					"Please provide a description for the plan after @plan.",
					"error-message"
				);
				return;
			}
			appendMessage("You", fullMessage, "user-message");
			vscode.postMessage({ type: "planRequest", value: planRequest });
			setLoadingState(true);
		} else {
			appendMessage("You", fullMessage, "user-message");
			vscode.postMessage({ type: "chatMessage", value: fullMessage });
			setLoadingState(true);
		}
	}

	function setLoadingState(loading: boolean) {
		isLoading = loading;
		if (sendButton && chatInput && modelSelect) {
			// <-- Include modelSelect in check
			const enableControls = !loading && isApiKeySet; // Controls enabled if not loading AND key is set
			sendButton.disabled = !enableControls;
			chatInput.disabled = !enableControls;
			modelSelect.disabled = !enableControls; // <-- Disable model select too

			if (loading) {
				const lastMessage = chatContainer?.lastElementChild;
				if (
					!lastMessage ||
					!lastMessage.classList.contains("loading-message")
				) {
					appendMessage("Model", "Thinking...", "loading-message");
				}
			} else {
				const lastMessage = chatContainer?.lastElementChild;
				if (lastMessage && lastMessage.classList.contains("loading-message")) {
					lastMessage.remove();
				}
			}
		}
		if (loading && planConfirmationContainer) {
			planConfirmationContainer.style.display = "none";
			pendingPlanData = null;
		}
	}

	function createPlanConfirmationUI() {
		if (!planConfirmationContainer) {
			planConfirmationContainer = document.createElement("div");
			planConfirmationContainer.id = "plan-confirmation-container";
			planConfirmationContainer.style.display = "none";

			const textElement = document.createElement("p");
			textElement.textContent = "Execute the generated plan?";

			const confirmButton = document.createElement("button");
			confirmButton.id = "confirm-plan-button";
			confirmButton.textContent = "Confirm";

			const cancelButton = document.createElement("button");
			cancelButton.id = "cancel-plan-button";
			cancelButton.textContent = "Cancel";

			planConfirmationContainer.appendChild(textElement);
			planConfirmationContainer.appendChild(confirmButton);
			planConfirmationContainer.appendChild(cancelButton);

			chatContainer?.insertAdjacentElement(
				"afterend",
				planConfirmationContainer
			);

			planConfirmationContainer.addEventListener(
				"click",
				(event: MouseEvent) => {
					const target = event.target as HTMLElement;
					if (target.id === "confirm-plan-button") {
						if (pendingPlanData) {
							vscode.postMessage({
								type: "confirmPlanExecution",
								value: pendingPlanData,
							});
							updateStatus("Executing plan...");
							planConfirmationContainer!.style.display = "none";
							pendingPlanData = null;
							// setLoadingState(true); // No need, provider handles state
						} else {
							updateStatus(
								"Error: Could not retrieve plan data for execution.",
								true
							);
							planConfirmationContainer!.style.display = "none";
						}
					} else if (target.id === "cancel-plan-button") {
						vscode.postMessage({ type: "cancelPlanExecution" });
						updateStatus("Plan execution cancelled.");
						planConfirmationContainer!.style.display = "none";
						pendingPlanData = null;
						// Re-enable input if API key is set
						if (chatInput && sendButton && modelSelect) {
							chatInput.disabled = !isApiKeySet;
							sendButton.disabled = !isApiKeySet;
							modelSelect.disabled = !isApiKeySet;
						}
					}
				}
			);
		}
	}

	// --- Event Listeners ---
	sendButton.addEventListener("click", sendMessage);
	chatInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	});

	// Model selection listener
	modelSelect.addEventListener("change", () => {
		const selectedModel = modelSelect.value;
		vscode.postMessage({ type: "selectModel", value: selectedModel });
		updateStatus(`Requesting switch to model: ${selectedModel}...`);
	});

	// Key management listeners (keep existing)
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
		console.log(
			"[Webview] Delete button clicked. Sending 'requestDeleteConfirmation'."
		);
		vscode.postMessage({ type: "requestDeleteConfirmation" });
		updateApiKeyStatus("Waiting for delete confirmation...");
	});

	// Chat action listeners (keep existing)
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

	// --- Message Handling from Extension Host ---
	window.addEventListener("message", (event: MessageEvent) => {
		const message = event.data;
		console.log("Message received from extension:", message.type);

		switch (message.type) {
			case "aiResponse": {
				setLoadingState(false); // Always turn off loading for any response

				appendMessage(
					"Model",
					message.value,
					message.isError ? "error-message" : "ai-message"
				);

				if (message.requiresConfirmation && message.planData) {
					createPlanConfirmationUI();
					if (planConfirmationContainer) {
						pendingPlanData = message.planData;
						planConfirmationContainer.style.display = "block";
						updateStatus(
							"Plan generated. Please review and confirm execution."
						);
						if (chatInput) {
							chatInput.disabled = true;
						}
						if (sendButton) {
							sendButton.disabled = true;
						}
						if (modelSelect) {
							modelSelect.disabled = true;
						} // Disable model select during confirmation
					} else {
						console.error("Plan confirmation container failed to create!");
						updateStatus(
							"Error: UI elements for plan confirmation missing.",
							true
						);
						if (chatInput) {
							chatInput.disabled = !isApiKeySet;
						}
						if (sendButton) {
							sendButton.disabled = !isApiKeySet;
						}
						if (modelSelect) {
							modelSelect.disabled = !isApiKeySet;
						}
					}
				} else {
					// Re-enable based on API key state if it was a regular response or error
					setLoadingState(false); // Handles enabling based on isApiKeySet
				}
				break;
			}
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
						currentKeyDisplay!.textContent = "No active key";
						updateApiKeyStatus("Please add an API key.");
					}

					prevKeyButton!.disabled = totalKeys <= 1;
					nextKeyButton!.disabled = totalKeys <= 1;
					deleteKeyButton!.disabled = updateData.activeIndex === -1;

					// Re-evaluate input state based on API key AND loading state
					if (!isLoading) {
						chatInput!.disabled = !isApiKeySet;
						sendButton!.disabled = !isApiKeySet;
						modelSelect!.disabled = !isApiKeySet; // <-- Enable/disable model select based on key
					}
				} else {
					console.error("Invalid 'updateKeyList' message received:", message);
				}
				break;
			}
			case "updateModelList": {
				// <-- Handle model list update
				if (
					message.value &&
					Array.isArray(message.value.availableModels) &&
					typeof message.value.selectedModel === "string"
				) {
					const { availableModels, selectedModel } = message.value;

					// Clear existing options
					modelSelect!.innerHTML = "";

					// Populate with new options
					availableModels.forEach((modelName: string) => {
						const option = document.createElement("option");
						option.value = modelName;
						option.textContent = modelName;
						if (modelName === selectedModel) {
							option.selected = true;
						}
						modelSelect!.appendChild(option);
					});

					// Ensure dropdown reflects the actual selected model
					modelSelect!.value = selectedModel;
					console.log(
						"Model list updated in webview. Selected:",
						selectedModel
					);
				} else {
					console.error("Invalid 'updateModelList' message received:", message);
				}
				break;
			}
			case "chatCleared": {
				if (chatContainer) {
					chatContainer.innerHTML = "";
				}
				clearChatButton!.disabled = true;
				saveChatButton!.disabled = true;
				break;
			}
			case "restoreHistory": {
				if (chatContainer && Array.isArray(message.value)) {
					chatContainer.innerHTML = "";
					message.value.forEach((msg: any) => {
						if (msg && msg.sender && msg.text) {
							appendMessage(msg.sender, msg.text, msg.className || "");
						}
					});
					updateStatus("Chat history restored.");
					const hasMessages = chatContainer.childElementCount > 0;
					clearChatButton!.disabled = !hasMessages;
					saveChatButton!.disabled = !hasMessages;
				} else {
					updateStatus("Error: Failed to restore chat history format.", true);
				}
				setLoadingState(false); // Re-enable input after restoring
				break;
			}
			case "reenableInput": {
				console.log("Received reenableInput request from provider.");
				setLoadingState(false); // Explicitly re-enable based on isApiKeySet state
				break;
			}
			default:
				console.warn(
					"Received unknown message type from extension:",
					message.type
				);
		}
	});

	// --- Initialization ---
	function initializeWebview() {
		vscode.postMessage({ type: "webviewReady" });
		console.log("Webview sent ready message.");
		chatInput?.focus();

		// Initial button states (use ! assertions as elements checked at top)
		prevKeyButton!.disabled = true;
		nextKeyButton!.disabled = true;
		deleteKeyButton!.disabled = true;
		chatInput!.disabled = true;
		sendButton!.disabled = true;
		modelSelect!.disabled = true; // <-- Disable model select initially
		clearChatButton!.disabled = true;
		saveChatButton!.disabled = true;
		loadChatButton!.disabled = false;

		createPlanConfirmationUI();
	}

	initializeWebview();
} // Close the 'else' block for element checks

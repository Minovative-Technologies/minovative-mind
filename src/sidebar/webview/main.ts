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

// FIX: Declare planConfirmationContainer - it will be created dynamically later
let planConfirmationContainer: HTMLDivElement | null = null;

// State
let isApiKeySet = false;
let isLoading = false;
let totalKeys = 0;
let pendingPlanData: any = null; // Store the pending plan data

console.log("Webview script loaded.");

// Check for essential elements (REMOVED planConfirmationContainer check here)
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
	// Moved helpers up as they are used by listeners and message handler

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
			// Basic sanitization (no changes needed here for now)
			const sanitizedText = text;

			// Simple Markdown-like rendering (keep existing logic)
			let htmlContent = sanitizedText
				.replace(/</g, "&lt;") // Basic HTML entity escaping first
				.replace(/>/g, "&gt;")
				.replace(
					/```(json|typescript|javascript|python|html|css|plaintext|\w*)?\n([\s\S]*?)\n```/g, // Allow more languages or none
					(match, lang, code) =>
						// Use template literal for easier reading and ensure code is escaped again inside pre
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
			// Basic sanitization
			const sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
			apiKeyStatusDiv.textContent = sanitizedText;

			const lowerText = text.toLowerCase();
			// Set color based on message content
			if (lowerText.startsWith("error:")) {
				apiKeyStatusDiv.style.color = "var(--vscode-errorForeground)";
			} else if (
				lowerText.startsWith("info:") ||
				lowerText.includes("success") ||
				lowerText.includes("key added") ||
				lowerText.includes("key deleted") ||
				lowerText.includes("using key") ||
				lowerText.includes("switched to key") ||
				lowerText.startsWith("adding") || // For immediate feedback
				lowerText.startsWith("switching") ||
				lowerText.startsWith("waiting") || // For delete confirmation
				lowerText.endsWith("cancelled.") // For delete cancellation
			) {
				apiKeyStatusDiv.style.color = "var(--vscode-editorInfo-foreground)"; // Use info color for these statuses
			} else {
				// Default color for general status like 'Please add API key'
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
			// Optional: fade out the message after a few seconds
			setTimeout(() => {
				if (statusArea.textContent === sanitizedText) {
					// Avoid clearing if a new message arrived
					statusArea.textContent = "";
				}
			}, 5000); // Clear after 5 seconds
		}
	}

	// FIX: Define only ONCE
	function sendMessage() {
		if (isLoading || !chatInput || !sendButton) {
			return;
		}
		const fullMessage = chatInput.value.trim();
		chatInput.value = ""; // Clear input *after* getting value

		if (!fullMessage) {
			console.log("Empty message submitted.");
			return; // Don't send empty messages
		}

		if (!isApiKeySet) {
			appendMessage(
				"System",
				"Please add or select a valid API Key first.",
				"error-message"
			);
			return;
		}

		// Check for the @plan prefix
		if (fullMessage.toLowerCase().startsWith("@plan ")) {
			const planRequest = fullMessage.substring(6).trim(); // Extract the actual request
			if (!planRequest) {
				appendMessage(
					"System",
					"Please provide a description for the plan after @plan.",
					"error-message"
				);
				return;
			}
			appendMessage("You", fullMessage, "user-message"); // Echo the full @plan command
			vscode.postMessage({ type: "planRequest", value: planRequest });
			setLoadingState(true); // Set loading while plan is generated
		} else {
			// Regular chat message
			appendMessage("You", fullMessage, "user-message");
			vscode.postMessage({ type: "chatMessage", value: fullMessage });
			setLoadingState(true);
		}
	}

	function setLoadingState(loading: boolean) {
		isLoading = loading;
		if (sendButton && chatInput) {
			sendButton.disabled = loading || !isApiKeySet; // Disable if loading OR no API key
			chatInput.disabled = loading || !isApiKeySet; // Disable if loading OR no API key
			if (loading) {
				// Ensure we don't add multiple "Thinking..." messages
				const lastMessage = chatContainer?.lastElementChild;
				if (
					!lastMessage ||
					!lastMessage.classList.contains("loading-message")
				) {
					appendMessage("Model", "Thinking...", "loading-message");
				}
			} else {
				// Remove "Thinking..." message if it's the last one
				const lastMessage = chatContainer?.lastElementChild;
				if (lastMessage && lastMessage.classList.contains("loading-message")) {
					lastMessage.remove();
				}
			}
		}
		// Ensure confirmation buttons are hidden when loading starts
		if (loading && planConfirmationContainer) {
			planConfirmationContainer.style.display = "none";
			pendingPlanData = null; // Clear pending plan if a new request starts loading
		}
	}

	// --- Function to Create Plan Confirmation UI ---
	function createPlanConfirmationUI() {
		if (!planConfirmationContainer) {
			planConfirmationContainer = document.createElement("div");
			planConfirmationContainer.id = "plan-confirmation-container";
			planConfirmationContainer.style.display = "none"; // Initially hidden

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

			// Append it after the chat container but before the status area
			chatContainer?.insertAdjacentElement(
				"afterend",
				planConfirmationContainer
			);

			// FIX: Add event listener AFTER creating the container
			// Use event delegation on the container
			planConfirmationContainer.addEventListener(
				"click",
				(event: MouseEvent) => {
					// FIX: Added MouseEvent type
					const target = event.target as HTMLElement;
					if (target.id === "confirm-plan-button") {
						if (pendingPlanData) {
							vscode.postMessage({
								type: "confirmPlanExecution",
								value: pendingPlanData, // Send stored plan data
							});
							updateStatus("Executing plan...");
							planConfirmationContainer!.style.display = "none"; // Hide after click (use ! assertion as we know it exists here)
							pendingPlanData = null; // Clear stored plan
							// Provider will re-enable input after execution attempt via aiResponse or statusUpdate
						} else {
							updateStatus(
								"Error: Could not retrieve plan data for execution.",
								true
							);
							planConfirmationContainer!.style.display = "none"; // Hide anyway
						}
					} else if (target.id === "cancel-plan-button") {
						vscode.postMessage({ type: "cancelPlanExecution" });
						updateStatus("Plan execution cancelled.");
						planConfirmationContainer!.style.display = "none"; // Hide after click
						pendingPlanData = null; // Clear stored plan
						// Re-enable input if API key is set
						if (chatInput && sendButton) {
							chatInput.disabled = !isApiKeySet;
							sendButton.disabled = !isApiKeySet;
						}
					}
				}
			);
		}
	}

	// --- Event Listeners ---
	// Keep standard listeners
	sendButton.addEventListener("click", sendMessage);
	chatInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	});

	addKeyButton.addEventListener("click", () => {
		const apiKey = addKeyInput!.value.trim(); // Use ! assertion as elements are checked
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
			addKeyButton!.click(); // Use ! assertion
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

				// Display the AI text response
				appendMessage(
					"Model",
					message.value,
					message.isError ? "error-message" : "ai-message"
				);

				// If this response requires confirmation (it's a plan)
				if (message.requiresConfirmation && message.planData) {
					createPlanConfirmationUI(); // Ensure the UI exists
					if (planConfirmationContainer) {
						// Check if creation was successful
						pendingPlanData = message.planData;
						planConfirmationContainer.style.display = "block"; // Show the buttons
						updateStatus(
							"Plan generated. Please review and confirm execution."
						);
						// Disable chat input while confirmation is pending
						if (chatInput) {
							chatInput.disabled = true;
						}
						if (sendButton) {
							sendButton.disabled = true;
						}
					} else {
						console.error("Plan confirmation container failed to create!");
						updateStatus(
							"Error: UI elements for plan confirmation missing.",
							true
						);
						// Re-enable input since confirmation cannot be shown
						if (chatInput) {
							chatInput.disabled = !isApiKeySet;
						}
						if (sendButton) {
							sendButton.disabled = !isApiKeySet;
						}
					}
				} else {
					// If it's a normal response or an error, ensure input is re-enabled (if API key exists)
					setLoadingState(false); // This correctly handles enabling based on isApiKeySet
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
						// Don't overwrite specific API key status here, let apiKeyStatus handle it
						// updateApiKeyStatus(`Using key ${updateData.activeIndex + 1} of ${totalKeys}.`);
					} else {
						currentKeyDisplay!.textContent = "No active key";
						updateApiKeyStatus("Please add an API key."); // Set initial status if no key
					}

					prevKeyButton!.disabled = totalKeys <= 1;
					nextKeyButton!.disabled = totalKeys <= 1;
					deleteKeyButton!.disabled = updateData.activeIndex === -1;

					// Re-evaluate input state based on API key AND loading state
					if (!isLoading) {
						chatInput!.disabled = !isApiKeySet;
						sendButton!.disabled = !isApiKeySet;
					}

					// Enable/disable chat action buttons based on history (done in appendMessage/restoreHistory/chatCleared)
				} else {
					console.error("Invalid 'updateKeyList' message received:", message);
				}
				break;
			}
			case "chatCleared": {
				if (chatContainer) {
					chatContainer.innerHTML = ""; // Clear the display
				}
				// System message is added by the provider now
				// Update button states after clearing
				clearChatButton!.disabled = true;
				saveChatButton!.disabled = true;
				// Don't re-enable input here automatically, let provider or setLoadingState handle it
				break;
			}
			case "restoreHistory": {
				if (chatContainer && Array.isArray(message.value)) {
					chatContainer.innerHTML = ""; // Clear existing messages first
					message.value.forEach((msg: any) => {
						if (msg && msg.sender && msg.text) {
							appendMessage(msg.sender, msg.text, msg.className || "");
						}
					});
					updateStatus("Chat history restored.");
					// Update button states after loading
					const hasMessages = chatContainer.childElementCount > 0;
					clearChatButton!.disabled = !hasMessages;
					saveChatButton!.disabled = !hasMessages;
				} else {
					updateStatus("Error: Failed to restore chat history format.", true);
				}
				// Re-enable input after restoring history (if API key exists)
				setLoadingState(false); // This handles enabling based on isApiKeySet
				break;
			}
			case "reenableInput": {
				console.log("Received reenableInput request from provider.");
				setLoadingState(false); // Explicitly re-enable based on isApiKeySet state
				break;
			}
		}
	});

	// --- Initialization ---
	function initializeWebview() {
		vscode.postMessage({ type: "webviewReady" });
		console.log("Webview sent ready message.");
		// updateApiKeyStatus("Initializing..."); // Request initial status
		chatInput?.focus();

		// Initial button states (use ! assertions as elements checked at top)
		prevKeyButton!.disabled = true;
		nextKeyButton!.disabled = true;
		deleteKeyButton!.disabled = true;
		chatInput!.disabled = true;
		sendButton!.disabled = true;
		clearChatButton!.disabled = true; // Disabled until history loads/checked
		saveChatButton!.disabled = true; // Disabled until history loads/checked
		loadChatButton!.disabled = false; // Load is always possible

		// Create the confirmation container placeholder during initialization
		createPlanConfirmationUI();
	}

	initializeWebview();
} // Close the 'else' block for element checks

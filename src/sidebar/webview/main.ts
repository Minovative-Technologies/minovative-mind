// src/sidebar/webview/main.ts
import MarkdownIt from "markdown-it"; // Added import

// --- Font Awesome Imports ---
import { library, dom, icon } from "@fortawesome/fontawesome-svg-core";
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
} from "@fortawesome/free-solid-svg-icons";

// Add icons to the library
library.add(
	faPaperPlane,
	faFloppyDisk,
	faFolderOpen,
	faTrashCan,
	faChevronLeft,
	faChevronRight,
	faPlus,
	faCheck,
	faTimes
);
// --- End Font Awesome Imports ---

interface VsCodeApi {
	postMessage(message: any): void;
	getState(): any;
	setState(newState: any): void;
}
declare const acquireVsCodeApi: () => VsCodeApi;
const vscode = acquireVsCodeApi();

// Initialize markdown-it with common options for robust rendering
const md = new MarkdownIt({ html: false, linkify: true, typographer: true }); // Added markdown-it initialization

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
let confirmPlanButton: HTMLButtonElement | null = null; // Specific button for icon
let cancelPlanButton: HTMLButtonElement | null = null; // Specific button for icon

// State
let isApiKeySet = false;
let isLoading = false;
let totalKeys = 0;
let pendingPlanData: any = null;

console.log("Webview script loaded.");

// Check for essential elements
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

	/**
	 * Appends a message to the chat container, processing markdown.
	 * @param sender The sender of the message (e.g., "You", "Model").
	 * @param text The raw text content of the message.
	 * @param className Optional CSS class to add to the message element.
	 */
	function appendMessage(sender: string, text: string, className: string = "") {
		if (chatContainer) {
			// Remove existing loading message if a new non-loading message arrives
			if (className !== "loading-message") {
				const lastMessage = chatContainer.lastElementChild;
				if (lastMessage && lastMessage.classList.contains("loading-message")) {
					lastMessage.remove();
				}
			} else if (chatContainer.querySelector(".loading-message")) {
				// Don't add a new loading message if one already exists
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

			// Render the raw message text using the initialized markdown-it instance
			const renderedHtml = md.render(text);

			textElement.innerHTML = renderedHtml; // Set the final processed HTML content
			messageElement.appendChild(textElement);

			// Append the new message element to the chat container
			chatContainer.appendChild(messageElement);

			// Always scroll to the bottom when a new message is added.
			chatContainer.scrollTop = chatContainer.scrollHeight;

			// Update button states based on whether messages exist
			const hasMessages = chatContainer.childElementCount > 0;
			if (clearChatButton && saveChatButton) {
				clearChatButton.disabled = !hasMessages;
				saveChatButton.disabled = !hasMessages;
			}
		}
	}

	function updateApiKeyStatus(text: string) {
		if (apiKeyStatusDiv) {
			// Sanitize text before setting it to avoid potential XSS if the text could ever come from an unsafe source
			const sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
			apiKeyStatusDiv.textContent = sanitizedText;

			// Style based on message content
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
				// Default color for other messages
				apiKeyStatusDiv.style.color = "var(--vscode-descriptionForeground)";
			}
		}
	}

	function updateStatus(text: string, isError = false) {
		if (statusArea) {
			// Sanitize text to prevent basic HTML injection
			const sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
			statusArea.textContent = sanitizedText;
			// Set color based on whether it's an error or normal status
			statusArea.style.color = isError
				? "var(--vscode-errorForeground)"
				: "var(--vscode-descriptionForeground)";
			// Automatically clear the status message after a few seconds
			setTimeout(() => {
				// Only clear if the message hasn't been replaced by a newer one
				if (statusArea.textContent === sanitizedText) {
					statusArea.textContent = "";
				}
			}, 5000); // 5 seconds delay
		}
	}

	function sendMessage() {
		// Prevent sending if already loading or elements are missing
		if (isLoading || !chatInput || !sendButton) {
			return;
		}
		// Get the message, trim whitespace, and clear the input
		const fullMessage = chatInput.value.trim();
		chatInput.value = "";

		// Don't send empty messages
		if (!fullMessage) {
			console.log("Empty message submitted.");
			return;
		}

		// Require an API key to be set
		if (!isApiKeySet) {
			appendMessage(
				"System",
				"Please add or select a valid API Key first.",
				"error-message"
			);
			return;
		}

		// Check for special commands like "@plan"
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
			// Append user's message and send plan request to extension
			appendMessage("You", fullMessage, "user-message");
			vscode.postMessage({ type: "planRequest", value: planRequest });
			setLoadingState(true); // Indicate loading
		} else {
			// Regular chat message
			appendMessage("You", fullMessage, "user-message");
			vscode.postMessage({ type: "chatMessage", value: fullMessage });
			setLoadingState(true); // Indicate loading
		}
	}

	function setLoadingState(loading: boolean) {
		isLoading = loading;
		if (sendButton && chatInput && modelSelect) {
			// Determine if controls should be enabled (not loading AND API key is set)
			const enableSendControls = !loading && isApiKeySet;
			sendButton.disabled = !enableSendControls;
			chatInput.disabled = !enableSendControls;
			// The following line correctly disables modelSelect when 'loading' is true.
			// If loading is true, enableSendControls is false, so !enableSendControls is true,
			// thus modelSelect.disabled becomes true.
			modelSelect.disabled = !enableSendControls;

			// Show/hide loading indicator message
			if (loading) {
				const lastMessage = chatContainer?.lastElementChild;
				// Add loading message only if it's not already the last message
				if (
					!lastMessage ||
					!lastMessage.classList.contains("loading-message")
				) {
					appendMessage("Model", "Creating...", "loading-message");
				}
			} else {
				// Remove loading message if it exists
				const lastMessage = chatContainer?.lastElementChild;
				if (lastMessage && lastMessage.classList.contains("loading-message")) {
					lastMessage.remove();
				}
			}
		}
		// Hide plan confirmation UI if loading starts
		if (loading && planConfirmationContainer) {
			planConfirmationContainer.style.display = "none";
			pendingPlanData = null; // Clear pending data
		}
	}

	function createPlanConfirmationUI() {
		// Create the UI only if it doesn't exist yet
		if (!planConfirmationContainer) {
			planConfirmationContainer = document.createElement("div");
			planConfirmationContainer.id = "plan-confirmation-container";
			planConfirmationContainer.style.display = "none"; // Initially hidden

			const textElement = document.createElement("p");
			textElement.textContent = "Execute the generated plan?";

			// Create confirm button
			confirmPlanButton = document.createElement("button");
			confirmPlanButton.id = "confirm-plan-button";
			confirmPlanButton.title = "Confirm Plan Execution"; // Tooltip

			// Create cancel button
			cancelPlanButton = document.createElement("button");
			cancelPlanButton.id = "cancel-plan-button";
			cancelPlanButton.title = "Cancel Plan Execution"; // Tooltip

			// Add elements to the container
			planConfirmationContainer.appendChild(textElement);
			planConfirmationContainer.appendChild(confirmPlanButton);
			planConfirmationContainer.appendChild(cancelPlanButton);

			// Insert the container after the chat area
			chatContainer?.insertAdjacentElement(
				"afterend",
				planConfirmationContainer
			);

			// Set icons for the new buttons
			setIconForButton(confirmPlanButton, faCheck);
			setIconForButton(cancelPlanButton, faTimes);

			// Add event listener to the container (using event delegation)
			planConfirmationContainer.addEventListener(
				"click",
				(event: MouseEvent) => {
					const target = event.target as HTMLElement;
					// Check if the confirm button or its icon was clicked
					if (
						target.id === "confirm-plan-button" ||
						target.closest("#confirm-plan-button")
					) {
						if (pendingPlanData) {
							// Send confirmation message to extension
							vscode.postMessage({
								type: "confirmPlanExecution",
								value: pendingPlanData,
							});
							updateStatus("Executing plan...");
							planConfirmationContainer!.style.display = "none"; // Hide UI
							pendingPlanData = null; // Clear data
							setLoadingState(true); // Set loading state while plan executes
						} else {
							// Error case: plan data missing
							updateStatus(
								"Error: Could not retrieve plan data for execution.",
								true
							);
							planConfirmationContainer!.style.display = "none";
						}
					} else if (
						// Check if the cancel button or its icon was clicked
						target.id === "cancel-plan-button" ||
						target.closest("#cancel-plan-button")
					) {
						// Send cancellation message to extension
						vscode.postMessage({ type: "cancelPlanExecution" });
						updateStatus("Plan execution cancelled.");
						planConfirmationContainer!.style.display = "none"; // Hide UI
						pendingPlanData = null; // Clear data
						// Re-enable input controls if an API key is set
						setLoadingState(false); // Explicitly turn off loading state
					}
				}
			);
		}
	}

	// --- Font Awesome Icon Helper ---
	function setIconForButton(
		button: HTMLButtonElement | null,
		iconDefinition: any // Font Awesome icon definition object
	) {
		if (button) {
			// Use Font Awesome's `icon()` function to generate the SVG element
			const iconHTML = icon(iconDefinition, {
				classes: ["fa-icon"], // Add a class for potential styling
			}).html[0]; // `html` is an array, we want the first (only) element

			if (iconHTML) {
				button.innerHTML = iconHTML; // Replace button content with the SVG icon
			} else {
				// Fallback in case icon generation fails
				button.innerHTML = "?"; // Placeholder text
				console.error(
					"Failed to generate Font Awesome icon:",
					iconDefinition.iconName
				);
			}
		}
	}

	// --- Event Listeners ---
	// Send message on button click
	sendButton.addEventListener("click", sendMessage);

	// Send message on Enter key (if Shift is not pressed)
	chatInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault(); // Prevent newline in textarea
			sendMessage();
		}
	});

	// Handle model selection change
	modelSelect.addEventListener("change", () => {
		const selectedModel = modelSelect.value;
		vscode.postMessage({ type: "selectModel", value: selectedModel });
		updateStatus(`Requesting switch to model: ${selectedModel}...`);
	});

	// Handle API key addition
	addKeyButton.addEventListener("click", () => {
		const apiKey = addKeyInput!.value.trim();
		if (apiKey) {
			vscode.postMessage({ type: "addApiKey", value: apiKey });
			addKeyInput!.value = ""; // Clear input field
			updateApiKeyStatus("Adding key...");
		} else {
			updateApiKeyStatus("Error: Please enter an API key to add.");
		}
	});
	// Allow adding key with Enter key in the input field
	addKeyInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			addKeyButton!.click(); // Trigger the button click
		}
	});
	// Handle switching to previous key
	prevKeyButton.addEventListener("click", () => {
		vscode.postMessage({ type: "switchToPrevKey" });
		updateApiKeyStatus("Switching key...");
	});
	// Handle switching to next key
	nextKeyButton.addEventListener("click", () => {
		vscode.postMessage({ type: "switchToNextKey" });
		updateApiKeyStatus("Switching key...");
	});
	// Handle delete key request (initiates confirmation)
	deleteKeyButton.addEventListener("click", () => {
		console.log(
			"[Webview] Delete button clicked. Sending 'requestDeleteConfirmation'."
		);
		vscode.postMessage({ type: "requestDeleteConfirmation" });
		updateApiKeyStatus("Waiting for delete confirmation...");
	});

	// Handle chat clearing request
	clearChatButton.addEventListener("click", () => {
		vscode.postMessage({ type: "clearChatRequest" });
	});
	// Handle chat saving request
	saveChatButton.addEventListener("click", () => {
		vscode.postMessage({ type: "saveChatRequest" });
		updateStatus("Requesting chat save...");
	});
	// Handle chat loading request
	loadChatButton.addEventListener("click", () => {
		vscode.postMessage({ type: "loadChatRequest" });
		updateStatus("Requesting chat load...");
	});

	// --- Message Handling from Extension Host ---
	window.addEventListener("message", (event: MessageEvent) => {
		const message = event.data; // The data sent from the extension
		console.log("[Webview] Message received from extension:", message.type);

		switch (message.type) {
			// Handle response from the AI model
			case "aiResponse": {
				setLoadingState(false); // Turn off loading indicator

				// Append the AI's message, marking as error if necessary
				appendMessage(
					"Model",
					message.value,
					message.isError ? "error-message" : "ai-message"
				);

				// If the response requires user confirmation (e.g., a plan)
				if (message.requiresConfirmation && message.planData) {
					createPlanConfirmationUI(); // Ensure the UI elements exist
					if (planConfirmationContainer) {
						pendingPlanData = message.planData; // Store data needed for confirmation
						planConfirmationContainer.style.display = "flex"; // Show confirmation buttons
						updateStatus(
							"Plan generated. Please review and confirm execution."
						);
						// Disable input while waiting for confirmation
						if (chatInput) {
							chatInput.disabled = true;
						}
						if (sendButton) {
							sendButton.disabled = true;
						}
						if (modelSelect) {
							modelSelect.disabled = true;
						}
					} else {
						// Error handling if UI couldn't be created
						console.error("Plan confirmation container failed to create!");
						updateStatus(
							"Error: UI elements for plan confirmation missing.",
							true
						);
						setLoadingState(false); // Re-enable based on API key status if UI fails
					}
				}
				// No 'else' needed, setLoadingState(false) handles re-enabling correctly
				break;
			}
			// Update the API key status display area
			case "apiKeyStatus": {
				if (typeof message.value === "string") {
					updateApiKeyStatus(message.value);
				}
				break;
			}
			// Update the general status message area
			case "statusUpdate": {
				if (typeof message.value === "string") {
					updateStatus(message.value, message.isError ?? false);
				}
				break;
			}
			// Update the API key list display and controls
			case "updateKeyList": {
				if (message.value && Array.isArray(message.value.keys)) {
					const updateData = message.value as {
						keys: any[]; // Should have {maskedKey: string} objects
						activeIndex: number;
						totalKeys: number;
					};
					totalKeys = updateData.totalKeys;
					isApiKeySet = updateData.activeIndex !== -1; // Key is set if index is valid

					// Update the displayed key (masked)
					if (
						updateData.activeIndex !== -1 &&
						updateData.keys[updateData.activeIndex]
					) {
						currentKeyDisplay!.textContent =
							updateData.keys[updateData.activeIndex].maskedKey;
					} else {
						currentKeyDisplay!.textContent = "No Active Key";
						updateApiKeyStatus("Please add an API key."); // Prompt user
					}

					// Enable/disable navigation and delete buttons
					prevKeyButton!.disabled = totalKeys <= 1;
					nextKeyButton!.disabled = totalKeys <= 1;
					deleteKeyButton!.disabled = updateData.activeIndex === -1; // Can't delete if none active

					// Re-enable/disable input controls based on key status (if not loading)
					// setLoadingState handles this automatically when loading changes
					// We might still need explicit setting here if the key status changes *while not loading*
					if (!isLoading) {
						const enableSendControls = isApiKeySet;
						chatInput!.disabled = !enableSendControls;
						sendButton!.disabled = !enableSendControls;
						modelSelect!.disabled = !enableSendControls;
					}
				} else {
					console.error("Invalid 'updateKeyList' message received:", message);
				}
				break;
			}
			// Update the model selection dropdown
			case "updateModelList": {
				if (
					message.value &&
					Array.isArray(message.value.availableModels) &&
					typeof message.value.selectedModel === "string"
				) {
					const { availableModels, selectedModel } = message.value;
					modelSelect!.innerHTML = ""; // Clear existing options
					// Populate dropdown with available models
					availableModels.forEach((modelName: string) => {
						const option = document.createElement("option");
						option.value = modelName;
						option.textContent = modelName;
						if (modelName === selectedModel) {
							option.selected = true; // Mark the currently selected model
						}
						modelSelect!.appendChild(option);
					});
					modelSelect!.value = selectedModel; // Ensure correct value is set
					console.log(
						"Model list updated in webview. Selected:",
						selectedModel
					);
				} else {
					console.error("Invalid 'updateModelList' message received:", message);
				}
				break;
			}
			// Handle chat cleared event
			case "chatCleared": {
				if (chatContainer) {
					chatContainer.innerHTML = ""; // Clear the chat display
				}
				// Disable clear/save buttons as there's no chat content
				clearChatButton!.disabled = true;
				saveChatButton!.disabled = true;
				setLoadingState(false); // Ensure loading state is off
				break;
			}
			// Restore chat history (e.g., after loading a saved chat)
			case "restoreHistory": {
				if (chatContainer && Array.isArray(message.value)) {
					chatContainer.innerHTML = ""; // Clear current chat first
					// Append each message from the history
					message.value.forEach((msg: any) => {
						if (msg && msg.sender && msg.text) {
							// Use the provided class name if available
							appendMessage(msg.sender, msg.text, msg.className || "");
						}
					});
					updateStatus("Chat history restored.");
					// Enable clear/save buttons if messages were restored
					const hasMessages = chatContainer.childElementCount > 0;
					clearChatButton!.disabled = !hasMessages;
					saveChatButton!.disabled = !hasMessages;
				} else {
					updateStatus("Error: Failed to restore chat history format.", true);
				}
				setLoadingState(false); // Ensure loading state is off after restore
				break;
			}
			case "reenableInput": {
				console.log("Received reenableInput request from provider.");
				setLoadingState(false); // Turn off loading and re-enable controls based on API key status
				break;
			}

			// Handle unknown message types
			default:
				console.warn(
					"[Webview] Received unknown message type from extension:",
					message.type
				);
		}
	});

	// --- Initialization ---
	function initializeWebview() {
		// Signal to the extension that the webview is ready
		vscode.postMessage({ type: "webviewReady" });
		console.log("Webview sent ready message.");
		chatInput?.focus(); // Set focus to the chat input

		// Set initial states for all buttons and inputs (mostly disabled until API key is ready)
		prevKeyButton!.disabled = true;
		nextKeyButton!.disabled = true;
		deleteKeyButton!.disabled = true;
		chatInput!.disabled = true;
		sendButton!.disabled = true;
		modelSelect!.disabled = true;
		clearChatButton!.disabled = true; // Disabled initially until chat has content
		saveChatButton!.disabled = true; // Disabled initially until chat has content
		loadChatButton!.disabled = false; // Load button is always enabled

		// Apply Font Awesome icons to the buttons
		setIconForButton(sendButton, faPaperPlane);
		setIconForButton(saveChatButton, faFloppyDisk);
		setIconForButton(loadChatButton, faFolderOpen);
		setIconForButton(clearChatButton, faTrashCan);
		setIconForButton(prevKeyButton, faChevronLeft);
		setIconForButton(nextKeyButton, faChevronRight);
		setIconForButton(deleteKeyButton, faTrashCan);
		setIconForButton(addKeyButton, faPlus);

		// Create the plan confirmation UI elements (initially hidden)
		createPlanConfirmationUI();
		// Icons for plan buttons are set within createPlanConfirmationUI
	}

	// Run initialization function when the script loads
	initializeWebview();
} // Close the 'else' block for element checks

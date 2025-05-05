// src/sidebar/webview/main.ts

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

			// --- Start Markdown Conversion Logic ---

			// 1. Initial HTML Escaping (escape '<' and '>')
			let htmlContent = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

			// 2. Handle Code Blocks (Extract, Process内HTML Escape, Placeholder)
			const codeBlocks: string[] = [];
			// Unique placeholder unlikely to appear in normal text
			const codeBlockPlaceholder =
				"___CODE_BLOCK_PLACEHOLDER_" + Date.now() + "___";
			const codeBlockRegex =
				/```(json|typescript|javascript|python|html|css|plaintext|\w*)?\n([\s\S]*?)\n```/g;
			htmlContent = htmlContent.replace(codeBlockRegex, (match, lang, code) => {
				// Escape HTML entities *inside* the code block content *again* just to be safe,
				// though initial escape should handle most. This ensures `<` inside code is `&lt;`.
				const escapedCode = code
					.trim()
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;");
				// Store the complete pre/code HTML structure
				codeBlocks.push(
					`<pre><code class="language-${
						lang || "plaintext"
					}">${escapedCode}</code></pre>`
				);
				return codeBlockPlaceholder; // Replace with placeholder in the main text
			});

			// 3. Process Block Elements Line by Line (Headings, Lists, Blockquotes)
			const lines = htmlContent.split("\n");
			let resultLines: string[] = []; // Array to hold processed lines/HTML blocks
			let inUl = false; // State flag for unordered list
			let inOl = false; // State flag for ordered list
			let inBlockquote = false; // State flag for blockquote
			let currentBlockquoteLines: string[] = []; // Buffer for consecutive blockquote lines

			for (let i = 0; i < lines.length; i++) {
				let line = lines[i];

				// Regular expressions to detect markdown patterns at the start of a line
				// Allowing leading spaces for potential (though not fully supported) nesting
				const ulMatch = /^\s*([*\-+])\s+(.*)/.exec(line);
				const olMatch = /^\s*(\d+)\.\s+(.*)/.exec(line);
				const bqMatch = /^\s*>\s?(.*)/.exec(line);
				const hMatch = /^\s*(#{1,3})\s+(.*)/.exec(line);

				// --- Close Blocks Check ---
				// If the current line doesn't continue the active block, close the block.
				if (inBlockquote && !bqMatch) {
					// Join buffered blockquote lines with <br> and wrap in <blockquote>
					resultLines.push(
						`<blockquote>${currentBlockquoteLines.join("<br>")}</blockquote>`
					);
					currentBlockquoteLines = []; // Reset buffer
					inBlockquote = false;
				}
				if (inUl && !ulMatch) {
					resultLines.push("</ul>"); // Close unordered list
					inUl = false;
				}
				if (inOl && !olMatch) {
					resultLines.push("</ol>"); // Close ordered list
					inOl = false;
				}

				// --- Process Current Line ---
				if (hMatch) {
					// Handle Headings (H1, H2, H3)
					const level = hMatch[1].length; // Number of '#' determines level
					const content = hMatch[2]; // Text after '### '
					resultLines.push(`<h${level}>${content}</h${level}>`);
				} else if (bqMatch) {
					// Handle Blockquotes
					if (!inBlockquote) {
						inBlockquote = true; // Mark blockquote start (tag added when block ends)
					}
					currentBlockquoteLines.push(bqMatch[1]); // Add line content (without '>') to buffer
				} else if (ulMatch) {
					// Handle Unordered Lists
					if (!inUl) {
						resultLines.push("<ul>"); // Start <ul> if not already in one
						inUl = true;
					}
					resultLines.push(`<li>${ulMatch[2]}</li>`); // Add list item (content without marker)
				} else if (olMatch) {
					// Handle Ordered Lists
					if (!inOl) {
						resultLines.push("<ol>"); // Start <ol> if not already in one
						inOl = true;
					}
					resultLines.push(`<li>${olMatch[2]}</li>`); // Add list item (content without marker)
				} else {
					// Handle Regular Lines (potential paragraph content)
					// Push non-empty lines; preserve empty lines between content for potential breaks
					if (line.trim().length > 0) {
						resultLines.push(line);
					} else if (
						resultLines.length > 0 &&
						resultLines[resultLines.length - 1].trim().length > 0
					) {
						// Add an empty line marker if the previous line had content
						resultLines.push("");
					}
				}
			}

			// --- Close Remaining Blocks ---
			// After the loop, close any blocks that were still open (e.g., if the text ends with a list)
			if (inBlockquote) {
				resultLines.push(
					`<blockquote>${currentBlockquoteLines.join("<br>")}</blockquote>`
				);
			}
			if (inUl) {
				resultLines.push("</ul>");
			}
			if (inOl) {
				resultLines.push("</ol>");
			}

			// --- Combine Processed Lines ---
			// Join lines, paragraphs will be implicitly separated by block tags or empty lines
			htmlContent = resultLines.join("\n");

			// 4. Apply Inline Formatting (Bold, Italic, Inline Code) to the entire structured content
			// Note: Apply these *after* block structure is formed to avoid conflicts.
			// Italic (using negative lookarounds for robustness against ***)
			htmlContent = htmlContent.replace(
				/(?<!\*)\*(?!\s|[*])(.*?)(?<!\s)\*(?!\*)/g,
				"<em>$1</em>"
			);
			// Bold
			htmlContent = htmlContent.replace(
				/\*\*(?!\s)(.*?)(?<!\s)\*\*/g,
				"<strong>$1</strong>"
			);
			// Inline Code
			htmlContent = htmlContent.replace(/`([^`]+)`/g, "<code>$1</code>");

			// --- Split by placeholders to handle newlines correctly around code blocks ---
			const contentSegments = htmlContent.split(codeBlockPlaceholder);
			let finalHtml = "";

			for (let i = 0; i < contentSegments.length; i++) {
				let segment = contentSegments[i];

				// Convert remaining newlines in non-code segments to <br> tags
				// Replace sequences of 2+ newlines (paragraph breaks) with a single newline first
				// Then replace single newlines with <br>
				// Finally, remove the temporary single newlines used for paragraph separation.
				segment = segment
					.replace(/\n{2,}/g, "\n") // Consolidate paragraph breaks
					.replace(/\n/g, "<br>"); // Convert single newlines (incl. consolidated ones) to <br>

				finalHtml += segment;

				// Re-insert the corresponding code block if it exists
				if (i < codeBlocks.length) {
					finalHtml += codeBlocks[i]; // Add the <pre><code> block back
				}
			}
			htmlContent = finalHtml;

			// 6. Final Cleanup
			// Remove leading/trailing <br> tags that might have been added unnecessarily
			htmlContent = htmlContent.replace(/^<br>|<br>$/g, "");
			// Remove <br> tags that are immediately before or after major block elements
			// (Helps clean up spacing around lists, headings, etc.)
			htmlContent = htmlContent.replace(
				/<br>\s*(<(ul|ol|li|h[1-3]|blockquote|pre|code)[^>]*>)/gi,
				"$1"
			);
			htmlContent = htmlContent.replace(
				/(<\/(ul|ol|h[1-3]|blockquote|pre)>)\s*<br>/gi,
				"$1"
			);

			// --- End Markdown Conversion Logic ---

			textElement.innerHTML = htmlContent; // Set the final processed HTML content
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
			const enableControls = !loading && isApiKeySet;
			sendButton.disabled = !enableControls;
			chatInput.disabled = !enableControls;
			modelSelect.disabled = !enableControls;

			// Show/hide loading indicator message
			if (loading) {
				const lastMessage = chatContainer?.lastElementChild;
				// Add loading message only if it's not already the last message
				if (
					!lastMessage ||
					!lastMessage.classList.contains("loading-message")
				) {
					appendMessage("Model", "Thinking...", "loading-message");
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
						// Re-enable based on API key status if UI fails
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
					// If no confirmation needed, just re-enable controls based on key status
					// setLoadingState(false) already handles enabling based on isApiKeySet
				}
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

					// Re-enable input controls if not currently loading
					if (!isLoading) {
						chatInput!.disabled = !isApiKeySet;
						sendButton!.disabled = !isApiKeySet;
						modelSelect!.disabled = !isApiKeySet;
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
			// Explicit request to re-enable input (e.g., after an error or cancellation)
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

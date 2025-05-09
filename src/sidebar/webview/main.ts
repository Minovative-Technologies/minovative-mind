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

let planConfirmationContainer: HTMLDivElement | null = null;
let confirmPlanButton: HTMLButtonElement | null = null;
let cancelPlanButton: HTMLButtonElement | null = null; // User Request: cancelPlanButton (HTMLButtonElement)

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
	// Modified appendMessage to handle stream initialization
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

			// If sender is 'Model' and this is the start of a stream (empty text from aiResponseStart)
			// capture the span for future updates and initialize accumulated text.
			if (sender === "Model" && className === "ai-message" && text === "") {
				currentAiMessageContentElement = textElement;
				currentAccumulatedText = ""; // text is already empty string from aiResponseStart
				textElement.innerHTML = md.render(currentAccumulatedText); // Render initially empty
			} else {
				// For user messages, system messages, or complete non-streamed AI messages
				const renderedHtml = md.render(text);
				textElement.innerHTML = renderedHtml;
			}

			messageElement.appendChild(textElement);
			chatContainer.appendChild(messageElement);
			chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll to bottom

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

	// Modified setLoadingState
	function setLoadingState(loading: boolean) {
		isLoading = loading; // Keep track of overall loading state
		if (sendButton && chatInput && modelSelect) {
			const enableSendControls = !loading && isApiKeySet;
			sendButton.disabled = !enableSendControls;
			chatInput.disabled = !enableSendControls;
			modelSelect.disabled = !enableSendControls; // Also disable model select when loading

			if (loading) {
				// Add loading message ONLY if not already actively streaming an AI response
				// and if a loading message isn't already present.
				if (
					!currentAiMessageContentElement &&
					!chatContainer?.querySelector(".loading-message")
				) {
					appendMessage("Model", "Creating...", "loading-message");
				}
			} else {
				// If loading is set to false (e.g., by aiResponseEnd or error),
				// ensure any "Creating..." message is removed.
				const loadingMsg = chatContainer?.querySelector(".loading-message");
				if (loadingMsg) {
					loadingMsg.remove();
				}
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
		}
	}

	function createPlanConfirmationUI() {
		if (!planConfirmationContainer) {
			planConfirmationContainer = document.createElement("div");
			planConfirmationContainer.id = "plan-confirmation-container";
			planConfirmationContainer.style.display = "none"; // Initially hidden

			const textElement = document.createElement("p");
			textElement.textContent = "Confirm to proceed with the outlined plan?";

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
							planConfirmationContainer!.style.display = "none";
							pendingPlanData = null;
							setLoadingState(true); // Set loading while structured plan is generated/executed
						} else {
							updateStatus("Error: No pending plan data to confirm.", true);
						}
					} else if (
						target.id === "cancel-plan-button" ||
						target.closest("#cancel-plan-button")
					) {
						vscode.postMessage({ type: "cancelPlanExecution" });
						updateStatus("Plan cancelled.");
						planConfirmationContainer!.style.display = "none";
						pendingPlanData = null;
						setLoadingState(false); // Re-enable inputs as plan flow is cancelled
					}
				}
			);
		}
	}

	function setIconForButton(
		button: HTMLButtonElement | null,
		iconDefinition: any
	) {
		if (button) {
			const iconHTML = icon(iconDefinition, {
				classes: ["fa-icon"],
			}).html[0];
			if (iconHTML) {
				button.innerHTML = iconHTML;
			} else {
				button.innerHTML = "?"; // Fallback
				console.error(
					"Failed to generate Font Awesome icon:",
					iconDefinition.iconName
				);
			}
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
						if (chatInput) {
							chatInput.disabled = true;
						}
						if (sendButton) {
							sendButton.disabled = true;
						}
						if (modelSelect) {
							modelSelect.disabled = true;
						}
						// setLoadingState is not called to false here, as per instruction,
						// to keep the UI disabled until the user confirms or cancels the plan.
					} else {
						// Fallback if UI creation failed.
						console.error(
							"Plan confirmation container failed to create or find for non-streamed plan!"
						);
						updateStatus("Error: UI for plan confirmation is missing.", true);
						setLoadingState(false); // Set loading to false as plan confirmation cannot be shown.
					}
				} else if (message.isLoading === false) {
					// This handles regular non-streamed messages or non-confirmable parts of plans.
					// If message.isLoading is explicitly false, it means the AI operation is complete.
					setLoadingState(false);
				}
				// If message.isLoading is true (or not provided) and it's not a confirmable plan,
				// setLoadingState(false) is NOT called, meaning loading state persists.
				// This might be for multi-part non-streamed responses where intermediate parts are sent.
				break;
			}

			// --- New handlers for streamed responses ---
			case "aiResponseStart": {
				// Remove any general "Creating..." loading message from chatContainer
				const loadingMsg = chatContainer?.querySelector(".loading-message");
				if (loadingMsg) {
					loadingMsg.remove();
				}
				// Call appendMessage to set up the structure for the AI's response.
				// Empty text indicates it's the start of a stream.
				appendMessage("Model", "", "ai-message");
				// setLoadingState(true) was called when the user sent the message.
				// We are now in the process of receiving the response, so loading is still active.
				// No need to call setLoadingState(false) here.
				break;
			}
			case "aiResponseChunk": {
				if (currentAiMessageContentElement && message.value !== undefined) {
					currentAccumulatedText += message.value;
					currentAiMessageContentElement.innerHTML = md.render(
						currentAccumulatedText
					);
					if (chatContainer) {
						chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll to keep latest content visible
					}
				}
				break;
			}
			case "aiResponseEnd": {
				// MODIFICATION START: Introduce planConfirmationWasShown flag
				let planConfirmationWasShown = false;
				// MODIFICATION END

				// Handle error display if the stream ended unsuccessfully.
				// Condition changed to use !message.success and message.error.
				if (!message.success && message.error) {
					const errorMessageContent =
						typeof message.error === "string"
							? message.error
							: "Unknown error from AI response end.";
					if (currentAiMessageContentElement) {
						// Append error to the (potentially partially) streamed message content.
						const errorHtml = `<br><p style="color: var(--vscode-errorForeground);"><strong>Error:</strong> ${md.renderInline(
							errorMessageContent
						)}</p>`;
						currentAiMessageContentElement.innerHTML += errorHtml;
					} else {
						// If no stream was active or element is gone, append as a new system error message.
						appendMessage(
							"System",
							`Error during response: ${errorMessageContent}`,
							"error-message"
						);
					}
				}

				// Handle plan confirmation if the stream was successful and resulted in a plan.
				// Condition changed to use message.success.
				if (message.success && message.isPlanResponse && message.planData) {
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
						if (chatInput) {
							chatInput.disabled = true;
						}
						if (sendButton) {
							sendButton.disabled = true;
						}
						if (modelSelect) {
							modelSelect.disabled = true;
						}
						// MODIFICATION START: Set planConfirmationWasShown to true
						planConfirmationWasShown = true;
						// MODIFICATION END
						// setLoadingState(false) is no longer unconditionally called at the end of this case.
						// Input enabling/disabling is now managed by plan confirmation UI or the conditional logic below.
					} else {
						// Fallback if UI creation failed.
						console.error(
							"Plan confirmation container failed to create or find!"
						);
						updateStatus("Error: UI for plan confirmation is missing.", true);
						// planConfirmationWasShown remains false, so setLoadingState(false) will be called below.
					}
				}

				// MODIFICATION START: Conditionally call setLoadingState(false)
				// If plan confirmation UI was shown, do not call setLoadingState(false) here.
				// The plan confirmation UI's confirm/cancel handlers will manage setLoadingState.
				// If it was a regular stream or plan stream that failed before confirmation,
				// then call setLoadingState(false) as before.
				if (!planConfirmationWasShown) {
					setLoadingState(false);
				}
				// MODIFICATION END

				// Always reset streaming state variables for the next response.
				currentAiMessageContentElement = null;
				currentAccumulatedText = "";
				break;
			}
			// --- End new handlers for streamed responses ---

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

					// Re-evaluate input states based on API key status, only if not currently loading/streaming
					// and no plan confirmation is active.
					if (
						!isLoading &&
						!currentAiMessageContentElement &&
						(!planConfirmationContainer ||
							planConfirmationContainer.style.display === "none")
					) {
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
				} else {
					console.error("Invalid 'updateModelList' message received:", message);
				}
				break;
			}
			case "chatCleared": {
				if (chatContainer) {
					chatContainer.innerHTML = "";
				}
				if (clearChatButton) {
					clearChatButton.disabled = true;
				}
				if (saveChatButton) {
					saveChatButton.disabled = true;
				}
				setLoadingState(false); // Ensure loading state is reset
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
							appendMessage(msg.sender, msg.text, msg.className || "");
						}
					});
					updateStatus("Chat history restored.");
					const hasMessages = chatContainer.childElementCount > 0;
					if (clearChatButton) {
						clearChatButton.disabled = !hasMessages;
					}
					if (saveChatButton) {
						saveChatButton.disabled = !hasMessages;
					}
				} else {
					updateStatus(
						"Error: Failed to restore chat history due to invalid format.",
						true
					);
				}
				setLoadingState(false); // Ensure loading state is reset
				// If plan confirmation was active, hide it
				if (
					planConfirmationContainer &&
					planConfirmationContainer.style.display !== "none"
				) {
					planConfirmationContainer.style.display = "none";
					pendingPlanData = null;
				}
				break;
			}
			case "reenableInput": {
				console.log("Received reenableInput request from provider.");
				// This message might be sent if an operation was cancelled on the extension side
				// or an error occurred that requires input to be re-enabled.
				setLoadingState(false);
				// Ensure streaming state is also reset if this happens unexpectedly mid-stream
				if (currentAiMessageContentElement) {
					console.warn(
						"reenableInput received mid-stream. Resetting stream state."
					);
					currentAiMessageContentElement = null;
					currentAccumulatedText = "";
				}
				// If plan confirmation was active, it should also be hidden as the flow is interrupted.
				if (
					planConfirmationContainer &&
					planConfirmationContainer.style.display !== "none"
				) {
					planConfirmationContainer.style.display = "none";
					pendingPlanData = null;
					updateStatus("Input re-enabled, pending plan cancelled.");
				}
				break;
			}
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

		// Initial button states
		prevKeyButton!.disabled = true;
		nextKeyButton!.disabled = true;
		deleteKeyButton!.disabled = true;
		chatInput!.disabled = true; // Disabled until API key is confirmed
		sendButton!.disabled = true; // Disabled until API key is confirmed
		modelSelect!.disabled = true; // Disabled until API key is confirmed
		clearChatButton!.disabled = true; // Disabled until there are messages
		saveChatButton!.disabled = true; // Disabled until there are messages
		loadChatButton!.disabled = false; // Always enabled

		// Set icons for buttons
		setIconForButton(sendButton, faPaperPlane);
		setIconForButton(saveChatButton, faFloppyDisk);
		setIconForButton(loadChatButton, faFolderOpen);
		setIconForButton(clearChatButton, faTrashCan);
		setIconForButton(prevKeyButton, faChevronLeft);
		setIconForButton(nextKeyButton, faChevronRight);
		setIconForButton(deleteKeyButton, faTrashCan);
		setIconForButton(addKeyButton, faPlus);

		// Create plan confirmation UI elements (initially hidden)
		createPlanConfirmationUI();
	}

	initializeWebview();
}

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
let cancelPlanButton: HTMLButtonElement | null = null;

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
	function appendMessage(sender: string, text: string, className: string = "") {
		if (chatContainer) {
			if (className !== "loading-message") {
				const lastMessage = chatContainer.lastElementChild;
				if (lastMessage && lastMessage.classList.contains("loading-message")) {
					lastMessage.remove();
				}
			} else if (chatContainer.querySelector(".loading-message")) {
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
			const renderedHtml = md.render(text);
			textElement.innerHTML = renderedHtml;
			messageElement.appendChild(textElement);

			chatContainer.appendChild(messageElement);
			chatContainer.scrollTop = chatContainer.scrollHeight;

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
		} else {
			appendMessage("You", fullMessage, "user-message");
			vscode.postMessage({ type: "chatMessage", value: fullMessage });
			setLoadingState(true);
		}
	}

	function setLoadingState(loading: boolean) {
		isLoading = loading;
		if (sendButton && chatInput && modelSelect) {
			const enableSendControls = !loading && isApiKeySet;
			sendButton.disabled = !enableSendControls;
			chatInput.disabled = !enableSendControls;
			modelSelect.disabled = !enableSendControls;

			if (loading) {
				const lastMessage = chatContainer?.lastElementChild;
				if (
					!lastMessage ||
					!lastMessage.classList.contains("loading-message")
				) {
					appendMessage("Model", "Creating...", "loading-message");
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
			textElement.textContent = "Confirm to proceed with the outlined plan?"; // Generic message

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
						// MODIFIED: Send the stored pendingPlanData (which is now simpler)
						// The provider side uses its internal _pendingPlanGenerationContext for full details.
						vscode.postMessage({
							type: "confirmPlanExecution",
							value: pendingPlanData, // Send the simplified context
						});
						updateStatus("Requesting plan execution...");
						planConfirmationContainer!.style.display = "none";
						pendingPlanData = null;
						setLoadingState(true); // Loading while structured plan is generated & executed
					} else if (
						target.id === "cancel-plan-button" ||
						target.closest("#cancel-plan-button")
					) {
						vscode.postMessage({ type: "cancelPlanExecution" });
						updateStatus("Plan cancelled.");
						planConfirmationContainer!.style.display = "none";
						pendingPlanData = null;
						setLoadingState(false);
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
				button.innerHTML = "?";
				console.error(
					"Failed to generate Font Awesome icon:",
					iconDefinition.iconName
				);
			}
		}
	}

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
			case "aiResponse": {
				setLoadingState(false);
				appendMessage(
					"Model",
					message.value,
					message.isError ? "error-message" : "ai-message"
				);

				if (message.requiresConfirmation && message.planData) {
					createPlanConfirmationUI();
					if (planConfirmationContainer) {
						// MODIFIED: Store the simplified planData from the provider
						pendingPlanData = message.planData as {
							type: string;
							originalRequest?: string;
							originalInstruction?: string;
						};
						planConfirmationContainer.style.display = "flex";
						updateStatus(
							"Textual plan generated. Please review and confirm to proceed."
						);
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
						console.error("Plan confirmation container failed to create!");
						updateStatus(
							"Error: UI elements for plan confirmation missing.",
							true
						);
						setLoadingState(false);
					}
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
						currentKeyDisplay!.textContent = "No Active Key";
						updateApiKeyStatus("Please add an API key.");
					}
					prevKeyButton!.disabled = totalKeys <= 1;
					nextKeyButton!.disabled = totalKeys <= 1;
					deleteKeyButton!.disabled = updateData.activeIndex === -1;

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
				clearChatButton!.disabled = true;
				saveChatButton!.disabled = true;
				setLoadingState(false);
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
				setLoadingState(false);
				break;
			}
			case "reenableInput": {
				console.log("Received reenableInput request from provider.");
				setLoadingState(false);
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

		prevKeyButton!.disabled = true;
		nextKeyButton!.disabled = true;
		deleteKeyButton!.disabled = true;
		chatInput!.disabled = true;
		sendButton!.disabled = true;
		modelSelect!.disabled = true;
		clearChatButton!.disabled = true;
		saveChatButton!.disabled = true;
		loadChatButton!.disabled = false;

		setIconForButton(sendButton, faPaperPlane);
		setIconForButton(saveChatButton, faFloppyDisk);
		setIconForButton(loadChatButton, faFolderOpen);
		setIconForButton(clearChatButton, faTrashCan);
		setIconForButton(prevKeyButton, faChevronLeft);
		setIconForButton(nextKeyButton, faChevronRight);
		setIconForButton(deleteKeyButton, faTrashCan);
		setIconForButton(addKeyButton, faPlus);

		createPlanConfirmationUI();
	}

	initializeWebview();
}

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
	faRedo,
	faStop,
	faCopy,
	faExclamationTriangle,
} from "@fortawesome/free-solid-svg-icons";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import { MINOVATIVE_COMMANDS } from "../common/sidebarConstants";
import { AiStreamingState } from "../common/sidebarTypes"; // Ensure this import is present

library.add(
	faPaperPlane,
	faFloppyDisk,
	faFolderOpen,
	faTrashCan,
	faChevronLeft,
	faChevronRight,
	faPlus,
	faCheck,
	faTimes,
	faRedo,
	faStop,
	faCopy,
	faExclamationTriangle
);

interface VsCodeApi {
	postMessage(message: any): void;
	getState(): any;
	setState(newState: any): void;
}
declare const acquireVsCodeApi: () => VsCodeApi;
const vscode = acquireVsCodeApi();

const md: MarkdownIt = new MarkdownIt({
	html: true, // Allow HTML tags in Markdown output
	linkify: true, // Automatically convert URLs to links
	typographer: true, // Enable some smart typography replacements
	highlight: function (str: string, lang: string): string {
		// If a language is specified and highlight.js supports it
		if (lang && hljs.getLanguage(lang)) {
			try {
				// Highlight the string and return the HTML value
				return hljs.highlight(str, { language: lang, ignoreIllegals: true })
					.value;
			} catch (__) {
				// Fallback in case of highlighting error
				console.warn(`[MarkdownIt] Highlight.js failed for language ${lang}.`);
			}
		}
		// Fallback for unsupported language or no language specified:
		// Render as a basic preformatted code block with escaped HTML
		return (
			'<pre class="hljs"><code>' + md.utils.escapeHtml(str) + "</code></pre>"
		);
	},
});

// --- Global variables for streaming responses ---
let currentAiMessageContentElement: HTMLSpanElement | null = null;
let currentAccumulatedText: string = "";
let typingBuffer: string = "";
let typingTimer: NodeJS.Timeout | null = null;
const TYPING_SPEED_MS: number = 0;
const CHARS_PER_INTERVAL: number = 5;
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
const emptyChatPlaceholder = document.getElementById(
	"empty-chat-placeholder"
) as HTMLDivElement | null;
const cancelGenerationButton = document.getElementById(
	"cancel-generation-button"
) as HTMLButtonElement | null;

const commandSuggestionsContainer = document.getElementById(
	"command-suggestions-container"
) as HTMLDivElement | null;
const chatInputControlsWrapper = document.getElementById(
	"chat-input-controls-wrapper"
) as HTMLDivElement | null;

let activeCommandIndex: number = -1;
let filteredCommands: string[] = [];
let isCommandSuggestionsVisible: boolean = false;

let planConfirmationContainer: HTMLDivElement | null = null;
let confirmPlanButton: HTMLButtonElement | null = null;
let cancelPlanButton: HTMLButtonElement | null = null;

const planParseErrorContainer = document.getElementById(
	"plan-parse-error-container"
) as HTMLDivElement | null;
const planParseErrorDisplay = document.getElementById(
	"plan-parse-error-display"
) as HTMLParagraphElement | null;
const failedJsonDisplay = document.getElementById(
	"failed-json-display"
) as HTMLElement | null;
const retryGenerationButton = document.getElementById(
	"retry-generation-button"
) as HTMLButtonElement | null;
const cancelParseErrorButton = document.getElementById(
	"cancel-parse-error-button"
) as HTMLButtonElement | null;

const commitReviewContainer = document.getElementById(
	"commit-review-container"
) as HTMLDivElement | null;
const commitMessageTextarea = document.getElementById(
	"commit-message-textarea"
) as HTMLTextAreaElement | null;
const stagedFilesList = document.getElementById(
	"staged-files-list"
) as HTMLUListElement | null;
const confirmCommitButton = document.getElementById(
	"confirm-commit-button"
) as HTMLButtonElement | null;
const cancelCommitButton = document.getElementById(
	"cancel-commit-button"
) as HTMLButtonElement | null;

const signUpButton = document.getElementById(
	"signUpButton"
) as HTMLButtonElement | null;
console.log("[main.ts] signUpButton element:", signUpButton);
const signInButton = document.getElementById(
	"signInButton"
) as HTMLButtonElement | null;

// State
let isApiKeySet = false;
let isLoading = false;
let totalKeys = 0;
let pendingPlanData: {
	type: string;
	originalRequest?: string;
	originalInstruction?: string;
	relevantFiles?: string[];
} | null = null;

console.log("Webview script loaded.");

function stopTypingAnimation() {
	if (typingTimer !== null) {
		clearInterval(typingTimer);
		typingTimer = null;
		console.log("[Webview] Typing animation stopped.");
	}
}

function typeNextCharacters() {
	if (!currentAiMessageContentElement) {
		stopTypingAnimation();
		console.warn(
			"[Webview] No currentAiMessageContentElement found, stopping typing animation."
		);
		return;
	}
	if (typingBuffer.length === 0 && !isLoading) {
		// Only stop if buffer is empty AND not actively loading (e.g., if a new chunk is expected soon)
		stopTypingAnimation();
		return;
	}
	const charsToType = Math.min(CHARS_PER_INTERVAL, typingBuffer.length);
	if (charsToType > 0) {
		currentAccumulatedText += typingBuffer.substring(0, charsToType);
		typingBuffer = typingBuffer.substring(charsToType);
		currentAiMessageContentElement.innerHTML = md.render(
			currentAccumulatedText
		);
		if (chatContainer) {
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}
	}
}

function startTypingAnimation() {
	if (typingTimer === null) {
		typingTimer = setInterval(typeNextCharacters, TYPING_SPEED_MS);
		console.log("[Webview] Typing animation started.");
	}
}

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
	!statusArea ||
	!cancelGenerationButton ||
	!planParseErrorContainer ||
	!planParseErrorDisplay ||
	!failedJsonDisplay ||
	!retryGenerationButton ||
	!cancelParseErrorButton ||
	!emptyChatPlaceholder ||
	!commitReviewContainer ||
	!commitMessageTextarea ||
	!stagedFilesList ||
	!confirmCommitButton ||
	!cancelCommitButton ||
	!signUpButton ||
	!signInButton ||
	!commandSuggestionsContainer ||
	!chatInputControlsWrapper
) {
	console.error("Required DOM elements not found!");
	const body = document.querySelector("body");
	if (body) {
		body.innerHTML =
			'<p style="color: var(--vscode-errorForeground); font-weight: bold;">Error initializing webview UI. Please check console (Developer: Open Webview Developer Tools).</p>';
	}
} else {
	function appendMessage(
		sender: string,
		text: string,
		className: string = "",
		isHistoryMessage: boolean = false,
		diffContent?: string,
		relevantFiles?: string[],
		messageIndexForHistory?: number,
		isRelevantFilesExpandedForHistory?: boolean
	) {
		if (chatContainer) {
			if (className === "loading-message") {
				if (chatContainer.querySelector(".loading-message")) {
					const existingLoadingMsg = chatContainer.querySelector(
						".loading-message"
					) as HTMLDivElement;
					if (existingLoadingMsg && existingLoadingMsg.textContent !== text) {
						existingLoadingMsg.textContent = text;
					}
					return;
				}
			} else {
				const loadingMsg = chatContainer.querySelector(".loading-message");
				if (loadingMsg) {
					loadingMsg.remove();
				}
			}

			const messageElement = document.createElement("div");
			messageElement.classList.add("message");
			if (className) {
				className
					.split(" ")
					.forEach((cls) => messageElement.classList.add(cls));
			}
			if (isHistoryMessage) {
				messageElement.dataset.isHistory = "true";
				if (messageIndexForHistory !== undefined) {
					messageElement.dataset.messageIndex =
						messageIndexForHistory.toString();
				}
			}

			const senderElement = document.createElement("strong");
			senderElement.textContent = `${sender}:\u00A0`;
			messageElement.appendChild(senderElement);

			if (className.includes("error-message")) {
				const errorIconContainer = document.createElement("span");
				errorIconContainer.classList.add("error-icon");
				errorIconContainer.title = "Error";
				try {
					const errorIconHTML = icon(faExclamationTriangle, {
						classes: ["fa-icon"],
					}).html[0];
					if (errorIconHTML) {
						errorIconContainer.innerHTML = errorIconHTML;
						messageElement.appendChild(errorIconContainer);
					} else {
						console.error("Failed to generate Font Awesome error icon HTML.");
					}
				} catch (e) {
					console.error("Error setting Font Awesome error icon", e);
				}
			}

			const textElement = document.createElement("span");
			textElement.classList.add("message-text-content");
			messageElement.appendChild(textElement);

			if (diffContent !== undefined) {
				const diffContainer = document.createElement("div");
				diffContainer.classList.add("diff-container");

				// The original 'diffHeader' element defined here was only appended
				// in the 'else' block for 'no-diff-content'.
				// For consistency and explicit placement, a new diffHeaderElement
				// is created and prepended below for actual diffs.
				const diffHeader = document.createElement("div");
				diffHeader.classList.add("diff-header");

				const trimmedDiffContent = diffContent.trim();

				if (trimmedDiffContent !== "") {
					// Remove or comment out this line as a new element will be created and prepended
					// diffHeader.textContent = "Code Changes:";

					// Create and append the diff header for actual diff content
					const diffHeaderElement = document.createElement("div");
					diffHeaderElement.classList.add("diff-header");
					diffHeaderElement.textContent = "Code Diff:";
					diffContainer.prepend(diffHeaderElement);

					const preCode = document.createElement("pre");
					preCode.classList.add("diff-code");

					const codeElement = document.createElement("code");
					codeElement.classList.add("language-diff"); // Instruct highlight.js it's a diff
					codeElement.classList.add("hljs"); // Add highlight.js base class

					let highlightedHtml = "";
					try {
						// Highlight the entire diff content as a 'diff' language
						highlightedHtml = hljs.highlight(trimmedDiffContent, {
							language: "diff",
							ignoreIllegals: true,
						}).value;
					} catch (e) {
						console.error("Error highlighting diff content:", e);
						// Fallback to plain text if highlighting fails
						highlightedHtml = md.utils.escapeHtml(trimmedDiffContent);
					}
					codeElement.innerHTML = highlightedHtml; // Set the highlighted HTML

					preCode.appendChild(codeElement);
					// No need to append diffHeader here as it's now prepended earlier
					diffContainer.appendChild(preCode);
				} else {
					diffHeader.textContent =
						"No Code Changes Detected (or no diff provided)";
					diffContainer.classList.add("no-diff-content");
					diffContainer.appendChild(diffHeader);
				}

				messageElement.appendChild(diffContainer);
			}

			if (sender === "Model" && relevantFiles && relevantFiles.length > 0) {
				const contextFilesDiv = document.createElement("div");
				contextFilesDiv.classList.add("ai-context-files");
				const shouldBeExpandedInitially =
					isRelevantFilesExpandedForHistory !== undefined
						? isRelevantFilesExpandedForHistory
						: relevantFiles.length <= 3;

				if (shouldBeExpandedInitially) {
					contextFilesDiv.classList.add("expanded");
				} else {
					contextFilesDiv.classList.add("collapsed");
				}

				const filesHeader = document.createElement("div");
				filesHeader.classList.add("context-files-header");
				filesHeader.textContent = "AI Context Files";
				contextFilesDiv.appendChild(filesHeader);
				filesHeader.addEventListener("click", () => {
					const currentIsExpanded =
						contextFilesDiv.classList.contains("expanded");
					const newIsExpanded = !currentIsExpanded;

					contextFilesDiv.classList.toggle("collapsed", !newIsExpanded);
					contextFilesDiv.classList.toggle("expanded", newIsExpanded);

					const parentMessageElement = filesHeader.closest(
						".message[data-is-history='true']"
					) as HTMLElement | null;
					if (
						parentMessageElement &&
						parentMessageElement.dataset.messageIndex
					) {
						const messageIdx = parseInt(
							parentMessageElement.dataset.messageIndex,
							10
						);
						if (!isNaN(messageIdx)) {
							vscode.postMessage({
								type: "toggleRelevantFilesDisplay",
								messageIndex: messageIdx,
								isExpanded: newIsExpanded,
							});
						} else {
							console.warn("Failed to parse messageIndex from dataset.");
						}
					} else {
						console.warn(
							"Parent message element or messageIndex dataset not found for relevant files toggle."
						);
					}
				});

				const fileList = document.createElement("ul");
				fileList.classList.add("context-file-list");

				relevantFiles.forEach((filePath) => {
					const li = document.createElement("li");
					li.classList.add("context-file-item");
					li.textContent = filePath;
					li.dataset.filepath = filePath;
					li.title = `Open ${filePath}`;
					fileList.appendChild(li);
				});

				contextFilesDiv.appendChild(fileList);

				const senderStrongTag = messageElement.querySelector("strong");
				if (senderStrongTag) {
					senderStrongTag.insertAdjacentElement("afterend", contextFilesDiv);
				} else {
					messageElement.appendChild(contextFilesDiv);
				}
			}

			let copyButton: HTMLButtonElement | null = null;
			let deleteButton: HTMLButtonElement | null = null;

			if (isHistoryMessage) {
				if (
					className.includes("user-message") ||
					className.includes("ai-message")
				) {
					copyButton = document.createElement("button");
					copyButton.classList.add("copy-button");
					copyButton.title = "Copy Message";
					setIconForButton(copyButton, faCopy);

					deleteButton = document.createElement("button");
					deleteButton.classList.add("delete-button");
					deleteButton.title = "Delete Message";
					setIconForButton(deleteButton, faTrashCan);

					const messageActions = document.createElement("div");
					messageActions.classList.add("message-actions");
					messageActions.appendChild(copyButton);
					messageActions.appendChild(deleteButton);

					messageElement.appendChild(messageActions);

					if (
						sender === "Model" &&
						text === "" &&
						className.includes("ai-message") &&
						!className.includes("error-message")
					) {
						console.log(
							"Appending start of AI stream message (isHistoryMessage)."
						);
						currentAiMessageContentElement = textElement;
						currentAccumulatedText = "";
						typingBuffer = "";
						startTypingAnimation();

						textElement.innerHTML =
							'<span class="loading-text">Generating<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';

						if (copyButton) {
							copyButton.disabled = true;
						}
						if (deleteButton) {
							deleteButton.disabled = true;
						}
					} else {
						stopTypingAnimation();
						typingBuffer = "";
						currentAiMessageContentElement = null;
						currentAccumulatedText = "";

						const renderedHtml = md.render(text);
						textElement.innerHTML = renderedHtml;
						if (copyButton) {
							copyButton.disabled = false;
						}
						if (deleteButton) {
							deleteButton.disabled = false;
						}
					}
				} else {
					console.log(
						"Appending history-backed non-user/AI message (no buttons)."
					);
					const renderedHtml = md.render(text);
					textElement.innerHTML = renderedHtml;
					stopTypingAnimation();
					typingBuffer = "";
					currentAiMessageContentElement = null;
					currentAccumulatedText = "";
				}
			} else {
				console.log("Appending non-history message (no buttons).");
				const renderedHtml = md.render(text);
				textElement.innerHTML = renderedHtml;
				stopTypingAnimation();
				typingBuffer = "";
				currentAiMessageContentElement = null;
				currentAccumulatedText = "";
			}

			chatContainer.appendChild(messageElement);
			chatContainer.scrollTop = chatContainer.scrollHeight;
			updateEmptyChatPlaceholderVisibility();
		}
	}

	function updateCommitButtonState() {
		if (commitMessageTextarea && confirmCommitButton) {
			const trimmedMessage = commitMessageTextarea.value.trim();
			confirmCommitButton.disabled = trimmedMessage === "";
		}
	}

	function showCommandSuggestions(commands: string[]): void {
		if (!commandSuggestionsContainer) {
			return;
		}
		filteredCommands = commands;
		commandSuggestionsContainer.innerHTML = "";
		activeCommandIndex = -1;

		if (commands.length === 0) {
			const noMatchesItem = document.createElement("div");
			noMatchesItem.classList.add("command-item", "no-matches");
			noMatchesItem.textContent = "No matching commands";
			commandSuggestionsContainer.appendChild(noMatchesItem);
		} else {
			commands.forEach((command) => {
				const commandItem = document.createElement("div");
				commandItem.classList.add("command-item");
				commandItem.textContent = command;
				commandItem.dataset.command = command;
				commandItem.addEventListener("click", () => {
					selectCommand(command);
				});
				commandSuggestionsContainer.appendChild(commandItem);
			});
		}
		commandSuggestionsContainer.style.display = "flex";
		isCommandSuggestionsVisible = true;
		setLoadingState(isLoading);
		if (chatInputControlsWrapper) {
			chatInputControlsWrapper.style.zIndex = "100";
		}
	}

	function hideCommandSuggestions(): void {
		if (!commandSuggestionsContainer) {
			return;
		}
		isCommandSuggestionsVisible = false;
		commandSuggestionsContainer.style.display = "none";
		setLoadingState(isLoading);
		commandSuggestionsContainer.innerHTML = "";
		activeCommandIndex = -1;
		filteredCommands = [];
		if (chatInputControlsWrapper) {
			chatInputControlsWrapper.style.zIndex = "";
		}
	}

	function selectCommand(command: string): void {
		if (!chatInput) {
			return;
		}
		chatInput.value = command + " ";
		chatInput.focus();
		chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
		hideCommandSuggestions();
	}

	function highlightCommand(index: number): void {
		if (!commandSuggestionsContainer) {
			return;
		}
		const items = Array.from(
			commandSuggestionsContainer.children
		) as HTMLDivElement[];
		items.forEach((item) => item.classList.remove("active"));
		if (index >= 0 && index < items.length) {
			items[index].classList.add("active");
			items[index].scrollIntoView({ block: "nearest" });
		}
	}

	function isInputtingCompleteCommand(text: string): boolean {
		for (const cmd of MINOVATIVE_COMMANDS) {
			if (text.startsWith(cmd)) {
				if (text.length === cmd.length || text[cmd.length] === " ") {
					return true;
				}
			}
		}
		return false;
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
			if (!isError) {
				setTimeout(() => {
					if (statusArea.textContent === sanitizedText) {
						statusArea.textContent = "";
					}
				}, 15000);
			} else {
				setTimeout(() => {
					if (statusArea.textContent === sanitizedText) {
						statusArea.textContent = "";
					}
				}, 30000);
			}
		}
	}

	function sendMessage() {
		const planConfirmationVisible =
			planConfirmationContainer &&
			planConfirmationContainer.style.display !== "none";
		const planParseErrorVisible =
			planParseErrorContainer &&
			planParseErrorContainer.style.display !== "none";
		const commitReviewVisible =
			commitReviewContainer && commitReviewContainer.style.display !== "none";

		if (
			isLoading ||
			planConfirmationVisible ||
			planParseErrorVisible ||
			commitReviewVisible ||
			isCommandSuggestionsVisible ||
			!chatInput ||
			!sendButton
		) {
			console.log(
				"Send button disabled: isLoading",
				isLoading,
				"planConfirmationVisible",
				planConfirmationVisible,
				"planParseErrorVisible",
				planParseErrorVisible,
				"commitReviewVisible",
				commitReviewVisible,
				"isCommandSuggestionsVisible:",
				isCommandSuggestionsVisible
			);
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
				"error-message",
				true
			);
			return;
		}

		setLoadingState(true);

		const lowerMessage = fullMessage.toLowerCase();
		if (lowerMessage.startsWith("/plan ")) {
			const planRequest = fullMessage.substring(6).trim();
			if (!planRequest) {
				setLoadingState(false);
				appendMessage(
					"System",
					"Please provide a description for the plan after /plan.",
					"error-message",
					true
				);
				return;
			}
			appendMessage("You", fullMessage, "user-message", true);
			vscode.postMessage({ type: "planRequest", value: planRequest });
		} else if (lowerMessage === "/commit") {
			appendMessage("You", fullMessage, "user-message", true);
			vscode.postMessage({ type: "commitRequest" });
		} else {
			appendMessage("You", fullMessage, "user-message", true);
			vscode.postMessage({ type: "chatMessage", value: fullMessage });
		}
	}

	function setLoadingState(loading: boolean) {
		console.log(
			`[setLoadingState] Call: loading=${loading}, current isLoading=${isLoading}, current isApiKeySet=${isApiKeySet}, current isCommandSuggestionsVisible=${isCommandSuggestionsVisible}`
		);
		isLoading = loading;
		const loadingMsg = chatContainer?.querySelector(".loading-message");
		if (loadingMsg) {
			loadingMsg.remove();
		}

		const planConfirmationVisible =
			planConfirmationContainer &&
			planConfirmationContainer.style.display !== "none";
		const planParseErrorVisible =
			planParseErrorContainer &&
			planParseErrorContainer.style.display !== "none";
		const commitReviewVisible =
			commitReviewContainer && commitReviewContainer.style.display !== "none";

		console.log(
			`[setLoadingState] UI Display States: planConfirmationContainer=${planConfirmationContainer?.style.display}, planParseErrorContainer=${planParseErrorContainer?.style.display}, commitReviewContainer=${commitReviewContainer?.style.display}, isCommandSuggestionsVisible=${isCommandSuggestionsVisible}`
		);

		const enableSendControls =
			!loading &&
			isApiKeySet &&
			!planConfirmationVisible &&
			!planParseErrorVisible &&
			!commitReviewVisible &&
			!isCommandSuggestionsVisible;

		const canInteractWithChatHistoryButtons =
			!loading &&
			!planConfirmationVisible &&
			!planParseErrorVisible &&
			!commitReviewVisible &&
			!isCommandSuggestionsVisible;

		console.log(
			`[setLoadingState] Final computed enableSendControls=${enableSendControls}, canInteractWithChatHistoryButtons=${canInteractWithChatHistoryButtons}`
		);

		if (sendButton) {
			sendButton.disabled = !enableSendControls;
		}
		if (chatInput) {
			chatInput.disabled = loading;
		}
		if (modelSelect) {
			modelSelect.disabled =
				!!isLoading ||
				!!planConfirmationVisible ||
				!!planParseErrorVisible ||
				!!commitReviewVisible ||
				!!isCommandSuggestionsVisible;
		}
		const enableApiKeyControls =
			!isLoading &&
			!planConfirmationVisible &&
			!planParseErrorVisible &&
			!commitReviewVisible &&
			!isCommandSuggestionsVisible &&
			totalKeys > 0;
		if (prevKeyButton) {
			prevKeyButton.disabled = !enableApiKeyControls || totalKeys <= 1;
		}
		if (nextKeyButton) {
			nextKeyButton.disabled = !enableApiKeyControls || totalKeys <= 1;
		}
		if (deleteKeyButton) {
			deleteKeyButton.disabled = !enableApiKeyControls || !isApiKeySet;
		}
		const enableAddKeyInputControls =
			!loading &&
			!planConfirmationVisible &&
			!planParseErrorVisible &&
			!commitReviewVisible &&
			!isCommandSuggestionsVisible;
		if (addKeyInput) {
			addKeyInput.disabled = !enableAddKeyInputControls;
		}
		if (addKeyButton) {
			addKeyButton.disabled = !enableAddKeyInputControls;
		}

		const hasMessages = chatContainer
			? chatContainer.childElementCount > 0 &&
			  !chatContainer.querySelector(".loading-message")
			: false;

		if (loadChatButton) {
			loadChatButton.disabled = !canInteractWithChatHistoryButtons;
		}
		if (saveChatButton) {
			saveChatButton.disabled =
				!canInteractWithChatHistoryButtons || !hasMessages;
		}
		if (clearChatButton) {
			clearChatButton.disabled =
				!canInteractWithChatHistoryButtons || !hasMessages;
		}

		console.log(
			`[setLoadingState] Status: loading=${loading}, planConfVis=${planConfirmationVisible}, planParseErrVis=${planParseErrorVisible}, commitRevVis=${commitReviewVisible}`
		);
		console.log(
			`[setLoadingState] Chat: childCount=${chatContainer?.childElementCount}, hasMessages=${hasMessages}`
		);
		console.log(
			`[setLoadingState] Buttons: saveDisabled=${saveChatButton?.disabled}, clearDisabled=${clearChatButton?.disabled}`
		);

		if (cancelGenerationButton) {
			if (
				loading &&
				!planConfirmationVisible &&
				!planParseErrorVisible &&
				!commitReviewVisible
			) {
				cancelGenerationButton.style.display = "inline-flex";
			} else {
				cancelGenerationButton.style.display = "none";
			}
		}

		if (loading) {
			if (
				!currentAiMessageContentElement &&
				!chatContainer?.querySelector(".loading-message")
			) {
				appendMessage(
					"Model",
					'<span class="loading-text">Generating<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>',
					"loading-message",
					false
				);
			}
		} else {
			updateEmptyChatPlaceholderVisibility();
		}

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

		if (
			loading &&
			planParseErrorContainer &&
			planParseErrorContainer.style.display !== "none"
		) {
			planParseErrorContainer.style.display = "none";
			if (planParseErrorDisplay) {
				planParseErrorDisplay.textContent = "";
			}
			if (failedJsonDisplay) {
				failedJsonDisplay.textContent = "";
			}
			updateStatus("New request initiated, parse error UI hidden.");
		}
		if (
			loading &&
			commitReviewContainer &&
			commitReviewContainer.style.display !== "none"
		) {
			commitReviewContainer.style.display = "none";
			updateStatus("New request initiated, commit review UI hidden.");
		}
	}

	function updateEmptyChatPlaceholderVisibility() {
		console.log("[DEBUG] updateEmptyChatPlaceholderVisibility called.");
		if (!chatContainer || !emptyChatPlaceholder) {
			return;
		}

		const actualMessages = Array.from(chatContainer.children).filter(
			(child) =>
				child.classList.contains("message") &&
				!child.classList.contains("loading-message")
		);

		if (actualMessages.length > 0) {
			emptyChatPlaceholder.style.display = "none";
			chatContainer.style.display = "flex";
		} else {
			emptyChatPlaceholder.style.display = "flex";
			chatContainer.style.display = "none";
		}
		console.log(
			`[DEBUG] actualMessages.length: ${actualMessages.length}, emptyChatPlaceholder.style.display: ${emptyChatPlaceholder.style.display}`
		);
	}

	function createPlanConfirmationUI() {
		if (!planConfirmationContainer) {
			planConfirmationContainer = document.createElement("div");
			planConfirmationContainer.id = "plan-confirmation-container";
			planConfirmationContainer.style.display = "none";

			const textElement = document.createElement("p");
			textElement.textContent = "Review plan and confirm to proceed?";

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
						console.log("Confirm Plan button clicked.");
						if (pendingPlanData) {
							vscode.postMessage({
								type: "confirmPlanExecution",
								value: pendingPlanData,
							});
							updateStatus("Requesting plan execution...");
							planConfirmationContainer!.style.display = "none";
							pendingPlanData = null;
							setLoadingState(true);
						} else {
							updateStatus("Error: No pending plan data to confirm.", true);
						}
					} else if (
						target.id === "cancel-plan-button" ||
						target.closest("#cancel-plan-button")
					) {
						console.log("Cancel Plan button clicked.");
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
			try {
				const iconHTML = icon(iconDefinition, {
					classes: ["fa-icon"],
				}).html[0];
				if (iconHTML) {
					button.innerHTML = iconHTML;
				} else {
					button.innerHTML = "?";
					console.error(
						"Failed to generate Font Awesome icon HTML for:",
						iconDefinition.iconName
					);
				}
			} catch (e) {
				console.error(
					"Error setting Font Awesome icon",
					iconDefinition.iconName,
					e
				);
				button.innerHTML = "!";
			}
		}
	}

	sendButton.addEventListener("click", () => {
		console.log("Send button clicked.");
		sendMessage();
	});

	chatInput.addEventListener("input", () => {
		if (!chatInput) {
			return;
		}
		const text = chatInput.value;
		if (text.startsWith("/")) {
			if (isInputtingCompleteCommand(text)) {
				hideCommandSuggestions();
				return;
			}

			const query = text.substring(1).toLowerCase();
			const matches = MINOVATIVE_COMMANDS.filter((cmd) =>
				cmd.toLowerCase().includes(query)
			);
			showCommandSuggestions(matches);
		} else {
			hideCommandSuggestions();
		}
	});

	chatInput.addEventListener("keydown", (e) => {
		if (!isCommandSuggestionsVisible) {
			if (e.key === "Enter" && !e.shiftKey) {
				console.log("Chat input Enter key pressed (no suggestions visible).");
				e.preventDefault();
				sendMessage();
			}
			return;
		}

		if (filteredCommands.length === 0) {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				console.log(
					"Enter pressed with visible but empty suggestions. Not sending message."
				);
			}
			return;
		}

		const numCommands = filteredCommands.length;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			activeCommandIndex = (activeCommandIndex + 1) % numCommands;
			highlightCommand(activeCommandIndex);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			activeCommandIndex = (activeCommandIndex - 1 + numCommands) % numCommands;
			highlightCommand(activeCommandIndex);
		} else if (e.key === "Enter") {
			e.preventDefault();

			if (activeCommandIndex !== -1) {
				selectCommand(filteredCommands[activeCommandIndex]);
			} else {
				console.log(
					"Enter pressed with suggestions visible but no command highlighted. Not sending message."
				);
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			hideCommandSuggestions();
		}
	});

	chatInput.addEventListener("blur", () => {
		setTimeout(() => {
			if (chatInput && !chatInput.value.startsWith("/")) {
				hideCommandSuggestions();
			}
		}, 150);
	});

	if (commitMessageTextarea) {
		commitMessageTextarea.addEventListener("input", updateCommitButtonState);
	}

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
		console.log("Clear Chat button clicked.");
		vscode.postMessage({ type: "clearChatRequest" });
	});
	saveChatButton.addEventListener("click", () => {
		console.log("Save Chat button clicked.");
		vscode.postMessage({ type: "saveChatRequest" });
		updateStatus("Requesting chat save...");
	});
	loadChatButton.addEventListener("click", () => {
		console.log("Load Chat button clicked.");
		vscode.postMessage({ type: "loadChatRequest" });
		updateStatus("Requesting chat load...");
	});

	if (retryGenerationButton) {
		retryGenerationButton.addEventListener("click", () => {
			console.log("Retry Generation button clicked.");
			if (planParseErrorContainer) {
				planParseErrorContainer.style.display = "none";
			}
			vscode.postMessage({ type: "retryStructuredPlanGeneration" });
			setLoadingState(true);
			if (planParseErrorDisplay) {
				planParseErrorDisplay.textContent = "";
			}
			if (failedJsonDisplay) {
				failedJsonDisplay.textContent = "";
			}
			updateStatus("Retrying structured plan generation...");
		});
	}

	if (signUpButton) {
		signUpButton.addEventListener("click", () => {
			console.log(
				"[main.ts] Sign Up button clicked. Posting openExternalLink message."
			);
			vscode.postMessage({
				type: "openExternalLink",
				url: "https://www.minovativemind.dev/registration/signin",
			});
		});
	}
	if (signInButton) {
		signInButton.addEventListener("click", () => {
			console.log(
				"[main.ts] Sign In button clicked. Posting openSettingsPanel message."
			);
			vscode.postMessage({
				type: "openSettingsPanel",
				panelId: "minovativeMindSidebarViewSettings",
			});
		});
	}

	window.addEventListener("message", (event: MessageEvent) => {
		const message = event.data;
		console.log("Received message:", event.data);
		console.log("[Webview] Message received from extension:", message.type);

		switch (message.type) {
			case "aiResponse": {
				appendMessage(
					"Model",
					message.value,
					`ai-message ${message.isError ? "error-message" : ""}`.trim(),
					true,
					undefined,
					message.relevantFiles
				);

				if (
					message.isPlanResponse &&
					message.requiresConfirmation &&
					message.planData
				) {
					console.log("Received aiResponse with confirmable plan.");
					createPlanConfirmationUI();
					if (planConfirmationContainer) {
						pendingPlanData = message.planData as {
							type: string;
							originalRequest?: string;
							originalInstruction?: string;
							relevantFiles?: string[];
						};
						planConfirmationContainer.style.display = "flex";
						updateStatus(
							"Textual plan generated. Review and confirm to proceed."
						);

						setLoadingState(false);
						if (cancelGenerationButton) {
							cancelGenerationButton.style.display = "none";
						}
					} else {
						console.error(
							"Plan confirmation container failed to create or find for non-streamed plan!"
						);
						updateStatus("Error: UI for plan confirmation is missing.", true);
						setLoadingState(false);
					}
				} else if (message.isLoading === false) {
					setLoadingState(false);
				}
				break;
			}

			case "restoreStreamingProgress": {
				const { content, relevantFiles, isComplete, isError } =
					message.value as AiStreamingState;
				console.log(
					"[Webview] Received restoreStreamingProgress. Content length:",
					content.length,
					"Is Complete:",
					isComplete
				);

				// 1. Clear any existing webview-side streaming state to prepare for restoration
				stopTypingAnimation();
				typingBuffer = "";
				currentAccumulatedText = "";
				currentAiMessageContentElement = null;

				// 2. Append the base AI message element. This sets up the DOM structure
				//    and assigns `currentAiMessageContentElement` to the correct span.
				//    We pass an empty string for initial text, as content will be injected/animated.
				appendMessage(
					"Model",
					"", // Initial empty text, content will be populated next
					`ai-message ${isError ? "error-message" : ""}`.trim(),
					true, // Treat as a history-backed message for consistent styling and buttons
					undefined, // No diffContent for streaming progress
					relevantFiles
				);

				// 3. Get a reference to the message element that was just created.
				const restoredMessageElement =
					chatContainer?.lastElementChild as HTMLDivElement | null;
				if (restoredMessageElement) {
					// Find the specific content span within the newly created message element.
					currentAiMessageContentElement = restoredMessageElement.querySelector(
						".message-text-content"
					) as HTMLSpanElement | null;

					// Get references to copy/delete buttons
					const copyButton = restoredMessageElement.querySelector(
						".copy-button"
					) as HTMLButtonElement | null;
					const deleteButton = restoredMessageElement.querySelector(
						".delete-button"
					) as HTMLButtonElement | null;

					if (currentAiMessageContentElement) {
						// Populate the accumulated text from the restored state
						currentAccumulatedText = content;

						// 4. Render content and manage loading state based on `isComplete`
						if (isComplete) {
							// If the stream is complete, just render the final content.
							currentAiMessageContentElement.innerHTML = md.render(
								currentAccumulatedText
							);
							if (copyButton) {
								copyButton.disabled = false;
							}
							if (deleteButton) {
								deleteButton.disabled = false;
							}
							stopTypingAnimation(); // Ensure animation is stopped
						} else {
							// If the stream is NOT complete, render accumulated content PLUS the loading dots.
							currentAiMessageContentElement.innerHTML =
								md.render(currentAccumulatedText) +
								'<span class="loading-text">Generating<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';
							startTypingAnimation(); // Re-activate the typing animation for the dots
							if (copyButton) {
								copyButton.disabled = true;
							} // Disable buttons while generating
							if (deleteButton) {
								deleteButton.disabled = true;
							}
						}

						// Ensure the chat container scrolls to the bottom to show the restored message
						if (chatContainer) {
							chatContainer.scrollTop = chatContainer.scrollHeight;
						}
					} else {
						console.warn(
							"[Webview] Failed to find .message-text-content in restored AI message. Fallback to direct append."
						);
						// Fallback if the content element isn't found after appendMessage.
						// Append the full content, assuming it's an error or complete state.
						appendMessage(
							"Model",
							content,
							`ai-message ${isError ? "error-message" : ""}`.trim(),
							true,
							undefined,
							relevantFiles
						);
					}
				} else {
					console.warn(
						"[Webview] Failed to find or create AI message element for restoreStreamingProgress. Fallback to direct append."
					);
					// Fallback if the message element itself couldn't be created.
					appendMessage(
						"Model",
						content,
						`ai-message ${isError ? "error-message" : ""}`.trim(),
						true,
						undefined,
						relevantFiles
					);
				}

				// 5. Update the overall loading state of the UI (disables/enables inputs, shows/hides cancel button)
				setLoadingState(!isComplete);
				break;
			}

			case "aiResponseStart": {
				isLoading = true;
				setLoadingState(true);
				currentAccumulatedText = "";
				typingBuffer = "";
				stopTypingAnimation();
				console.log(
					"Received aiResponseStart. Starting stream via appendMessage."
				);
				appendMessage(
					"Model",
					"",
					"ai-message",
					true,
					undefined,
					message.value.relevantFiles
				);
				break;
			}
			case "aiResponseChunk": {
				if (message.value !== undefined) {
					typingBuffer += message.value;
					if (typingTimer === null) {
						startTypingAnimation();
					}
				}
				break;
			}
			case "aiResponseEnd": {
				stopTypingAnimation();
				console.log("Received aiResponseEnd. Stream finished.");
				if (currentAiMessageContentElement) {
					currentAccumulatedText += typingBuffer;
					const renderedHtml = md.render(currentAccumulatedText);
					currentAiMessageContentElement.innerHTML = renderedHtml;

					const messageElement = currentAiMessageContentElement.parentElement;
					if (messageElement) {
						const copyButton = messageElement.querySelector(
							".copy-button"
						) as HTMLButtonElement | null;
						if (copyButton) {
							copyButton.disabled = false;
						}
						const deleteButton = messageElement.querySelector(
							".delete-button"
						) as HTMLButtonElement | null;
						if (deleteButton) {
							deleteButton.disabled = false;
						}
					}
				} else {
					console.warn(
						"aiResponseEnd received but currentAiMessageContentElement is null. Attempting to clear state."
					);
				}

				typingBuffer = "";
				currentAiMessageContentElement = null;
				currentAccumulatedText = "";

				if (!message.success && message.error) {
					const errorMessageContent =
						typeof message.error === "string"
							? message.error
							: "Unknown error occurred during AI response streaming.";
					updateStatus(`AI Stream Error: ${errorMessageContent}`, true);
				}

				if (message.success && message.isPlanResponse && message.planData) {
					console.log("aiResponseEnd indicates confirmable plan.");
					createPlanConfirmationUI();
					if (planConfirmationContainer) {
						pendingPlanData = message.planData as {
							type: string;
							originalRequest?: string;
							originalInstruction?: string;
							relevantFiles?: string[];
						};

						planConfirmationContainer.style.display = "flex";
						updateStatus(
							"Textual plan generated. Review and confirm to proceed."
						);

						setLoadingState(false);
						if (cancelGenerationButton) {
							cancelGenerationButton.style.display = "none";
						}
					} else {
						console.error(
							"Plan confirmation container failed to create or find!"
						);
						updateStatus("Error: UI for plan confirmation is missing.", true);
						setLoadingState(false);
					}
				} else if (message.success) {
					console.log("aiResponseEnd indicates successful chat response.");
					setLoadingState(false);
					updateEmptyChatPlaceholderVisibility();
				} else {
					console.log("aiResponseEnd indicates failed streaming operation.");
					setLoadingState(false);
				}
				break;
			}

			case "structuredPlanParseFailed": {
				const { error, failedJson } = message.value;
				console.log("Received structuredPlanParseFailed.");

				if (
					planParseErrorContainer &&
					planParseErrorDisplay &&
					failedJsonDisplay &&
					retryGenerationButton &&
					cancelParseErrorButton
				) {
					planParseErrorDisplay.textContent = error;
					failedJsonDisplay.textContent = failedJson;

					planParseErrorContainer.style.display = "block";

					setLoadingState(false);

					updateStatus(
						"Structured plan parsing failed. Review error and retry or cancel.",
						true
					);
				} else {
					console.error(
						"Parse error UI elements not found. Cannot display structured plan parse failure."
					);
					appendMessage(
						"System",
						`Structured plan parsing failed: ${error}. Failed JSON: \n\`\`\`json\n${failedJson}\n\`\`\`. Error UI missing.`,
						"error-message",
						true
					);
					setLoadingState(false);
				}
				break;
			}

			case "commitReview": {
				console.log("Received commitReview message:", message.value);
				const { commitMessage, stagedFiles } = message.value;

				if (commitMessageTextarea) {
					commitMessageTextarea.value = commitMessage;
					commitMessageTextarea.focus();
					commitMessageTextarea.scrollTop = 0;
					updateCommitButtonState();
				} else {
					console.error("commitMessageTextarea element not found.");
				}

				if (
					commitReviewContainer &&
					commitMessageTextarea &&
					stagedFilesList &&
					confirmCommitButton &&
					cancelCommitButton
				) {
					stagedFilesList.innerHTML = "";

					if (stagedFiles && stagedFiles.length > 0) {
						stagedFiles.forEach((file: string) => {
							const li = document.createElement("li");
							li.textContent = file;
							stagedFilesList.appendChild(li);
						});
					} else {
						const li = document.createElement("li");
						li.textContent = "No files to commit.";
						li.style.fontStyle = "italic";
						stagedFilesList.appendChild(li);
					}

					commitReviewContainer.style.display = "flex";
					document.documentElement.scrollTop =
						document.documentElement.scrollHeight;
					updateStatus("Review commit details and confirm.", false);
					setLoadingState(false);
					if (cancelGenerationButton) {
						cancelGenerationButton.style.display = "none";
					}
				} else {
					console.error(
						"Commit review UI elements not found. Cannot display commit details."
					);
					updateStatus("Error: UI for commit review is missing.", true);
					setLoadingState(false);
				}
				break;
			}

			case "restorePendingPlanConfirmation":
				if (message.value) {
					console.log("Received restorePendingPlanConfirmation.");
					pendingPlanData = message.value as {
						type: string;
						originalRequest?: string;
						originalInstruction?: string;
						relevantFiles?: string[];
					};

					createPlanConfirmationUI();

					if (planConfirmationContainer) {
						planConfirmationContainer.style.display = "flex";
						updateStatus(
							"Pending plan confirmation restored. Review and confirm to proceed."
						);

						if (cancelGenerationButton) {
							cancelGenerationButton.style.display = "none";
						}
						isLoading = false;
						setLoadingState(false);
					} else {
						console.error(
							"Error: Plan confirmation container not found during restore. Cannot display pending plan."
						);
						updateStatus(
							"Error: Failed to restore pending plan UI. Inputs re-enabled.",
							true
						);
						pendingPlanData = null;
						setLoadingState(false);
					}
				} else {
					console.warn(
						"restorePendingPlanConfirmation received without message.value. No action taken."
					);
					setLoadingState(false);
				}
				break;

			case "appendRealtimeModelMessage":
				if (message.value && typeof message.value.text === "string") {
					appendMessage(
						"Model",
						message.value.text,
						`ai-message ${message.value.isError ? "error-message" : ""}`.trim(),
						true,
						message.value.diffContent,
						message.value.relevantFiles
					);
					setLoadingState(isLoading);
				} else {
					console.warn(
						"Received 'appendRealtimeModelMessage' with invalid value:",
						message.value
					);
				}
				break;

			case "apiKeyStatus": {
				if (typeof message.value === "string") {
					updateApiKeyStatus(message.value);
					setLoadingState(isLoading);
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
					setLoadingState(isLoading);
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
					setLoadingState(isLoading);
				} else {
					console.error("Invalid 'updateModelList' message received:", message);
				}
				break;
			}
			// New case added as per instruction 2
			case "updateLoadingState": {
				setLoadingState(message.value as boolean);
				break;
			}
			case "chatCleared": {
				if (chatContainer) {
					chatContainer.innerHTML = "";
				}
				setLoadingState(false);
				stopTypingAnimation();
				typingBuffer = "";
				currentAiMessageContentElement = null;
				currentAccumulatedText = "";
				if (
					planConfirmationContainer &&
					planConfirmationContainer.style.display !== "none"
				) {
					planConfirmationContainer.style.display = "none";
					pendingPlanData = null;
				}
				if (
					planParseErrorContainer &&
					planParseErrorContainer.style.display !== "none"
				) {
					planParseErrorContainer.style.display = "none";
					if (planParseErrorDisplay) {
						planParseErrorDisplay.textContent = "";
					}
					if (failedJsonDisplay) {
						failedJsonDisplay.textContent = "";
					}
				}
				if (
					commitReviewContainer &&
					commitReviewContainer.style.display !== "none"
				) {
					commitReviewContainer.style.display = "none";
				}
				updateEmptyChatPlaceholderVisibility();
				break;
			}
			case "restoreHistory": {
				if (chatContainer && Array.isArray(message.value)) {
					chatContainer.innerHTML = "";
					message.value.forEach((msg: any, index: number) => {
						if (
							msg &&
							typeof msg.sender === "string" &&
							typeof msg.text === "string"
						) {
							appendMessage(
								msg.sender,
								msg.text,
								msg.className || "",
								true,
								msg.diffContent,
								msg.relevantFiles,
								index,
								msg.isRelevantFilesExpanded
							);
						}
					});
					updateStatus("Chat history restored.");
				} else {
					updateStatus(
						"Error: Failed to restore chat history due to invalid format.",
						true
					);
				}
				if (
					planConfirmationContainer &&
					planConfirmationContainer.style.display !== "none"
				) {
					planConfirmationContainer.style.display = "none";
					pendingPlanData = null;
				}
				if (
					planParseErrorContainer &&
					planParseErrorContainer.style.display !== "none"
				) {
					planParseErrorContainer.style.display = "none";
					if (planParseErrorDisplay) {
						planParseErrorDisplay.textContent = "";
					}
					if (failedJsonDisplay) {
						failedJsonDisplay.textContent = "";
					}
				}
				if (
					commitReviewContainer &&
					commitReviewContainer.style.display !== "none"
				) {
					commitReviewContainer.style.display = "none";
				}
				updateEmptyChatPlaceholderVisibility();

				document.documentElement.scrollTop = 0;

				break;
			}
			case "authStateUpdate": {
				const { isSignedIn, currentUserTier, isSubscriptionActive } =
					message.value;
				console.log(
					`[main.ts] authStateUpdate received. isSignedIn: ${isSignedIn}, Tier: ${currentUserTier}, ActiveSub: ${isSubscriptionActive}`
				);

				if (signUpButton) {
					const newDisplay = isSignedIn ? "none" : "inline-block";
					signUpButton.style.display = newDisplay;
					console.log(
						`[main.ts] signUpButton display set to: '${newDisplay}' based on isSignedIn: ${isSignedIn}`
					);
				} else {
					console.warn(
						"[main.ts] authStateUpdate: signUpButton element not found when trying to update visibility."
					);
				}
				if (signInButton) {
					const newDisplay = isSignedIn ? "none" : "inline-block";
					signInButton.style.display = newDisplay;
					console.log(
						`[main.ts] signInButton display set to: '${newDisplay}' based on isSignedIn: ${isSignedIn}`
					);
				} else {
					console.warn(
						"[main.ts] authStateUpdate: signInButton element not found when trying to update visibility."
					);
				}
				break;
			}
			case "updateRelevantFilesDisplay": {
				const { messageIndex, isExpanded } = message.value;
				if (chatContainer) {
					const messageElement = chatContainer.querySelector(
						`.message[data-message-index="${messageIndex}"]`
					) as HTMLDivElement | null;
					if (messageElement) {
						const contextFilesDiv = messageElement.querySelector(
							".ai-context-files"
						) as HTMLDivElement | null;
						if (contextFilesDiv) {
							contextFilesDiv.classList.toggle("collapsed", !isExpanded);
							contextFilesDiv.classList.toggle("expanded", isExpanded);
						} else {
							console.warn(
								`[updateRelevantFilesDisplay] .ai-context-files div not found for message index ${messageIndex}.`
							);
						}
					} else {
						console.warn(
							`[updateRelevantFilesDisplay] Message element with data-message-index="${messageIndex}" not found.`
						);
					}
				}
				break;
			}
			case "reenableInput": {
				console.log(
					"[reenableInput] Received reenableInput request from provider."
				);

				isLoading = false;
				stopTypingAnimation();

				if (currentAiMessageContentElement) {
					console.warn(
						"reenableInput received mid-stream. Resetting stream state."
					);
					currentAccumulatedText += typingBuffer;
					const renderedHtml = md.render(currentAccumulatedText);
					currentAiMessageContentElement.innerHTML = renderedHtml;
					const messageElement = currentAiMessageContentElement.parentElement;
					if (messageElement) {
						const copyButton = messageElement.querySelector(
							".copy-button"
						) as HTMLButtonElement | null;
						if (copyButton) {
							copyButton.disabled = false;
						}
						const deleteButton = messageElement.querySelector(
							".delete-button"
						) as HTMLButtonElement | null;
						if (deleteButton) {
							deleteButton.disabled = false;
						}
					}
				}

				typingBuffer = "";
				currentAiMessageContentElement = null;
				currentAccumulatedText = "";

				if (planConfirmationContainer) {
					console.log(
						`[reenableInput] Hiding planConfirmationContainer. Current display: ${planConfirmationContainer.style.display}`
					);
				}
				if (
					planConfirmationContainer &&
					planConfirmationContainer.style.display !== "none"
				) {
					planConfirmationContainer.style.display = "none";
					pendingPlanData = null;
				}
				if (planParseErrorContainer) {
					console.log(
						`[reenableInput] Hiding planParseErrorContainer. Current display: ${planParseErrorContainer.style.display}`
					);
				}
				if (
					planParseErrorContainer &&
					planParseErrorContainer.style.display !== "none"
				) {
					planParseErrorContainer.style.display = "none";
					if (planParseErrorDisplay) {
						planParseErrorDisplay.textContent = "";
					}
					if (failedJsonDisplay) {
						failedJsonDisplay.textContent = "";
					}
				}
				if (commitReviewContainer) {
					console.log(
						`[reenableInput] Hiding commitReviewContainer. Current display: ${commitReviewContainer.style.display}`
					);
				}
				if (
					commitReviewContainer &&
					commitReviewContainer.style.display !== "none"
				) {
					commitReviewContainer.style.display = "none";
				}

				console.log(
					"[reenableInput] Calling setLoadingState(false); Confirming isLoading is now false."
				);
				setLoadingState(false);

				const planConfirmationActive =
					planConfirmationContainer &&
					planConfirmationContainer.style.display !== "none";

				if (!planConfirmationActive && pendingPlanData) {
					pendingPlanData = null;
					updateStatus(
						"Inputs re-enabled; any non-visible pending plan confirmation has been cleared."
					);
				} else if (!planConfirmationActive) {
					updateStatus("Inputs re-enabled.");
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

		if (chatInput) {
			chatInput.disabled = true;
		}
		if (sendButton) {
			sendButton.disabled = true;
		}
		if (modelSelect) {
			modelSelect.disabled = true;
		}

		if (clearChatButton) {
			clearChatButton.disabled = true;
		}
		if (saveChatButton) {
			saveChatButton.disabled = true;
		}

		if (loadChatButton) {
			loadChatButton.disabled = false;
		}

		if (prevKeyButton) {
			prevKeyButton.disabled = true;
		}
		if (nextKeyButton) {
			nextKeyButton.disabled = true;
		}
		if (deleteKeyButton) {
			deleteKeyButton.disabled = true;
		}

		if (cancelGenerationButton) {
			cancelGenerationButton.style.display = "none";
		}
		if (planParseErrorContainer) {
			planParseErrorContainer.style.display = "none";
		}
		if (commitReviewContainer) {
			commitReviewContainer.style.display = "none";
		}
		if (confirmCommitButton) {
			confirmCommitButton.disabled = true;
		}

		if (commandSuggestionsContainer) {
			commandSuggestionsContainer.style.display = "none";
		}

		setIconForButton(sendButton, faPaperPlane);
		setIconForButton(saveChatButton, faFloppyDisk);
		setIconForButton(loadChatButton, faFolderOpen);
		setIconForButton(clearChatButton, faTrashCan);
		setIconForButton(prevKeyButton, faChevronLeft);
		setIconForButton(nextKeyButton, faChevronRight);
		setIconForButton(deleteKeyButton, faTrashCan);
		setIconForButton(addKeyButton, faPlus);
		setIconForButton(retryGenerationButton, faRedo);
		setIconForButton(cancelParseErrorButton, faTimes);
		setIconForButton(cancelGenerationButton, faStop);

		if (cancelParseErrorButton) {
			cancelParseErrorButton.addEventListener("click", () => {
				console.log("Cancel Parse Error button clicked.");
				if (planParseErrorContainer) {
					planParseErrorContainer.style.display = "none";
				}
				if (planParseErrorDisplay) {
					planParseErrorDisplay.textContent = "";
				}
				if (failedJsonDisplay) {
					failedJsonDisplay.textContent = "";
				}
				vscode.postMessage({ type: "cancelPlanExecution" });
				updateStatus("Plan generation retry cancelled.");
				setLoadingState(false);
			});
		}

		if (confirmCommitButton) {
			confirmCommitButton.addEventListener("click", () => {
				console.log("Confirm Commit button clicked.");
				if (commitReviewContainer) {
					commitReviewContainer.style.display = "none";
				}
				const editedMessage = commitMessageTextarea?.value || "";
				vscode.postMessage({ type: "confirmCommit", value: editedMessage });
				updateStatus("Committing changes...", false);
				setLoadingState(true);
			});
		}

		if (cancelCommitButton) {
			cancelCommitButton.addEventListener("click", () => {
				console.log("Cancel Commit button clicked.");
				if (commitReviewContainer) {
					commitReviewContainer.style.display = "none";
				}
				vscode.postMessage({ type: "cancelCommit" });
				updateStatus("Commit cancelled by user.", false);
				setLoadingState(false);
			});
		}

		setIconForButton(confirmCommitButton, faCheck);
		setIconForButton(cancelCommitButton, faTimes);

		if (cancelGenerationButton) {
			cancelGenerationButton.addEventListener("click", () => {
				console.log("Cancel Generation button clicked.");
				vscode.postMessage({ type: "cancelGeneration" });

				updateStatus("Cancelling operation...");
			});
		}

		if (chatContainer) {
			chatContainer.addEventListener("click", async (event) => {
				const target = event.target as HTMLElement;
				const copyButton = target.closest(
					".copy-button"
				) as HTMLButtonElement | null;
				const deleteButton = target.closest(
					".delete-button"
				) as HTMLButtonElement | null;
				const fileItem = target.closest(
					".context-file-item[data-filepath]"
				) as HTMLLIElement | null;

				if (fileItem) {
					event.preventDefault();
					const filePath = fileItem.dataset.filepath;
					if (filePath) {
						vscode.postMessage({ type: "openFile", value: filePath });
						updateStatus(`Opening file: ${filePath}`);
					}
					return;
				}

				if (copyButton && !copyButton.disabled) {
					const messageElement = copyButton.closest(".message");
					if (messageElement) {
						const textElement = messageElement.querySelector(
							".message-text-content"
						) as HTMLSpanElement | null;

						if (textElement) {
							const textToCopyHTML = textElement.innerHTML;

							const tempDiv = document.createElement("div");
							tempDiv.innerHTML = textToCopyHTML;

							Array.from(
								tempDiv.querySelectorAll(
									"p, pre, ul, ol, li, div, br, h1, h2, h3, h4, h5, h6, blockquote, table, tr"
								)
							).forEach((el) => {
								if (el.tagName === "BR") {
									el.replaceWith("\n");
								} else if (el.tagName === "LI") {
									if (el.previousElementSibling) {
										el.prepend("\n");
									}
								} else {
									el.append("\n");
								}
							});

							let textToCopy = tempDiv.textContent || tempDiv.innerText || "";
							textToCopy = textToCopy.replace(/\n{3,}/g, "\n\n");
							textToCopy = textToCopy.replace(/^\n+/, "");
							textToCopy = textToCopy.replace(/\n+$/, "");
							textToCopy = textToCopy.trim();

							textToCopy = textToCopy.replace(/\n\s*\n/g, "\n\n");

							try {
								await navigator.clipboard.writeText(textToCopy);
								console.log("Text copied to clipboard.");

								const originalIconHTML = copyButton.innerHTML;
								setIconForButton(copyButton, faCheck);
								copyButton.title = "Copied!";

								setTimeout(() => {
									copyButton.innerHTML = originalIconHTML;
									copyButton.title = "Copy Message";
								}, 1500);
							} catch (err) {
								console.error("Failed to copy text: ", err);
								let errorMessage = "Failed to copy text.";
								if (err instanceof Error && err.message) {
									errorMessage += ` Details: ${err.message}`;
								}
								updateStatus(errorMessage, true);
							}
						} else {
							console.warn("Could not find text span for copy button.");
							updateStatus("Error: Could not find text to copy.", true);
						}
					} else {
						console.warn(
							"Copy button clicked, but parent message element not found."
						);
					}
				} else if (deleteButton && !deleteButton.disabled) {
					const messageElementToDelete = deleteButton.closest(
						".message[data-is-history='true']"
					);
					if (messageElementToDelete) {
						const allHistoryMessages = Array.from(
							chatContainer.querySelectorAll(".message[data-is-history='true']")
						);
						const messageIndex = allHistoryMessages.indexOf(
							messageElementToDelete
						);

						if (messageIndex !== -1) {
							vscode.postMessage({
								type: "deleteSpecificMessage",
								messageIndex: messageIndex,
							});
							updateStatus("Requesting message deletion...");
						} else {
							console.warn(
								"Could not find index of history message to delete (after data-is-history filter)."
							);
						}
					} else {
						console.warn(
							"Delete button clicked, but target is not a history-backed message."
						);
					}
				}
			});
		}

		createPlanConfirmationUI();

		updateEmptyChatPlaceholderVisibility();
		console.log("[DEBUG] initializeWebview completed.");
	}

	initializeWebview();
}

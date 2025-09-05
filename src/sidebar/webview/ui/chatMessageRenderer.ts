import { md } from "../utils/markdownRenderer";
import {
	setIconForButton,
	faExclamationTriangle,
	faCopy,
	faTrashCan,
	faPenToSquare,
	faLightbulb,
} from "../utils/iconHelpers";
import { postMessageToExtension } from "../utils/vscodeApi";
import { appState } from "../state/appState";
import { stopTypingAnimation, startTypingAnimation } from "./typingAnimation";
import {
	updateEmptyChatPlaceholderVisibility,
	updateStatus,
} from "./statusManager";
import { RequiredDomElements } from "../types/webviewTypes";
import { ImageInlineData } from "../../common/sidebarTypes";
import {
	faChevronDown,
	faChevronUp,
	faFileImport,
} from "@fortawesome/free-solid-svg-icons";

// Global reference to setLoadingState function
let globalSetLoadingState:
	| ((loading: boolean, elements: RequiredDomElements) => void)
	| null = null;

// Flag to ensure CSS is only injected once
let _chatRendererStylesInjected: boolean = false;

// Function to set the global setLoadingState reference
export function setGlobalSetLoadingState(
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	globalSetLoadingState = setLoadingState;
	// Instruction 6: Inject conceptual CSS rules upon initialization
	injectChatRendererStyles();
}

/**
 * Injects default CSS rules for editing indicator and cancel button.
 * This ensures they are hidden by default when the webview is initialized.
 * Called once upon the first setting of globalSetLoadingState.
 */
export function injectChatRendererStyles(): void {
	if (_chatRendererStylesInjected) {
		return;
	}

	const style = document.createElement("style");
	style.textContent = `
		.editing-indicator {
			display: none;
		}
		.cancel-edit-button {
			display: none;
		}
	`;
	document.head.appendChild(style);
	_chatRendererStylesInjected = true;
	console.log(
		"[ChatMessageRenderer] Injected default CSS for editing state elements."
	);
}

/**
 * Finalizes an AI streaming message by stopping animation, rendering final text,
 * re-enabling buttons, and resetting app state variables.
 * @param elements - The required DOM elements.
 */
export function finalizeStreamingMessage(elements: RequiredDomElements): void {
	if (appState.currentAiMessageContentElement) {
		console.log("[ChatMessageRenderer] Finalizing AI streaming message.");
		stopTypingAnimation();

		// Ensure any remaining text in the buffer is added to accumulated text
		appState.currentAccumulatedText += appState.typingBuffer;

		// Render the final accumulated content
		appState.currentAiMessageContentElement.innerHTML = md.render(
			appState.currentAccumulatedText
		);
		// Store the original markdown text for copy functionality
		appState.currentAiMessageContentElement.dataset.originalMarkdown =
			appState.currentAccumulatedText;

		// Re-enable action buttons on all messages, which will handle the just-completed message
		reenableAllMessageActionButtons(elements);

		// Reset app state variables
		appState.currentAiMessageContentElement = null;
		appState.currentAccumulatedText = "";
		appState.typingBuffer = "";
		appState.typingTimer = null; // Ensure the timer is cleared
		clearEditingState(elements);
		elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
	} else {
		console.log(
			"[ChatMessageRenderer] No active AI streaming message to finalize."
		);
	}
}

export function appendMessage(
	elements: RequiredDomElements,
	sender: string,
	text: string,
	className: string = "",
	isHistoryMessage: boolean = false,
	diffContent?: string,
	relevantFiles?: string[],
	messageIndexForHistory?: number,
	isRelevantFilesExpandedForHistory?: boolean,
	isPlanExplanationForRender: boolean = false,
	isPlanStepUpdateForRender: boolean = false,
	imageParts?: ImageInlineData[]
): void {
	// Instruction 2: At the very beginning of the `appendMessage` function, insert the following conditional call:
	if (
		(sender === "Model" && text === "" && className.includes("ai-message")) ||
		(className !== "loading-message" && !isHistoryMessage)
	) {
		finalizeStreamingMessage(elements);
	}

	// Handle loading-message deduplication
	if (className === "loading-message") {
		const existingLoadingMsg = elements.chatContainer.querySelector(
			".loading-message"
		) as HTMLDivElement;
		if (existingLoadingMsg) {
			if (existingLoadingMsg.textContent !== text) {
				existingLoadingMsg.textContent = text;
			}
			return;
		}
	} else {
		// Remove any existing loading message if a non-loading message is being appended
		const loadingMsg = elements.chatContainer.querySelector(".loading-message");
		if (loadingMsg) {
			loadingMsg.remove();
		}
	}

	const messageElement = document.createElement("div");
	messageElement.classList.add("message");
	if (className) {
		className.split(" ").forEach((cls) => messageElement.classList.add(cls));
	}
	if (isPlanStepUpdateForRender) {
		messageElement.classList.add("plan-step-message");
	}
	if (isHistoryMessage) {
		messageElement.dataset.isHistory = "true";
		if (messageIndexForHistory !== undefined) {
			messageElement.dataset.messageIndex = messageIndexForHistory.toString();
		}
	}

	const senderElement = document.createElement("strong");
	senderElement.textContent = `${sender}:\u00A0`;
	messageElement.appendChild(senderElement);

	// Add error icon if it's an error message
	if (className.includes("error-message")) {
		const errorIconContainer = document.createElement("span");
		errorIconContainer.classList.add("error-icon");
		errorIconContainer.title = "Error";
		setIconForButton(
			errorIconContainer as HTMLButtonElement,
			faExclamationTriangle
		); // Casting to HTMLButtonElement as setIconForButton expects it, but it's just setting innerHTML
		messageElement.appendChild(errorIconContainer);
	}

	const textElement = document.createElement("span");
	textElement.classList.add("message-text-content");
	messageElement.appendChild(textElement);

	// Add diff content if provided
	if (diffContent !== undefined) {
		const diffContainer = document.createElement("div");
		diffContainer.classList.add("diff-container");
		diffContainer.classList.add("collapsed"); // Default to collapsed

		const diffHeaderElement = document.createElement("div");
		diffHeaderElement.classList.add("diff-header");

		const headerTextSpan = document.createElement("span");
		headerTextSpan.classList.add("diff-header-text");
		headerTextSpan.textContent = "Code Diff:";
		diffHeaderElement.appendChild(headerTextSpan);

		const toggleButton = document.createElement("button");
		toggleButton.classList.add("diff-toggle-button");
		toggleButton.title = "Toggle Diff Visibility";
		setIconForButton(toggleButton, faChevronDown); // Default icon for collapsed state

		toggleButton.addEventListener("click", () => {
			const isCollapsed = diffContainer.classList.toggle("collapsed");
			if (isCollapsed) {
				setIconForButton(toggleButton, faChevronDown);
			} else {
				setIconForButton(toggleButton, faChevronUp);
			}
			// Ensure the chat scrolls to make the expanded diff visible
			elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
		});

		diffHeaderElement.appendChild(toggleButton);
		diffContainer.appendChild(diffHeaderElement);

		const diffContentWrapper = document.createElement("div"); // New wrapper for collapsible content
		diffContentWrapper.classList.add("diff-content-wrapper");

		const trimmedDiffContent = diffContent.trim();

		if (trimmedDiffContent !== "") {
			const preCode = document.createElement("pre");
			preCode.classList.add("diff-code");

			const codeElement = document.createElement("code");
			codeElement.classList.add("language-diff");
			codeElement.classList.add("hljs");

			// Logic to render diff lines with gutter and code highlighting
			const diffLines = trimmedDiffContent.split("\n");
			let oldLine = 1;
			let newLine = 1;

			function flushHunk(hunk: HTMLDivElement[]) {
				if (hunk.length === 0) {
					return;
				}
				const hunkContainer = document.createElement("div");
				hunkContainer.classList.add("diff-hunk-container");
				hunk.forEach((lineWrapper: HTMLDivElement) =>
					hunkContainer.appendChild(lineWrapper)
				);
				codeElement.appendChild(hunkContainer);
			}

			let currentHunk: HTMLDivElement[] = [];
			let inHunk = false;

			diffLines.forEach((line, i) => {
				const lineWrapper = document.createElement("div");
				lineWrapper.classList.add("diff-line");

				const gutter = document.createElement("span");
				gutter.classList.add("diff-gutter");

				const lineNumber = document.createElement("span");
				lineNumber.classList.add("diff-linenumber");
				const sign = document.createElement("span");
				sign.classList.add("diff-sign");

				let isChange = false;
				if (line.startsWith("+")) {
					lineNumber.textContent = newLine.toString();
					sign.textContent = "+";
					newLine++;
					gutter.style.color = "#4caf50";
					lineWrapper.classList.add("hljs-addition");
					isChange = true;
				} else if (line.startsWith("-")) {
					lineNumber.textContent = oldLine.toString();
					sign.textContent = "-";
					oldLine++;
					gutter.style.color = "#e53935";
					lineWrapper.classList.add("hljs-deletion");
					isChange = true;
				} else {
					lineNumber.textContent = oldLine.toString();
					sign.textContent = " ";
					oldLine++;
					newLine++;
				}

				gutter.appendChild(lineNumber);
				gutter.appendChild(sign);
				lineWrapper.appendChild(gutter);

				const codeSpan = document.createElement("span");
				codeSpan.textContent = line.replace(/^[+\- ]/, "");
				lineWrapper.appendChild(codeSpan);

				if (isChange) {
					currentHunk.push(lineWrapper);
					inHunk = true;
				} else {
					if (inHunk) {
						flushHunk(currentHunk);
						currentHunk = [];
						inHunk = false;
					}
					codeElement.appendChild(lineWrapper);
				}
				if (i === diffLines.length - 1 && currentHunk.length > 0) {
					flushHunk(currentHunk);
					currentHunk = [];
				}
			});

			preCode.appendChild(codeElement);
			diffContentWrapper.appendChild(preCode); // Append to wrapper
		} else {
			// Handle case with no actual diff content
			const noDiffText = document.createElement("span");
			noDiffText.textContent = "No Code Changes Detected (or no diff provided)";
			noDiffText.style.fontStyle = "italic";
			noDiffText.style.color = "var(--vscode-descriptionForeground)";
			noDiffText.style.padding = "10px 20px";
			diffContentWrapper.appendChild(noDiffText);
			diffContainer.classList.add("no-diff-content");
			// Hide toggle button if no diff content
			toggleButton.style.display = "none";
			diffContainer.classList.remove("collapsed"); // Ensure it's not visually collapsed
		}
		diffContainer.appendChild(diffContentWrapper); // Append wrapper to container
		messageElement.appendChild(diffContainer);
	}

	// Add relevant files section for Model messages
	if (sender === "Model" && relevantFiles && relevantFiles.length > 0) {
		const contextFilesDiv = document.createElement("div");
		contextFilesDiv.classList.add("ai-context-files");
		const shouldBeExpandedInitially =
			isRelevantFilesExpandedForHistory !== undefined
				? isRelevantFilesExpandedForHistory
				: relevantFiles.length <= 3; // Default expansion logic

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
			const currentIsExpanded = contextFilesDiv.classList.contains("expanded");
			const newIsExpanded = !currentIsExpanded;

			contextFilesDiv.classList.toggle("collapsed", !newIsExpanded);
			contextFilesDiv.classList.toggle("expanded", newIsExpanded);

			const parentMessageElement = filesHeader.closest(
				'.message[data-is-history="true"]'
			) as HTMLElement | null;
			if (parentMessageElement && parentMessageElement.dataset.messageIndex) {
				const messageIdx = parseInt(
					parentMessageElement.dataset.messageIndex,
					10
				);
				if (!isNaN(messageIdx)) {
					postMessageToExtension({
						type: "toggleRelevantFilesDisplay",
						messageIndex: messageIdx,
						isExpanded: newIsExpanded,
					});
				} else {
					console.warn(
						"Failed to parse messageIndex from dataset for relevant files toggle."
					);
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
			li.addEventListener("click", () => {
				postMessageToExtension({
					type: "openFile",
					value: filePath,
				});
			});
			fileList.appendChild(li);
		});

		contextFilesDiv.appendChild(fileList);

		// Append context files to the message element,
		// placing it at the end of the main content, before action buttons.
		messageElement.appendChild(contextFilesDiv);
	}

	let copyButton: HTMLButtonElement | null = null;
	let deleteButton: HTMLButtonElement | null = null;
	let editButton: HTMLButtonElement | null = null;
	let copyContextButton: HTMLButtonElement | null = null; // Declare the new button
	// Declare planButton and its container
	let generatePlanButton: HTMLButtonElement | null = null;
	let planButtonContainer: HTMLDivElement | null = null;

	if (isHistoryMessage) {
		if (
			className.includes("user-message") ||
			className.includes("ai-message")
		) {
			copyButton = document.createElement("button");
			copyButton.classList.add("copy-button");
			copyButton.title = "Copy Markdown";
			setIconForButton(copyButton, faCopy);

			deleteButton = document.createElement("button");
			deleteButton.classList.add("delete-button");
			deleteButton.title = "Delete Message";
			setIconForButton(deleteButton, faTrashCan);

			// --- Edit Button Creation ---
			if (className.includes("user-message")) {
				// Only for user messages
				editButton = document.createElement("button");
				editButton.classList.add("edit-button");
				editButton.title = "Edit Message";
				setIconForButton(editButton, faPenToSquare);

				// Create the "Copy Context" button for user messages
				copyContextButton = document.createElement("button");
				copyContextButton.classList.add("copy-context-button");
				copyContextButton.title = "Copy Message Context with Relevant Files";
				setIconForButton(copyContextButton, faFileImport); // Set icon

				copyContextButton.addEventListener("click", () => {
					const messageIndexStr = messageElement.dataset.messageIndex;
					const messageIndex = messageIndexStr
						? parseInt(messageIndexStr, 10)
						: -1;

					if (isNaN(messageIndex) || messageIndex < 0) {
						console.error(
							"[ChatMessageRenderer] Invalid message index for copy context:",
							messageIndexStr
						);
						updateStatus(
							elements,
							"Error: Cannot copy context. Please try again or refresh.",
							true
						);
						return;
					}

					postMessageToExtension({
						type: "copyMessageContext", // New message type
						messageIndex: messageIndex,
					});

					updateStatus(elements, "Copying message context...");
				});
			}

			// "Generate Plan" button creation (for ai-message only)
			if (
				className.includes("ai-message") &&
				!isPlanExplanationForRender &&
				!appState.isPlanExecutionInProgress
			) {
				planButtonContainer = document.createElement("div");
				planButtonContainer.classList.add("plan-button-container");

				generatePlanButton = document.createElement("button");
				generatePlanButton.classList.add(
					"action-button",
					"generate-plan-button"
				);
				setIconForButton(generatePlanButton, faLightbulb);
				generatePlanButton.title = "Generate a /plan prompt from this message";

				// Crucially, embed the AI message's messageIndex
				if (messageIndexForHistory !== undefined) {
					generatePlanButton.dataset.messageIndex =
						messageIndexForHistory.toString();
				}

				planButtonContainer.appendChild(generatePlanButton);
			}

			// LOGIC for initial button disabled state
			if (className.includes("user-message")) {
				if (copyButton) {
					copyButton.disabled = false;
				}
				if (deleteButton) {
					deleteButton.disabled = false;
				}
				if (editButton) {
					editButton.disabled = false;
				}
				if (copyContextButton) {
					// New: enable for copy context button
					copyContextButton.disabled = false;
				}
			} else if (className.includes("ai-message")) {
				const shouldDisableAiStreamingButtons =
					(sender === "Model" &&
						text === "" &&
						!className.includes("error-message")) ||
					isPlanStepUpdateForRender; // ADDED: Also disable if it's a plan step update

				if (copyButton) {
					copyButton.disabled = shouldDisableAiStreamingButtons;
				}
				if (deleteButton) {
					deleteButton.disabled = shouldDisableAiStreamingButtons;
				}
				if (editButton) {
					editButton.disabled = shouldDisableAiStreamingButtons;
				}
				if (generatePlanButton) {
					generatePlanButton.disabled = shouldDisableAiStreamingButtons;
					// Additionally, hide it if it's a plan step update
					if (isPlanStepUpdateForRender) {
						generatePlanButton.style.display = "none";
					}
				}
				// copyContextButton is only for user messages, so no need to handle here
			}

			const messageActions = document.createElement("div");
			messageActions.classList.add("message-actions");
			messageActions.appendChild(copyButton);
			messageActions.appendChild(deleteButton);
			// --- Append Edit Button ---
			if (editButton) {
				messageActions.appendChild(editButton);
			}
			// Append "Copy Context" button
			if (copyContextButton) {
				messageActions.appendChild(copyContextButton);
			}
			// Append "Generate Plan" button container
			if (planButtonContainer) {
				messageActions.appendChild(planButtonContainer);
			}

			messageElement.appendChild(messageActions);

			// Instruction 1 & 2: Update Edit Button Listener
			if (editButton) {
				editButton.addEventListener("click", () => {
					const messageIndexStr = messageElement.dataset.messageIndex;
					const messageIndex = messageIndexStr
						? parseInt(messageIndexStr, 10)
						: -1;

					if (isNaN(messageIndex) || messageIndex < 0) {
						console.error(
							"[ChatMessageRenderer] Invalid message index for editing:",
							messageIndexStr
						);
						updateStatus(
							elements,
							"Error: Cannot edit message. Please try again or refresh.",
							true
						);
						return;
					}

					const currentTextElement = messageElement.querySelector(
						".message-text-content"
					) as HTMLSpanElement;
					const originalText = currentTextElement?.textContent || "";

					// Copy the message text to elements.chatInput.value
					elements.chatInput.value = originalText.trim();

					// Set appState.editingMessageIndex and appState.isEditingMessage
					appState.editingMessageIndex = messageIndex;
					appState.isEditingMessage = true;

					// Make elements.editingIndicator and elements.cancelEditButton visible
					if (elements.editingIndicator) {
						elements.editingIndicator.style.display = "inline-block"; // Or 'block', based on expected layout
					}
					if (elements.cancelEditButton) {
						elements.cancelEditButton.style.display = "inline-flex"; // Or 'block', based on expected layout
					}

					// Focus the elements.chatInput
					elements.chatInput.focus();

					// Call disableAllMessageActionButtons
					disableAllMessageActionButtons(elements);

					elements.sendButton.disabled = false;

					console.log(
						`[ChatMessageRenderer] Editing message at index: ${messageIndex}`
					);
				});
			}

			if (
				sender === "Model" &&
				text === "" &&
				className.includes("ai-message") &&
				!className.includes("error-message")
			) {
				// This is the start of an AI streaming message
				console.log("Appending start of AI stream message (isHistoryMessage).");
				appState.currentAiMessageContentElement = textElement;
				appState.currentAccumulatedText = "";
				appState.typingBuffer = "";
				startTypingAnimation(elements);

				textElement.innerHTML =
					'<span class="loading-text">Generating<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';

				if (copyButton) {
					copyButton.disabled = true;
				}
				if (deleteButton) {
					deleteButton.disabled = true;
				}
				if (editButton) {
					editButton.disabled = true;
				}
				// Disable new button during streaming
				if (generatePlanButton) {
					generatePlanButton.disabled = true;
				}
				// copyContextButton is only for user messages, so no need to handle here
			} else {
				// Complete message or history message (not streaming)
				stopTypingAnimation();
				appState.typingBuffer = "";
				appState.currentAiMessageContentElement = null;
				appState.currentAccumulatedText = "";

				const renderedHtml = md.render(text);
				textElement.innerHTML = renderedHtml;
				// Store the original markdown text for copy functionality
				textElement.dataset.originalMarkdown = text;

				// Add image attached indicator for user messages with image parts
				if (
					className.includes("user-message") &&
					imageParts &&
					imageParts.length > 0
				) {
					const imageIndicatorSpan = document.createElement("span");
					imageIndicatorSpan.classList.add("image-attached-indicator");
					imageIndicatorSpan.textContent = "Image Attached";
					imageIndicatorSpan.style.fontSize = "0.9em";
					imageIndicatorSpan.style.opacity = "0.7";
					imageIndicatorSpan.style.fontStyle = "italic";
					imageIndicatorSpan.style.backgroundColor = "#222";
					imageIndicatorSpan.style.padding = "4px 8px";
					imageIndicatorSpan.style.borderRadius = "5px";
					textElement.appendChild(imageIndicatorSpan);
				}

				// Enable buttons for completed messages IF NOT a plan step update
				if (!isPlanStepUpdateForRender) {
					if (copyButton) {
						copyButton.disabled = false;
					}
					if (deleteButton) {
						deleteButton.disabled = false;
					}
					if (editButton) {
						editButton.disabled = false;
					}
					if (copyContextButton) {
						// New: enable for copy context button
						copyContextButton.disabled = false;
					}
					if (
						generatePlanButton &&
						!isPlanExplanationForRender &&
						!appState.isPlanExecutionInProgress
					) {
						generatePlanButton.disabled = false;
						generatePlanButton.style.display = "";
					} else if (generatePlanButton) {
						generatePlanButton.style.display = "none";
					}
				} else {
					// For plan step update messages, explicitly hide/disable buttons if they were somehow created.
					// The CSS will also handle this, but defensive JS is good.
					if (copyButton) {
						copyButton.style.display = "none";
					}
					if (deleteButton) {
						deleteButton.style.display = "none";
					}
					if (editButton) {
						editButton.style.display = "none";
					}
					if (copyContextButton) {
						// New: hide for copy context button
						copyContextButton.style.display = "none";
					}
					if (generatePlanButton) {
						generatePlanButton.style.display = "none";
					}
				}
			}
		} else {
			// History-backed message but not user/AI (e.g., system messages) - no buttons
			console.log("Appending history-backed non-user/AI message (no buttons).");
			const renderedHtml = md.render(text);
			textElement.innerHTML = renderedHtml;
			stopTypingAnimation();
			appState.typingBuffer = "";
			appState.currentAiMessageContentElement = null;
			appState.currentAccumulatedText = "";
		}
	} else {
		// Non-history message (e.g., direct append by other functions) - no buttons
		console.log("Appending non-history message (no buttons).");
		const renderedHtml = md.render(text);
		textElement.innerHTML = renderedHtml;
		stopTypingAnimation();
		appState.typingBuffer = "";
		appState.currentAiMessageContentElement = null;
		appState.currentAccumulatedText = "";
	}

	elements.chatContainer.appendChild(messageElement);
	elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
	updateEmptyChatPlaceholderVisibility(elements);
}

export function disableAllMessageActionButtons(
	elements: RequiredDomElements
): void {
	const allHistoryMessages = elements.chatContainer.querySelectorAll(
		".message[data-is-history='true']"
	);

	allHistoryMessages.forEach((messageElement) => {
		if (messageElement.classList.contains("plan-step-message")) {
			return; // Skip plan-step messages
		}

		const copyButton = messageElement.querySelector(
			".copy-button"
		) as HTMLButtonElement | null;
		const deleteButton = messageElement.querySelector(
			".delete-button"
		) as HTMLButtonElement | null;
		const editButton = messageElement.querySelector(
			".edit-button"
		) as HTMLButtonElement | null;
		const copyContextButton = messageElement.querySelector(
			".copy-context-button"
		) as HTMLButtonElement | null; // Get the new button
		const generatePlanButton = messageElement.querySelector(
			".generate-plan-button"
		) as HTMLButtonElement | null;
		const messageActions = messageElement.querySelector(
			".message-actions"
		) as HTMLDivElement | null;

		const buttonsToDisable = [
			copyButton,
			deleteButton,
			editButton,
			copyContextButton, // Add the new button here
			generatePlanButton,
		];

		buttonsToDisable.forEach((button) => {
			if (button) {
				button.disabled = true;
				button.style.opacity = "0.5";
				button.style.pointerEvents = "none";
			}
		});

		if (messageActions) {
			messageActions.style.opacity = "0.5";
			messageActions.style.pointerEvents = "none";
		}
	});

	console.log("[ChatMessageRenderer] Disabled all message action buttons.");
}

export function reenableAllMessageActionButtons(
	elements: RequiredDomElements
): void {
	const allHistoryMessages = elements.chatContainer.querySelectorAll(
		".message[data-is-history='true']"
	);

	allHistoryMessages.forEach((messageElement) => {
		if (messageElement.classList.contains("plan-step-message")) {
			// Do not re-enable buttons or change display for plan step update messages
			return;
		}

		// CRITICAL CHECK: Prevent re-enabling buttons on the currently streaming AI message
		const messageTextContentElement = messageElement.querySelector(
			".message-text-content"
		) as HTMLSpanElement | null;
		if (
			appState.currentAiMessageContentElement &&
			messageTextContentElement &&
			appState.currentAiMessageContentElement === messageTextContentElement
		) {
			return;
		}

		const copyButton = messageElement.querySelector(
			".copy-button"
		) as HTMLButtonElement | null;
		const deleteButton = messageElement.querySelector(
			".delete-button"
		) as HTMLButtonElement | null;
		const editButton = messageElement.querySelector(
			".edit-button"
		) as HTMLButtonElement | null;
		const copyContextButton = messageElement.querySelector(
			".copy-context-button"
		) as HTMLButtonElement | null; // Get the new button
		const generatePlanButton = messageElement.querySelector(
			".generate-plan-button"
		) as HTMLButtonElement | null;
		const messageActions = messageElement.querySelector(
			".message-actions"
		) as HTMLDivElement | null; // Get the message actions container

		// Re-enable copy, delete, and edit buttons
		if (copyButton) {
			copyButton.disabled = false;
			copyButton.style.opacity = ""; // Reset opacity
			copyButton.style.pointerEvents = ""; // Reset pointer events
		}
		if (deleteButton) {
			deleteButton.disabled = false;
			deleteButton.style.opacity = "";
			deleteButton.style.pointerEvents = "";
		}
		if (editButton) {
			editButton.disabled = false;
			editButton.style.opacity = "";
			editButton.style.pointerEvents = "";
		}
		if (copyContextButton) {
			// New: re-enable copy context button
			copyContextButton.disabled = false;
			copyContextButton.style.opacity = "";
			copyContextButton.style.pointerEvents = "";
		}

		// Logic for the .generate-plan-button
		if (generatePlanButton) {
			if (
				!appState.isPlanExecutionInProgress &&
				messageElement.classList.contains("ai-message")
			) {
				generatePlanButton.disabled = false;
				generatePlanButton.style.display = ""; // Ensure visible
				generatePlanButton.style.opacity = ""; // Reset opacity
				generatePlanButton.style.pointerEvents = ""; // Reset pointer events
			} else {
				// Hide and disable if plan execution is in progress or not an AI message (though it should only be created for AI messages)
				generatePlanButton.style.display = "none";
				generatePlanButton.disabled = true;
				generatePlanButton.style.opacity = "0";
				generatePlanButton.style.pointerEvents = "none";
			}
		}

		// Reset opacity and pointer events for the message-actions container
		if (messageActions) {
			messageActions.style.opacity = "";
			messageActions.style.pointerEvents = "";
		}
	});

	console.log("[ChatMessageRenderer] Re-enabled all message action buttons.");
}

// Instruction 3: Create clearEditingState function
export function clearEditingState(elements: RequiredDomElements): void {
	elements.chatInput.value = "";
	if (elements.editingIndicator) {
		elements.editingIndicator.style.display = "none";
	}
	if (elements.cancelEditButton) {
		elements.cancelEditButton.style.display = "none";
	}
	appState.editingMessageIndex = -1; // Assuming -1 means no message is being edited
	appState.isEditingMessage = false;
	console.log("[ChatMessageRenderer] Cleared editing state.");
}

// Instruction 4: Refactor sendEditedMessageToExtension
export function sendEditedMessageToExtension(
	messageIndex: number,
	newContent: string
): void {
	postMessageToExtension({
		type: "editChatMessage",
		messageIndex: messageIndex,
		newContent: newContent,
	});
	console.log(
		`[ChatMessageRenderer] Sent editChatMessage for index ${messageIndex}`
	);
}

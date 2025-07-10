import { md } from "../utils/markdownRenderer";
import {
	setIconForButton,
	faExclamationTriangle,
	faCopy,
	faTrashCan,
	faPenToSquare, // Added for edit button
} from "../utils/iconHelpers";
import { postMessageToExtension } from "../utils/vscodeApi";
import { appState } from "../state/appState";
import { stopTypingAnimation, startTypingAnimation } from "./typingAnimation";
import { updateEmptyChatPlaceholderVisibility } from "./statusManager";
import { RequiredDomElements } from "../types/webviewTypes";
import { initializeDomElements } from "../state/domElements"; // Preserving unused import

/**
 * Appends a chat message to the chat container.
 * This function handles message rendering, diff display, relevant file listing,
 * and integrates with typing animation and message action buttons.
 * @param elements An object containing references to all required DOM elements.
 * @param sender The sender of the message (e.g., "You", "Model", "System").
 * @param text The content of the message in Markdown format.
 * @param className Optional CSS classes for the message element.
 * @param isHistoryMessage Whether the message is loaded from history.
 * @param diffContent Optional string for code diff to display.
 * @param relevantFiles Optional array of strings for relevant files.
 * @param messageIndexForHistory Optional index for messages loaded from history, used for editing/deleting.
 * @param isRelevantFilesExpandedForHistory Optional boolean indicating if relevant files section was expanded in history.
 */
export function appendMessage(
	elements: RequiredDomElements,
	sender: string,
	text: string,
	className: string = "",
	isHistoryMessage: boolean = false,
	diffContent?: string,
	relevantFiles?: string[],
	messageIndexForHistory?: number,
	isRelevantFilesExpandedForHistory?: boolean
): void {
	// elements.chatContainer is guaranteed to be present by the RequiredDomElements type,
	// so no null check is needed for chatContainer itself.

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

		const diffHeaderElement = document.createElement("div");
		diffHeaderElement.classList.add("diff-header");
		diffContainer.prepend(diffHeaderElement);

		const trimmedDiffContent = diffContent.trim();

		if (trimmedDiffContent !== "") {
			diffHeaderElement.textContent = "Code Diff:";
			const preCode = document.createElement("pre");
			preCode.classList.add("diff-code");

			const codeElement = document.createElement("code");
			codeElement.classList.add("language-diff");
			codeElement.classList.add("hljs");

			// Split diff into lines and render each with gutter
			const diffLines = trimmedDiffContent.split("\n");
			let oldLine = 1;
			let newLine = 1;

			function flushHunk(hunk: HTMLDivElement[]) {
				if (hunk.length === 0) {
					return;
				}
				// Wrap hunk lines in a container
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
				codeSpan.textContent = line.replace(/^[-+ ]/, "");
				lineWrapper.appendChild(codeSpan);

				// Group consecutive change lines into hunks
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
				// If last line, flush any remaining hunk
				if (i === diffLines.length - 1 && currentHunk.length > 0) {
					flushHunk(currentHunk);
					currentHunk = [];
				}
			});

			preCode.appendChild(codeElement);
			diffContainer.appendChild(preCode);
		} else {
			diffHeaderElement.textContent =
				"No Code Changes Detected (or no diff provided)";
			diffContainer.classList.add("no-diff-content");
		}
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

		// Insert context files after the sender's strong tag
		const senderStrongTag = messageElement.querySelector("strong");
		if (senderStrongTag) {
			senderStrongTag.insertAdjacentElement("afterend", contextFilesDiv);
		} else {
			messageElement.appendChild(contextFilesDiv); // Fallback
		}
	}

	let copyButton: HTMLButtonElement | null = null;
	let deleteButton: HTMLButtonElement | null = null;
	let editButton: HTMLButtonElement | null = null; // Declare editButton

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

			// --- Edit Button Creation (Instruction 2) ---
			if (className.includes("user-message")) {
				// Only for user messages
				editButton = document.createElement("button");
				editButton.classList.add("edit-button");
				editButton.title = "Edit Message";
				setIconForButton(editButton, faPenToSquare); // Set the edit icon
			}

			// NEW LOGIC for initial button disabled state based on appState.isLoading
			const disableButtonsInitially = appState.isLoading;

			if (copyButton) {
				copyButton.disabled = disableButtonsInitially;
			}
			if (deleteButton) {
				deleteButton.disabled = disableButtonsInitially;
			}
			if (editButton) {
				editButton.disabled = disableButtonsInitially;
			}

			const messageActions = document.createElement("div");
			messageActions.classList.add("message-actions");
			messageActions.appendChild(copyButton);
			messageActions.appendChild(deleteButton);
			// --- Append Edit Button (Instruction 3) ---
			if (editButton) {
				messageActions.appendChild(editButton);
			}

			messageElement.appendChild(messageActions);

			// --- Edit Mode Activation (Instruction 4) and Key Event Handling (Instruction 5) ---
			if (editButton) {
				editButton.addEventListener("click", () => {
					// Get the messageIndexForHistory
					if (messageIndexForHistory === undefined) {
						console.error(
							"[ChatMessageRenderer] Message index not found for editing."
						);
						return;
					}

					// Get the currentTextElement and store its textContent as originalText
					const currentTextElement = messageElement.querySelector(
						".message-text-content"
					) as HTMLSpanElement;
					const originalText = currentTextElement?.textContent || "";

					// Create a new textarea element
					const textarea = document.createElement("textarea");
					textarea.classList.add("message-text-content", "editing-textarea");
					textarea.value = originalText.trim(); // Set textarea.value to originalText.trim()
					textarea.rows = Math.max(3, originalText.split("\n").length); // Set textarea.rows

					// Replace currentTextElement with textarea
					currentTextElement?.replaceWith(textarea);

					// Hide messageActions during editing
					if (messageActions) {
						messageActions.style.opacity = "0";
						messageActions.style.pointerEvents = "none";
					}

					// Focus the textarea
					textarea.focus();

					// Inner event handlers to manage scope and allow removal
					const handleKeydown = (e: KeyboardEvent) => {
						if (e.key === "Enter" && !e.shiftKey) {
							// On Enter (without Shift)
							e.preventDefault();
							const newContent = textarea.value.trim();
							if (newContent !== originalText.trim()) {
								// If newContent !== originalText.trim()
								// 1. Visually update the message: Create new span, replace textarea with span
								const newTextSpan = document.createElement("span");
								newTextSpan.classList.add("message-text-content");
								newTextSpan.innerHTML = md.render(newContent);
								textarea.replaceWith(newTextSpan);

								// 2. Add the temporary CSS class `user-message-edited-pending-ai` to the parent `messageElement`
								messageElement.classList.add("user-message-edited-pending-ai");

								// 6. Ensure messageActions for the edited message are visible and interactive.
								if (messageActions) {
									messageActions.style.opacity = "1";
									messageActions.style.pointerEvents = "auto";
								}

								// 3. Get a reference to `messageElement` and traverse its `nextElementSibling` siblings,
								//    calling `remove()` on them from `elements.chatContainer` to clear previous AI responses and subsequent user messages.
								let nextSibling = messageElement.nextElementSibling;
								while (nextSibling) {
									const toRemove = nextSibling;
									nextSibling = toRemove.nextElementSibling; // Get next before removing
									toRemove.remove();
								}
								elements.chatContainer.scrollTop =
									elements.chatContainer.scrollHeight; // Scroll to bottom after clearing

								// 4. Call `appendMessage(elements, "Model", "", "ai-message loading-message", false);`
								appendMessage(
									elements,
									"Model",
									"",
									"ai-message loading-message",
									false
								);

								// 5. Call `startTypingAnimation(elements);`
								startTypingAnimation(elements);

								// 7. After these UI updates, call the now-modified `sendEditedMessageToExtension`.
								sendEditedMessageToExtension(
									elements,
									messageIndexForHistory,
									newContent
								);
							} else {
								// If content hasn't changed, just revert
								revertEdit(textarea, originalText, messageActions);
							}
							// Remove event listeners after handling Enter/revert
							textarea.removeEventListener("keydown", handleKeydown);
							textarea.removeEventListener("blur", handleBlur);
						} else if (e.key === "Escape") {
							// On Escape
							e.preventDefault();
							revertEdit(textarea, originalText, messageActions); // Call revertEdit()
							// Remove event listeners
							textarea.removeEventListener("keydown", handleKeydown);
							textarea.removeEventListener("blur", handleBlur);
						}
					};

					const handleBlur = () => {
						// On blur
						const newContent = textarea.value.trim();
						if (newContent !== originalText.trim()) {
							// Apply the same UI updates as in handleKeydown 'Enter' block if content changes
							const newTextSpan = document.createElement("span");
							newTextSpan.classList.add("message-text-content");
							newTextSpan.innerHTML = md.render(newContent);
							textarea.replaceWith(newTextSpan);

							messageElement.classList.add("user-message-edited-pending-ai");

							if (messageActions) {
								messageActions.style.opacity = "1";
								messageActions.style.pointerEvents = "auto";
							}

							let nextSibling = messageElement.nextElementSibling;
							while (nextSibling) {
								const toRemove = nextSibling;
								nextSibling = toRemove.nextElementSibling;
								toRemove.remove();
							}
							elements.chatContainer.scrollTop =
								elements.chatContainer.scrollHeight;

							appendMessage(
								elements,
								"Model",
								"",
								"ai-message loading-message",
								false
							);
							startTypingAnimation(elements);

							sendEditedMessageToExtension(
								elements,
								messageIndexForHistory,
								newContent
							);
						} else {
							revertEdit(textarea, originalText, messageActions); // Call revertEdit()
						}
						// Remove event listeners
						textarea.removeEventListener("keydown", handleKeydown);
						textarea.removeEventListener("blur", handleBlur);
					};

					textarea.addEventListener("keydown", handleKeydown);
					textarea.addEventListener("blur", handleBlur);
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
				startTypingAnimation(elements); // Pass elements

				textElement.innerHTML =
					'<span class="loading-text">Generating<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';

				if (copyButton) {
					copyButton.disabled = true;
				}
				if (deleteButton) {
					deleteButton.disabled = true;
				}
				if (editButton) {
					// Also disable edit button for streaming messages
					editButton.disabled = true;
				}
			} else {
				// Complete message or history message (not streaming)
				stopTypingAnimation();
				appState.typingBuffer = "";
				appState.currentAiMessageContentElement = null;
				appState.currentAccumulatedText = "";

				const renderedHtml = md.render(text);
				textElement.innerHTML = renderedHtml;
				// Ensure buttons are enabled for completed messages
				if (copyButton) {
					copyButton.disabled = false;
				}
				if (deleteButton) {
					deleteButton.disabled = false;
				}
				if (editButton) {
					editButton.disabled = false;
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

/**
 * Re-enables all message action buttons (copy, delete, edit) for all history messages.
 * This is called when the loading state changes to false to ensure buttons are interactive.
 * @param elements An object containing references to all required DOM elements.
 */
export function reenableAllMessageActionButtons(
	elements: RequiredDomElements
): void {
	const allHistoryMessages = elements.chatContainer.querySelectorAll(
		".message[data-is-history='true']"
	);

	allHistoryMessages.forEach((messageElement) => {
		const copyButton = messageElement.querySelector(
			".copy-button"
		) as HTMLButtonElement | null;
		const deleteButton = messageElement.querySelector(
			".delete-button"
		) as HTMLButtonElement | null;
		const editButton = messageElement.querySelector(
			".edit-button"
		) as HTMLButtonElement | null;

		if (copyButton) {
			copyButton.disabled = false;
		}
		if (deleteButton) {
			deleteButton.disabled = false;
		}
		if (editButton) {
			editButton.disabled = false;
		}
	});

	console.log("[ChatMessageRenderer] Re-enabled all message action buttons.");
}

// Helper functions (Instruction 6)

function sendEditedMessageToExtension(
	elements: RequiredDomElements,
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
	// All DOM manipulation removed as per instruction.
}

// Helper function to revert an edit or update a message element in UI (if not doing full append for render)
function revertEdit(
	textarea: HTMLTextAreaElement,
	originalText: string,
	messageActions: HTMLDivElement | null
) {
	const originalTextSpan = document.createElement("span");
	originalTextSpan.classList.add("message-text-content");
	originalTextSpan.innerHTML = md.render(originalText);
	textarea.replaceWith(originalTextSpan);

	if (messageActions) {
		messageActions.style.opacity = "1";
		messageActions.style.pointerEvents = "auto";
	}
}

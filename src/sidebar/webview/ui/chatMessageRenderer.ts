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
import { initializeDomElements } from "../state/domElements";

// Global reference to setLoadingState function
let globalSetLoadingState:
	| ((loading: boolean, elements: RequiredDomElements) => void)
	| null = null;

// Function to set the global setLoadingState reference
export function setGlobalSetLoadingState(
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	globalSetLoadingState = setLoadingState;
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
	isPlanStepUpdateForRender: boolean = false // New parameter
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
				codeSpan.textContent = line.replace(/^[+\- ]/, "");
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
	let editButton: HTMLButtonElement | null = null;
	// NEW: Declare planButton and its container
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

			// --- Edit Button Creation (Instruction 2) ---
			if (className.includes("user-message")) {
				// Only for user messages
				editButton = document.createElement("button");
				editButton.classList.add("edit-button");
				editButton.title = "Edit Message";
				setIconForButton(editButton, faPenToSquare);
			}

			// NEW: "Generate Plan" button creation (for ai-message only)
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

			// NEW LOGIC for initial button disabled state
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
			}

			const messageActions = document.createElement("div");
			messageActions.classList.add("message-actions");
			messageActions.appendChild(copyButton);
			messageActions.appendChild(deleteButton);
			// --- Append Edit Button (Instruction 3) ---
			if (editButton) {
				messageActions.appendChild(editButton);
			}
			// NEW: Append "Generate Plan" button container
			if (planButtonContainer) {
				messageActions.appendChild(planButtonContainer);
			}

			messageElement.appendChild(messageActions);

			// --- Edit Mode Activation (Instruction 4) and Key Event Handling (Instruction 5) ---
			if (editButton) {
				editButton.addEventListener("click", () => {
					// Retrieve the message index directly from the DOM element's dataset
					const messageIndexStr = messageElement.dataset.messageIndex;
					const messageIndex = messageIndexStr
						? parseInt(messageIndexStr, 10)
						: -1; // Parse to number

					// Add robust validation for the retrieved index
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
						return; // Prevent further execution if index is invalid
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
								if (textarea.parentNode) {
									textarea.replaceWith(newTextSpan);
								} else {
									console.warn(
										"[ChatMessageRenderer] Textarea not found in DOM during Enter key finalization. Aborting replaceWith."
									);
								}

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
									messageIndex,
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
							if (textarea.parentNode) {
								textarea.replaceWith(newTextSpan);
							} else {
								console.warn(
									"[ChatMessageRenderer] Textarea not found in DOM during Blur event finalization. Aborting replaceWith."
								);
							}

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

							sendEditedMessageToExtension(elements, messageIndex, newContent);
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

function sendEditedMessageToExtension(
	elements: RequiredDomElements,
	messageIndex: number,
	newContent: string
): void {
	// Set loading state to true to disable buttons, similar to sendMessage function
	if (globalSetLoadingState) {
		globalSetLoadingState(true, elements);
	}

	postMessageToExtension({
		type: "editChatMessage",
		messageIndex: messageIndex,
		newContent: newContent,
	});
	console.log(
		`[ChatMessageRenderer] Sent editChatMessage for index ${messageIndex}`
	);
}

function revertEdit(
	textarea: HTMLTextAreaElement,
	originalText: string,
	messageActions: HTMLDivElement | null
) {
	const originalTextSpan = document.createElement("span");
	originalTextSpan.classList.add("message-text-content");
	originalTextSpan.innerHTML = md.render(originalText);
	if (textarea.parentNode) {
		textarea.replaceWith(originalTextSpan);
	} else {
		console.warn(
			"[ChatMessageRenderer] Textarea not found in DOM during revert operation. Aborting replaceWith."
		);
	}

	if (messageActions) {
		messageActions.style.opacity = "1";
		messageActions.style.pointerEvents = "auto";
	}
}

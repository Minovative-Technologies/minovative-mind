import { md } from "../utils/markdownRenderer";
import {
	setIconForButton,
	faExclamationTriangle,
	faCopy,
	faTrashCan,
} from "../utils/iconHelpers";
import { postMessageToExtension } from "../utils/vscodeApi";
import { appState } from "../state/appState";
import { stopTypingAnimation, startTypingAnimation } from "./typingAnimation";
import { updateEmptyChatPlaceholderVisibility } from "./statusManager";
import { RequiredDomElements } from "../types/webviewTypes";

/**
 * Appends a chat message to the chat container.
 * This function handles message rendering, diff display, relevant file listing,
 * and integrates with typing animation and message action buttons.
 * @param elements An object containing references to all required DOM elements.
 * @param sender The sender of the message (e.g., "You", "Model", "System").
 * @param text The content of the message in Markdown format.
 * @param className Additional CSS classes to apply to the message element.
 * @param isHistoryMessage True if this message is being restored from history.
 * @param diffContent Optional string content for a code diff block.
 * @param relevantFiles Optional array of file paths related to the AI response.
 * @param messageIndexForHistory Optional index of the message in history for data-attributes.
 * @param isRelevantFilesExpandedForHistory Optional boolean indicating if relevant files should be expanded for history messages.
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
			diffLines.forEach((line) => {
				const lineWrapper = document.createElement("div");
				lineWrapper.classList.add("diff-line");

				const gutter = document.createElement("span");
				gutter.classList.add("diff-gutter");

				const lineNumber = document.createElement("span");
				lineNumber.classList.add("diff-linenumber");
				const sign = document.createElement("span");
				sign.classList.add("diff-sign");

				if (line.startsWith("+")) {
					lineNumber.textContent = newLine.toString();
					sign.textContent = "+";
					newLine++;
					gutter.style.color = "#4caf50";
					lineWrapper.classList.add("hljs-addition");
				} else if (line.startsWith("-")) {
					lineNumber.textContent = oldLine.toString();
					sign.textContent = "-";
					oldLine++;
					gutter.style.color = "#e53935";
					lineWrapper.classList.add("hljs-deletion");
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

				codeElement.appendChild(lineWrapper);
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
			} else {
				// Complete message or history message (not streaming)
				stopTypingAnimation();
				appState.typingBuffer = "";
				appState.currentAiMessageContentElement = null;
				appState.currentAccumulatedText = "";

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

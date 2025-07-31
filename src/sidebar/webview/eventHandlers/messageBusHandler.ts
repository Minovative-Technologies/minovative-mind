import { appendMessage } from "../ui/chatMessageRenderer";
import {
	updateApiKeyStatus,
	updateStatus,
	updateEmptyChatPlaceholderVisibility,
} from "../ui/statusManager";
import { appState } from "../state/appState";
import {
	AiStreamingState,
	PersistedPlanData,
	PlanExecutionFinishedMessage,
	// New imports for code streaming
	CodeFileStreamStartMessage,
	CodeFileStreamChunkMessage,
	CodeFileStreamEndMessage,
	ChatMessage, // Import ChatMessage for type casting
} from "../../common/sidebarTypes";
import {
	stopTypingAnimation,
	startTypingAnimation,
} from "../ui/typingAnimation";
import {
	createPlanConfirmationUI,
	showPlanConfirmationUI,
	showPlanParseErrorUI,
	showCommitReviewUI,
	hideAllConfirmationAndReviewUIs,
	showClearChatConfirmationUI, // Added import for showClearChatConfirmationUI
} from "../ui/confirmationAndReviewUIs";
import { md } from "../utils/markdownRenderer";
import { postMessageToExtension } from "../utils/vscodeApi";
import { RequiredDomElements } from "../types/webviewTypes";
import { resetUIStateAfterCancellation } from "../ui/statusManager";
import { showSuggestions, hideSuggestions } from "../ui/commandSuggestions"; // Existing import, ensures show/hideSuggestions are available

// Add global variables for code streaming
const activeCodeStreams = new Map<
	string,
	{ container: HTMLDivElement; codeElement: HTMLElement }
>();
let codeStreamingArea: HTMLElement | null = null;

// Helper function for code streaming state reset
const resetCodeStreams = () => {
	activeCodeStreams.clear();
	if (codeStreamingArea) {
		codeStreamingArea.innerHTML = "";
		codeStreamingArea.style.display = "none";
	}
};

export function initializeMessageBusHandler(
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	// Initialize codeStreamingArea at the beginning
	codeStreamingArea = document.getElementById("code-streaming-area");

	// Helper for AI chat streaming state reset
	const resetStreamingAnimationState = () => {
		stopTypingAnimation();
		appState.currentAiMessageContentElement = null;
		appState.currentAccumulatedText = "";
		appState.typingBuffer = "";
	};

	window.addEventListener("message", (event: MessageEvent) => {
		const message = event.data;
		console.log(
			"[Webview] Message received from extension:",
			message.type,
			message
		);

		switch (message.type) {
			case "aiResponse": {
				appendMessage(
					elements,
					"Model",
					message.value,
					`ai-message ${message.isError ? "error-message" : ""}`.trim(),
					true,
					undefined,
					message.relevantFiles,
					undefined, // messageIndexForHistory
					undefined, // isRelevantFilesExpandedForHistory
					false // isPlanExplanationForRender
				);

				// REMOVED: This block was prematurely showing the plan confirmation UI.
				// The plan confirmation UI should only be shown after aiResponseEnd for streaming plans.
				if (message.isLoading === false) {
					setLoadingState(false, elements);
				}
				break;
			}

			case "codeFileStreamStart": {
				const { streamId, filePath, languageId } =
					message.value as CodeFileStreamStartMessage["value"];
				console.log(
					`[Webview] Code stream start: ${filePath} (Stream ID: ${streamId})`
				);

				if (!codeStreamingArea) {
					console.error("[Webview] Code streaming area not found.");
					return;
				}

				// Create container for this file's stream
				const container = document.createElement("div");
				container.classList.add("code-file-stream-container");
				container.dataset.streamId = streamId;

				// Pre and Code elements for content
				const pre = document.createElement("pre");
				const codeElement = document.createElement("code");
				codeElement.classList.add(`language-${languageId}`);
				codeElement.classList.add("hljs"); // For highlight.js
				pre.appendChild(codeElement);
				container.appendChild(pre);

				// NEW: Footer for file path and loading dots
				const footer = document.createElement("div");
				footer.classList.add("code-file-stream-footer");
				footer.innerHTML = `
                    <span class="file-path">${filePath}</span>
                    <span class="status-indicator">
                        <span class="loading-dots">Generating<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>
                    </span>
                `;
				container.appendChild(footer);

				codeStreamingArea.appendChild(container);
				activeCodeStreams.set(streamId, { container, codeElement });

				codeStreamingArea.style.display = "flex"; // Show the overall streaming area
				codeStreamingArea.scrollTop = codeStreamingArea.scrollHeight; // Scroll to bottom
				break;
			}

			case "codeFileStreamChunk": {
				const { streamId, chunk } =
					message.value as CodeFileStreamChunkMessage["value"];
				// console.log(`[Webview] Code stream chunk for ${streamId}: ${chunk.length} chars`);

				const streamInfo = activeCodeStreams.get(streamId);
				if (streamInfo) {
					streamInfo.codeElement.textContent += chunk;
					// Re-highlight the element with each chunk
					// hljs might be global or needs to be imported. Assuming global for now.
					if ((window as any).hljs) {
						(window as any).hljs.highlightElement(streamInfo.codeElement);
					}
					if (codeStreamingArea) {
						codeStreamingArea.scrollTop = codeStreamingArea.scrollHeight; // Scroll to bottom
					}
				} else {
					console.warn(
						`[Webview] Received chunk for unknown stream ID: ${streamId}`
					);
				}
				break;
			}

			case "codeFileStreamEnd": {
				const { streamId, success, error } =
					message.value as CodeFileStreamEndMessage["value"];
				console.log(
					`[Webview] Code stream end for ${streamId}. Success: ${success}, Error: ${error}`
				);

				const streamInfo = activeCodeStreams.get(streamId);
				if (streamInfo) {
					const footer = streamInfo.container.querySelector(
						".code-file-stream-footer"
					);
					const statusIndicator = footer?.querySelector(
						".status-indicator"
					) as HTMLElement | null;
					const loadingDots = footer?.querySelector(
						".loading-dots"
					) as HTMLElement | null;

					// Remove loading dots
					if (loadingDots) {
						loadingDots.remove();
					}

					// Add success/error icon
					if (statusIndicator) {
						const icon = document.createElement("span");
						icon.classList.add("status-icon");
						if (success) {
							icon.textContent = "✔"; // Green check
							icon.style.color = "var(--vscode-editorGutter-addedBackground)";
							icon.title = "Generation complete";
						} else {
							icon.textContent = "❌"; // Red cross
							icon.style.color = "var(--vscode-errorForeground)";
							icon.title = `Generation failed: ${error || "Unknown error"}`;
							if (error) {
								const errorDetails = document.createElement("span");
								errorDetails.classList.add("error-details");
								errorDetails.textContent = ` ${error}`;
								statusIndicator.appendChild(errorDetails);
							}
						}
						statusIndicator.prepend(icon);
					}

					// Ensure final highlighting is applied
					if ((window as any).hljs) {
						(window as any).hljs.highlightElement(streamInfo.codeElement);
					}

					activeCodeStreams.delete(streamId);

					if (codeStreamingArea) {
						codeStreamingArea.scrollTop = codeStreamingArea.scrollHeight; // Scroll to bottom
					}
				} else {
					console.warn(
						`[Webview] Received end message for unknown stream ID: ${streamId}`
					);
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

				resetStreamingAnimationState();

				// Append the base AI message element. This sets up the DOM structure
				// and assigns `appState.currentAiMessageContentElement` to the correct span.
				// We pass an empty string for initial text, as content will be injected/animated.
				appendMessage(
					elements,
					"Model",
					"", // Initial empty text, content will be populated next
					`ai-message ${isError ? "error-message" : ""}`.trim(),
					true, // Treat as a history-backed message for consistent styling and buttons
					undefined, // No diffContent for streaming progress
					relevantFiles,
					undefined, // messageIndexForHistory
					undefined, // isRelevantFilesExpandedForHistory
					false // isPlanExplanationForRender
				);

				// Get a reference to the message element that was just created.
				const restoredMessageElement = elements.chatContainer
					?.lastElementChild as HTMLDivElement | null;
				if (restoredMessageElement) {
					// Find the specific content span within the newly created message element.
					appState.currentAiMessageContentElement =
						restoredMessageElement.querySelector(
							".message-text-content"
						) as HTMLSpanElement | null;

					// Get references to copy/delete buttons
					const copyButton = restoredMessageElement.querySelector(
						".copy-button"
					) as HTMLButtonElement | null;
					const deleteButton = restoredMessageElement.querySelector(
						".delete-button"
					) as HTMLButtonElement | null;
					const editButton = restoredMessageElement.querySelector(
						".edit-button"
					) as HTMLButtonElement | null;

					if (appState.currentAiMessageContentElement) {
						// Populate the accumulated text from the restored state
						appState.currentAccumulatedText = content;

						// Render content and manage loading state based on `isComplete`
						if (isComplete) {
							// If the stream is complete, just render the final content.
							appState.currentAiMessageContentElement.innerHTML = md.render(
								appState.currentAccumulatedText
							);
							// Store the original markdown text for copy functionality
							appState.currentAiMessageContentElement.dataset.originalMarkdown =
								appState.currentAccumulatedText;
							if (copyButton) {
								copyButton.disabled = false;
							}
							if (deleteButton) {
								deleteButton.disabled = false;
							}
							if (editButton) {
								editButton.disabled = false;
							}
							stopTypingAnimation(); // Ensure animation is stopped
						} else {
							// If the stream is NOT complete, render accumulated content PLUS the loading dots.
							appState.currentAiMessageContentElement.innerHTML =
								md.render(appState.currentAccumulatedText) +
								'<span class="loading-text">Generating<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';
							startTypingAnimation(elements); // Re-activate the typing animation for the dots
							if (copyButton) {
								copyButton.disabled = true;
							} // Disable buttons while generating
							if (deleteButton) {
								deleteButton.disabled = true;
							}
							if (editButton) {
								editButton.disabled = true;
							}
						}

						// Ensure the chat container scrolls to the bottom to show the restored message
						if (elements.chatContainer) {
							elements.chatContainer.scrollTop =
								elements.chatContainer.scrollHeight;
						}
					} else {
						console.warn(
							"[Webview] Failed to find .message-text-content in restored AI message. Fallback to direct append."
						);
						// Fallback if the content element isn't found after appendMessage.
						// Append the full content, assuming it's an error or complete state.
						appendMessage(
							elements,
							"Model",
							content,
							`ai-message ${isError ? "error-message" : ""}`.trim(),
							true,
							undefined,
							relevantFiles,
							undefined, // messageIndexForHistory
							undefined, // isRelevantFilesExpandedForHistory
							false // isPlanExplanationForRender
						);
					}
				} else {
					console.warn(
						"[Webview] Failed to find or create AI message element for restoreStreamingProgress. Fallback to direct append."
					);
					// Fallback if the message element itself couldn't be created.
					appendMessage(
						elements,
						"Model",
						content,
						`ai-message ${isError ? "error-message" : ""}`.trim(),
						true,
						undefined,
						relevantFiles,
						undefined, // messageIndexForHistory
						undefined, // isRelevantFilesExpandedForHistory
						false // isPlanExplanationForRender
					);
				}

				// Update the overall loading state of the UI (disables/enables inputs, shows/hides cancel button)
				setLoadingState(!isComplete, elements);
				break;
			}

			case "showGenericLoadingMessage": {
				console.log(
					"[Webview] Received showGenericLoadingMessage. Displaying generic loading."
				);
				// Remove any existing loading message to ensure a clean state
				const existingLoadingMsg =
					elements.chatContainer.querySelector(".loading-message");
				if (existingLoadingMsg) {
					existingLoadingMsg.remove();
				}

				// Append a new AI message element. By passing an empty string for text,
				// appendMessage will automatically trigger the typing animation to show "Generating..." dots.
				appendMessage(
					elements,
					"Model",
					"", // Empty string to signify starting stream/generation
					"ai-message",
					true, // Treat as a history-backed message for consistent styling and buttons (even if not yet in history)
					undefined, // diffContent
					undefined, // relevantFiles
					undefined, // messageIndexForHistory
					undefined, // isRelevantFilesExpandedForHistory
					false // isPlanExplanationForRender
				);
				// Ensure UI controls are disabled while loading
				setLoadingState(true, elements);
				break;
			}

			case "aiResponseStart": {
				setLoadingState(true, elements);
				resetStreamingAnimationState();
				console.log(
					"Received aiResponseStart. Starting stream via appendMessage."
				);
				appState.isCancellationInProgress = false; // Add this line
				appendMessage(
					elements,
					"Model",
					"",
					"ai-message",
					true,
					undefined,
					message.value.relevantFiles,
					undefined, // messageIndexForHistory
					undefined, // isRelevantFilesExpandedForHistory
					false // isPlanExplanationForRender
				);
				break;
			}
			case "aiResponseChunk": {
				if (message.value !== undefined) {
					appState.typingBuffer += message.value;
					if (appState.typingTimer === null) {
						startTypingAnimation(elements);
					}
				}
				break;
			}
			case "aiResponseEnd": {
				// 1. Ensure that resetStreamingAnimationState(); and appState.isCancellationInProgress = false; are called at the top.
				resetStreamingAnimationState();
				appState.isCancellationInProgress = false;

				console.log("Received aiResponseEnd. Stream finished.");

				const isCancellation =
					typeof message.error === "string" &&
					message.error.includes("cancelled");

				if (appState.currentAiMessageContentElement) {
					appState.currentAccumulatedText += appState.typingBuffer;
					let finalContentHtml: string;

					if (!message.success && isCancellation) {
						finalContentHtml = "";
						appState.currentAiMessageContentElement.dataset.originalMarkdown =
							"";
						appState.currentAccumulatedText = "";
					} else if (!message.success && message.error) {
						const errorMessageContent =
							typeof message.error === "string"
								? message.error
								: "Unknown error occurred during AI response streaming.";
						const errorText = `Error: ${errorMessageContent}`;
						finalContentHtml = md.render(errorText);
						appState.currentAiMessageContentElement.dataset.originalMarkdown =
							errorText;
					} else {
						finalContentHtml = md.render(appState.currentAccumulatedText);
						appState.currentAiMessageContentElement.dataset.originalMarkdown =
							appState.currentAccumulatedText;
					}
					// Ensure rendering happens BEFORE plan confirmation logic
					appState.currentAiMessageContentElement.innerHTML = finalContentHtml;

					const messageElement =
						appState.currentAiMessageContentElement.parentElement;
					if (messageElement) {
						// Re-enable copy, delete, and edit buttons on the message
						messageElement
							.querySelector(".copy-button")
							?.removeAttribute("disabled");
						messageElement
							.querySelector(".delete-button")
							?.removeAttribute("disabled");
						messageElement
							.querySelector(".edit-button")
							?.removeAttribute("disabled");

						// CRITICAL CHANGE: Handle generate-plan-button visibility
						const generatePlanButton = messageElement.querySelector(
							".generate-plan-button"
						) as HTMLButtonElement | null;

						if (message.success && message.isPlanResponse && message.planData) {
							if (generatePlanButton) {
								generatePlanButton.style.display = "none";
							}
						} else {
							// Otherwise, ensure it's visible (for regular AI responses)
							if (generatePlanButton) {
								generatePlanButton.style.display = ""; // Reset to default display
							}
						}
					}
				} else {
					console.warn(
						"aiResponseEnd received but currentAiMessageContentElement is null. Fallback to appending new message."
					);
					// Fallback: If for some reason the element wasn't tracked, append a new message.
					// This should generally only happen if a previous streaming message was somehow malformed or lost.
					if (!message.success && isCancellation) {
					} else if (!message.success && message.error) {
						const errorMessageContent =
							typeof message.error === "string"
								? message.error
								: "Unknown error occurred during AI operation.";
						appendMessage(
							elements,
							"Model",
							md.render(`Error: ${errorMessageContent}`),
							"ai-message error-message",
							true,
							undefined, // diffContent
							undefined, // relevantFiles
							undefined, // messageIndexForHistory
							undefined, // isRelevantFilesExpandedForHistory
							false // isPlanExplanationForRender (fallback, so it's not a plan)
						);
					} else {
						// If successful but currentAiMessageContentElement was null, append the accumulated text.
						appendMessage(
							elements,
							"Model",
							md.render(appState.currentAccumulatedText),
							"ai-message",
							true,
							undefined, // diffContent
							undefined, // relevantFiles
							undefined, // messageIndexForHistory
							undefined, // isRelevantFilesExpandedForHistory
							false // isPlanExplanationForRender (fallback, so it's not a plan)
						);
					}
				}

				// Add logic to select all elements with the class '.user-message-edited-pending-ai'
				// from 'elements.chatContainer' and remove this class from each of them.
				const editedMessages = elements.chatContainer.querySelectorAll(
					".user-message-edited-pending-ai"
				);
				editedMessages.forEach((msg) => {
					msg.classList.remove("user-message-edited-pending-ai");
				});

				// Common cleanup for isCommitActionInProgress regardless of outcome
				appState.isCommitActionInProgress = false;

				// Handle status bar updates for errors/cancellations
				if (!message.success) {
					const statusMessage = isCancellation
						? "AI operation cancelled."
						: typeof message.error === "string"
						? `AI Operation Failed: ${message.error}`
						: "AI operation failed or was cancelled.";
					updateStatus(elements, statusMessage, true);
				} else if (message.statusMessageOverride) {
					// Handle custom success messages like "No changes staged"
					updateStatus(elements, message.statusMessageOverride, false);
				}

				// This block is the SOLE place where showPlanConfirmationUI is called for newly generated plans.
				// It must contain calls to createPlanConfirmationUI, set appState.pendingPlanData, call showPlanConfirmationUI,
				// and hide the cancel button.
				if (message.success && message.isPlanResponse && message.planData) {
					console.log("aiResponseEnd indicates confirmable plan.");
					createPlanConfirmationUI(
						elements,
						postMessageToExtension,
						updateStatus,
						setLoadingState
					);
					appState.pendingPlanData = message.planData as {
						type: string;
						originalRequest?: string;
						originalInstruction?: string;
						relevantFiles?: string[];
					};
					showPlanConfirmationUI(
						elements,
						appState.pendingPlanData,
						postMessageToExtension,
						updateStatus,
						setLoadingState
					);
					if (elements.cancelGenerationButton) {
						elements.cancelGenerationButton.style.display = "none";
					}

					// Automatically open the sidebar when a plan is completed
					postMessageToExtension({
						type: "openSidebar",
					});
				}
				// 2. Add a new else if for commit review.
				else if (
					message.success &&
					message.isCommitReviewPending &&
					message.commitReviewData
				) {
					appState.pendingCommitReviewData = message.commitReviewData;
					showCommitReviewUI(
						elements,
						message.commitReviewData.commitMessage,
						message.commitReviewData.stagedFiles,
						postMessageToExtension,
						updateStatus,
						setLoadingState
					);
					if (elements.cancelGenerationButton) {
						elements.cancelGenerationButton.style.display = "none";
					}
				}
				// 4. Ensure the final else if handles standard UI re-enablement.
				else if (message.success || !message.success) {
					setLoadingState(false, elements);
				}
				break;
			}

			case "requestClearChatConfirmation": {
				console.log("[Webview] Received requestClearChatConfirmation.");
				showClearChatConfirmationUI(
					elements,
					postMessageToExtension,
					updateStatus,
					setLoadingState
				);
				break;
			}

			case "updateTokenStatistics": {
				console.log(
					"[Webview] Received token statistics update:",
					message.value
				);
				const stats = message.value;

				// Update token usage display
				const totalInputElement = document.getElementById("total-input-tokens");
				const totalOutputElement = document.getElementById(
					"total-output-tokens"
				);
				const totalTokensElement = document.getElementById("total-tokens");
				const requestCountElement = document.getElementById("request-count");
				const avgInputElement = document.getElementById("avg-input-tokens");
				const avgOutputElement = document.getElementById("avg-output-tokens");

				if (totalInputElement) {
					totalInputElement.textContent = stats.totalInput;
				}
				if (totalOutputElement) {
					totalOutputElement.textContent = stats.totalOutput;
				}
				if (totalTokensElement) {
					totalTokensElement.textContent = stats.total;
				}
				if (requestCountElement) {
					requestCountElement.textContent = stats.requestCount;
				}
				if (avgInputElement) {
					avgInputElement.textContent = stats.averageInput;
				}
				if (avgOutputElement) {
					avgOutputElement.textContent = stats.averageOutput;
				}
				break;
			}

			case "updateCurrentTokenEstimates": {
				console.log(
					"[Webview] Received current token estimates update:",
					message.value
				);
				const estimates = message.value;

				// Update token usage display with current streaming estimates
				const totalInputElement = document.getElementById("total-input-tokens");
				const totalOutputElement = document.getElementById(
					"total-output-tokens"
				);
				const totalTokensElement = document.getElementById("total-tokens");

				if (totalInputElement) {
					totalInputElement.textContent = estimates.inputTokens;
				}
				if (totalOutputElement) {
					totalOutputElement.textContent = estimates.outputTokens;
				}
				if (totalTokensElement) {
					totalTokensElement.textContent = estimates.totalTokens;
				}
				break;
			}

			case "structuredPlanParseFailed": {
				const { error, failedJson } = message.value;
				console.log("Received structuredPlanParseFailed.");
				showPlanParseErrorUI(
					elements,
					error,
					failedJson,
					postMessageToExtension,
					updateStatus, // Corrected order as per showPlanParseErrorUI signature
					setLoadingState // Corrected order as per showPlanParseErrorUI signature
				);
				break;
			}

			case "commitReview": {
				console.log("Received commitReview message:", message.value);
				if (
					!message.value ||
					typeof message.value.commitMessage !== "string" ||
					!Array.isArray(message.value.stagedFiles)
				) {
					console.error("Invalid 'commitReview' message value:", message.value);
					setLoadingState(false, elements);
					return;
				}
				const { commitMessage, stagedFiles } = message.value;
				appState.pendingCommitReviewData = { commitMessage, stagedFiles }; // Update appState here
				showCommitReviewUI(
					elements,
					commitMessage,
					stagedFiles,
					postMessageToExtension,
					updateStatus,
					setLoadingState
				);
				break;
			}

			case "restorePendingCommitReview": {
				if (message.value) {
					console.log(
						"Received restorePendingCommitReview message:",
						message.value
					);
					if (
						typeof message.value.commitMessage !== "string" ||
						!Array.isArray(message.value.stagedFiles)
					) {
						console.error(
							"Invalid 'restorePendingCommitReview' message value:",
							message.value
						);
						setLoadingState(false, elements);
						return;
					}
					const { commitMessage, stagedFiles } = message.value;

					appState.pendingCommitReviewData = { commitMessage, stagedFiles };

					showCommitReviewUI(
						elements,
						commitMessage,
						stagedFiles,
						postMessageToExtension,
						updateStatus,
						setLoadingState
					);

					setLoadingState(false, elements);

					if (elements.cancelGenerationButton) {
						elements.cancelGenerationButton.style.display = "none";
					}
				} else {
					console.warn(
						"restorePendingCommitReview received without message.value. No action taken."
					);
					setLoadingState(false, elements);
				}
				break;
			}

			case "restorePendingPlanConfirmation":
				if (message.value) {
					console.log("Received restorePendingPlanConfirmation.");
					// Update the type cast to include textualPlanExplanation for comprehensive restoration
					const restoredPlanData = message.value as PersistedPlanData; // Use the more complete type from sidebarTypes
					appState.pendingPlanData = restoredPlanData; // Assign to appState

					// ADDED: Append the restored textual plan explanation to the chat UI
					appendMessage(
						elements,
						"Model",
						restoredPlanData.textualPlanExplanation, // Use the restored text
						"ai-message",
						true, // Treat as history-backed
						undefined,
						restoredPlanData.relevantFiles,
						undefined, // messageIndexForHistory
						undefined, // isRelevantFilesExpandedForHistory
						true // isPlanExplanationForRender
					);

					createPlanConfirmationUI(
						elements,
						postMessageToExtension,
						updateStatus,
						setLoadingState
					);

					if (elements.planConfirmationContainer) {
						elements.planConfirmationContainer.style.display = "flex";
						updateStatus(
							elements,
							"Pending plan confirmation restored. Review and confirm to proceed."
						);

						if (elements.cancelGenerationButton) {
							elements.cancelGenerationButton.style.display = "none";
						}
						setLoadingState(false, elements);
					} else {
						console.error(
							"Error: Plan confirmation container not found during restore. Cannot display pending plan."
						);
						updateStatus(
							elements,
							"Error: Failed to restore pending plan UI. Inputs re-enabled.",
							true
						);
						appState.pendingPlanData = null;
						setLoadingState(false, elements);
					}
				} else {
					console.warn(
						"restorePendingPlanConfirmation received without message.value. No action taken."
					);
					setLoadingState(false, elements);
				}
				break;

			case "appendRealtimeModelMessage":
				if (message.value && typeof message.value.text === "string") {
					appendMessage(
						elements,
						"Model",
						message.value.text,
						`ai-message ${message.value.isError ? "error-message" : ""}`.trim(),
						true,
						message.diffContent,
						message.relevantFiles,
						undefined, // messageIndexForHistory
						undefined, // isRelevantFilesExpandedForHistory
						false, // isPlanExplanationForRender
						message.isPlanStepUpdate // Pass the new flag here
					);
					setLoadingState(appState.isLoading, elements);
				} else {
					console.warn(
						"Received 'appendRealtimeModelMessage' with invalid value:",
						message.value
					);
				}
				break;

			case "apiKeyStatus": {
				if (typeof message.value === "string") {
					updateApiKeyStatus(elements, message.value);
					setLoadingState(appState.isLoading, elements);
				}
				break;
			}
			case "statusUpdate": {
				if (typeof message.value === "string") {
					updateStatus(
						elements,
						message.value,
						message.isError ?? false,
						message.showLoadingDots ?? false
					);
					if (
						appState.isCancellationInProgress &&
						message.value.toLowerCase().includes("cancelled")
					) {
						appState.isCancellationInProgress = false;
						console.log(
							"[Webview] Cancellation flow confirmed and completed by statusUpdate. isCancellationInProgress reset."
						);
					}
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

					appState.totalKeys = updateData.totalKeys;
					appState.isApiKeySet = updateData.activeIndex !== -1;

					if (
						updateData.activeIndex !== -1 &&
						updateData.keys[updateData.activeIndex]
					) {
						elements.currentKeyDisplay!.textContent =
							updateData.keys[updateData.activeIndex].maskedKey;
					} else {
						elements.currentKeyDisplay!.textContent = "No Active Key";
						updateApiKeyStatus(elements, "Please add an API key.");
					}
					setLoadingState(appState.isLoading, elements);
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
					elements.modelSelect!.innerHTML = "";
					availableModels.forEach((modelName: string) => {
						const option = document.createElement("option");
						option.value = modelName;
						option.textContent = modelName;
						if (modelName === selectedModel) {
							option.selected = true;
						}
						elements.modelSelect!.appendChild(option);
					});
					elements.modelSelect!.value = selectedModel;
					console.log(
						"Model list updated in webview. Selected:",
						selectedModel
					);
					setLoadingState(appState.isLoading, elements);
				} else {
					console.error("Invalid 'updateModelList' message received:", message);
				}
				break;
			}
			case "updateLoadingState": {
				setLoadingState(message.value as boolean, elements);
				break;
			}
			case "reenableInput": {
				console.log("Received reenableInput message. Resetting UI state.");
				resetUIStateAfterCancellation(elements, setLoadingState);
				resetCodeStreams();
				break;
			}
			case "planExecutionStarted": {
				appState.isPlanExecutionInProgress = true;
				setLoadingState(appState.isLoading, elements);
				break;
			}
			case "planExecutionEnded": {
				appState.isPlanExecutionInProgress = false;
				setLoadingState(appState.isLoading, elements);
				break;
			}
			case "planExecutionFinished": {
				console.log(
					"[Webview] Received planExecutionFinished message.",
					message
				);
				const planFinishedMessage = message as PlanExecutionFinishedMessage;
				appState.hasRevertibleChanges =
					planFinishedMessage.hasRevertibleChanges;
				setLoadingState(false, elements); // Refresh UI to update revert button visibility
				break;
			}
			case "revertCompleted": {
				console.log("[Webview] Received revertCompleted message.");
				appState.hasRevertibleChanges = false; // Hide the revert button
				postMessageToExtension({
					type: "statusUpdate",
					value: "Revert completed.",
					isError: false,
				});
				break;
			}
			case "chatCleared": {
				if (elements.chatContainer) {
					elements.chatContainer.innerHTML = "";
				}
				setLoadingState(false, elements);
				resetStreamingAnimationState();
				hideAllConfirmationAndReviewUIs(elements);
				appState.pendingPlanData = null; // Ensure this is reset too
				appState.pendingCommitReviewData = null; // Ensure this is reset too
				appState.isPlanExecutionInProgress = false; // Reset plan execution state
				updateEmptyChatPlaceholderVisibility(elements);
				resetCodeStreams();
				break;
			}
			case "restoreHistory": {
				if (elements.chatContainer && Array.isArray(message.value)) {
					// Clear existing messages to ensure a complete re-render.
					elements.chatContainer.innerHTML = "";
					appState.nextMessageIndex = message.value.length; // Synchronize the next message index
					// Re-populate the chat display with each historical entry.
					message.value.forEach((msg: ChatMessage, index: number) => {
						if (
							msg &&
							typeof msg.sender === "string" &&
							typeof msg.text === "string"
						) {
							appendMessage(
								elements,
								msg.sender,
								msg.text,
								msg.className || "",
								true,
								msg.diffContent,
								msg.relevantFiles,
								index,
								msg.isRelevantFilesExpanded,
								msg.isPlanExplanation, // isPlanExplanationForRender
								msg.isPlanStepUpdate, // Pass the new flag here
								msg.imageParts // Pass the 12th parameter
							);
						}
					});
					updateStatus(elements, "Chat history restored.");

					// Select all elements within elements.chatContainer that have the class .user-message-edited-pending-ai.
					const editedMessages = elements.chatContainer.querySelectorAll(
						".user-message-edited-pending-ai"
					);
					editedMessages.forEach((msg) => {
						msg.classList.remove("user-message-edited-pending-ai");
					});

					setLoadingState(appState.isLoading, elements);

					// Scroll to the bottom to show the most recent messages, maintaining UX.
					elements.chatContainer.scrollTop =
						elements.chatContainer.scrollHeight;
				} else {
					updateStatus(
						elements,
						"Error: Failed to restore chat history due to invalid format.",
						true
					);
				}
				break;
			}
			case "authStateUpdate": {
				const { isSignedIn } = message.value;
				console.log(
					`[messageBusHandler] authStateUpdate received. isSignedIn: ${isSignedIn}`
				);

				break;
			}
			case "updateRelevantFilesDisplay": {
				const { messageIndex, isExpanded } = message.value;
				if (elements.chatContainer) {
					const messageElement = elements.chatContainer.querySelector(
						`.message[data-message-index=\"${messageIndex}\"]`
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
							`[updateRelevantFilesDisplay] Message element with data-message-index=\"${messageIndex}\" not found.`
						);
					}
				}
				break;
			}
			case "PrefillChatInput": {
				console.log(
					"[Webview] Received PrefillChatInput. Prefilling chat input."
				);
				const { text } = message.payload;
				elements.chatInput.value = text;
				elements.chatInput.focus();
				elements.chatInput.placeholder = "Ask Minovative Mind...";
				elements.chatInput.disabled = false;
				elements.sendButton.disabled = false;
				setLoadingState(false, elements);
				break;
			}
			case "resetCodeStreamingArea": {
				console.log(
					"[Webview] Received resetCodeStreamingArea message. Resetting code streams."
				);
				resetCodeStreams();
				break;
			}
			case "receiveWorkspaceFiles": {
				console.log("[Webview] Received receiveWorkspaceFiles message.");
				const files = message.value as string[];
				appState.allWorkspaceFiles = files;
				// Assuming appState.isRequestingWorkspaceFiles exists and was set to true prior to this message.
				appState.isRequestingWorkspaceFiles = false;

				// Check if the input still starts with '@' and re-filter/show suggestions
				const chatInputValue = elements.chatInput.value;
				if (chatInputValue.startsWith("@")) {
					const query = chatInputValue.substring(1).toLowerCase();
					const matches = appState.allWorkspaceFiles.filter((file) =>
						file.toLowerCase().includes(query)
					);
					showSuggestions(matches, "file", elements, setLoadingState);
					elements.chatInput.focus(); // Ensure input is focused after updating suggestions
				} else {
					// If '@' is no longer present, hide any previously shown suggestions
					hideSuggestions(elements, setLoadingState);
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
}

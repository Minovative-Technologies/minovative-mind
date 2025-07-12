import {
	appendMessage,
	reenableAllMessageActionButtons,
} from "../ui/chatMessageRenderer";
import {
	updateApiKeyStatus,
	updateStatus,
	updateEmptyChatPlaceholderVisibility,
} from "../ui/statusManager";
import { appState } from "../state/appState";
import { AiStreamingState, PersistedPlanData } from "../../common/sidebarTypes";
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
} from "../ui/confirmationAndReviewUIs";
import { md } from "../utils/markdownRenderer";
import { postMessageToExtension } from "../utils/vscodeApi";
import { RequiredDomElements } from "../types/webviewTypes";

export function initializeMessageBusHandler(
	elements: RequiredDomElements,
	setLoadingState: (loading: boolean, elements: RequiredDomElements) => void
): void {
	// Helper for streaming state reset
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
					message.relevantFiles
				);

				// REMOVED: This block was prematurely showing the plan confirmation UI.
				// The plan confirmation UI should only be shown after aiResponseEnd for streaming plans.
				if (message.isLoading === false) {
					setLoadingState(false, elements);
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
					relevantFiles
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
							relevantFiles
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
						relevantFiles
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
				break;
			}

			case "aiResponse": {
				appendMessage(
					elements,
					"Model",
					message.value,
					`ai-message ${message.isError ? "error-message" : ""}`.trim(),
					true,
					undefined,
					message.relevantFiles
				);

				// REMOVED: This block was prematurely showing the plan confirmation UI.
				// The plan confirmation UI should only be shown after aiResponseEnd for streaming plans.
				if (message.isLoading === false) {
					setLoadingState(false, elements);
				}
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
					true // Treat as a history-backed message for consistent styling and buttons (even if not yet in history)
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
					message.value.relevantFiles
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
				stopTypingAnimation();
				console.log("Received aiResponseEnd. Stream finished.");

				const isCancellation =
					typeof message.error === "string" &&
					message.error.includes("cancelled");

				if (appState.currentAiMessageContentElement) {
					appState.currentAccumulatedText += appState.typingBuffer;
					let finalContentHtml: string;

					if (!message.success && isCancellation) {
						const cancellationText = "*Operation cancelled.*";
						finalContentHtml = md.render(cancellationText);
						appState.currentAiMessageContentElement.dataset.originalMarkdown =
							cancellationText;
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
					// Store the original markdown text for copy functionality
					appState.currentAiMessageContentElement.dataset.originalMarkdown =
						appState.currentAccumulatedText;

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
					}
				} else {
					console.warn(
						"aiResponseEnd received but currentAiMessageContentElement is null. Fallback to appending new message."
					);
					// Fallback: If for some reason the element wasn't tracked, append a new message.
					// This should generally only happen if a previous streaming message was somehow malformed or lost.
					if (!message.success && isCancellation) {
						appendMessage(
							elements,
							"Model",
							md.render("*Operation cancelled.*"),
							"ai-message error-message",
							true
						);
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
							true
						);
					} else {
						// If successful but currentAiMessageContentElement was null, append the accumulated text.
						appendMessage(
							elements,
							"Model",
							md.render(appState.currentAccumulatedText),
							"ai-message",
							true
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

				resetStreamingAnimationState(); // Clear animation state
				appState.isCancellationInProgress = false; // Reset cancellation flag after processing content update

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
				} else if (message.success) {
					console.log("aiResponseEnd indicates successful chat response.");
					// No special UI logic here, main UI state handled at the end
				}

				// Re-enable all message action buttons to ensure they're interactive after AI operations
				reenableAllMessageActionButtons(elements);

				// setLoadingState(false, elements) must occur at the very end of this aiResponseEnd block.
				setLoadingState(false, elements);
				updateEmptyChatPlaceholderVisibility(elements);
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
						restoredPlanData.relevantFiles
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
						message.value.diffContent,
						message.value.relevantFiles
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
					updateStatus(elements, message.value, message.isError ?? false);
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
				break;
			}
			case "restoreHistory": {
				if (elements.chatContainer && Array.isArray(message.value)) {
					elements.chatContainer.innerHTML = "";
					appState.nextMessageIndex = message.value.length; // Synchronize the next message index
					message.value.forEach((msg: any, index: number) => {
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
								msg.isRelevantFilesExpanded
							);
						}
					});
					updateStatus(elements, "Chat history restored.");

					// Select all elements within elements.chatContainer that have the class .user-message-edited-pending-ai.
					const editedMessages = elements.chatContainer.querySelectorAll(
						".user-message-edited-pending-ai"
					);
					// Iterate through these selected elements and remove the user-message-edited-pending-ai class from each.
					editedMessages.forEach((msg) => {
						msg.classList.remove("user-message-edited-pending-ai");
					});

					// Call setLoadingState(appState.isLoading, elements); to ensure all UI elements' enabled/disabled states are correctly updated based on the current appState.isLoading.
					setLoadingState(appState.isLoading, elements);

					// Ensure elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight; is called after all messages are appended to guarantee the chat scrolls to the bottom.
					elements.chatContainer.scrollTop =
						elements.chatContainer.scrollHeight;
				} else {
					updateStatus(
						elements,
						"Error: Failed to restore chat history due to invalid format.",
						true
					);
				}
				hideAllConfirmationAndReviewUIs(elements);
				appState.pendingPlanData = null; // Ensure this is reset too
				appState.pendingCommitReviewData = null; // Ensure this is reset too
				appState.isPlanExecutionInProgress = false; // Reset plan execution state
				updateEmptyChatPlaceholderVisibility(elements);
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
			case "reenableInput": {
				console.log(
					"[reenableInput] Received reenableInput request from provider."
				);
				appState.isCancellationInProgress = false; // MOVED TO HERE

				resetStreamingAnimationState();

				if (appState.currentAiMessageContentElement) {
					console.warn(
						"reenableInput received mid-stream. Resetting stream state."
					);
					appState.currentAccumulatedText += appState.typingBuffer;
					const renderedHtml = md.render(appState.currentAccumulatedText);
					appState.currentAiMessageContentElement.innerHTML = renderedHtml;
					// Store the original markdown text for copy functionality
					appState.currentAiMessageContentElement.dataset.originalMarkdown =
						appState.currentAccumulatedText;
					const messageElement =
						appState.currentAiMessageContentElement.parentElement;
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
						const editButton = messageElement.querySelector(
							".edit-button"
						) as HTMLButtonElement | null;
						if (editButton) {
							editButton.disabled = false;
						}
					}
				}

				// Re-enable all message action buttons to ensure they're interactive
				reenableAllMessageActionButtons(elements);

				hideAllConfirmationAndReviewUIs(elements);

				appState.isCommitActionInProgress = false; // Added as per instructions
				appState.isPlanExecutionInProgress = false; // Reset plan execution state

				console.log(
					"[reenableInput] Calling setLoadingState(false); Confirming appState.isLoading is now false."
				);
				setLoadingState(false, elements);

				const planConfirmationActive =
					elements.planConfirmationContainer &&
					elements.planConfirmationContainer.style.display !== "none";

				if (!appState.isCancellationInProgress) {
					// Only update status if not in a cancellation flow
					if (!planConfirmationActive && appState.pendingPlanData) {
						appState.pendingPlanData = null;
						updateStatus(
							elements,
							"Inputs re-enabled; any non-visible pending plan confirmation has been cleared."
						);
					} else if (!planConfirmationActive) {
						updateStatus(elements, "Inputs re-enabled.");
					}
				} else {
					// If cancellation is in progress, pendingPlanData should still be cleared
					// if relevant, but no new status message from reenableInput itself.
					if (!planConfirmationActive && appState.pendingPlanData) {
						appState.pendingPlanData = null;
					}
					console.log(
						"[Webview] reenableInput skipped status update due to ongoing cancellation."
					);
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

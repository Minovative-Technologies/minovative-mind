import * as vscode from "vscode";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import { ERROR_OPERATION_CANCELLED } from "../ai/gemini";
import { UrlContextService } from "./urlContextService";
import { HistoryEntry } from "../sidebar/common/sidebarTypes"; // Import HistoryEntry for type safety

export class ChatService {
	private urlContextService: UrlContextService;

	constructor(private provider: SidebarProvider) {
		this.urlContextService = new UrlContextService();
	}

	public async handleRegularChat(
		userMessage: string,
		groundingEnabled: boolean = false
	): Promise<void> {
		const { settingsManager } = this.provider;
		const modelName = settingsManager.getSelectedModelName();

		this.provider.activeOperationCancellationTokenSource =
			new vscode.CancellationTokenSource();
		const token = this.provider.activeOperationCancellationTokenSource.token;

		let success = true;
		let finalAiResponseText: string | null = null;

		try {
			// Automatically process URLs in the user message for context
			const urlContexts =
				await this.urlContextService.processMessageForUrlContext(userMessage);
			const urlContextString =
				this.urlContextService.formatUrlContexts(urlContexts);

			if (urlContexts.length > 0) {
				console.log(
					`[ChatService] Processed ${urlContexts.length} URLs for context`
				);
			}

			// If grounding with Google Search is enabled, perform search and augment userMessage or context.
			if (groundingEnabled) {
				// TODO: Implement Google Search API call and context augmentation here.
				// Example: const googleResults = await performGoogleSearch(userMessage);
				// Then, append or prepend results to userMessage or projectContext.
			}

			const projectContext =
				await this.provider.contextService.buildProjectContext(
					token,
					userMessage
				);
			if (projectContext.contextString.startsWith("[Error")) {
				throw new Error(projectContext.contextString);
			}

			// 2. Initialize this.provider.currentAiStreamingState
			this.provider.currentAiStreamingState = {
				content: "",
				relevantFiles: projectContext.relevantFiles,
				isComplete: false,
				isError: false,
			};

			this.provider.postMessageToWebview({
				type: "aiResponseStart",
				value: { modelName, relevantFiles: projectContext.relevantFiles },
			});

			const finalPrompt = `You are Minovative Mind, an AI assistant in VS Code. Respond helpfully and concisely. Format your response using Markdown and never provide full code snippets to user's requests, be concise and informative.\n\nProject Context:\n${
				projectContext.contextString
			}${
				urlContextString ? `\n\n${urlContextString}` : ""
			}\n\nUser Query:\n${userMessage}\n\nAssistant Response:`;

			let accumulatedResponse = "";
			finalAiResponseText =
				await this.provider.aiRequestService.generateWithRetry(
					finalPrompt,
					modelName,
					this.provider.chatHistoryManager.getChatHistory(),
					"chat",
					undefined,
					{
						onChunk: (chunk: string) => {
							accumulatedResponse += chunk;
							// 3. In the onChunk callback, append the chunk
							if (this.provider.currentAiStreamingState) {
								this.provider.currentAiStreamingState.content += chunk;
							}
							this.provider.postMessageToWebview({
								type: "aiResponseChunk",
								value: chunk,
							});
						},
					},
					token
				);

			if (token.isCancellationRequested) {
				throw new Error(ERROR_OPERATION_CANCELLED);
			}
			if (finalAiResponseText.toLowerCase().startsWith("error:")) {
				success = false;
			} else {
				// Process URLs in AI response for context in future interactions
				const aiResponseUrlContexts =
					await this.urlContextService.processMessageForUrlContext(
						accumulatedResponse
					);
				if (aiResponseUrlContexts.length > 0) {
					console.log(
						`Found ${aiResponseUrlContexts.length} URLs in AI response`
					);
				}

				this.provider.chatHistoryManager.addHistoryEntry(
					"model",
					accumulatedResponse,
					undefined,
					projectContext.relevantFiles,
					projectContext.relevantFiles &&
						projectContext.relevantFiles.length <= 3
				);
			}
		} catch (error: any) {
			finalAiResponseText = error.message;
			success = false;
			// 4. In the catch block (for errors), set isError = true;
			if (this.provider.currentAiStreamingState) {
				this.provider.currentAiStreamingState.isError = true;
			}
		} finally {
			// 5. In the finally block, set isComplete = true;
			if (this.provider.currentAiStreamingState) {
				this.provider.currentAiStreamingState.isComplete = true;
			}
			const isCancellation = finalAiResponseText === ERROR_OPERATION_CANCELLED;

			// Only send aiResponseEnd if we haven't already cancelled
			// CRITICAL CHANGE: Removed the 'if' condition. aiResponseEnd must always be sent.
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: success,
				error: isCancellation
					? "Chat generation cancelled."
					: success
					? null
					: finalAiResponseText,
			});

			this.provider.activeOperationCancellationTokenSource?.dispose();
			this.provider.activeOperationCancellationTokenSource = undefined;
			this.provider.chatHistoryManager.restoreChatHistoryToWebview();
		}
	}

	public async regenerateAiResponseFromHistory(
		userMessageIndex: number
	): Promise<void> {
		const {
			settingsManager,
			chatHistoryManager,
			contextService,
			aiRequestService,
		} = this.provider;
		const modelName = settingsManager.getSelectedModelName();

		// 1. Cancel any existing activeOperationCancellationTokenSource and create a new one.
		this.provider.activeOperationCancellationTokenSource?.cancel();
		this.provider.activeOperationCancellationTokenSource =
			new vscode.CancellationTokenSource();
		const token = this.provider.activeOperationCancellationTokenSource.token;

		let success = true;
		let finalAiResponseText: string | null = null;
		let currentHistory: readonly HistoryEntry[] = [];
		let userMessageText: string = "";
		let relevantFiles: string[] | undefined;

		try {
			// 2. Get the current _chatHistory from chatHistoryManager.
			currentHistory = chatHistoryManager.getChatHistory();

			// 3. After editMessageAndTruncate, the edited message becomes the last message in the history.
			// Find the last user message in the truncated history.
			let lastUserMessageIndex = -1;
			for (let i = currentHistory.length - 1; i >= 0; i--) {
				if (currentHistory[i].role === "user") {
					lastUserMessageIndex = i;
					break;
				}
			}

			if (lastUserMessageIndex === -1) {
				throw new Error(
					"Validation Error: No user message found in chat history after editing."
				);
			}

			const editedUserMessageEntry = currentHistory[lastUserMessageIndex];

			if (
				!editedUserMessageEntry ||
				editedUserMessageEntry.role !== "user" ||
				!editedUserMessageEntry.parts ||
				editedUserMessageEntry.parts.length === 0 ||
				!editedUserMessageEntry.parts[0].text
			) {
				throw new Error(
					"Validation Error: Edited user message not found or is not a user message with valid content."
				);
			}

			userMessageText = editedUserMessageEntry.parts[0].text;

			// 4. Call contextService.buildProjectContext using token and userMessageText.
			const projectContext = await contextService.buildProjectContext(
				token,
				userMessageText
			);

			if (projectContext.contextString.startsWith("[Error")) {
				throw new Error(projectContext.contextString);
			}
			relevantFiles = projectContext.relevantFiles;

			// 5. Initialize this.provider.currentAiStreamingState with empty content and relevant files from projectContext.
			this.provider.currentAiStreamingState = {
				content: "",
				relevantFiles: relevantFiles,
				isComplete: false,
				isError: false,
			};

			// 6. Post an aiResponseStart message to the webview.
			this.provider.postMessageToWebview({
				type: "aiResponseStart",
				value: { modelName, relevantFiles: relevantFiles },
			});

			// 7. Construct the finalPrompt including existing 'You are Minovative Mind...' prefix,
			// the projectContext.contextString, and the userMessageText from the edited message,
			// and an 'Assistant Response:'.
			const finalPrompt = `You are Minovative Mind, an AI assistant in VS Code. Respond helpfully and concisely. Format your response using Markdown and never provide full code snippets to user's requests, be concise and informative.\n\nProject Context:\n${projectContext.contextString}\n\nUser Query:\n${userMessageText}\n\nAssistant Response:`;

			let accumulatedResponse = "";
			finalAiResponseText = await aiRequestService.generateWithRetry(
				finalPrompt,
				modelName,
				currentHistory, // Pass the truncated currentHistory
				"chat",
				undefined,
				{
					// 8. Call aiRequestService.generateWithRetry with onChunk callback.
					onChunk: (chunk: string) => {
						accumulatedResponse += chunk;
						// Append to accumulatedResponse and update this.provider.currentAiStreamingState.content
						if (this.provider.currentAiStreamingState) {
							this.provider.currentAiStreamingState.content += chunk;
						}
						// Then post an aiResponseChunk message.
						this.provider.postMessageToWebview({
							type: "aiResponseChunk",
							value: chunk,
						});
					},
				},
				token
			);

			// 9. Handle token.isCancellationRequested or error: responses.
			if (token.isCancellationRequested) {
				throw new Error(ERROR_OPERATION_CANCELLED);
			}
			if (finalAiResponseText.toLowerCase().startsWith("error:")) {
				success = false;
			} else {
				// 10. If successful, add the new model response to chatHistoryManager.
				chatHistoryManager.addHistoryEntry(
					"model",
					accumulatedResponse,
					undefined, // No diff content for a chat response
					relevantFiles,
					relevantFiles && relevantFiles.length <= 3
				);
			}
		} catch (error: any) {
			finalAiResponseText = error.message;
			success = false;
			// Set isError = true;
			if (this.provider.currentAiStreamingState) {
				this.provider.currentAiStreamingState.isError = true;
			}
			if (error.message === ERROR_OPERATION_CANCELLED) {
				console.log("[ChatService] AI response regeneration cancelled.");
				// No need to add error message to history if cancelled by user
			} else {
				console.error("[ChatService] Error regenerating AI response:", error);
				// Add a system error message to history and display it
				chatHistoryManager.addHistoryEntry(
					"model", // Changed from 'system' to 'model' as per instructions
					`Error regenerating AI response: ${finalAiResponseText}`,
					"error-message"
				);
			}
		} finally {
			// In the finally block:
			// a. Set this.provider.currentAiStreamingState.isComplete = true.
			if (this.provider.currentAiStreamingState) {
				this.provider.currentAiStreamingState.isComplete = true;
			}
			const isCancellation = finalAiResponseText === ERROR_OPERATION_CANCELLED;

			// Only send aiResponseEnd if we haven't already cancelled
			// CRITICAL CHANGE: Removed the 'if' condition. aiResponseEnd must always be sent.
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: success,
				error: isCancellation
					? "Chat generation cancelled."
					: success
					? null
					: finalAiResponseText,
			});

			// c. Dispose of the activeOperationCancellationTokenSource.
			this.provider.activeOperationCancellationTokenSource?.dispose();
			this.provider.activeOperationCancellationTokenSource = undefined;
			this.provider.chatHistoryManager.restoreChatHistoryToWebview();

			// Set the flag to false before restoring history
			this.provider.isEditingMessageActive = false;
			// d. Call chatHistoryManager.restoreChatHistoryToWebview() to re-render the UI based on the new, full history.
			chatHistoryManager.restoreChatHistoryToWebview();
		}
	}
}

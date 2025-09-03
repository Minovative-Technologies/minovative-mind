import * as vscode from "vscode";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import {
	ERROR_OPERATION_CANCELLED,
	initializeGenerativeAI,
} from "../ai/gemini"; // Ensure initializeGenerativeAI is imported
import { GenerationConfig, Tool } from "@google/generative-ai"; // Ensure Tool is imported
import { UrlContextService } from "./urlContextService";
import { HistoryEntry, HistoryEntryPart } from "../sidebar/common/sidebarTypes"; // Import HistoryEntry for type safety, and HistoryEntryPart
import { DEFAULT_FLASH_LITE_MODEL } from "../sidebar/common/sidebarConstants"; // Import constants for API key and model selection
import { formatUserFacingErrorMessage } from "../utils/errorFormatter";

const AI_CHAT_PROMPT =
	"Lets discuss and do not code yet. You should only focus on high level thinking in this project, using the project context given to you. Only respone helpfully with production-ready explainations, no placeholders, no TODOs for the user. Make sure to mention what files are being changed or created if any.";

export class ChatService {
	private urlContextService: UrlContextService;

	constructor(private provider: SidebarProvider) {
		this.urlContextService = new UrlContextService();
	}

	public async handleRegularChat(
		userContentParts: HistoryEntryPart[], // Modified signature
		groundingEnabled: boolean = false
	): Promise<void> {
		const { settingsManager } = this.provider;
		// Retrieve the active apiKey and the current modelName from settings
		const apiKey = this.provider.apiKeyManager.getActiveApiKey();
		const modelName = DEFAULT_FLASH_LITE_MODEL; // Set modelName to DEFAULT_FLASH_LITE_MODEL directly

		// 1. After calling this.provider.startUserOperation(), declare a local const operationId.
		// The activeOperationCancellationTokenSource and currentActiveChatOperationId are expected to be set by startUserOperation.
		await this.provider.startUserOperation("chat");
		const operationId = this.provider.currentActiveChatOperationId;
		const token = this.provider.activeOperationCancellationTokenSource?.token;

		if (!operationId || !token) {
			console.error(
				"[ChatService] Operation ID or token not available after startUserOperation."
			);
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: false,
				error: "Internal error: Operation ID or token not available.",
				operationId: operationId as string,
			});
			// Ensure cleanup if we exit early
			this.provider.activeOperationCancellationTokenSource?.dispose();
			this.provider.activeOperationCancellationTokenSource = undefined;
			this.provider.currentActiveChatOperationId = null; // MODIFIED line 51
			return;
		}

		let success = true;
		let finalAiResponseText: string | null = null;

		// Add checks for apiKey and modelName before initialization
		if (!apiKey) {
			vscode.window.showErrorMessage(
				"Gemini API key is not set. Please set it in VS Code settings to use chat features."
			);
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: false,
				error: "Gemini API key is not set.",
				operationId: operationId as string, // Include operationId in error message too
			});
			return; // Exit early if API key is missing
		}

		if (!modelName) {
			vscode.window.showErrorMessage(
				"Gemini model is not selected. Please select one in VS Code settings to use chat features."
			);
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: false,
				error: "Gemini model is not selected.",
				operationId: operationId as string, // Include operationId in error message too
			});
			return; // Exit early if model name is missing
		}

		// Call initializeGenerativeAI with apiKey, modelName, and toolConfig.
		const initializationSuccess = initializeGenerativeAI(apiKey, modelName);

		// Add error handling to verify the success of initializeGenerativeAI.
		if (!initializationSuccess) {
			vscode.window.showErrorMessage(
				`Failed to initialize Gemini AI with model '${modelName}'. Please check your API key and selected model.`
			);
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: false,
				error: `Failed to initialize Gemini AI with model '${modelName}'.`,
				operationId: operationId as string, // Include operationId
			});
			throw new Error(
				formatUserFacingErrorMessage(
					new Error(
						`Failed to initialize Gemini AI with model '${modelName}'.`
					),
					"Failed to initialize AI service.",
					"AI Initialization Error: ",
					this.provider.workspaceRootUri
				)
			);
		}

		// Extract text content for services that only handle text (UrlContextService, ContextService)
		const userMessageTextForContext = userContentParts
			.filter((part): part is { text: string } => "text" in part)
			.map((part) => part.text)
			.join("\n");

		try {
			// Automatically process URLs in the user message for context
			const urlContexts =
				await this.urlContextService.processMessageForUrlContext(
					userMessageTextForContext
				);
			const urlContextString =
				this.urlContextService.formatUrlContexts(urlContexts);

			if (urlContexts.length > 0) {
				console.log(
					`[ChatService] Processed ${urlContexts.length} URLs for context`
				);
			}

			const projectContext =
				await this.provider.contextService.buildProjectContext(
					token,
					userMessageTextForContext // Use text-only for project context building
				);
			if (projectContext.contextString.startsWith("[Error")) {
				throw new Error(projectContext.contextString);
			}

			// 2. Initialize this.provider.currentAiStreamingState with the operationId property
			this.provider.currentAiStreamingState = {
				content: "",
				relevantFiles: projectContext.relevantFiles,
				isComplete: false,
				isError: false,
				operationId: operationId, // Set the operationId property
			};

			// 3. When posting messages to the webview for aiResponseStart, include the operationId
			this.provider.postMessageToWebview({
				type: "aiResponseStart",
				value: {
					modelName,
					relevantFiles: projectContext.relevantFiles,
					operationId: operationId,
				}, // Add operationId
			});

			// Revise construction of input for aiRequestService.generateWithRetry
			const initialSystemPrompt: HistoryEntryPart[] = [
				{
					text: `${AI_CHAT_PROMPT} \n\nProject Context:\n${
						projectContext.contextString
					}${urlContextString ? `\n\n${urlContextString}` : ""}`,
				},
			];
			const fullUserTurnContents: HistoryEntryPart[] = [
				...initialSystemPrompt,
				...userContentParts, // Append the direct user input (text + images)
			];

			let accumulatedResponse = "";

			let generationConfig: GenerationConfig | undefined = undefined;

			if (groundingEnabled) {
				generationConfig = {};
			}

			finalAiResponseText =
				await this.provider.aiRequestService.generateWithRetry(
					fullUserTurnContents, // Pass HistoryEntryPart[] as the first argument
					modelName,
					this.provider.chatHistoryManager.getChatHistory(),
					"chat",
					generationConfig,
					{
						onChunk: (chunk: string) => {
							accumulatedResponse += chunk;
							// 3. In the onChunk callback, append the chunk and include operationId
							if (this.provider.currentAiStreamingState) {
								this.provider.currentAiStreamingState.content += chunk;
							}
							this.provider.postMessageToWebview({
								type: "aiResponseChunk",
								value: chunk,
								operationId: operationId as string, // MODIFIED line 168
							});
						},
					},
					token,
					false
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
					[{ text: accumulatedResponse }], // Ensure content is HistoryEntryPart[]
					undefined,
					projectContext.relevantFiles,
					projectContext.relevantFiles &&
						projectContext.relevantFiles.length <= 3
				);
			}
		} catch (error: any) {
			finalAiResponseText = formatUserFacingErrorMessage(
				error,
				"Failed to generate AI response.",
				"AI Response Generation Error: ",
				this.provider.workspaceRootUri
			);
			success = false;
			// 4. In the catch block (for errors), set isError = true;
			if (this.provider.currentAiStreamingState) {
				this.provider.currentAiStreamingState.isError = true;
			}
		} finally {
			// 4. Modify the condition for isThisOperationStillActiveGlobally
			const isThisOperationStillActiveGlobally =
				this.provider.currentActiveChatOperationId === operationId;

			if (isThisOperationStillActiveGlobally) {
				// === Global Cleanup (Operation is truly finished and is the last one) ===
				// Mark the provider's current streaming state as complete.
				if (this.provider.currentAiStreamingState) {
					this.provider.currentAiStreamingState.isComplete = true;
				}

				// Determine if the operation was cancelled to set the appropriate error message.
				const isCancellation =
					finalAiResponseText === ERROR_OPERATION_CANCELLED;

				// If cancellation occurred and this was the active operation, notify SidebarProvider
				if (isCancellation) {
					this.provider.endCancellationOperation();
				}

				// Notify the webview that the AI response has ended.
				// 3. When posting messages to the webview for aiResponseEnd, include the operationId
				this.provider.postMessageToWebview({
					type: "aiResponseEnd",
					success: success, // Pass the success status from the try/catch block.
					error: isCancellation
						? "Chat generation cancelled."
						: success
						? null // No error if successful.
						: finalAiResponseText, // Pass the actual error message otherwise.
					operationId: operationId as string, // Add operationId
				});

				// Dispose of the globally active token source associated with THIS operation.
				// 5. Cleanup for activeOperationCancellationTokenSource and currentActiveChatOperationId
				this.provider.activeOperationCancellationTokenSource?.dispose();
				this.provider.activeOperationCancellationTokenSource = undefined;
				this.provider.currentActiveChatOperationId = null; // MODIFIED line 282

				// Restore the chat history to the webview, reflecting the final state.
				this.provider.chatHistoryManager.restoreChatHistoryToWebview();
				// === End Global Cleanup ===
			} else {
				// === Local Cleanup Only (New operation has started) ===
				// A new AI operation has superseded this one.
				// Only clean up resources specific to *this* operation.
				// Do NOT modify global provider state (activeOperationCancellationTokenSource, streaming state, history).
				// 5. If isThisOperationStillActiveGlobally is false, ensure provider.activeOperationCancellationTokenSource is NOT cleared or disposed.
				// This is inherently handled as the global state is only modified in the `if` block.
				console.log(
					`[ChatService] Old chat operation (${operationId})'s finally block detected new operation, skipping global state modification.`
				);
				// === End Local Cleanup Only ===
			}
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
		const modelName = DEFAULT_FLASH_LITE_MODEL; // Use the default model for regeneration

		// 1. After calling this.provider.startUserOperation(), declare a local const operationId.
		// The activeOperationCancellationTokenSource and currentActiveChatOperationId are expected to be set by startUserOperation.
		await this.provider.startUserOperation("chat");
		const operationId = this.provider.currentActiveChatOperationId;
		const token = this.provider.activeOperationCancellationTokenSource?.token;

		if (!operationId || !token) {
			console.error(
				"[ChatService] Operation ID or token not available after startUserOperation."
			);
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: false,
				error: "Internal error: Operation ID or token not available.",
				operationId: operationId as string,
			});
			// Ensure cleanup if we exit early
			this.provider.activeOperationCancellationTokenSource?.dispose();
			this.provider.activeOperationCancellationTokenSource = undefined;
			this.provider.currentActiveChatOperationId = null; // MODIFIED line 332
			return;
		}

		let success = true;
		let finalAiResponseText: string | null = null;
		let currentHistory: readonly HistoryEntry[] = [];
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
				editedUserMessageEntry.parts.length === 0
			) {
				throw new Error(
					"Validation Error: Edited user message not found or is not a user message with valid content."
				);
			}

			const userContentPartsForRegen = editedUserMessageEntry.parts; // Get HistoryEntryPart[]
			// Extract text content for services that only handle text
			const userMessageTextForContext = userContentPartsForRegen
				.filter((part): part is { text: string } => "text" in part)
				.map((part) => part.text)
				.join("\n");

			// 4. Call contextService.buildProjectContext using token and userMessageText (text-only for context).
			const projectContext = await contextService.buildProjectContext(
				token,
				userMessageTextForContext,
				undefined, // editorContext
				undefined, // initialDiagnosticsString
				{ useAISelectionCache: false, forceAISelectionRecalculation: true } // options
			);

			if (projectContext.contextString.startsWith("[Error")) {
				throw new Error(projectContext.contextString);
			}
			relevantFiles = projectContext.relevantFiles;

			// 2. Initialize this.provider.currentAiStreamingState with the operationId property
			this.provider.currentAiStreamingState = {
				content: "",
				relevantFiles: relevantFiles,
				isComplete: false,
				isError: false,
				operationId: operationId, // Set the operationId property
			};

			// 3. Post an aiResponseStart message to the webview with operationId
			this.provider.postMessageToWebview({
				type: "aiResponseStart",
				value: {
					modelName,
					relevantFiles: relevantFiles,
					operationId: operationId,
				}, // Add operationId
			});

			// Construct the full user turn contents, including system prompt and user input
			const initialSystemPrompt: HistoryEntryPart[] = [
				{
					text: `${AI_CHAT_PROMPT} \n\nProject Context:\n${projectContext.contextString}`,
				},
			];
			const fullUserTurnContents: HistoryEntryPart[] = [
				...initialSystemPrompt,
				...userContentPartsForRegen, // Append the direct user input (text + images)
			];

			let accumulatedResponse = "";
			finalAiResponseText = await aiRequestService.generateWithRetry(
				fullUserTurnContents, // Pass HistoryEntryPart[] as the first argument
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
						// Then post an aiResponseChunk message including operationId.
						this.provider.postMessageToWebview({
							type: "aiResponseChunk",
							value: chunk,
							operationId: operationId as string, // MODIFIED line 392
						});
					},
				},
				token,
				false
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
					[{ text: accumulatedResponse }], // Ensure content is HistoryEntryPart[]
					undefined, // No diff content for a chat response
					relevantFiles,
					relevantFiles && relevantFiles.length <= 3
				);
			}
		} catch (error: any) {
			finalAiResponseText = formatUserFacingErrorMessage(
				error,
				"Failed to regenerate AI response.",
				"AI Response Regeneration Error: ",
				this.provider.workspaceRootUri
			);
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
					[{ text: finalAiResponseText }],
					"error-message"
				);
			}
		} finally {
			// 4. Modify the condition for isThisOperationStillActiveGlobally
			const isThisOperationStillActiveGlobally =
				this.provider.currentActiveChatOperationId === operationId;

			if (isThisOperationStillActiveGlobally) {
				// === Global Cleanup (Operation is truly finished and is the last one) ===
				// Mark the provider's current streaming state as complete.
				if (this.provider.currentAiStreamingState) {
					this.provider.currentAiStreamingState.isComplete = true;
				}

				// Determine if the operation was cancelled to set the appropriate error message.
				const isCancellation =
					finalAiResponseText === ERROR_OPERATION_CANCELLED;

				// If cancellation occurred and this was the active operation, notify SidebarProvider
				if (isCancellation) {
					this.provider.endCancellationOperation();
				}

				// Notify the webview that the AI response has ended.
				// 3. When posting messages to the webview for aiResponseEnd, include the operationId
				this.provider.postMessageToWebview({
					type: "aiResponseEnd",
					success: success, // Pass the success status from the try/catch block.
					error: isCancellation
						? "Chat generation cancelled."
						: success
						? null // No error if successful.
						: finalAiResponseText, // Pass the actual error message otherwise.
					operationId: operationId as string, // Add operationId
				});

				// Dispose of the globally active token source associated with THIS operation.
				// 5. Cleanup for activeOperationCancellationTokenSource and currentActiveChatOperationId
				this.provider.activeOperationCancellationTokenSource?.dispose();
				this.provider.activeOperationCancellationTokenSource = undefined;
				this.provider.currentActiveChatOperationId = null; // MODIFIED line 530

				// Restore the chat history to the webview, reflecting the final state.
				this.provider.chatHistoryManager.restoreChatHistoryToWebview();
				// === End Global Cleanup ===
			} else {
				// === Local Cleanup Only (New operation has started) ===
				// A new AI operation has superseded this one.
				// Only clean up resources specific to *this* operation.
				// Do NOT modify global provider state (activeOperationCancellationTokenSource, streaming state, history).
				// 5. If isThisOperationStillActiveGlobally is false, ensure provider.activeOperationCancellationTokenSource is NOT cleared or disposed.
				// This is inherently handled as the global state is only modified in the `if` block.
				console.log(
					`[ChatService] Old regeneration operation (${operationId})'s finally block detected new operation, skipping global state modification.`
				);
				// === End Local Cleanup Only ===
			}

			// Reset the 'isEditingMessageActive' flag. This flag indicates the UI state related to an edit attempt,
			// and it should be reset after the regeneration attempt completes (whether successful, cancelled, or failed),
			// regardless of whether a new operation has taken over.
			this.provider.isEditingMessageActive = false;
		}
	}
}

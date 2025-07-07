import * as vscode from "vscode";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import { ERROR_OPERATION_CANCELLED } from "../ai/gemini";
import { UrlContextService } from "./urlContextService";

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

			const finalPrompt = `You are Minovative Mind, an AI assistant in VS Code. Respond helpfully and concisely. Format your response using Markdown. If the user wants you to implement code changes, guide them to use the "/plan [user prompt]" for requests they want you to code. Give them a "/plan [prompt]" use case according to the user query for them to use. Make sure the "/plan [prompt]" is without Markdown.\n\nProject Context:\n${
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
		}
	}
}

// src/services/chatService.ts
import * as vscode from "vscode";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import { ERROR_OPERATION_CANCELLED } from "../ai/gemini";

export class ChatService {
	constructor(private provider: SidebarProvider) {}

	public async handleRegularChat(userMessage: string): Promise<void> {
		const { settingsManager } = this.provider;
		const modelName = settingsManager.getSelectedModelName();

		this.provider.activeOperationCancellationTokenSource =
			new vscode.CancellationTokenSource();
		const token = this.provider.activeOperationCancellationTokenSource.token;

		let success = true;
		let finalAiResponseText: string | null = null;

		try {
			const projectContext =
				await this.provider.contextService.buildProjectContext(
					token,
					userMessage
				);
			if (projectContext.contextString.startsWith("[Error")) {
				throw new Error(projectContext.contextString);
			}

			this.provider.postMessageToWebview({
				type: "aiResponseStart",
				value: { modelName, relevantFiles: projectContext.relevantFiles },
			});

			const finalPrompt = `You are Minovative Mind, an AI assistant in VS Code. Respond helpfully and concisely. Format your response using Markdown. If the user wants you to implement code changes, guide them to use the (/plan [user request]) for ideas they want you to code. Give them an example use case of /plan according to their queries.\n\nProject Context:\n${projectContext.contextString}\n\nUser Query:\n${userMessage}\n\nAssistant Response:`;

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
		} finally {
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

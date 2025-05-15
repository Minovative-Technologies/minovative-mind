// src/sidebar/managers/chatHistoryManager.ts
import * as vscode from "vscode";
import { HistoryEntry, ChatMessage } from "../common/sidebarTypes"; // Assuming ChatMessage is defined here for save/load

const MAX_HISTORY_ITEMS = 50;

export class ChatHistoryManager {
	private _chatHistory: HistoryEntry[] = [];

	constructor(private readonly postMessageToWebview: (message: any) => void) {}

	public getChatHistory(): readonly HistoryEntry[] {
		return this._chatHistory;
	}

	public addHistoryEntry(role: "user" | "model", text: string): void {
		// Existing logic for managing chat history and preventing duplicates
		if (this._chatHistory.length > 0) {
			const lastEntry = this._chatHistory[this._chatHistory.length - 1];
			if (lastEntry.role === role && lastEntry.parts[0]?.text === text) {
				// Prevent adding duplicate messages for certain types of status updates
				if (
					text.startsWith("Changes reverted") ||
					(text === "Plan execution finished successfully." &&
						lastEntry.parts[0]?.text === text) ||
					(text === "Plan execution cancelled by user." &&
						lastEntry.parts[0]?.text === text) ||
					(text === "Chat generation cancelled by user." &&
						lastEntry.parts[0]?.text === text) ||
					(text === "Commit message generation cancelled by user." &&
						lastEntry.parts[0]?.text === text) ||
					(text === "Structured plan generation cancelled by user." &&
						lastEntry.parts[0]?.text === text) ||
					(text.startsWith("Step ") &&
						!text.includes("FAILED") &&
						!text.includes("SKIPPED"))
				) {
					console.log("Skipping potential duplicate history entry:", text);
					return;
				}
			}
		}

		this._chatHistory.push({ role, parts: [{ text }] });
		if (this._chatHistory.length > MAX_HISTORY_ITEMS) {
			this._chatHistory.splice(0, this._chatHistory.length - MAX_HISTORY_ITEMS);
		}
		// Note: Caller (SidebarProvider) should decide when to post updates to webview if needed,
		// e.g., after an AI response is fully received.
	}

	public async clearChat(): Promise<void> {
		this._chatHistory = [];
		this.postMessageToWebview({ type: "chatCleared" });
		this.postMessageToWebview({ type: "statusUpdate", value: "Chat cleared." });
		this.postMessageToWebview({ type: "reenableInput" });
	}

	public async saveChat(): Promise<void> {
		const options: vscode.SaveDialogOptions = {
			saveLabel: "Save Chat History",
			filters: { "JSON Files": ["json"] },
			defaultUri: vscode.workspace.workspaceFolders
				? vscode.Uri.joinPath(
						vscode.workspace.workspaceFolders[0].uri,
						`minovative-mind-chat-${
							new Date().toISOString().split("T")[0]
						}.json`
				  )
				: undefined,
		};
		const fileUri = await vscode.window.showSaveDialog(options);
		if (fileUri) {
			try {
				const saveableHistory: ChatMessage[] = this._chatHistory.map(
					(entry) => ({
						sender: entry.role === "user" ? "User" : "Model",
						text: entry.parts.map((p) => p.text).join(""),
						className: entry.role === "user" ? "user-message" : "ai-message",
					})
				);
				const contentString = JSON.stringify(saveableHistory, null, 2);
				await vscode.workspace.fs.writeFile(
					fileUri,
					Buffer.from(contentString, "utf-8")
				);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Chat saved successfully.",
				});
			} catch (error) {
				console.error("Error saving chat:", error);
				const message = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Failed to save chat: ${message}`);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Error: Failed to save chat.",
					isError: true,
				});
			}
		} else {
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Chat save cancelled.",
			});
		}
	}

	public async loadChat(): Promise<void> {
		const options: vscode.OpenDialogOptions = {
			canSelectMany: false,
			openLabel: "Load Chat History",
			filters: { "Chat History Files": ["json"], "All Files": ["*"] },
		};
		const fileUris = await vscode.window.showOpenDialog(options);
		if (fileUris && fileUris.length > 0) {
			const fileUri = fileUris[0];
			try {
				const contentBytes = await vscode.workspace.fs.readFile(fileUri);
				const contentString = Buffer.from(contentBytes).toString("utf-8");
				const loadedData = JSON.parse(contentString) as ChatMessage[]; // Cast for type checking

				if (
					Array.isArray(loadedData) &&
					loadedData.every(
						(item) =>
							item &&
							typeof item.sender === "string" &&
							typeof item.text === "string" &&
							(item.sender === "User" ||
								item.sender === "Model" ||
								item.sender === "System")
					)
				) {
					this._chatHistory = loadedData.map(
						(item: ChatMessage): HistoryEntry => ({
							role: item.sender === "User" ? "user" : "model",
							parts: [{ text: item.text }],
						})
					);
					this.restoreChatHistoryToWebview(); // Call this after updating internal history
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Chat loaded successfully.",
					});
				} else {
					throw new Error("Invalid chat history file format.");
				}
			} catch (error) {
				console.error("Error loading chat:", error);
				const message = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Failed to load chat: ${message}`);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Error: Failed to load or parse chat file.",
					isError: true,
				});
			}
		} else {
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Chat load cancelled.",
			});
		}
	}

	public restoreChatHistoryToWebview(): void {
		const historyForWebview: ChatMessage[] = this._chatHistory.map((entry) => ({
			sender: entry.role === "user" ? "User" : "Model",
			text: entry.parts.map((p) => p.text).join(""),
			className: entry.role === "user" ? "user-message" : "ai-message",
		}));
		this.postMessageToWebview({
			type: "restoreHistory",
			value: historyForWebview,
		});
	}
}

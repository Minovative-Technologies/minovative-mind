// src/sidebar/managers/chatHistoryManager.ts
import * as vscode from "vscode";
import {
	HistoryEntry,
	ChatMessage,
	UpdateRelevantFilesDisplayMessage,
} from "../common/sidebarTypes"; // Assuming ChatMessage is defined here for save/load

const CHAT_HISTORY_STORAGE_KEY = "minovativeMindChatHistory";
const MAX_HISTORY_ITEMS = 100;

export class ChatHistoryManager {
	private _chatHistory: HistoryEntry[] = [];
	private _workspaceState: vscode.Memento;

	constructor(
		workspaceState: vscode.Memento,
		private readonly postMessageToWebview: (message: any) => void
	) {
		this._workspaceState = workspaceState;
		this.loadHistoryFromStorage();
	}

	public getChatHistory(): readonly HistoryEntry[] {
		return this._chatHistory;
	}

	private async loadHistoryFromStorage(): Promise<void> {
		try {
			const storedHistoryString = this._workspaceState.get<string>(
				CHAT_HISTORY_STORAGE_KEY
			);
			if (storedHistoryString) {
				const loadedHistory: HistoryEntry[] = JSON.parse(storedHistoryString);
				if (
					Array.isArray(loadedHistory) &&
					loadedHistory.every(
						(item) =>
							typeof item === "object" &&
							item !== null &&
							typeof item.role === "string" &&
							Array.isArray(item.parts) &&
							item.parts.every((p) => typeof p.text === "string") &&
							// Add validation for diffContent, relevantFiles, and isRelevantFilesExpanded
							(item.diffContent === undefined ||
								typeof item.diffContent === "string") &&
							(item.relevantFiles === undefined ||
								(Array.isArray(item.relevantFiles) &&
									item.relevantFiles.every(
										(f: any) => typeof f === "string"
									))) &&
							(item.isRelevantFilesExpanded === undefined ||
								typeof item.isRelevantFilesExpanded === "boolean")
					)
				) {
					// Map loaded history to apply defensive defaults where needed
					this._chatHistory = loadedHistory.map((entry) => ({
						...entry,
						relevantFiles: entry.relevantFiles || [], // Defensive default for relevantFiles as per instruction
						// isRelevantFilesExpanded does not need a defensive default per instruction and type
					}));
					this.restoreChatHistoryToWebview();
					console.log("Chat history loaded from workspace state.");
				} else {
					console.warn(
						"Stored chat history format is invalid. Clearing history."
					);
					this._chatHistory = [];
					this.saveHistoryToStorage();
				}
			} else {
				console.log("No chat history found in workspace state.");
			}
		} catch (error) {
			console.error("Error loading chat history from storage:", error);
			this._chatHistory = [];
			this.saveHistoryToStorage();
		}
	}

	private async saveHistoryToStorage(): Promise<void> {
		try {
			// HistoryEntry objects already contain relevantFiles and isRelevantFilesExpanded if present.
			// JSON.stringify will correctly serialize these properties into the stored string.
			await this._workspaceState.update(
				CHAT_HISTORY_STORAGE_KEY,
				JSON.stringify(this._chatHistory)
			);
			console.log("Chat history saved to workspace state.");
		} catch (error) {
			console.error("Error saving chat history to storage:", error);
		}
	}

	public addHistoryEntry(
		role: "user" | "model",
		text: string,
		diffContent?: string,
		relevantFiles?: string[],
		isRelevantFilesExpanded?: boolean // New optional parameter
	): void {
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

		const newEntry: HistoryEntry = {
			role,
			parts: [{ text }],
			...(diffContent && { diffContent }),
			// The existing logic correctly assigns relevantFiles and sets isRelevantFilesExpanded
			// based on provided value or defaults it based on relevantFiles.length <= 3 if relevant files are present.
			...(relevantFiles && {
				relevantFiles,
				isRelevantFilesExpanded:
					isRelevantFilesExpanded !== undefined
						? isRelevantFilesExpanded
						: relevantFiles.length <= 3
						? true
						: false,
			}),
		};

		this._chatHistory.push(newEntry);
		if (this._chatHistory.length > MAX_HISTORY_ITEMS) {
			this._chatHistory.splice(0, this._chatHistory.length - MAX_HISTORY_ITEMS);
		}
		this.saveHistoryToStorage();
	}

	public async clearChat(): Promise<void> {
		this._chatHistory = [];
		this.postMessageToWebview({ type: "chatCleared" });
		this.postMessageToWebview({ type: "statusUpdate", value: "Chat cleared." });
		this.postMessageToWebview({ type: "reenableInput" });
		this.saveHistoryToStorage();
	}

	public deleteHistoryEntry(index: number): void {
		if (
			typeof index !== "number" ||
			!Number.isInteger(index) ||
			index < 0 ||
			index >= this._chatHistory.length
		) {
			console.warn(
				`Invalid index provided for deleteHistoryEntry: ${index}. History length: ${this._chatHistory.length}`
			);
			return;
		}

		console.log(`Removing message at index ${index} from history.`);
		this._chatHistory.splice(index, 1);
		this.saveHistoryToStorage();
		this.restoreChatHistoryToWebview();
	}

	public updateMessageRelevantFilesExpandedState(
		index: number,
		isExpanded: boolean
	): void {
		if (index < 0 || index >= this._chatHistory.length) {
			console.warn(
				`Invalid index for updateMessageRelevantFilesExpandedState: ${index}. History length: ${this._chatHistory.length}`
			);
			return;
		}
		const entry = this._chatHistory[index];
		if (entry.relevantFiles) {
			const oldExpandedState = entry.isRelevantFilesExpanded;
			entry.isRelevantFilesExpanded = isExpanded;
			this.saveHistoryToStorage();
			// Only send update to webview if the state actually changed
			if (oldExpandedState !== isExpanded) {
				const message: UpdateRelevantFilesDisplayMessage = {
					type: "updateRelevantFilesDisplay",
					messageIndex: index,
					isExpanded: isExpanded,
				};
				this.postMessageToWebview(message);
			}
		} else {
			console.warn(
				`No relevantFiles found for entry at index ${index}, cannot update expanded state.`
			);
		}
	}

	/**
	 * Edits a specific user message in the history and truncates all subsequent messages.
	 * @param index The 0-based index of the user message to edit.
	 * @param newContent The new text content for the message.
	 */
	public editMessageAndTruncate(index: number, newContent: string): void {
		// 1. Validate index
		if (
			typeof index !== "number" ||
			!Number.isInteger(index) ||
			index < 0 ||
			index >= this._chatHistory.length
		) {
			const warningMsg = `[ChatHistoryManager] Invalid index provided for editMessageAndTruncate: ${index}. History length: ${this._chatHistory.length}`;
			console.warn(warningMsg);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Error: Could not edit message. Invalid index.",
				isError: true,
			});
			return;
		}

		const messageToEdit = this._chatHistory[index];

		// 2. Validate that it's a 'user' role message
		if (messageToEdit.role !== "user") {
			const warningMsg = `[ChatHistoryManager] Attempted to edit non-user message (role: ${messageToEdit.role}) at index ${index}. Operation skipped.`;
			console.warn(warningMsg);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Error: Only your own messages can be edited.",
				isError: true,
			});
			return;
		}

		// 3. Update the text of the first part of the messageToEdit
		messageToEdit.parts[0].text = newContent;

		// 4. Truncate the array, removing all messages after the edited message.
		this._chatHistory.splice(index + 1);

		// 5. Call saveHistoryToStorage() to persist the changes.
		this.saveHistoryToStorage();
		console.log(
			`[ChatHistoryManager] Message at index ${index} edited and history truncated successfully.`
		);
		this.postMessageToWebview({
			type: "statusUpdate",
			value: "Message edited. AI response will be regenerated.",
		});
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
						...(entry.diffContent && { diffContent: entry.diffContent }),
						...(entry.relevantFiles && { relevantFiles: entry.relevantFiles }),
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
				const loadedData = JSON.parse(contentString) as ChatMessage[];

				if (
					Array.isArray(loadedData) &&
					loadedData.every(
						(item) =>
							item &&
							typeof item.sender === "string" &&
							typeof item.text === "string" &&
							(item.sender === "User" ||
								item.sender === "Model" ||
								item.sender === "System") &&
							(item.diffContent === undefined ||
								typeof item.diffContent === "string") &&
							(item.relevantFiles === undefined ||
								(Array.isArray(item.relevantFiles) &&
									item.relevantFiles.every((f) => typeof f === "string")))
					)
				) {
					this._chatHistory = loadedData.map(
						(item: ChatMessage): HistoryEntry => ({
							role: item.sender === "User" ? "user" : "model",
							parts: [{ text: item.text }],
							diffContent: item.diffContent,
							relevantFiles: item.relevantFiles,
							isRelevantFilesExpanded: item.relevantFiles
								? item.relevantFiles.length <= 3
									? true
									: false
								: undefined,
						})
					);
					this.restoreChatHistoryToWebview();
					this.saveHistoryToStorage();
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
		// Ensures the entire chat history is rendered in the webview to maintain UI consistency.
		const historyForWebview: ChatMessage[] = this._chatHistory.map((entry) => ({
			sender: entry.role === "user" ? "User" : "Model",
			text: entry.parts.map((p) => p.text).join(""),
			className: entry.role === "user" ? "user-message" : "ai-message",
			...(entry.diffContent && { diffContent: entry.diffContent }),
			...(entry.relevantFiles && { relevantFiles: entry.relevantFiles }),
			...(entry.relevantFiles &&
				entry.isRelevantFilesExpanded !== undefined && {
					isRelevantFilesExpanded: entry.isRelevantFilesExpanded,
				}),
		}));
		this.postMessageToWebview({
			type: "restoreHistory",
			value: historyForWebview,
		});
	}
}

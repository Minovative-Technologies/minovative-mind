import * as vscode from "vscode";
import {
	HistoryEntry,
	ChatMessage,
	UpdateRelevantFilesDisplayMessage,
	HistoryEntryPart,
	ImageInlineData,
} from "../common/sidebarTypes";

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
							item.parts.every(
								(p) =>
									(typeof p === "object" &&
										p !== null &&
										"text" in p &&
										typeof p.text === "string") || // Modified line
									("inlineData" in p &&
										typeof p.inlineData === "object" &&
										p.inlineData !== null &&
										typeof p.inlineData.mimeType === "string" &&
										typeof p.inlineData.data === "string")
							) &&
							// Add validation for diffContent, relevantFiles, and isRelevantFilesExpanded
							(item.diffContent === undefined ||
								typeof item.diffContent === "string") &&
							(item.relevantFiles === undefined ||
								(Array.isArray(item.relevantFiles) &&
									item.relevantFiles.every(
										(f: any) => typeof f === "string"
									))) &&
							(item.isRelevantFilesExpanded === undefined ||
								typeof item.isRelevantFilesExpanded === "boolean") &&
							(item.isPlanExplanation === undefined ||
								typeof item.isPlanExplanation === "boolean") &&
							(item.isPlanStepUpdate === undefined ||
								typeof item.isPlanStepUpdate === "boolean")
					)
				) {
					// Map loaded history to apply defensive defaults where needed
					this._chatHistory = loadedHistory.map((entry) => ({
						...entry,
						relevantFiles: entry.relevantFiles || [], // Defensive default for relevantFiles as per instruction
						// isRelevantFilesExpanded does not need a defensive default per instruction and type
						isPlanExplanation: entry.isPlanExplanation,
						isPlanStepUpdate: entry.isPlanStepUpdate,
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
		content: string | HistoryEntryPart[], // Modified parameter type
		diffContent?: string,
		relevantFiles?: string[],
		isRelevantFilesExpanded?: boolean,
		isPlanExplanation: boolean = false,
		isPlanStepUpdate: boolean = false
	): void {
		let parts: HistoryEntryPart[];
		let contentForDuplicateCheck: string;

		if (typeof content === "string") {
			parts = [{ text: content }];
			contentForDuplicateCheck = content;
		} else {
			parts = content;
			// For duplicate check, try to get the first text part.
			// If it's a user message, it's expected to have a text part first.
			contentForDuplicateCheck =
				parts.length > 0 && "text" in parts[0] ? parts[0].text : "";
		}

		// Existing logic for managing chat history and preventing duplicates
		if (this._chatHistory.length > 0) {
			const lastEntry = this._chatHistory[this._chatHistory.length - 1];
			// Updated duplicate check to use contentForDuplicateCheck
			if (
				lastEntry.role === role &&
				lastEntry.parts.length > 0 &&
				"text" in lastEntry.parts[0] &&
				lastEntry.parts[0].text === contentForDuplicateCheck
			) {
				// Prevent adding duplicate messages for certain types of status updates
				if (
					contentForDuplicateCheck.startsWith("Changes reverted") ||
					(contentForDuplicateCheck ===
						"Plan execution finished successfully." &&
						("text" in lastEntry.parts[0]
							? lastEntry.parts[0].text
							: undefined) === contentForDuplicateCheck) || // Modified line
					(contentForDuplicateCheck === "Plan execution cancelled by user." &&
						("text" in lastEntry.parts[0]
							? lastEntry.parts[0].text
							: undefined) === contentForDuplicateCheck) || // Modified line
					(contentForDuplicateCheck === "Chat generation cancelled by user." &&
						("text" in lastEntry.parts[0]
							? lastEntry.parts[0].text
							: undefined) === contentForDuplicateCheck) || // Modified line
					(contentForDuplicateCheck ===
						"Commit message generation cancelled by user." &&
						("text" in lastEntry.parts[0]
							? lastEntry.parts[0].text
							: undefined) === contentForDuplicateCheck) || // Modified line
					(contentForDuplicateCheck ===
						"Structured plan generation cancelled by user." &&
						("text" in lastEntry.parts[0]
							? lastEntry.parts[0].text
							: undefined) === contentForDuplicateCheck) || // Modified line
					(contentForDuplicateCheck.startsWith("Step ") &&
						!contentForDuplicateCheck.includes("FAILED") &&
						!contentForDuplicateCheck.includes("SKIPPED"))
				) {
					console.log(
						"Skipping potential duplicate history entry:",
						contentForDuplicateCheck
					);
					return;
				}
			}
		}

		const newEntry: HistoryEntry = {
			role,
			parts: parts, // Use the determined parts array
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
			isPlanExplanation: isPlanExplanation,
			isPlanStepUpdate: isPlanStepUpdate,
		};

		this._chatHistory.push(newEntry);
		if (this._chatHistory.length > MAX_HISTORY_ITEMS) {
			this._chatHistory.splice(0, this._chatHistory.length - MAX_HISTORY_ITEMS);
		}
		this.saveHistoryToStorage();
	}

	public async clearChat(): Promise<void> {
		this._chatHistory = [];
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
		// Ensure parts[0] exists and is a text part before attempting to update.
		if (messageToEdit.parts.length > 0 && "text" in messageToEdit.parts[0]) {
			messageToEdit.parts[0].text = newContent;
		} else {
			// If there's no text part or parts array is empty, replace it with a new text part.
			messageToEdit.parts = [{ text: newContent }];
		}

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
					(entry) => {
						// For saving, we only extract text content as ChatMessage on disk doesn't support images currently.
						const textContent = entry.parts
							.filter((p): p is { text: string } => "text" in p)
							.map((p) => p.text)
							.join("\n");
						return {
							sender: entry.role === "user" ? "User" : "Model",
							text: textContent,
							className: entry.role === "user" ? "user-message" : "ai-message",
							...(entry.diffContent && { diffContent: entry.diffContent }),
							...(entry.relevantFiles && {
								relevantFiles: entry.relevantFiles,
							}),
							...(entry.isPlanExplanation && {
								isPlanExplanation: entry.isPlanExplanation,
							}),
							...(entry.isPlanStepUpdate && {
								isPlanStepUpdate: entry.isPlanStepUpdate,
							}),
						};
					}
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
							typeof item.text === "string" && // ChatMessage only has 'text', not 'parts'
							(item.sender === "User" ||
								item.sender === "Model" ||
								item.sender === "System") &&
							(item.diffContent === undefined ||
								typeof item.diffContent === "string") &&
							(item.relevantFiles === undefined ||
								(Array.isArray(item.relevantFiles) &&
									item.relevantFiles.every((f) => typeof f === "string"))) &&
							(item.isPlanExplanation === undefined ||
								typeof item.isPlanExplanation === "boolean") &&
							(item.isPlanStepUpdate === undefined ||
								typeof item.isPlanStepUpdate === "boolean")
					)
				) {
					this._chatHistory = loadedData.map(
						(item: ChatMessage): HistoryEntry => ({
							role: item.sender === "User" ? "user" : "model",
							parts: [{ text: item.text }], // Convert ChatMessage.text back to a single HistoryEntryPart
							diffContent: item.diffContent,
							relevantFiles: item.relevantFiles,
							isRelevantFilesExpanded: item.relevantFiles
								? item.relevantFiles.length <= 3
									? true
									: false
								: undefined,
							isPlanExplanation: item.isPlanExplanation,
							isPlanStepUpdate: item.isPlanStepUpdate,
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
		const historyForWebview: (ChatMessage & {
			imageParts?: ImageInlineData[];
		})[] = this._chatHistory.map((entry) => {
			let concatenatedText = "";
			const currentImageParts: ImageInlineData[] = [];

			entry.parts.forEach((part) => {
				if ("text" in part) {
					concatenatedText += part.text;
				} else if ("inlineData" in part) {
					currentImageParts.push(part.inlineData);
				}
			});

			const baseChatMessage: ChatMessage & { imageParts?: ImageInlineData[] } =
				{
					sender: entry.role === "user" ? "User" : "Model",
					text: concatenatedText.trim(), // Use the accumulated text
					className: entry.role === "user" ? "user-message" : "ai-message",
					...(entry.diffContent && { diffContent: entry.diffContent }),
					...(entry.relevantFiles && { relevantFiles: entry.relevantFiles }),
					...(entry.relevantFiles &&
						entry.isRelevantFilesExpanded !== undefined && {
							isRelevantFilesExpanded: entry.isRelevantFilesExpanded,
						}),
					isPlanExplanation: entry.isPlanExplanation,
					isPlanStepUpdate: entry.isPlanStepUpdate,
				};

			// Conditionally add imageParts if there are any
			if (currentImageParts.length > 0) {
				// The ChatMessage type (locally extended) now includes imageParts
				baseChatMessage.imageParts = currentImageParts;
			}
			return baseChatMessage;
		});
		this.postMessageToWebview({
			type: "restoreHistory",
			value: historyForWebview,
		});
	}
}

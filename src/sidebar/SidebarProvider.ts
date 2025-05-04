// src/sidebar/SidebarProvider.ts

import * as vscode from "vscode";
import { getNonce } from "../utilities/nonce";
import { generateContent, resetClient } from "../ai/gemini";
import { scanWorkspace } from "../context/workspaceScanner";
import { buildContextString } from "../context/contextBuilder";
import {
	ExecutionPlan,
	PlanStep,
	PlanStepAction,
	isCreateDirectoryStep,
	isCreateFileStep,
	isModifyFileStep,
	isRunCommandStep,
	parseAndValidatePlan,
} from "../ai/workflowPlanner";

// Secret storage keys
const GEMINI_API_KEYS_LIST_SECRET_KEY = "geminiApiKeysList";
const GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY = "geminiActiveApiKeyIndex";

// Workspace state keys for persistent settings
const MODEL_SELECTION_STORAGE_KEY = "geminiSelectedModel";

// --- Available Models ---
// Define the models that will be available for selection.
// Ensure these models are actually accessible via the Gemini API with your key.
const AVAILABLE_GEMINI_MODELS = [
	"gemini-2.5-pro-preview-03-25",
	"gemini-2.5-pro-exp-03-25",
	"gemini-2.5-flash-preview-04-17",
];

// Default model to use if no selection is stored or the stored model is invalid
const DEFAULT_MODEL = AVAILABLE_GEMINI_MODELS[0];

// Workspace state key for welcome page tracking (session-based)
const WELCOME_PAGE_SHOWN_SESSION_KEY = "minovativeMindWelcomeShownSession";

// Type for the data sent to the webview regarding keys
interface ApiKeyInfo {
	maskedKey: string;
	index: number;
	isActive: boolean;
}
interface KeyUpdateData {
	keys: ApiKeyInfo[];
	activeIndex: number;
	totalKeys: number;
}

// Define the structure for saving/loading chat history
interface ChatMessage {
	sender: "User" | "Model" | "System";
	text: string;
	className: string;
}

// Structure matching Google's Content type for internal use
interface HistoryEntry {
	role: "user" | "model";
	parts: { text: string }[];
}

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "minovativeMindSidebarView";

	private _view?: vscode.WebviewView;
	private readonly _extensionUri: vscode.Uri;
	private readonly _secretStorage: vscode.SecretStorage;
	private readonly _workspaceState: vscode.Memento; // Correct type for state storage
	private _apiKeyList: string[] = [];
	private _activeKeyIndex: number = -1;
	private _selectedModelName: string = DEFAULT_MODEL; // Store the selected model name
	private _chatHistory: HistoryEntry[] = [];
	private _currentPlan: ExecutionPlan | null = null;

	constructor(
		private readonly _extensionUri_in: vscode.Uri,
		context: vscode.ExtensionContext // Keep the context here
	) {
		this._extensionUri = _extensionUri_in;
		this._secretStorage = context.secrets;
		this._workspaceState = context.workspaceState; // Assign workspaceState

		// --- Reset welcome page flag on activation for session tracking ---
		// We do this here to ensure it resets *every time* VS Code activates the extension,
		// effectively making it session-based for the workspace.
		this._workspaceState.update(WELCOME_PAGE_SHOWN_SESSION_KEY, false);
		console.log("Welcome page session flag reset.");

		// Keep the onDidChange listener for secrets
		context.secrets.onDidChange((e) => {
			if (
				e.key === GEMINI_API_KEYS_LIST_SECRET_KEY ||
				e.key === GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
			) {
				console.log(`Secret key changed: ${e.key}. Reloading keys.`);
				this._loadKeysFromStorage().catch((err) => {
					console.error("Error reloading keys on secret change:", err);
				});
			}
		});
	}

	/**
	 * Asynchronously initializes the provider by loading keys and settings from storage.
	 * Should be called after construction and awaited in extension.ts.
	 */
	public async initialize(): Promise<void> {
		console.log("SidebarProvider initializing: Loading keys and settings...");
		await this._loadKeysFromStorage();
		this._loadSettingsFromStorage(); // Load model selection
		console.log("SidebarProvider initialization complete.");
	}

	// --- Key Management Logic (Keep existing, ensure _updateWebviewKeyList is called) ---

	private async _loadKeysFromStorage() {
		try {
			const keysJson = await this._secretStorage.get(
				GEMINI_API_KEYS_LIST_SECRET_KEY
			);
			this._apiKeyList = keysJson ? JSON.parse(keysJson) : [];

			const activeIndexStr = await this._secretStorage.get(
				GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
			);
			let potentialIndex = activeIndexStr ? parseInt(activeIndexStr, 10) : -1;

			// Validate and correct the index
			if (potentialIndex < 0 || potentialIndex >= this._apiKeyList.length) {
				potentialIndex = this._apiKeyList.length > 0 ? 0 : -1;
				// Only update storage if the correction is different from the stored value (or if list is empty and stored is not -1)
				const storedIndex = activeIndexStr ? parseInt(activeIndexStr, 10) : -2; // Use -2 to differentiate
				if (potentialIndex !== storedIndex) {
					if (potentialIndex !== -1) {
						await this._secretStorage.store(
							GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
							String(potentialIndex)
						);
						console.log(`Corrected active key index to ${potentialIndex}`);
					} else {
						// If list is empty, ensure stored index is deleted
						await this._secretStorage.delete(
							GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
						);
						console.log(
							`Cleared active index from storage as key list is empty.`
						);
					}
				}
			}
			this._activeKeyIndex = potentialIndex;

			console.log(
				`Loaded ${this._apiKeyList.length} keys. Active index: ${this._activeKeyIndex}`
			);
			resetClient(); // Reset AI client so it picks up potentially new key/model on next use
			this._updateWebviewKeyList(); // Update webview with the loaded keys
		} catch (error) {
			console.error("Error loading API keys from storage:", error);
			this._apiKeyList = [];
			this._activeKeyIndex = -1;
			vscode.window.showErrorMessage("Failed to load API keys.");
			this._updateWebviewKeyList(); // Ensure webview is updated even on error
		}
	}

	private async _saveKeysToStorage() {
		let saveError: any = null;
		try {
			await this._secretStorage.store(
				GEMINI_API_KEYS_LIST_SECRET_KEY,
				JSON.stringify(this._apiKeyList)
			);
			if (this._activeKeyIndex !== -1) {
				await this._secretStorage.store(
					GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
					String(this._activeKeyIndex)
				);
			} else {
				await this._secretStorage.delete(
					GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
				);
			}

			console.log(
				`Saved ${this._apiKeyList.length} keys. Active index: ${this._activeKeyIndex}`
			);
			resetClient(); // Reset AI client state
		} catch (error) {
			saveError = error;
			console.error("Error saving API keys to storage:", error);
		}
		this._updateWebviewKeyList(); // Always update webview
		if (saveError) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Error: Failed to save key changes.",
				isError: true, // Indicate error visually
			});
		}
	}

	// ... _addApiKey, _deleteActiveApiKey, _switchToNextApiKey, _switchToPreviousApiKey ...
	// (Keep these methods, they should call _saveKeysToStorage at the end)

	private async _addApiKey(key: string) {
		if (this._apiKeyList.includes(key)) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: `Info: Key ...${key.slice(-4)} is already stored.`,
			});
			return;
		}

		this._apiKeyList.push(key);
		this._activeKeyIndex = this._apiKeyList.length - 1; // Make new key active
		await this._saveKeysToStorage(); // This calls resetClient and _updateWebviewKeyList
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ending in ...${key.slice(-4)} added and set as active.`,
		});
	}

	private async _deleteActiveApiKey() {
		console.log(
			`[Minovative Mind] Attempting delete. Current active index: ${this._activeKeyIndex}, Key list length: ${this._apiKeyList.length}`
		);

		if (
			this._activeKeyIndex === -1 ||
			this._activeKeyIndex >= this._apiKeyList.length
		) {
			console.log(
				"[Minovative Mind] Delete blocked: Invalid active key index."
			);
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value:
					this._apiKeyList.length === 0
						? "Error: Cannot delete, key list is empty."
						: "Error: No active key selected to delete.",
				isError: true,
			});
			return;
		}

		const keyToDelete = this._apiKeyList[this._activeKeyIndex]; // Get key BEFORE splicing
		console.log(
			`[Minovative Mind] Proceeding to delete key at index ${
				this._activeKeyIndex
			}: ...${keyToDelete.slice(-4)}`
		);

		this._apiKeyList.splice(this._activeKeyIndex, 1);

		const oldIndex = this._activeKeyIndex;
		if (this._apiKeyList.length === 0) {
			this._activeKeyIndex = -1;
		} else if (this._activeKeyIndex >= this._apiKeyList.length) {
			this._activeKeyIndex = this._apiKeyList.length - 1;
		}
		// If we deleted the *last* item, activeIndex becomes -1 correctly
		// If we deleted item 0 and there are others, activeIndex stays 0 (correct)
		// If we deleted item N (not the last), and there are items after, activeIndex stays N
		// If we deleted item N (the last), activeIndex becomes length-1 (correct)

		console.log(
			`[Minovative Mind] Key deleted. Old index: ${oldIndex}, New active index: ${this._activeKeyIndex}`
		);

		await this._saveKeysToStorage(); // This calls resetClient and _updateWebviewKeyList

		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ...${keyToDelete.slice(-4)} deleted.`,
		});
	}

	private async _switchToNextApiKey() {
		if (this._apiKeyList.length <= 1 || this._activeKeyIndex === -1) {
			// No need to switch if 0 or 1 key, or no active key
			return;
		}
		this._activeKeyIndex = (this._activeKeyIndex + 1) % this._apiKeyList.length;
		await this._saveKeysToStorage(); // This calls resetClient and _updateWebviewKeyList
		const newKey = this._apiKeyList[this._activeKeyIndex];
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Switched to key ...${newKey.slice(-4)}.`,
		});
	}

	private async _switchToPreviousApiKey() {
		if (this._apiKeyList.length <= 1 || this._activeKeyIndex === -1) {
			// No need to switch if 0 or 1 key, or no active key
			return;
		}
		this._activeKeyIndex =
			(this._activeKeyIndex - 1 + this._apiKeyList.length) %
			this._apiKeyList.length;
		await this._saveKeysToStorage(); // This calls resetClient and _updateWebviewKeyList
		const newKey = this._apiKeyList[this._activeKeyIndex];
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Switched to key ...${newKey.slice(-4)}.`,
		});
	}

	private _updateWebviewKeyList() {
		const keyInfos: ApiKeyInfo[] = this._apiKeyList.map((key, index) => ({
			maskedKey: `Key ...${key.slice(-4)} (${index + 1}/${
				this._apiKeyList.length
			})`,
			index: index, // This index is the list index, useful for lookup if needed
			isActive: index === this._activeKeyIndex,
		}));

		const updateData: KeyUpdateData = {
			keys: keyInfos,
			activeIndex: this._activeKeyIndex, // Send the actual index
			totalKeys: this._apiKeyList.length,
		};
		this.postMessageToWebview({ type: "updateKeyList", value: updateData });
	}

	public getActiveApiKey(): string | undefined {
		if (
			this._activeKeyIndex >= 0 &&
			this._activeKeyIndex < this._apiKeyList.length
		) {
			return this._apiKeyList[this._activeKeyIndex];
		}
		return undefined;
	}

	// --- Model Selection Logic ---

	private _loadSettingsFromStorage() {
		try {
			const savedModel = this._workspaceState.get<string>(
				MODEL_SELECTION_STORAGE_KEY
			);
			if (savedModel && AVAILABLE_GEMINI_MODELS.includes(savedModel)) {
				this._selectedModelName = savedModel;
				console.log("Loaded selected model:", this._selectedModelName);
			} else {
				this._selectedModelName = DEFAULT_MODEL;
				console.log(
					"No saved model or invalid model found. Using default:",
					DEFAULT_MODEL
				);
			}
		} catch (error) {
			console.error("Error loading settings from storage:", error);
			this._selectedModelName = DEFAULT_MODEL;
			vscode.window.showErrorMessage("Failed to load extension settings.");
		}
	}

	private async _saveSettingsToStorage() {
		try {
			await this._workspaceState.update(
				MODEL_SELECTION_STORAGE_KEY,
				this._selectedModelName
			);
			console.log("Saved selected model:", this._selectedModelName);
			resetClient(); // Reset AI client state so it picks up the new model
		} catch (error) {
			console.error("Error saving settings to storage:", error);
			vscode.window.showErrorMessage("Failed to save extension settings.");
		}
		this._updateWebviewModelList(); // Ensure webview is updated
	}

	private async _handleModelSelection(modelName: string) {
		if (AVAILABLE_GEMINI_MODELS.includes(modelName)) {
			this._selectedModelName = modelName;
			await this._saveSettingsToStorage(); // This calls resetClient and _updateWebviewModelList
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Switched to AI model: ${modelName}.`,
			});
		} else {
			console.warn("Attempted to select an invalid model:", modelName);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Error: Invalid model selected: ${modelName}.`,
				isError: true,
			});
			// Revert webview selection if possible
			this._updateWebviewModelList();
		}
	}

	private _updateWebviewModelList() {
		if (this._view) {
			this.postMessageToWebview({
				type: "updateModelList",
				value: {
					availableModels: AVAILABLE_GEMINI_MODELS,
					selectedModel: this._selectedModelName,
				},
			});
		}
	}

	public getSelectedModelName(): string {
		return this._selectedModelName;
	}

	// --- Chat History & Actions (Keep existing) ---

	private _addHistoryEntry(role: "user" | "model", text: string) {
		this._chatHistory.push({ role, parts: [{ text }] });
		const MAX_HISTORY_ITEMS = 50;
		if (this._chatHistory.length > MAX_HISTORY_ITEMS) {
			this._chatHistory.shift(); // Remove the oldest entry
		}
	}

	private async _clearChat() {
		this._chatHistory = [];
		this.postMessageToWebview({ type: "chatCleared" });
		this.postMessageToWebview({
			type: "statusUpdate",
			value: "Chat cleared.",
		});
		this.postMessageToWebview({ type: "reenableInput" });
	}

	private async _saveChat() {
		const options: vscode.SaveDialogOptions = {
			saveLabel: "Save Chat History",
			filters: {
				"JSON Files": ["json"],
				"Text Files": ["txt"], // Added txt as a simpler fallback
			},
			defaultUri: vscode.workspace.workspaceFolders
				? vscode.Uri.joinPath(
						vscode.workspace.workspaceFolders[0].uri,
						`minovative-mind-chat-${
							new Date().toISOString().split("T")[0]
						}.json` // Default to .json
				  )
				: undefined,
		};

		const fileUri = await vscode.window.showSaveDialog(options);
		if (fileUri) {
			try {
				const saveableHistory: ChatMessage[] = this._chatHistory.map(
					(entry) => ({
						sender: entry.role === "user" ? "User" : "Model",
						text: entry.parts[0].text,
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
				vscode.window.showErrorMessage(
					`Failed to save chat: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
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

	private async _loadChat() {
		const options: vscode.OpenDialogOptions = {
			canSelectMany: false,
			openLabel: "Load Chat History",
			filters: {
				"Chat History Files": ["json", "txt"], // Allow json and txt
				"All Files": ["*"],
			},
		};

		const fileUris = await vscode.window.showOpenDialog(options);
		if (fileUris && fileUris.length > 0) {
			const fileUri = fileUris[0];
			try {
				const contentBytes = await vscode.workspace.fs.readFile(fileUri);
				const contentString = Buffer.from(contentBytes).toString("utf-8");
				let loadedData: any;

				// Attempt to parse as JSON first
				try {
					loadedData = JSON.parse(contentString);
				} catch (jsonError) {
					// If JSON fails, treat as plain text history (simple format)
					console.warn(
						"Failed to parse chat as JSON, treating as plain text:",
						jsonError
					);
					// Basic plain text parsing: odd lines User, even lines Model
					const lines = contentString.split(/\r?\n/);
					loadedData = [];
					let currentSender: "User" | "Model" = "User";
					for (const line of lines) {
						if (line.trim()) {
							loadedData.push({
								sender: currentSender,
								text: line,
								className:
									currentSender === "User" ? "user-message" : "ai-message",
							});
							currentSender = currentSender === "User" ? "Model" : "User"; // Alternate sender
						}
					}
					// Simple plain text loads won't have roles for AI processing, just for display
				}

				if (
					Array.isArray(loadedData) &&
					loadedData.every(
						(item) =>
							item &&
							typeof item.sender === "string" &&
							typeof item.text === "string" &&
							(item.sender === "User" ||
								item.sender === "Model" || // 'Model' is the standard role
								item.sender === "Gemini" || // Handle older saved formats
								item.sender === "System")
					)
				) {
					this._chatHistory = []; // Clear current history
					this._chatHistory = loadedData.map(
						(item: ChatMessage): HistoryEntry => ({
							role: item.sender === "User" ? "user" : "model", // Convert to API role
							parts: [{ text: item.text }],
						})
					);

					this.postMessageToWebview({
						type: "restoreHistory",
						value: loadedData, // Send original loaded data structure to webview
					});
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Chat loaded successfully.",
					});
				} else {
					throw new Error("Invalid chat history file format.");
				}
			} catch (error) {
				console.error("Error loading chat:", error);
				vscode.window.showErrorMessage(
					`Failed to load chat: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
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

	// --- VS Code Provider Methods ---

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, "dist"),
				vscode.Uri.joinPath(this._extensionUri, "media"),
				vscode.Uri.joinPath(this._extensionUri, "src", "sidebar", "webview"),
				vscode.Uri.joinPath(this._extensionUri, "src", "resources"),
			],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// --- Trigger Welcome Page Logic ---
		const welcomeShown = this._workspaceState.get<boolean>(
			WELCOME_PAGE_SHOWN_SESSION_KEY
		);

		if (!welcomeShown) {
			console.log(
				"First time sidebar viewed this session. Triggering welcome page."
			);
			// Use executeCommand to avoid race conditions if the command isn't registered yet
			vscode.commands.executeCommand("minovative-mind.showWelcomePage").then(
				() => {
					// Set the flag *after* successfully triggering the command
					this._workspaceState.update(WELCOME_PAGE_SHOWN_SESSION_KEY, true);
					console.log("Welcome page shown flag set for this session.");
				},
				(err) => {
					console.error("Failed to execute showWelcomePage command:", err);
					// Optionally, don't set the flag if the command fails, so it tries again next time
				}
			);
		} else {
			console.log("Welcome page already shown this session.");
		}
		// --- End Trigger Welcome Page Logic ---

		webviewView.webview.onDidReceiveMessage(async (data) => {
			console.log(`[Provider] Message received: ${data.type}`);

			switch (data.type) {
				// --- Plan Execution Handling ---
				case "planRequest": {
					const userRequest = data.value;
					const activeKey = this.getActiveApiKey();
					const selectedModel = this.getSelectedModelName(); // Get selected model

					if (!activeKey) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: No active API Key set.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					if (!selectedModel) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: No AI model selected.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					this._addHistoryEntry("user", `@plan ${userRequest}`);
					await this._handlePlanRequest(userRequest, activeKey, selectedModel); // Pass model
					break;
				}
				case "confirmPlanExecution": {
					const planToExecute = data.value as ExecutionPlan | null;
					const currentActiveKey = this.getActiveApiKey();
					const selectedModel = this.getSelectedModelName(); // Get selected model

					if (!currentActiveKey) {
						this.postMessageToWebview({
							type: "statusUpdate",
							value: "Error: Cannot execute plan - no active API key.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					if (!selectedModel) {
						this.postMessageToWebview({
							type: "statusUpdate",
							value: "Error: Cannot execute plan - no AI model selected.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					if (planToExecute) {
						await this._executePlan(
							planToExecute,
							currentActiveKey,
							selectedModel
						); // Pass model
					} else {
						console.error(
							"Received confirmPlanExecution but plan data was missing."
						);
						this.postMessageToWebview({
							type: "statusUpdate",
							value:
								"Error: Failed to confirm plan execution - missing plan data.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
					}
					break;
				}
				case "cancelPlanExecution": {
					this._currentPlan = null;
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Plan execution cancelled.",
					});
					this._addHistoryEntry("model", "Plan execution cancelled by user.");
					this.postMessageToWebview({ type: "reenableInput" });
					break;
				}

				// --- Regular Chat Handling ---
				case "chatMessage": {
					const userMessage = data.value;
					const activeKey = this.getActiveApiKey();
					const selectedModel = this.getSelectedModelName(); // Get selected model

					if (!activeKey) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: No active API Key set.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						return;
					}
					if (!selectedModel) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: No AI model selected.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						return;
					}
					this._addHistoryEntry("user", userMessage);
					await this._handleRegularChat(userMessage, activeKey, selectedModel); // Pass model
					break;
				}

				// --- Key Management & Other Actions ---
				case "addApiKey":
					if (typeof data.value === "string") {
						await this._addApiKey(data.value.trim());
					}
					break;
				case "requestDeleteConfirmation":
					await this._requestDeleteConfirmation();
					break;
				case "switchToNextKey":
					await this._switchToNextApiKey();
					break;
				case "switchToPrevKey":
					await this._switchToPreviousApiKey();
					break;
				case "clearChatRequest":
					await this._clearChat();
					break;
				case "saveChatRequest":
					await this._saveChat();
					break;
				case "loadChatRequest":
					await this._loadChat();
					break;

				// --- Model Selection Handling ---
				case "selectModel":
					if (typeof data.value === "string") {
						await this._handleModelSelection(data.value);
					}
					break;

				case "webviewReady":
					console.log("[Provider] Webview ready. Updating UI.");
					this._updateWebviewKeyList(); // Send key list
					this._updateWebviewModelList(); // Send model list
					this._restoreChatHistoryToWebview(); // Restore chat history
					// Re-enable input if possible after initial load
					this.postMessageToWebview({ type: "reenableInput" });
					break;
				case "reenableInput":
					console.log("Webview reported input re-enabled (acknowledged).");
					break;
				default:
					console.warn(`Unknown message type received: ${data.type}`);
			}
		});
	}

	private _restoreChatHistoryToWebview() {
		const historyForWebview: ChatMessage[] = this._chatHistory.map((entry) => ({
			sender: entry.role === "user" ? "User" : "Model",
			text: entry.parts[0].text,
			className: entry.role === "user" ? "user-message" : "ai-message",
		}));
		this.postMessageToWebview({
			type: "restoreHistory",
			value: historyForWebview,
		});
	}

	private async _requestDeleteConfirmation() {
		const keyToDeleteIndex = this._activeKeyIndex;
		let keyIdentifier = "the active key";
		if (keyToDeleteIndex >= 0 && keyToDeleteIndex < this._apiKeyList.length) {
			keyIdentifier = `key ...${this._apiKeyList[keyToDeleteIndex].slice(-4)}`;
		} else {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Error: No active key selected to delete.",
				isError: true,
			});
			return;
		}

		const confirmation = await vscode.window.showWarningMessage(
			`Are you sure you want to delete ${keyIdentifier}? This cannot be undone.`, // Added stronger warning
			{ modal: true },
			"Delete Key"
		);

		if (confirmation === "Delete Key") {
			// Re-check if the index is still valid and matches what we intended to delete
			if (
				this._activeKeyIndex === keyToDeleteIndex &&
				keyToDeleteIndex < this._apiKeyList.length
			) {
				await this._deleteActiveApiKey();
			} else {
				// This could happen if the key list changed while the confirmation was pending
				console.warn(
					"Active key index changed during delete confirmation. Aborting delete."
				);
				this.postMessageToWebview({
					type: "apiKeyStatus",
					value: "Info: Key list changed, deletion aborted.",
					isError: false,
				});
			}
		} else {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Key deletion cancelled.",
				isError: false,
			});
		}
	}

	// --- Planning Workflow Logic ---

	private _createPlanningPrompt(
		userRequest: string,
		projectContext: string
	): string {
		const jsonFormatDescription = `
		{
			"planDescription": "Brief summary of the overall goal.",
			"steps": [
				{
					"step": 1,
					"action": "create_directory | create_file | modify_file | run_command",
					"description": "What this step does.",
					// --- Properties depend on action ---
					"path": "relative/path/to/target", // For file/dir actions
					"content": "...", // For simple create_file
					"generate_prompt": "...", // For complex create_file (AI generates content based on this prompt)
					"modification_prompt": "...", // For modify_file (AI modifies file based on this prompt)
					"command": "full command line string" // For run_command
				},
				// ... more steps
			]
		}`;

		return `
You are an expert AI programmer assisting within VS Code. Your task is to create a step-by-step execution plan in JSON format to fulfill the user's request, considering the provided project context.

**Goal:** Generate ONLY a valid JSON object representing the plan. Do NOT include any introductory text, explanations, apologies, or markdown formatting like \`\`\`json ... \`\`\` around the JSON output. The entire response must be the JSON plan itself.

**Instructions for Plan Generation:**
1.  Analyze Request: Understand the user's high-level request: "${userRequest}".
2.  Analyze Context: Use the project context (file structure, existing code, detected package manager via lock files if present) to determine necessary actions. Identify correct relative paths.
3.  Break Down: Decompose the request into logical, sequential steps. Number steps starting from 1.
4.  Specify Actions: For each step, define the 'action'.
5.  Detail Properties:
    *   For **create_directory**: Provide 'path' and 'description'. The path must be relative to the workspace root.
    *   For **create_file**: Provide 'path', 'description', and EITHER 'content' (for simple files <10 lines) OR a specific 'generate_prompt' (for complex content). The path must be relative.
    *   For **modify_file**: Provide 'path', 'description', and a detailed 'modification_prompt'. The path must be relative. The AI receiving the modification_prompt will be given the file's full content and this prompt, and asked to return the complete modified file content.
    *   For **run_command**: Provide 'description' and the exact shell 'command' to run (e.g., "npm install @fortawesome/fontawesome-svg-core --save", "yarn add react-router-dom", "pnpm install --save-dev eslint"). **IMPORTANT:** Use this action for installing/adding dependencies *instead* of modifying package.json directly for dependencies. Base the command (npm/yarn/pnpm) on the project's likely package manager (check for lock files mentioned in context, e.g., package-lock.json -> npm, yarn.lock -> yarn, pnpm-lock.yaml -> pnpm). Determine if it's a dev dependency (--save-dev / -D) or regular dependency. Place this step *after* any steps that might require the dependency. Ensure commands are safe and standard. Do not include prompts for confirmation within the command itself.
6.  JSON Output: Format the plan strictly according to the JSON structure below. Ensure correct step numbering and only include relevant properties for each action type. Validate paths are relative and do not contain '..'.

*** Project Context (Reference Only) ***
${projectContext}
*** End Project Context ***

--- User Request ---
${userRequest}
--- End User Request ---

--- Expected JSON Plan Format ---
${jsonFormatDescription}
--- End Expected JSON Plan Format ---

Execution Plan (JSON only):
`;
	}

	private async _handlePlanRequest(
		userRequest: string,
		apiKey: string,
		modelName: string // <-- Added modelName
	): Promise<void> {
		this.postMessageToWebview({
			type: "aiResponse",
			value: `Minovative Mind (${modelName}) is generating an execution plan...`,
			isLoading: true,
		});
		this._currentPlan = null;

		const projectContext = await this._buildProjectContext();
		if (projectContext.startsWith("[Error")) {
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error generating plan: Failed to build project context. ${projectContext}`,
				isLoading: false,
				isError: true,
			});
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}

		const planningPrompt = this._createPlanningPrompt(
			userRequest,
			projectContext
		);

		let planJsonString = "";
		try {
			planJsonString = await generateContent(apiKey, modelName, planningPrompt); // Pass modelName
			planJsonString = planJsonString
				.replace(/^```json\n?/, "")
				.replace(/^```\n?/, "") // Handle ``` without language specifier
				.replace(/\n?```$/, "")
				.trim();

			if (
				!planJsonString.startsWith("{") ||
				!planJsonString.endsWith("}") ||
				planJsonString.length < 10 // Basic check for empty/malformed response
			) {
				console.error("AI response doesn't look like JSON:", planJsonString);
				throw new Error(
					"AI did not return a valid JSON plan.\nRaw Response:\n" +
						planJsonString.substring(0, 500) +
						(planJsonString.length > 500 ? "..." : "")
				);
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error generating plan: ${errorMsg}`,
				isLoading: false,
				isError: true,
			});
			this._addHistoryEntry("model", `Error generating plan: ${errorMsg}`);
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}

		const plan: ExecutionPlan | null = parseAndValidatePlan(planJsonString);

		if (!plan) {
			const errorDetail =
				"Failed to parse or validate the execution plan JSON received from the AI.";
			console.error(errorDetail, "Raw:", planJsonString);
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error: ${errorDetail}`,
				isLoading: false,
				isError: true,
			});
			this._addHistoryEntry(
				"model",
				`Error: Failed to parse/validate plan.\nRaw Response:\n\`\`\`json\n${planJsonString}\n\`\`\``
			);
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}

		this._currentPlan = plan;
		// Consider adding the plan description to history, maybe not the full JSON
		this._addHistoryEntry(
			"model",
			`Plan Generated:\n*${
				plan.planDescription || "No description."
			}*\n\nTo execute this plan, confirm below.`
		);

		let planDisplayText = `**Execution Plan Proposed:**\n*${
			plan.planDescription || "No description."
		}*\n\n`;
		if (plan.steps && plan.steps.length > 0) {
			plan.steps.forEach((step: PlanStep, index: number) => {
				planDisplayText += `**Step ${index + 1}: ${
					step.action ? step.action.replace(/_/g, " ") : "Unknown Action"
				}**\n`;
				planDisplayText += `   - ${step.description || "No description."}\n`;
				if (step.path) {
					planDisplayText += `   - Path: \`${step.path}\`\n`;
				}
				if (isCreateFileStep(step)) {
					if (step.content !== undefined) {
						planDisplayText += `   - Content: Provided (short)\n`;
					} else if (step.generate_prompt) {
						planDisplayText += `   - To Generate: "${step.generate_prompt.substring(
							0,
							80
						)}..."\n`; // Quote and truncate
					}
				} else if (isModifyFileStep(step)) {
					planDisplayText += `   - To Modify: "${step.modification_prompt.substring(
						0,
						80
					)}..."\n`; // Quote and truncate
				} else if (isRunCommandStep(step)) {
					planDisplayText += `   - Command: \`${step.command}\`\n`;
				}
				planDisplayText += "\n"; // Add space between steps
			});
		} else {
			planDisplayText += "The AI did not generate any steps for this plan.\n\n";
		}

		// Post the plan text for display in the chat and the confirmation prompt
		this.postMessageToWebview({
			type: "aiResponse",
			value: planDisplayText, // Send the formatted text for display
			isLoading: false,
			requiresConfirmation: true,
			planData: plan, // Send the structured plan data for execution
		});
	}

	private async _handleRegularChat(
		userMessage: string,
		apiKey: string,
		modelName: string // <-- Added modelName
	): Promise<void> {
		this.postMessageToWebview({
			type: "aiResponse",
			value: `Minovative Mind (${modelName}) is thinking...`,
			isLoading: true,
		});
		this._currentPlan = null; // Clear any pending plan

		const projectContext = await this._buildProjectContext();
		if (projectContext.startsWith("[Error")) {
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error processing message: Failed to build project context. ${projectContext}`,
				isLoading: false,
				isError: true,
			});
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}

		const historyForApi = [...this._chatHistory];
		// Ensure the last user message in history matches the one being sent now
		if (
			historyForApi.length > 0 &&
			historyForApi[historyForApi.length - 1].role === "user"
		) {
			const lastUserMsg = historyForApi[historyForApi.length - 1].parts
				.map((p) => p.text)
				.join("");
			if (lastUserMsg !== userMessage) {
				console.warn(
					"Last history entry doesn't match current user message. Appending new user message to history for API."
				);
				// If it doesn't match (e.g., history was cleared or edited manually), add the current message
				historyForApi.push({ role: "user", parts: [{ text: userMessage }] });
			}
			// If it matches, the user message is already in historyForApi
		} else {
			// If history is empty or last message isn't user, add the current user message
			historyForApi.push({ role: "user", parts: [{ text: userMessage }] });
		}

		const finalPrompt = `
You are an AI assistant called Minovative Mind integrated into VS Code. Below is some context about the user's current project. Use this context ONLY as background information to help answer the user's query accurately. Do NOT explicitly mention that you analyzed the context or summarize the project files unless the user specifically asks you to. Focus directly on answering the user's query. Use Markdown formatting for code blocks and lists where appropriate. Keep responses concise but informative.

*** Project Context (Reference Only) ***
${projectContext}
*** End Project Context ***

--- User Query ---
${userMessage}
--- End User Query ---

Assistant Response:
`;

		try {
			const aiResponseText = await generateContent(
				apiKey,
				modelName, // Pass modelName
				finalPrompt,
				historyForApi // Pass history
			);
			// Only add the model's response to history if it's not an error message from generateContent itself
			if (!aiResponseText.toLowerCase().startsWith("error:")) {
				this._addHistoryEntry("model", aiResponseText);
			}
			this.postMessageToWebview({
				type: "aiResponse",
				value: aiResponseText,
				isLoading: false,
				isError: aiResponseText.toLowerCase().startsWith("error:"),
			});
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error: ${errorMessage}`,
				isLoading: false,
				isError: true,
			});
			this._addHistoryEntry("model", `Error: ${errorMessage}`);
		}
		// Input re-enabled by webview based on isLoading=false
	}

	private async _buildProjectContext(): Promise<string> {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				const msg = "[No workspace open]";
				console.warn(msg);
				return msg;
			}
			const rootFolder = workspaceFolders[0];
			// Pass options to scanWorkspace if needed in the future (e.g. user settings)
			const relevantFiles = await scanWorkspace({ respectGitIgnore: true });
			if (relevantFiles.length > 0) {
				return await buildContextString(relevantFiles, rootFolder.uri);
			} else {
				const msg = "[No relevant files found in workspace]";
				console.warn(msg);
				return msg;
			}
		} catch (scanOrBuildError) {
			console.error(
				"Error during workspace scan or context build:",
				scanOrBuildError
			);
			// Don't show error message here, let the calling function decide
			return `[Error building project context: ${
				scanOrBuildError instanceof Error
					? scanOrBuildError.message
					: String(scanOrBuildError)
			}]`;
		}
	}

	// --- Plan Execution Logic (Keep existing, pass modelName to generateContent calls) ---
	private async _executePlan(
		plan: ExecutionPlan,
		apiKey: string,
		modelName: string // <-- Added modelName
	): Promise<void> {
		this.postMessageToWebview({
			type: "statusUpdate",
			value: `Starting execution: ${plan.planDescription}`,
		});
		this._addHistoryEntry("model", "Initiating plan execution...");
		this._currentPlan = null; // Clear pending plan

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Error: Cannot execute plan - no workspace folder open.",
				isError: true,
			});
			this._addHistoryEntry(
				"model",
				"Execution Failed: No workspace folder open."
			);
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}
		const rootUri = workspaceFolders[0].uri;
		let executionOk = true;

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Minovative Mind: Executing Plan - ${
					plan.planDescription || "No description"
				}`,
				cancellable: false,
			},
			async (progress) => {
				const totalSteps = plan.steps ? plan.steps.length : 0;
				if (totalSteps === 0) {
					progress.report({ message: "Plan has no steps.", increment: 100 });
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Plan has no steps. Execution finished.",
					});
					this._addHistoryEntry("model", "Plan execution finished (no steps).");
					executionOk = true;
					return;
				}

				for (const step of plan.steps!) {
					const stepMessageTitle = `Step ${step.step}/${totalSteps}: ${
						step.description || step.action.replace(/_/g, " ")
					}`;
					progress.report({
						message: `${stepMessageTitle}...`,
						increment: (1 / totalSteps) * 100,
					});
					const stepPath = step.path || "";
					const stepCommand = step.command || ""; // For logging RunCommand

					this.postMessageToWebview({
						type: "statusUpdate",
						value: `Executing ${stepMessageTitle} ${
							step.action === PlanStepAction.RunCommand
								? `- '${stepCommand}'`
								: stepPath
								? `- ${stepPath}`
								: ""
						}`,
					});

					try {
						switch (step.action) {
							case PlanStepAction.CreateDirectory:
								if (isCreateDirectoryStep(step)) {
									const dirUri = vscode.Uri.joinPath(rootUri, step.path);
									await vscode.workspace.fs.createDirectory(dirUri);
									console.log(`${step.action} OK: ${step.path}`);
									this._addHistoryEntry(
										"model",
										`Step ${step.step} OK: ${step.action.replace(
											/_/g,
											" "
										)} \`${step.path}\``
									);
								} else {
									throw new Error(`Invalid ${step.action} structure.`);
								}
								break;

							case PlanStepAction.CreateFile:
								if (isCreateFileStep(step)) {
									const fileUri = vscode.Uri.joinPath(rootUri, step.path);
									let contentToWrite = "";
									if (step.content !== undefined) {
										contentToWrite = step.content;
									} else if (step.generate_prompt) {
										this.postMessageToWebview({
											type: "statusUpdate",
											value: `Step ${step.step}/${totalSteps}: Generating content for ${step.path}...`,
										});
										const generationPrompt = `You are an AI programmer. Generate the complete raw file content for the following request.\nProvide ONLY the raw code or text for the file, without any explanations, comments about the code, or markdown formatting like backticks. The entire response must be the file content.\n\nFile Path: ${step.path}\nInstructions: ${step.generate_prompt}\n\nFile Content:`;
										contentToWrite = await generateContent(
											apiKey,
											modelName, // Pass modelName
											generationPrompt
										);
										if (contentToWrite.toLowerCase().startsWith("error:")) {
											throw new Error(
												`AI content generation failed: ${contentToWrite}`
											);
										}
										contentToWrite = contentToWrite
											.replace(/^```[a-z]*\n?/, "")
											.replace(/\n?```$/, "")
											.trim();
									} else {
										throw new Error(
											"CreateFileStep must have 'content' or 'generate_prompt'."
										);
									}
									await vscode.workspace.fs.writeFile(
										fileUri,
										Buffer.from(contentToWrite, "utf-8")
									);
									console.log(`${step.action} OK: ${step.path}`);
									this._addHistoryEntry(
										"model",
										`Step ${step.step} OK: ${step.action.replace(
											/_/g,
											" "
										)} \`${step.path}\``
									);
								} else {
									throw new Error(`Invalid ${step.action} structure.`);
								}
								break;

							case PlanStepAction.ModifyFile:
								if (isModifyFileStep(step)) {
									const fileUri = vscode.Uri.joinPath(rootUri, step.path);
									let existingContent = "";
									try {
										const contentBytes = await vscode.workspace.fs.readFile(
											fileUri
										);
										existingContent =
											Buffer.from(contentBytes).toString("utf-8");
									} catch (readError: any) {
										if (readError.code === "FileNotFound") {
											throw new Error(
												`File to modify not found: \`${step.path}\``
											);
										}
										throw readError;
									}
									this.postMessageToWebview({
										type: "statusUpdate",
										value: `Step ${step.step}/${totalSteps}: Generating modifications for ${step.path}...`,
									});
									const modificationPrompt = `You are an AI programmer. Modify the following code based on the instructions.\nProvide ONLY the complete, raw, modified code for the entire file. Do not include explanations, comments about the changes (unless specifically asked in the instructions), or markdown formatting. The entire response must be the final file content.\n\nFile Path: ${step.path}\nModification Instructions: ${step.modification_prompt}\n\n--- Existing File Content ---\n\`\`\`\n${existingContent}\n\`\`\`\n--- End Existing File Content ---\n\nComplete Modified File Content:`;
									let modifiedContent = await generateContent(
										apiKey,
										modelName, // Pass modelName
										modificationPrompt
									);
									if (modifiedContent.toLowerCase().startsWith("error:")) {
										throw new Error(
											`AI modification failed: ${modifiedContent}`
										);
									}
									modifiedContent = modifiedContent
										.replace(/^```[a-z]*\n?/, "")
										.replace(/\n?```$/, "")
										.trim();

									if (modifiedContent !== existingContent) {
										const edit = new vscode.WorkspaceEdit();
										// Get the actual range of the entire document
										const document = await vscode.workspace.openTextDocument(
											fileUri
										);
										const fullRange = new vscode.Range(
											new vscode.Position(0, 0),
											document.positionAt(document.getText().length)
										);

										edit.replace(fileUri, fullRange, modifiedContent);
										const success = await vscode.workspace.applyEdit(edit);
										if (!success) {
											throw new Error(
												`Failed to apply modifications to \`${step.path}\``
											);
										}
										console.log(`${step.action} OK: ${step.path}`);
										this._addHistoryEntry(
											"model",
											`Step ${step.step} OK: ${step.action.replace(
												/_/g,
												" "
											)} \`${step.path}\``
										);
									} else {
										console.log(
											`Step ${step.step}: AI returned identical content for ${step.path}. Skipping write.`
										);
										this._addHistoryEntry(
											"model",
											`Step ${step.step} OK: Modification for \`${step.path}\` resulted in no changes.`
										);
									}
								} else {
									throw new Error(`Invalid ${step.action} structure.`);
								}
								break;

							case PlanStepAction.RunCommand:
								if (isRunCommandStep(step)) {
									const commandToRun = step.command;
									const stepIdentifier = `Minovative Mind Plan Step ${step.step}`;

									this.postMessageToWebview({
										type: "statusUpdate",
										value: `Step ${step.step}: Preparing to run command '${commandToRun}'...`,
									});

									// Create a ShellExecution for the command
									const execution = new vscode.ShellExecution(commandToRun, {
										cwd: rootUri.fsPath, // Run in the workspace root
									});

									// Define the Task
									const task = new vscode.Task(
										{ type: "shell", stepIdentifier }, // Unique identifier for our task
										vscode.TaskScope.Workspace, // Scope to the workspace
										stepIdentifier, // Name shown in UI
										"Minovative Mind", // Source
										execution
									);

									// Set presentation options (optional but good practice)
									task.presentationOptions = {
										reveal: vscode.TaskRevealKind.Silent, // Don't force reveal terminal
										focus: false,
										panel: vscode.TaskPanelKind.Dedicated, // Use a dedicated panel
										clear: false, // Don't clear terminal each time
									};

									// --- Execute Task and Wait for Completion ---
									let taskCompletionError: Error | null = null;
									try {
										// Execute the task
										const executedTask = await vscode.tasks.executeTask(task); // executedTask is of type TaskExecution
										console.log(
											`Step ${step.step}: Task '${stepIdentifier}' started.`
										);

										// Create a promise that resolves when the task process ends
										const taskEndPromise = new Promise<number | undefined>(
											(resolve, reject) => {
												const disposable = vscode.tasks.onDidEndTaskProcess(
													(e) => {
														// CORRECTED COMPARISON: Compare the execution objects directly
														if (e.execution === executedTask) {
															console.log(
																`Step ${step.step}: Task '${stepIdentifier}' ended with exit code: ${e.exitCode}`
															);
															disposable.dispose(); // Clean up the listener
															resolve(e.exitCode);
														}
													}
												);
											}
										);

										// Wait for the task to finish
										const exitCode = await taskEndPromise;

										// Check the exit code
										if (exitCode !== 0 && exitCode !== undefined) {
											// Added undefined check for robustness
											throw new Error(
												`Command '${commandToRun}' failed with exit code ${exitCode}. Check the terminal output for details.`
											);
										} else if (exitCode === undefined) {
											// This might happen if the task system couldn't determine an exit code (rare, but possible)
											console.warn(
												`Step ${step.step}: Task '${stepIdentifier}' ended without a specific exit code. Assuming success, but check terminal output.`
											);
										}

										// Task completed successfully (or assumed success if exit code is undefined)
										console.log(`${step.action} OK: Command '${commandToRun}'`);
										this._addHistoryEntry(
											"model",
											`Step ${step.step} OK: Command \`${commandToRun}\` executed successfully.`
										);
										this.postMessageToWebview({
											type: "statusUpdate",
											value: `Step ${step.step}: Command '${commandToRun}' completed.`,
										});
									} catch (error) {
										// Capture errors from executeTask or the exit code check
										taskCompletionError =
											error instanceof Error ? error : new Error(String(error));
										console.error(
											`Error during task execution for step ${step.step}:`,
											taskCompletionError
										);
										// Re-throw to be caught by the outer try-catch block
										throw taskCompletionError;
									}
									// --- End Task Execution ---
								} else {
									throw new Error("Invalid RunCommandStep structure.");
								}
								break;

							default:
								console.warn(`Unsupported plan action: ${step.action}`);
								this.postMessageToWebview({
									type: "statusUpdate",
									value: `Step ${step.step}: Skipped unsupported action ${step.action}.`,
									isError: false,
								});
								this._addHistoryEntry(
									"model",
									`Step ${step.step} SKIPPED: Unsupported action ${step.action}`
								);
								break; // Skip unsupported actions
						}
					} catch (error) {
						executionOk = false;
						const errorMsg =
							error instanceof Error ? error.message : String(error);
						console.error(
							`Error executing step ${step.step} (${step.action}, ${
								stepPath || stepCommand
							}):`,
							error
						);
						this.postMessageToWebview({
							type: "statusUpdate",
							value: `Error on Step ${step.step}: ${errorMsg}`,
							isError: true,
						});
						this._addHistoryEntry(
							"model",
							`Step ${step.step} FAILED: ${errorMsg}`
						);
						break; // Stop plan execution on error
					}
				} // End loop
				progress.report({
					message: executionOk ? "Execution complete." : "Execution failed.",
					increment: 100,
				});
			}
		);

		if (executionOk) {
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Plan execution completed successfully.",
			});
			this._addHistoryEntry("model", "Plan execution finished successfully.");
		} else {
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Plan execution failed. Check chat for details.",
				isError: true,
			});
		}

		this.postMessageToWebview({ type: "reenableInput" });
	}

	public postMessageToWebview(message: any) {
		if (this._view) {
			this._view.webview.postMessage(message);
		} else {
			console.warn("Sidebar view not available to post message:", message.type);
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "dist", "webview.js")
		);
		const stylesUri = webview.asWebviewUri(
			vscode.Uri.joinPath(
				this._extensionUri,
				"src",
				"sidebar",
				"webview",
				"style.css"
			)
		);
		const nonce = getNonce();

		// Generate options for the model select dropdown
		const modelOptionsHtml = AVAILABLE_GEMINI_MODELS.map(
			(modelName) =>
				`<option value="${modelName}" ${
					modelName === this._selectedModelName ? "selected" : ""
				}>${modelName}</option>`
		).join("");

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="
						default-src 'none';
						style-src ${webview.cspSource} 'unsafe-inline';
						img-src ${webview.cspSource} https: data:;
						script-src 'nonce-${nonce}';
						connect-src 'none';
				">
				<link href="${stylesUri}" rel="stylesheet">
				<title>Minovative Mind Chat</title>
		</head>
		<body>
				<div class="chat-controls">
					 <h1>Minovative Mind</h1>
						<div>
								<button id="save-chat-button" title="Save Chat">Save</button>
								<button id="load-chat-button" title="Load Chat">Load</button>
								<button id="clear-chat-button" title="Clear Chat">Clear</button>
						</div>
				</div>
				<div id="status-area"></div>
				<div id="chat-container">
						<!-- Chat messages will appear here -->
				</div>

				<!-- Plan confirmation buttons will be injected after chat-container by main.ts if needed -->
				<div id="input-container">
						<textarea id="chat-input" rows="3" placeholder="Enter message or @plan [request]..."></textarea>
						<button id="send-button" title="Send Message">Send</button>
				</div>

				<!-- New Section: Model Selection -->
				<div class="section model-selection-section">
					<h2>AI Model Selection</h2>
					<div class="model-select-container">
								<select id="model-select" title="Select AI Model">
										${modelOptionsHtml}
								</select>
					</div>
				</div>

				<div class="section api-key-section">
						<h2>API Key Management</h2>
						<div class="key-management-controls">
								<span id="current-key-display">No keys stored</span>
								<button id="prev-key-button" title="Previous Key" disabled>&lt;</button>
								<button id="next-key-button" title="Next Key" disabled>&gt;</button>
								<button id="delete-key-button" title="Delete Current Key" disabled>Del</button>
						</div>
						<div class="add-key-container">
							<input type="password" id="add-key-input" placeholder="Add new Gemini API Key">
							<button id="add-key-button" title="Add API Key">Add</button>
						</div>
						<div id="api-key-status"></div>
						<p><small>Keys are stored securely using VS Code SecretStorage.</small></p>
				</div>
				<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
		 </body>
		</html>`;
	}
}

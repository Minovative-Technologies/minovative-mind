// src/sidebar/SidebarProvider.ts

import * as vscode from "vscode";
import { getNonce } from "../utilities/nonce";
import {
	generateContent,
	resetClient,
	ERROR_QUOTA_EXCEEDED,
} from "../ai/gemini"; // Import the error constant
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
import { Content } from "@google/generative-ai"; // Import Content type
import path = require("path"); // Node.js path module

// Secret storage keys
const GEMINI_API_KEYS_LIST_SECRET_KEY = "geminiApiKeysList";
const GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY = "geminiActiveApiKeyIndex";

// Workspace state keys for persistent settings
const MODEL_SELECTION_STORAGE_KEY = "geminiSelectedModel";

// --- DONT CHANGE THESE MODELS ---
const AVAILABLE_GEMINI_MODELS = [
	"gemini-2.5-pro-preview-03-25",
	"gemini-2.5-pro-exp-03-25",
	"gemini-2.5-flash-preview-04-17",
];

// Default model to use if no selection is stored or the stored model is invalid
const DEFAULT_MODEL = AVAILABLE_GEMINI_MODELS[0];

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

// Structure matching Google's Content type for internal use (now alias for imported Content)
type HistoryEntry = Content;

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "minovativeMindSidebarView";

	private _view?: vscode.WebviewView;
	private readonly _extensionUri: vscode.Uri;
	private readonly _secretStorage: vscode.SecretStorage;
	private readonly _workspaceState: vscode.Memento;
	private _apiKeyList: string[] = [];
	private _activeKeyIndex: number = -1;
	private _selectedModelName: string = DEFAULT_MODEL;
	private _chatHistory: HistoryEntry[] = [];
	private _currentPlan: ExecutionPlan | null = null;

	// --- Added for Cancellation Support ---
	private _isCancellableOperationInProgress: boolean = false;
	private _cancellationTokenSource?: vscode.CancellationTokenSource;
	// --- End Cancellation Support ---

	constructor(
		private readonly _extensionUri_in: vscode.Uri,
		context: vscode.ExtensionContext
	) {
		this._extensionUri = _extensionUri_in;
		this._secretStorage = context.secrets;
		this._workspaceState = context.workspaceState;

		// --- Listen for Secret Changes ---
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
		// --- End Listen for Secret Changes ---
	}

	public async initialize(): Promise<void> {
		console.log("SidebarProvider initializing: Loading keys and settings...");
		await this._loadKeysFromStorage();
		this._loadSettingsFromStorage();
		console.log("SidebarProvider initialization complete.");
	}

	// --- Key Management Logic (No Changes Here) ---
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

			// Validate and correct the active index
			if (potentialIndex < 0 || potentialIndex >= this._apiKeyList.length) {
				potentialIndex = this._apiKeyList.length > 0 ? 0 : -1;
				const storedIndex = activeIndexStr ? parseInt(activeIndexStr, 10) : -2; // Use -2 to differentiate from valid 0 or -1
				// Only update storage if the corrected index is different from what was stored
				if (potentialIndex !== storedIndex) {
					if (potentialIndex !== -1) {
						await this._secretStorage.store(
							GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
							String(potentialIndex)
						);
						console.log(`Corrected active key index to ${potentialIndex}`);
					} else {
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
			resetClient(); // Reset Gemini client as keys might have changed
			this._updateWebviewKeyList(); // Update UI
		} catch (error) {
			console.error("Error loading API keys from storage:", error);
			this._apiKeyList = [];
			this._activeKeyIndex = -1;
			vscode.window.showErrorMessage("Failed to load API keys.");
			this._updateWebviewKeyList(); // Update UI even on error
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
				// If no keys are left or no active key, remove the index from storage
				await this._secretStorage.delete(
					GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
				);
			}

			console.log(
				`Saved ${this._apiKeyList.length} keys. Active index: ${this._activeKeyIndex}`
			);
			resetClient(); // Reset Gemini client as active key might have changed
		} catch (error) {
			saveError = error; // Store error to report later
			console.error("Error saving API keys to storage:", error);
		}
		// Update the webview regardless of save success/failure to reflect current state
		this._updateWebviewKeyList();
		if (saveError) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Error: Failed to save key changes.",
				isError: true,
			});
		}
	}

	private async _addApiKey(key: string) {
		if (this._apiKeyList.includes(key)) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: `Info: Key ...${key.slice(-4)} is already stored.`,
			});
			return; // Don't add duplicates
		}

		this._apiKeyList.push(key);
		// Make the newly added key the active one
		this._activeKeyIndex = this._apiKeyList.length - 1;
		await this._saveKeysToStorage(); // Save changes and reset client
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ending in ...${key.slice(-4)} added and set as active.`,
		});
	}

	private async _deleteActiveApiKey() {
		if (
			this._activeKeyIndex === -1 ||
			this._activeKeyIndex >= this._apiKeyList.length
		) {
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

		const keyToDelete = this._apiKeyList[this._activeKeyIndex];
		this._apiKeyList.splice(this._activeKeyIndex, 1); // Remove the key

		const oldIndex = this._activeKeyIndex; // Store for logging if needed

		// Adjust the active index after deletion
		if (this._apiKeyList.length === 0) {
			this._activeKeyIndex = -1; // No keys left
		} else if (this._activeKeyIndex >= this._apiKeyList.length) {
			// If the last key was deleted, move to the new last key
			this._activeKeyIndex = this._apiKeyList.length - 1;
		}
		// If a key *before* the end was deleted, the index implicitly points to the next element now, which is okay.

		console.log(
			`Key deleted. Old index: ${oldIndex}, New active index: ${this._activeKeyIndex}`
		);

		await this._saveKeysToStorage(); // Save changes and reset client

		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ...${keyToDelete.slice(-4)} deleted.`,
		});
	}

	private async _switchToNextApiKey() {
		if (this._apiKeyList.length <= 1 || this._activeKeyIndex === -1) {
			return; // Cannot switch if 0 or 1 key
		}
		this._activeKeyIndex = (this._activeKeyIndex + 1) % this._apiKeyList.length; // Cycle forward
		await this._saveKeysToStorage(); // Saves and resets client
		const newKey = this._apiKeyList[this._activeKeyIndex];
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Switched to key ...${newKey.slice(-4)}.`,
		});
		return newKey; // Return the new key for retry logic if needed
	}

	private async _switchToPreviousApiKey() {
		if (this._apiKeyList.length <= 1 || this._activeKeyIndex === -1) {
			return; // Cannot switch if 0 or 1 key
		}
		this._activeKeyIndex =
			(this._activeKeyIndex - 1 + this._apiKeyList.length) %
			this._apiKeyList.length; // Cycle backward
		await this._saveKeysToStorage(); // Saves and resets client
		const newKey = this._apiKeyList[this._activeKeyIndex];
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Switched to key ...${newKey.slice(-4)}.`,
		});
	}

	private _updateWebviewKeyList() {
		if (!this._view) {
			return;
		}

		const keyInfos: ApiKeyInfo[] = this._apiKeyList.map((key, index) => ({
			maskedKey: `Key ...${key.slice(-4)} (${index + 1}/${
				this._apiKeyList.length
			})`,
			index: index,
			isActive: index === this._activeKeyIndex,
		}));

		const updateData: KeyUpdateData = {
			keys: keyInfos,
			activeIndex: this._activeKeyIndex,
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
		return undefined; // No active key
	}
	// --- End Key Management Logic ---

	// --- Model Selection Logic (No Changes Here) ---
	private _loadSettingsFromStorage() {
		try {
			const savedModel = this._workspaceState.get<string>(
				MODEL_SELECTION_STORAGE_KEY
			);
			// Validate the saved model against the current list
			if (savedModel && AVAILABLE_GEMINI_MODELS.includes(savedModel)) {
				this._selectedModelName = savedModel;
				console.log("Loaded selected model:", this._selectedModelName);
			} else {
				this._selectedModelName = DEFAULT_MODEL; // Use default if saved is invalid or not found
				console.log(
					"No saved model or invalid model found. Using default:",
					DEFAULT_MODEL
				);
			}
		} catch (error) {
			console.error("Error loading settings from storage:", error);
			this._selectedModelName = DEFAULT_MODEL; // Fallback to default on error
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
			resetClient(); // Reset Gemini client as model preference changed
		} catch (error) {
			console.error("Error saving settings to storage:", error);
			vscode.window.showErrorMessage("Failed to save extension settings.");
		}
		this._updateWebviewModelList(); // Update UI
	}

	private async _handleModelSelection(modelName: string) {
		if (AVAILABLE_GEMINI_MODELS.includes(modelName)) {
			this._selectedModelName = modelName;
			await this._saveSettingsToStorage(); // Save and reset client
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
			// Revert UI back to the currently valid selected model
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
	// --- End Model Selection Logic ---

	// --- Chat History & Actions (No Changes Here) ---
	private _addHistoryEntry(role: "user" | "model", text: string) {
		// Convert to Content structure expected by Gemini API
		this._chatHistory.push({ role, parts: [{ text }] });

		// Limit history size to prevent excessive memory usage/context length
		const MAX_HISTORY_ITEMS = 50; // Keep history manageable (e.g., last 25 exchanges)
		if (this._chatHistory.length > MAX_HISTORY_ITEMS) {
			// Remove the oldest entries (typically one user, one model)
			this._chatHistory.splice(0, this._chatHistory.length - MAX_HISTORY_ITEMS);
		}
	}

	private async _clearChat() {
		this._chatHistory = [];
		this.postMessageToWebview({ type: "chatCleared" }); // Tell webview to clear UI
		this.postMessageToWebview({
			type: "statusUpdate",
			value: "Chat cleared.",
		});
		this.postMessageToWebview({ type: "reenableInput" }); // Ensure input is enabled
	}

	private async _saveChat() {
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
				// Save in the format expected by restore (ChatMessage interface)
				const saveableHistory: ChatMessage[] = this._chatHistory.map(
					(entry) => ({
						sender: entry.role === "user" ? "User" : "Model",
						// Combine parts if multiple exist (though we usually add single parts)
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

	private async _loadChat() {
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
				const loadedData = JSON.parse(contentString);

				// Validate format (basic check for ChatMessage structure)
				if (
					Array.isArray(loadedData) &&
					loadedData.every(
						(item) =>
							item &&
							typeof item.sender === "string" &&
							typeof item.text === "string" &&
							(item.sender === "User" ||
								item.sender === "Model" ||
								item.sender === "System") // Allow 'System' for potential future use
					)
				) {
					this._chatHistory = []; // Clear current history
					// Convert back to HistoryEntry format for internal use
					this._chatHistory = loadedData.map(
						(item: ChatMessage): HistoryEntry => ({
							// Map sender to role ('System' could map to 'model' or a specific handling)
							role: item.sender === "User" ? "user" : "model",
							parts: [{ text: item.text }],
						})
					);

					this.postMessageToWebview({
						type: "restoreHistory",
						value: loadedData,
					}); // Send loaded structure to webview
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
	// --- End Chat History & Actions ---

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
				vscode.Uri.joinPath(this._extensionUri, "dist"), // Compiled JS
				vscode.Uri.joinPath(this._extensionUri, "media"), // Icons/Images
				vscode.Uri.joinPath(this._extensionUri, "src", "sidebar", "webview"), // CSS
				vscode.Uri.joinPath(this._extensionUri, "src", "resources"), // Welcome page assets
			],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// --- Handle Messages from Webview ---
		webviewView.webview.onDidReceiveMessage(async (data) => {
			console.log(`[Provider] Message received: ${data.type}`);

			switch (data.type) {
				// Plan Execution Handling
				case "planRequest": {
					const userRequest = data.value;
					const activeKey = this.getActiveApiKey();
					const selectedModel = this.getSelectedModelName();

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
					if (this._isCancellableOperationInProgress) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: Another AI operation is already in progress.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					this._addHistoryEntry("user", `@plan ${userRequest}`); // Add user's raw @plan request
					await this._handlePlanRequest(userRequest, activeKey, selectedModel);
					break;
				}
				case "confirmPlanExecution": {
					const planToExecute = data.value as ExecutionPlan | null;
					const currentActiveKey = this.getActiveApiKey();
					const selectedModel = this.getSelectedModelName();

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
					if (this._isCancellableOperationInProgress) {
						this.postMessageToWebview({
							type: "statusUpdate",
							value: "Error: Another AI operation is already in progress.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					if (planToExecute) {
						// Execute the plan using the key/model active *at the time of confirmation*
						await this._executePlan(
							planToExecute,
							currentActiveKey,
							selectedModel
						);
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
					this._currentPlan = null; // Discard the pending plan
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Plan execution cancelled.",
					});
					this._addHistoryEntry("model", "Plan execution cancelled by user.");
					this.postMessageToWebview({ type: "reenableInput" });
					// Note: This only cancels *before* execution starts. Ongoing execution needs the stop button.
					break;
				}

				// Regular Chat Handling
				case "chatMessage": {
					const userMessage = data.value;
					const activeKey = this.getActiveApiKey();
					const selectedModel = this.getSelectedModelName();

					if (!activeKey) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: No active API Key set.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						return; // Stop processing if no key
					}
					if (!selectedModel) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: No AI model selected.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						return; // Stop processing if no model
					}
					if (this._isCancellableOperationInProgress) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: Another AI operation is already in progress.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						return;
					}
					this._addHistoryEntry("user", userMessage); // Add user message to history
					await this._handleRegularChat(userMessage, activeKey, selectedModel);
					break;
				}

				// Key Management & Other Actions
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

				// Model Selection Handling
				case "selectModel":
					if (typeof data.value === "string") {
						await this._handleModelSelection(data.value);
					}
					break;

				// Webview Lifecycle
				case "webviewReady":
					console.log("[Provider] Webview ready. Updating UI.");
					this._updateWebviewKeyList();
					this._updateWebviewModelList();
					this._restoreChatHistoryToWebview();
					this.postMessageToWebview({ type: "reenableInput" }); // Initial enable
					// Ensure stop button is initially disabled if no operation is running
					if (!this._isCancellableOperationInProgress) {
						this.postMessageToWebview({ type: "disableStopButton" });
					}
					break; // Removed extra case label that caused fallthrough

				// --- Stop Request Handling ---
				case "stopRequest":
					if (
						this._isCancellableOperationInProgress &&
						this._cancellationTokenSource
					) {
						console.log(
							"[Provider] Stop request received. Cancelling operation."
						);
						this.postMessageToWebview({
							type: "statusUpdate",
							value: "Stopping request...",
						});
						this._cancellationTokenSource.cancel();
						// The finally block of the *running operation* will handle state reset,
						// history update, button disabling, and input re-enabling.
					} else {
						console.warn(
							"[Provider] Received stopRequest but no cancellable operation is in progress."
						);
						// Optionally inform the user or just ignore
						this.postMessageToWebview({ type: "disableStopButton" }); // Ensure button is disabled if state is inconsistent
						this.postMessageToWebview({ type: "reenableInput" }); // Ensure input is enabled
					}
					break;

				case "reenableInput": // Acknowledgment from webview or internal signal
					this.postMessageToWebview({ type: "reenableInput" }); // Forward to webview if needed
					break;
				default:
					console.warn(`Unknown message type received: ${data.type}`);
			}
		});
	}

	private _restoreChatHistoryToWebview() {
		if (!this._view) {
			return;
		}

		// Convert internal HistoryEntry back to ChatMessage for webview
		const historyForWebview: ChatMessage[] = this._chatHistory.map((entry) => ({
			sender: entry.role === "user" ? "User" : "Model",
			text: entry.parts.map((p) => p.text).join(""), // Combine parts if needed
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

		// Show warning message and wait for user action
		const confirmation = await vscode.window.showWarningMessage(
			`Are you sure you want to delete ${keyIdentifier}? This cannot be undone.`,
			{ modal: true }, // Make it modal to block other actions
			"Delete Key" // Action button text
		);

		if (confirmation === "Delete Key") {
			// Double-check the index hasn't changed while the dialog was open
			if (
				this._activeKeyIndex === keyToDeleteIndex &&
				keyToDeleteIndex < this._apiKeyList.length
			) {
				await this._deleteActiveApiKey();
			} else {
				// This could happen if the user somehow triggered a key switch while the modal was open (unlikely but possible)
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
			// User cancelled the deletion
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Key deletion cancelled.",
				isError: false,
			});
		}
	}
	// --- End VS Code Provider Methods ---

	// --- Retry Logic Wrapper (Modified for Cancellation) ---
	/**
	 * Wraps the call to generateContent, handling quota errors and retrying with the next key.
	 * Supports cancellation.
	 */
	public async _generateWithRetry(
		prompt: string,
		initialApiKey: string,
		modelName: string,
		history: HistoryEntry[] | undefined,
		// MODIFICATION START: Made cancellationToken optional
		cancellationToken?: vscode.CancellationToken, // <-- Made optional
		// MODIFICATION END
		requestType: string = "request" // Added for logging clarity
	): Promise<string> {
		let currentApiKey = initialApiKey;
		const triedKeys = new Set<string>(); // Track keys failed *within this request* due to quota
		const maxRetries = this._apiKeyList.length; // Try each key at most once per request
		let attempts = 0;
		const CANCELLATION_MESSAGE = "Operation cancelled by user."; // Define consistent cancellation message

		while (attempts < maxRetries) {
			attempts++;

			// --- Cancellation Check ---
			// MODIFICATION START: Added safe navigation for optional cancellationToken
			if (cancellationToken?.isCancellationRequested) {
				// MODIFICATION END
				console.log(
					`[RetryWrapper] Cancellation requested before attempt ${attempts} for ${requestType}.`
				);
				// No need to post status here, the calling function's finally block will handle it.
				return CANCELLATION_MESSAGE;
			}
			// --- End Cancellation Check ---

			console.log(
				`[RetryWrapper] Attempt ${attempts}/${maxRetries} for ${requestType} with key ...${currentApiKey.slice(
					-4
				)}`
			);

			// generateContent handles initialization checks internally now
			// Pass the cancellation token down if the underlying API supports it (assuming it doesn't here)
			// If generateContent becomes async and long-running itself, it would need its own internal checks.
			const result = await generateContent(
				currentApiKey,
				modelName,
				prompt,
				history
				// We don't pass the token to generateContent itself unless it supports it
			);

			// --- Post-API Call Cancellation Check ---
			// Check again in case cancellation happened *during* the API call
			// MODIFICATION START: Added safe navigation for optional cancellationToken
			if (cancellationToken?.isCancellationRequested) {
				// MODIFICATION END
				console.log(
					`[RetryWrapper] Cancellation requested after API call attempt ${attempts} for ${requestType}.`
				);
				return CANCELLATION_MESSAGE;
			}
			// --- End Post-API Call Check ---

			if (result === ERROR_QUOTA_EXCEEDED) {
				console.warn(
					`[RetryWrapper] Quota/Rate limit hit for key ...${currentApiKey.slice(
						-4
					)} on attempt ${attempts}.`
				);
				triedKeys.add(currentApiKey); // Mark this key as failed for *this* request

				const availableKeysCount = this._apiKeyList.length;
				if (availableKeysCount <= 1 || triedKeys.size >= availableKeysCount) {
					// No other keys to try, or all available keys have hit quota in this cycle
					const finalErrorMsg = `API quota or rate limit exceeded for model ${modelName}. All ${availableKeysCount} API key(s) failed or were rate-limited. Please try again later or check your Gemini usage.`;
					// Let the caller display the final error if necessary
					return finalErrorMsg;
				}

				// Find the index of the *next* key that hasn't been tried yet in this cycle
				let nextKeyFound = false;
				let originalIndex = this._activeKeyIndex;
				let nextIndex = originalIndex;

				for (let i = 0; i < availableKeysCount; i++) {
					nextIndex = (originalIndex + i + 1) % availableKeysCount; // Cycle through indices
					const potentialNextKey = this._apiKeyList[nextIndex];
					if (!triedKeys.has(potentialNextKey)) {
						// Found an untried key
						this.postMessageToWebview({
							type: "statusUpdate",
							value: `Quota limit hit. Retrying ${requestType} with next key...`,
						});
						// Manually switch to this specific index
						this._activeKeyIndex = nextIndex;
						await this._saveKeysToStorage(); // Save the new active index (this resets the client)
						currentApiKey = this._apiKeyList[this._activeKeyIndex]; // Update the key for the next loop
						this.postMessageToWebview({
							type: "apiKeyStatus", // Update the display
							value: `Switched to key ...${currentApiKey.slice(-4)} for retry.`,
						});
						nextKeyFound = true;
						break; // Exit the inner loop and proceed with the retry
					}
				}

				if (!nextKeyFound) {
					// This safeguard check should ideally be covered by triedKeys.size check above
					const finalErrorMsg = `API quota or rate limit exceeded for model ${modelName}. All available API keys have been tried for this request cycle. Please try again later.`;
					return finalErrorMsg;
				}
				// Continue to the next iteration of the while loop with the new key
			} else {
				// If it's not a quota error (could be success or another error type), return the result.
				// generateContent already handles logging/showing other error messages.
				return result;
			}
		}

		// Should only reach here if maxRetries is hit without success or a non-quota error
		const finalErrorMsg = `API quota or rate limit exceeded for model ${modelName}. Failed after trying ${attempts} keys. Please try again later.`;
		return finalErrorMsg;
	}
	// --- End Retry Logic Wrapper ---

	// --- Planning Workflow Logic (Modified for Cancellation) ---

	/**
	 * Creates the prompt for the AI to generate an execution plan.
	 * (No changes needed in this function itself)
	 */
	private _createPlanningPrompt(
		userRequest: string, // Request from chat (empty if from editor)
		projectContext: string,
		editorContext?: {
			instruction: string;
			selectedText: string;
			fullText: string;
			languageId: string;
			filePath: string; // Relative path
		},
		diagnosticsString?: string // Formatted string of relevant diagnostics
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

		let specificContextPrompt = "";
		let mainInstructions = "";

		if (editorContext) {
			const instructionType =
				editorContext.instruction.toLowerCase() === "/fix"
					? `The user triggered the '/fix' command on the selected code.`
					: `The user provided the custom instruction: "${editorContext.instruction}".`;

			specificContextPrompt = `
		--- Specific User Request Context from Editor ---
		File Path: ${editorContext.filePath}
		Language: ${editorContext.languageId}
		${instructionType}

		--- Selected Code in Editor ---
		\`\`\`${editorContext.languageId}
		${editorContext.selectedText}
		\`\`\`
		--- End Selected Code ---

		${
			// --- Include diagnostics if available ---
			diagnosticsString
				? `\n--- Relevant Diagnostics in Selection ---\n${diagnosticsString}\n--- End Relevant Diagnostics ---\n`
				: ""
			// --- End diagnostics inclusion ---
		}

		--- Full Content of Affected File (${editorContext.filePath}) ---
		\`\`\`${editorContext.languageId}
		${editorContext.fullText}
		\`\`\`
		--- End Full Content ---
		`;

			mainInstructions = `Based on the user's request from the editor (${
				editorContext.instruction.toLowerCase() === "/fix"
					? "'/fix' command"
					: "custom instruction"
			}) and the provided file/selection context, generate a plan to fulfill the request. For '/fix', the plan should **prioritize addressing the specific 'Relevant Diagnostics' listed above**, potentially involving modifications inside or outside the selection, or even in other files (like adding imports). For custom instructions, interpret the request in the context of the selected code and any diagnostics.`;
		} else {
			// Request originated from chat (@plan ...)
			specificContextPrompt = `
		--- User Request from Chat ---
		${userRequest}
		--- End User Request ---`;
			mainInstructions = `Based on the user's request from the chat ("${userRequest}"), generate a plan to fulfill it.`;
		}

		return `
		You are an expert AI programmer assisting within VS Code. Your task is to create a step-by-step execution plan in JSON format.

		**Goal:** Generate ONLY a valid JSON object representing the plan. Do NOT include any introductory text, explanations, apologies, or markdown formatting like \`\`\`json ... \`\`\` around the JSON output. The entire response must be the JSON plan itself.

		**Instructions for Plan Generation:**
		1.  Analyze Request & Context: ${mainInstructions} Use the broader project context below for reference. **${
			editorContext && diagnosticsString
				? "Pay close attention to the 'Relevant Diagnostics' section and ensure your plan addresses them for '/fix' requests."
				: ""
		}**
		2.  **Ensure Completeness:** The generated steps **must collectively address the *entirety* of the user's request**. Do not omit any requested actions or components. If a request is complex, break it into multiple granular steps.
		3.  Break Down: Decompose the request into logical, sequential steps. Number steps starting from 1.
		4.  Specify Actions: For each step, define the 'action' (create_directory, create_file, modify_file, run_command).
		5.  Detail Properties: Provide necessary details ('path', 'content', 'generate_prompt', 'modification_prompt', 'command') based on the action type, following the format description. Ensure paths are relative and safe. For 'run_command', infer the package manager and dependency type correctly. **For 'modify_file', the plan should define *what* needs to change (modification_prompt), not the changed code itself.**
		6.  JSON Output: Format the plan strictly according to the JSON structure below.
		7.  Never Aussume when generating code. ALWAYS provide the code if you think it's not there. NEVER ASSUME ANYTHING

		${specificContextPrompt}

		*** Broader Project Context (Reference Only) ***
		${projectContext}
		*** End Broader Project Context ***

		--- Expected JSON Plan Format ---
		${jsonFormatDescription}
		--- End Expected JSON Plan Format ---

		**Remember: The output MUST be ONLY the valid JSON plan, fully addressing the user's request.**

		Execution Plan (JSON only):
		`;
	}

	// Handles @plan command from chat input
	private async _handlePlanRequest(
		userRequest: string,
		apiKey: string,
		modelName: string
	): Promise<void> {
		// --- Setup Cancellation ---
		this._cancellationTokenSource?.dispose(); // Dispose any previous source
		this._cancellationTokenSource = new vscode.CancellationTokenSource();
		const token = this._cancellationTokenSource.token;
		this._isCancellableOperationInProgress = true;
		this.postMessageToWebview({ type: "enableStopButton" });
		// --- End Cancellation Setup ---

		try {
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Minovative Mind (${modelName}) is generating an execution plan...`,
				isLoading: true,
			});
			this._currentPlan = null; // Clear previous pending plan

			const projectContext = await this._buildProjectContext();
			if (projectContext.startsWith("[Error")) {
				this.postMessageToWebview({
					type: "aiResponse",
					value: `Error generating plan: Failed to build project context. ${projectContext}`,
					isLoading: false,
					isError: true,
				});
				// No reenable input here, finally block handles it
				return;
			}

			// Call _createPlanningPrompt without editorContext or diagnostics for chat-based @plan
			const planningPrompt = this._createPlanningPrompt(
				userRequest,
				projectContext
				/* No editor context */
				/* No diagnostics */
			);
			// Pass the token to the generation function
			await this._generateAndPresentPlan(
				planningPrompt,
				apiKey,
				modelName,
				token
			);
		} catch (error) {
			// Catch errors *not* caught within _generateAndPresentPlan (e.g., context build error if check removed)
			// Or if _generateAndPresentPlan re-throws an error
			console.error("Error in _handlePlanRequest:", error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			// Avoid duplicating error message if it's the cancellation message
			if (errorMsg !== "Operation cancelled by user.") {
				this.postMessageToWebview({
					type: "aiResponse",
					value: `Error during plan request: ${errorMsg}`,
					isLoading: false,
					isError: true,
				});
				this._addHistoryEntry(
					"model",
					`Error during plan request: ${errorMsg}`
				);
			}
		} finally {
			// --- Final Cleanup for Cancellation ---
			console.log("Plan request finished or cancelled. Cleaning up.");
			this._isCancellableOperationInProgress = false;
			this._cancellationTokenSource?.dispose();
			this._cancellationTokenSource = undefined;
			this.postMessageToWebview({ type: "disableStopButton" });
			this.postMessageToWebview({ type: "reenableInput" }); // Ensure input is always re-enabled
			// --- End Final Cleanup ---
		}
	}

	/**
	 * NEW: Public method called by extension.ts for /fix and custom editor modifications.
	 * Modified for cancellation.
	 */
	public async initiatePlanFromEditorAction(
		instruction: string,
		selectedText: string,
		fullText: string,
		languageId: string,
		documentUri: vscode.Uri,
		selection: vscode.Range // <-- Receive the selection range
	) {
		console.log(
			`[SidebarProvider] Received plan request from editor action: "${instruction}"`
		);

		if (this._isCancellableOperationInProgress) {
			this.postMessageToWebview({
				type: "aiResponse",
				value: "Error: Another AI operation is already in progress.",
				isError: true,
			});
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}

		const activeKey = this.getActiveApiKey();
		const modelName = this.getSelectedModelName();

		if (!activeKey) {
			this.postMessageToWebview({
				type: "aiResponse",
				value: "Error: No active API Key set for planning.",
				isError: true,
			});
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}
		if (!modelName) {
			this.postMessageToWebview({
				type: "aiResponse",
				value: "Error: No AI model selected for planning.",
				isError: true,
			});
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}

		// --- Setup Cancellation ---
		this._cancellationTokenSource?.dispose(); // Dispose any previous source
		this._cancellationTokenSource = new vscode.CancellationTokenSource();
		const token = this._cancellationTokenSource.token;
		this._isCancellableOperationInProgress = true;
		this.postMessageToWebview({ type: "enableStopButton" });
		// --- End Cancellation Setup ---

		try {
			// Don't add the raw instruction to chat history. Add a system message instead.
			this._addHistoryEntry(
				"model", // Use 'model' role for system messages related to actions
				`Received request from editor: "${instruction}" for the current selection. Generating plan...`
			);
			this.postMessageToWebview({
				type: "aiResponse", // Use aiResponse to show message in chat
				value: `Minovative Mind (${modelName}) received '${instruction}' request from editor. Generating plan...`,
				isLoading: true,
			});
			this._currentPlan = null; // Clear previous pending plan

			const projectContext = await this._buildProjectContext();
			if (projectContext.startsWith("[Error")) {
				this.postMessageToWebview({
					type: "aiResponse",
					value: `Error generating plan: Failed to build project context. ${projectContext}`,
					isLoading: false,
					isError: true,
				});
				this._addHistoryEntry(
					"model",
					`Error: Failed to build project context for editor action.`
				);
				// No reenable input here, finally block handles it
				return;
			}

			// --- Calculate relative path for the prompt ---
			let relativeFilePath = documentUri.fsPath; // Fallback
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders && workspaceFolders.length > 0) {
				relativeFilePath = path.relative(
					workspaceFolders[0].uri.fsPath,
					documentUri.fsPath
				);
			}

			// --- Get and Format Diagnostics ---
			let diagnosticsString = "";
			try {
				const allDiagnostics = vscode.languages.getDiagnostics(documentUri);
				const relevantDiagnostics = allDiagnostics.filter(
					(diag) => diag.range.intersection(selection) // Check for intersection with selection
				);

				if (relevantDiagnostics.length > 0) {
					// Sort diagnostics by line number, then severity
					relevantDiagnostics.sort((a, b) => {
						if (a.range.start.line !== b.range.start.line) {
							return a.range.start.line - b.range.start.line;
						}
						return a.severity - b.severity; // Error > Warning > Info > Hint
					});

					diagnosticsString = relevantDiagnostics
						.map(
							(d) =>
								`- ${vscode.DiagnosticSeverity[d.severity]} (Line ${
									d.range.start.line + 1 // Use 1-based line number
								}): ${d.message}`
						)
						.join("\n");
					console.log("Found relevant diagnostics:", diagnosticsString);
				} else {
					console.log("No diagnostics found intersecting the selection.");
				}
			} catch (diagError) {
				console.error("Error retrieving diagnostics:", diagError);
				diagnosticsString = "[Could not retrieve diagnostics]";
			}
			// --- End Get and Format Diagnostics ---

			// --- Create the planning prompt with editor context and diagnostics ---
			const planningPrompt = this._createPlanningPrompt(
				"", // userRequest is empty as it comes from editorContext
				projectContext,
				{
					instruction: instruction,
					selectedText: selectedText,
					fullText: fullText,
					languageId: languageId,
					filePath: relativeFilePath,
				},
				diagnosticsString // Pass the formatted diagnostics
			);

			// --- Call the common logic to generate and display the plan, passing the token ---
			await this._generateAndPresentPlan(
				planningPrompt,
				activeKey,
				modelName,
				token
			);
		} catch (error) {
			console.error("Error in initiatePlanFromEditorAction:", error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			// Avoid duplicating error message if it's the cancellation message
			if (errorMsg !== "Operation cancelled by user.") {
				this.postMessageToWebview({
					type: "aiResponse",
					value: `Error during editor action plan request: ${errorMsg}`,
					isLoading: false,
					isError: true,
				});
				this._addHistoryEntry(
					"model",
					`Error during editor action plan request: ${errorMsg}`
				);
			}
		} finally {
			// --- Final Cleanup for Cancellation ---
			console.log("Editor plan request finished or cancelled. Cleaning up.");
			this._isCancellableOperationInProgress = false;
			this._cancellationTokenSource?.dispose();
			this._cancellationTokenSource = undefined;
			this.postMessageToWebview({ type: "disableStopButton" });
			this.postMessageToWebview({ type: "reenableInput" }); // Ensure input is always re-enabled
			// --- End Final Cleanup ---
		}
	}

	/**
	 * Common helper function to generate plan from prompt and display it.
	 * Modified for cancellation.
	 */
	private async _generateAndPresentPlan(
		planningPrompt: string,
		apiKey: string,
		modelName: string,
		token: vscode.CancellationToken // <-- Added cancellation token
	): Promise<void> {
		let planJsonString = "";
		const CANCELLATION_MESSAGE = "Operation cancelled by user.";

		try {
			// Use the retry wrapper for generating the plan, passing the token
			planJsonString = await this._generateWithRetry(
				planningPrompt,
				apiKey,
				modelName,
				undefined, // No history needed for planning prompt itself
				token, // Pass token
				"plan generation"
			);

			// --- Cancellation Check ---
			if (
				token.isCancellationRequested ||
				planJsonString === CANCELLATION_MESSAGE
			) {
				console.log("Plan generation cancelled.");
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Plan generation cancelled.",
				});
				this._addHistoryEntry("model", CANCELLATION_MESSAGE);
				throw new Error(CANCELLATION_MESSAGE); // Propagate cancellation as error to trigger finally block correctly
			}
			// --- End Cancellation Check ---

			// Check if the retry wrapper returned a final error message (other than cancellation)
			if (
				planJsonString.toLowerCase().startsWith("error:") ||
				planJsonString === ERROR_QUOTA_EXCEEDED
			) {
				throw new Error(planJsonString); // Throw to handle it in the catch block
			}

			// Clean potential markdown fences or other noise
			planJsonString = planJsonString
				.replace(/^```json\n?/, "")
				.replace(/^```\n?/, "")
				.replace(/\n?```$/, "")
				.trim();

			if (
				!planJsonString.startsWith("{") ||
				!planJsonString.endsWith("}") ||
				planJsonString.length < 10
			) {
				console.error("AI response doesn't look like JSON:", planJsonString);
				throw new Error(
					"AI did not return a valid JSON plan.\nRaw Response:\n" +
						planJsonString.substring(0, 500) +
						(planJsonString.length > 500 ? "..." : "")
				);
			}
		} catch (error) {
			// This catch block now handles errors from _generateWithRetry and JSON validation/cleaning
			const errorMsg = error instanceof Error ? error.message : String(error);
			// Avoid duplicate messages if it's cancellation
			if (errorMsg !== CANCELLATION_MESSAGE) {
				this.postMessageToWebview({
					type: "aiResponse",
					value: `Error generating plan: ${errorMsg}`,
					isLoading: false, // Ensure loading state is cleared
					isError: true,
				});
				this._addHistoryEntry("model", `Error generating plan: ${errorMsg}`);
			}
			// Re-throw the error so the caller's finally block executes
			throw error;
		}

		// If we reach here, plan generation was successful (and not cancelled)
		// Parse and Validate the Plan
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
			// Add raw response to history for debugging
			this._addHistoryEntry(
				"model",
				`Error: Failed to parse/validate plan.\nRaw Response:\n\`\`\`json\n${planJsonString}\n\`\`\``
			);
			// No reenable input here, finally block handles it
			// Throw an error to ensure the caller's finally block runs
			throw new Error(errorDetail);
		}

		// Store and Display the Plan for Confirmation
		this._currentPlan = plan;
		const planSummary = `Plan Generated:\n*${
			plan.planDescription || "No description provided."
		}*\n\nReview the steps below and confirm execution.`;
		this._addHistoryEntry("model", planSummary); // Add summary to internal history

		// Format plan for display in the webview
		let planDisplayText = `**Execution Plan Proposed:**\n*${
			plan.planDescription || "No description provided."
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
						)}..."\n`;
					}
				} else if (isModifyFileStep(step)) {
					planDisplayText += `   - To Modify: "${step.modification_prompt.substring(
						0,
						80
					)}..."\n`;
				} else if (isRunCommandStep(step)) {
					planDisplayText += `   - Command: \`${step.command}\`\n`;
				}
				planDisplayText += "\n";
			});
		} else {
			planDisplayText += "The AI did not generate any steps for this plan.\n\n";
		}

		// Send the formatted plan and confirmation request to the webview
		// Loading is finished, but confirmation is required. Input remains disabled until confirmation/cancellation.
		this.postMessageToWebview({
			type: "aiResponse",
			value: planDisplayText,
			isLoading: false, // Plan generated, stop loading indicator
			requiresConfirmation: true,
			planData: plan, // Send the actual plan data for execution later
		});
		// NOTE: The finally block in the *caller* (_handlePlanRequest / initiatePlanFromEditorAction)
		// will handle resetting the cancellation state and re-enabling input AFTER confirmation/cancellation.
	}

	// Handles regular chat messages (non-@plan) - Modified for cancellation
	private async _handleRegularChat(
		userMessage: string,
		apiKey: string,
		modelName: string
	): Promise<void> {
		// --- MODIFICATION START: Setup Cancellation ---
		this._cancellationTokenSource?.dispose(); // Dispose any previous source
		this._cancellationTokenSource = new vscode.CancellationTokenSource();
		const token = this._cancellationTokenSource.token;
		this._isCancellableOperationInProgress = true;
		this.postMessageToWebview({ type: "enableStopButton" }); // Enable stop button in UI
		// --- MODIFICATION END ---

		const CANCELLATION_MESSAGE = "Operation cancelled by user."; // Consistent message

		// --- MODIFICATION START: Wrap existing logic in try...finally ---
		try {
			// Existing logic starts here
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
				// Return early, the finally block will handle cleanup
				return;
			}

			// Use the current chat history for context
			const historyForApi = JSON.parse(JSON.stringify(this._chatHistory));

			// Construct the final prompt including context and user query
			const finalPrompt = `
			You are an AI assistant called Minovative Mind integrated into VS Code. Below is some context about the user's current project. Use this context ONLY as background information to help answer the user's query accurately. Do NOT explicitly mention that you analyzed the context or summarize the project files unless the user specifically asks you to. Focus directly on answering the user's query and when you do answer the user's queries, make sure you complete the entire request, don't do minimal, shorten, or partial of what the user asked for. Complete the entire request from the users no matter how long it may take. Use Markdown formatting for code blocks and lists where appropriate. Keep responses concise but informative. Never Aussume ANYTHING when generating code. ALWAYS provide the code if you think it's not there. NEVER ASSUME ANYTHING.

			*** Project Context (Reference Only) ***
			${projectContext}
			*** End Project Context ***

			--- User Query ---
			${userMessage}
			--- End User Query ---

			Assistant Response:
	`;

			// --- MODIFICATION START: Pass token to _generateWithRetry ---
			const aiResponseText = await this._generateWithRetry(
				finalPrompt,
				apiKey,
				modelName,
				historyForApi, // Pass context history
				token, // Pass cancellation token
				"chat" // Specify request type for logging
			);
			// --- MODIFICATION END ---

			// --- MODIFICATION START: Add cancellation check after generation ---
			if (
				token.isCancellationRequested ||
				aiResponseText === CANCELLATION_MESSAGE
			) {
				console.log("[_handleRegularChat] Chat generation cancelled.");
				this.postMessageToWebview({
					// Update UI status
					type: "statusUpdate",
					value: "Chat request cancelled.",
				});
				this._addHistoryEntry("model", CANCELLATION_MESSAGE); // Add cancellation message to chat history
				// No further processing needed, exit the try block. Cleanup happens in finally.
				return;
			}
			// --- MODIFICATION END ---

			// Check if the retry wrapper returned a final error message (other than cancellation)
			const isErrorResponse =
				aiResponseText.toLowerCase().startsWith("error:") ||
				aiResponseText === ERROR_QUOTA_EXCEEDED;

			// Add the model's response to history
			this._addHistoryEntry("model", aiResponseText); // Add success or error message

			// Send the response (or error) back to the webview
			this.postMessageToWebview({
				type: "aiResponse",
				value: aiResponseText,
				isLoading: false,
				isError: isErrorResponse,
			});
		} catch (error) {
			// Catch errors not handled by _generateWithRetry (e.g., context build)
			console.error("Error in _handleRegularChat:", error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			// Avoid duplicate messages for cancellation (should have been handled by return above)
			if (errorMsg !== CANCELLATION_MESSAGE) {
				this.postMessageToWebview({
					type: "aiResponse",
					value: `Error during chat: ${errorMsg}`,
					isLoading: false,
					isError: true,
				});
				this._addHistoryEntry("model", `Error during chat: ${errorMsg}`);
			}
		} finally {
			// --- MODIFICATION START: Final Cleanup ---
			console.log(
				"[_handleRegularChat] Chat request finished or cancelled. Cleaning up."
			);
			this._isCancellableOperationInProgress = false; // Reset flag
			this._cancellationTokenSource?.dispose(); // Dispose the source
			this._cancellationTokenSource = undefined; // Clear the reference
			this.postMessageToWebview({ type: "disableStopButton" }); // Disable stop button in UI
			this.postMessageToWebview({ type: "reenableInput" }); // Re-enable input after chat response/error/cancellation
			// --- MODIFICATION END ---
		}
		// --- MODIFICATION END: Wrap existing logic in try...finally ---
	}

	// Builds project context string (No changes here)
	private async _buildProjectContext(): Promise<string> {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				const msg = "[No workspace open]";
				console.warn(msg);
				return msg;
			}
			const rootFolder = workspaceFolders[0];
			// Scan workspace respecting .gitignore and other patterns
			const relevantFiles = await scanWorkspace({ respectGitIgnore: true });
			if (relevantFiles.length > 0) {
				// Build the context string, potentially truncating based on limits
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
			return `[Error building project context: ${
				scanOrBuildError instanceof Error
					? scanOrBuildError.message
					: String(scanOrBuildError)
			}]`;
		}
	}

	// --- Plan Execution Logic (Modified for Cancellation) ---
	private async _executePlan(
		plan: ExecutionPlan,
		apiKey: string, // Key active *at time of confirmation*
		modelName: string // Model active *at time of confirmation*
	): Promise<void> {
		// --- Setup Cancellation ---
		this._cancellationTokenSource?.dispose(); // Dispose any previous source
		this._cancellationTokenSource = new vscode.CancellationTokenSource();
		const token = this._cancellationTokenSource.token;
		this._isCancellableOperationInProgress = true;
		this.postMessageToWebview({ type: "enableStopButton" });
		// --- End Cancellation Setup ---

		let executionOk = true; // Assume success initially
		const CANCELLATION_MESSAGE = "Operation cancelled by user.";

		try {
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Starting execution: ${plan.planDescription || "Unnamed Plan"}`,
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
				executionOk = false; // Mark as failed
				// No reenable input here, finally block handles it
				return;
			}
			const rootUri = workspaceFolders[0].uri;
			// Use the API key/model provided at confirmation time for all steps initially
			let currentApiKeyForExecution = apiKey;

			// Use withProgress for background task notification
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Minovative Mind: Executing Plan - ${
						plan.planDescription || "Processing..."
					}`,
					cancellable: true, // Make the VS Code progress notification cancellable
				},
				async (progress, progressToken) => {
					// Link the VS Code progress cancellation to our internal cancellation source
					progressToken.onCancellationRequested(() => {
						console.log(
							"VS Code progress cancellation requested. Cancelling internal source."
						);
						this._cancellationTokenSource?.cancel();
					});

					const totalSteps = plan.steps ? plan.steps.length : 0;
					if (totalSteps === 0) {
						progress.report({ message: "Plan has no steps.", increment: 100 });
						this.postMessageToWebview({
							type: "statusUpdate",
							value: "Plan has no steps. Execution finished.",
						});
						this._addHistoryEntry(
							"model",
							"Plan execution finished (no steps)."
						);
						executionOk = true; // No steps is considered OK
						return; // Exit progress scope
					}

					for (const [index, step] of plan.steps!.entries()) {
						// --- Cancellation Check at Start of Loop Iteration ---
						if (token.isCancellationRequested) {
							console.log(`Plan execution cancelled before step ${index + 1}.`);
							this.postMessageToWebview({
								type: "statusUpdate",
								value: `Plan execution cancelled.`,
							});
							this._addHistoryEntry("model", CANCELLATION_MESSAGE);
							executionOk = false; // Mark as failed due to cancellation
							break; // Exit the loop
						}
						// --- End Cancellation Check ---

						const stepNumber = index + 1;
						const stepMessageTitle = `Step ${stepNumber}/${totalSteps}: ${
							step.description || step.action.replace(/_/g, " ")
						}`;
						progress.report({
							message: `${stepMessageTitle}...`,
							increment: (1 / totalSteps) * 100,
						});
						const stepPath = step.path || "";
						const stepCommand = step.command || "";

						// Update status in sidebar
						this.postMessageToWebview({
							type: "statusUpdate",
							value: `Executing ${stepMessageTitle} ${
								step.action === PlanStepAction.RunCommand
									? `- '${stepCommand}'`
									: stepPath
									? `- \`${stepPath}\``
									: ""
							}`,
						});

						try {
							// --- Get the currently active key *before* potentially calling AI ---
							currentApiKeyForExecution =
								this.getActiveApiKey() || currentApiKeyForExecution;

							if (!currentApiKeyForExecution) {
								throw new Error(
									"No active API key available during plan execution step."
								);
							}

							// --- Execute Step ---
							switch (step.action) {
								case PlanStepAction.CreateDirectory:
									if (isCreateDirectoryStep(step)) {
										const dirUri = vscode.Uri.joinPath(rootUri, step.path);
										await vscode.workspace.fs.createDirectory(dirUri);
										console.log(`${step.action} OK: ${step.path}`);
										this._addHistoryEntry(
											"model",
											`Step ${stepNumber} OK: Created directory \`${step.path}\``
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
												value: `Step ${stepNumber}/${totalSteps}: Generating content for ${step.path}...`,
											});
											// Prompt for AI to generate file content
											const generationPrompt = `
											You are an AI programmer tasked with generating file content.
											**Critical Instruction:** Generate the **complete and comprehensive** file content based *fully* on the user's instructions below. Do **not** provide a minimal, placeholder, or incomplete implementation unless the instructions *specifically* ask for it. Fulfill the entire request.
											**Output Format:** Provide ONLY the raw code or text for the file. Do NOT include any explanations, or markdown formatting like backticks. Add comments in the code to help the user understand the code and the entire response MUST be only the final file content. Never Aussume ANYTHING when generating code. ALWAYS provide the code if you think it's not there. NEVER ASSUME ANYTHING.

											File Path: ${step.path}
											Instructions: ${step.generate_prompt}

											Complete File Content:
											`;

											// Use retry wrapper for AI content generation, passing token
											contentToWrite = await this._generateWithRetry(
												generationPrompt,
												currentApiKeyForExecution, // Use potentially updated key
												modelName,
												undefined, // No history context needed here
												token, // Pass cancellation token
												`plan step ${stepNumber} (create file)`
											);
											// Re-fetch key in case retry switched it
											currentApiKeyForExecution =
												this.getActiveApiKey() || currentApiKeyForExecution;

											// Check for cancellation or error from generation
											if (
												token.isCancellationRequested ||
												contentToWrite === CANCELLATION_MESSAGE
											) {
												throw new Error(CANCELLATION_MESSAGE); // Propagate cancellation
											}
											if (
												!currentApiKeyForExecution || // Check again after potential retry
												contentToWrite.toLowerCase().startsWith("error:") ||
												contentToWrite === ERROR_QUOTA_EXCEEDED
											) {
												throw new Error(
													`AI content generation failed: ${
														contentToWrite || "No API Key available"
													}`
												);
											}
											// Clean potential markdown fences
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
											`Step ${stepNumber} OK: Created file \`${step.path}\``
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
											if (
												readError instanceof vscode.FileSystemError &&
												readError.code === "FileNotFound"
											) {
												throw new Error(
													`File to modify not found: \`${step.path}\``
												);
											}
											throw readError; // Rethrow other read errors
										}
										this.postMessageToWebview({
											type: "statusUpdate",
											value: `Step ${stepNumber}/${totalSteps}: Generating modifications for ${step.path}...`,
										});
										// Prompt for AI to modify file content
										const modificationPrompt = `
										You are an AI programmer tasked with modifying an existing file.
										**Critical Instruction:** Modify the code based *fully* on the user's instructions below. Ensure the modifications are **complete and comprehensive**, addressing the entire request. Do **not** make partial changes or leave placeholders unless the instructions *specifically* ask for it.
										**Output Format:** Provide ONLY the complete, raw, modified code for the **entire file**. Do NOT include explanations, or markdown formatting. Add comments in the code to help the user understand the code and the entire response MUST be the final, complete file content after applying all requested modifications.

										File Path: ${step.path}
										Modification Instructions: ${step.modification_prompt}

										--- Existing File Content ---
										\`\`\`
										${existingContent}
										\`\`\`
										--- End Existing File Content ---

										Complete Modified File Content:
										`;

										// Use retry wrapper for AI modification, passing token
										let modifiedContent = await this._generateWithRetry(
											modificationPrompt,
											currentApiKeyForExecution, // Use potentially updated key
											modelName,
											undefined, // No history context needed here
											token, // Pass cancellation token
											`plan step ${stepNumber} (modify file)`
										);
										// Re-fetch key in case retry switched it
										currentApiKeyForExecution =
											this.getActiveApiKey() || currentApiKeyForExecution;

										// Check for cancellation or error from generation
										if (
											token.isCancellationRequested ||
											modifiedContent === CANCELLATION_MESSAGE
										) {
											throw new Error(CANCELLATION_MESSAGE); // Propagate cancellation
										}
										if (
											!currentApiKeyForExecution || // Check again after potential retry
											modifiedContent.toLowerCase().startsWith("error:") ||
											modifiedContent === ERROR_QUOTA_EXCEEDED
										) {
											throw new Error(
												`AI modification failed: ${
													modifiedContent || "No API Key available"
												}`
											);
										}
										// Clean potential markdown fences
										modifiedContent = modifiedContent
											.replace(/^```[a-z]*\n?/, "")
											.replace(/\n?```$/, "")
											.trim();

										// Only apply edit if content actually changed
										if (modifiedContent !== existingContent) {
											const edit = new vscode.WorkspaceEdit();
											// Need to get the full range of the document
											const document = await vscode.workspace.openTextDocument(
												fileUri
											);
											const fullRange = new vscode.Range(
												document.positionAt(0),
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
												`Step ${stepNumber} OK: Modified file \`${step.path}\``
											);
										} else {
											console.log(
												`Step ${stepNumber}: AI returned identical content for ${step.path}. Skipping write.`
											);
											this._addHistoryEntry(
												"model",
												`Step ${stepNumber} OK: Modification for \`${step.path}\` resulted in no changes.`
											);
										}
									} else {
										throw new Error(`Invalid ${step.action} structure.`);
									}
									break;

								case PlanStepAction.RunCommand:
									if (isRunCommandStep(step)) {
										const commandToRun = step.command;
										// Ask user for confirmation before running potentially harmful commands
										const userChoice = await vscode.window.showWarningMessage(
											`The plan wants to run a command in the terminal:\n\n\`${commandToRun}\`\n\nThis could install packages or modify your system. Allow?`,
											{ modal: true },
											"Allow Command",
											"Skip Command"
										);

										// --- Check for cancellation after modal dialog ---
										if (token.isCancellationRequested) {
											throw new Error(CANCELLATION_MESSAGE);
										}
										// --- End Cancellation Check ---

										if (userChoice === "Allow Command") {
											try {
												// Create or get a terminal instance
												const term = vscode.window.createTerminal({
													name: `Plan Step ${stepNumber}`,
													cwd: rootUri.fsPath, // Run in workspace root
												});
												term.sendText(commandToRun); // Send the command
												term.show(); // Show the terminal to the user
												this.postMessageToWebview({
													type: "statusUpdate",
													value: `Step ${stepNumber}: Running command '${commandToRun}' in terminal...`,
												});
												this._addHistoryEntry(
													"model",
													`Step ${stepNumber} OK: User allowed running command \`${commandToRun}\`.`
												);
												// Give the command some time to potentially start/finish
												// Note: This is heuristic. A better approach might involve terminal exit codes if possible.
												// Add cancellation check during wait
												await new Promise((resolve, reject) => {
													const timeoutId = setTimeout(resolve, 2000);
													token.onCancellationRequested(() => {
														clearTimeout(timeoutId);
														console.log(
															"Delay cancelled during command execution wait."
														);
														reject(new Error(CANCELLATION_MESSAGE));
													});
												});
											} catch (termError) {
												// Catch errors from terminal creation or the cancellation during wait
												if (
													termError instanceof Error &&
													termError.message === CANCELLATION_MESSAGE
												) {
													throw termError; // Propagate cancellation
												}
												const errorMsg =
													termError instanceof Error
														? termError.message
														: String(termError);
												throw new Error(
													`Failed to launch terminal for command '${commandToRun}': ${errorMsg}`
												);
											}
										} else {
											// User skipped the command
											this.postMessageToWebview({
												type: "statusUpdate",
												value: `Step ${stepNumber}: Skipped command '${commandToRun}'.`,
												isError: false,
											});
											this._addHistoryEntry(
												"model",
												`Step ${stepNumber} SKIPPED: User did not allow command \`${commandToRun}\`.`
											);
										}
									} else {
										throw new Error("Invalid RunCommandStep structure.");
									}
									break;

								default:
									// Handle unknown actions if the schema changes
									const exhaustiveCheck: never = step.action;
									console.warn(`Unsupported plan action: ${exhaustiveCheck}`);
									this.postMessageToWebview({
										type: "statusUpdate",
										value: `Step ${stepNumber}: Skipped unsupported action ${step.action}.`,
										isError: false,
									});
									this._addHistoryEntry(
										"model",
										`Step ${stepNumber} SKIPPED: Unsupported action ${step.action}`
									);
									break;
							}
						} catch (error) {
							// Catch errors within a step's execution (including cancellation)
							executionOk = false; // Mark execution as failed
							const errorMsg =
								error instanceof Error ? error.message : String(error);
							console.error(
								`Error executing step ${stepNumber} (${step.action}, ${
									stepPath || stepCommand
								}):`,
								error
							);
							// If the error is cancellation, use the standard message
							const displayMsg =
								errorMsg === CANCELLATION_MESSAGE
									? CANCELLATION_MESSAGE
									: `Error on Step ${stepNumber}: ${errorMsg}`;
							const historyMsg =
								errorMsg === CANCELLATION_MESSAGE
									? CANCELLATION_MESSAGE
									: `Step ${stepNumber} FAILED: ${errorMsg}`;

							this.postMessageToWebview({
								type: "statusUpdate",
								value: displayMsg,
								isError: errorMsg !== CANCELLATION_MESSAGE, // Only mark as error if not cancellation
							});
							this._addHistoryEntry("model", historyMsg);
							break; // Stop plan execution on the first error or cancellation
						}

						// --- Cancellation Check at End of Loop Iteration ---
						// Important if a step finishes quickly after cancellation was requested
						if (token.isCancellationRequested) {
							console.log(`Plan execution cancelled after step ${index + 1}.`);
							this.postMessageToWebview({
								type: "statusUpdate",
								value: `Plan execution cancelled.`,
							});
							// Add history entry only if not already added by an error/cancellation within the step
							if (
								!this._chatHistory.some(
									(entry) =>
										entry.parts[0].text === CANCELLATION_MESSAGE &&
										entry.role === "model"
								)
							) {
								this._addHistoryEntry("model", CANCELLATION_MESSAGE);
							}
							executionOk = false; // Mark as failed due to cancellation
							break; // Exit the loop
						}
						// --- End Cancellation Check ---
					} // End loop through steps

					// Final progress update based on whether the loop completed or was broken
					progress.report({
						message: executionOk
							? "Execution complete."
							: "Execution stopped (failed or cancelled).",
						increment: 100, // Ensure progress bar completes
					});
				} // End async progress callback
			); // End vscode.window.withProgress
		} catch (error) {
			// Catch errors occurring outside the 'withProgress' scope but within the try block
			// (e.g., error setting up workspace folders, though unlikely with current checks)
			executionOk = false;
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error("Unexpected error during plan execution:", error);
			const displayMsg =
				errorMsg === CANCELLATION_MESSAGE
					? CANCELLATION_MESSAGE
					: `Plan execution failed unexpectedly: ${errorMsg}`;
			const historyMsg =
				errorMsg === CANCELLATION_MESSAGE
					? CANCELLATION_MESSAGE
					: `Plan execution FAILED unexpectedly: ${errorMsg}`;

			this.postMessageToWebview({
				type: "statusUpdate",
				value: displayMsg,
				isError: errorMsg !== CANCELLATION_MESSAGE,
			});
			this._addHistoryEntry("model", historyMsg);
		} finally {
			// --- Final Cleanup for Cancellation/Completion/Error ---
			console.log(
				"Plan execution finished, failed, or cancelled. Cleaning up."
			);

			// Final status update in the sidebar based on the final state of executionOk
			// Check if the last message was already the cancellation message to avoid duplicates
			const lastMessage =
				this._chatHistory[this._chatHistory.length - 1]?.parts[0]?.text;
			if (executionOk) {
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Plan execution completed successfully.",
				});
				// Add success message only if the last one wasn't already it (e.g., no steps plan)
				if (
					lastMessage !== "Plan execution finished successfully." &&
					lastMessage !== "Plan execution finished (no steps)."
				) {
					this._addHistoryEntry(
						"model",
						"Plan execution finished successfully."
					);
				}
			} else if (lastMessage !== CANCELLATION_MESSAGE) {
				// If failed (and not due to cancellation reported already)
				this.postMessageToWebview({
					type: "statusUpdate",
					value:
						"Plan execution stopped due to failure or cancellation. Check chat for details.",
					isError: true, // Mark as error unless it was just cancellation
				});
				// Failure/cancellation message should have been added in the catch block or loop break
			} else {
				// If execution failed specifically due to cancellation already reported
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Plan execution cancelled.",
					isError: false, // Cancellation isn't strictly an 'error' state
				});
			}

			this._isCancellableOperationInProgress = false;
			this._cancellationTokenSource?.dispose();
			this._cancellationTokenSource = undefined;
			this.postMessageToWebview({ type: "disableStopButton" });
			this.postMessageToWebview({ type: "reenableInput" }); // Re-enable input after execution finishes or fails/cancels
			// --- End Final Cleanup ---
		}
	}
	// --- End Planning Workflow Logic ---

	// --- Utility Methods ---
	public postMessageToWebview(message: any) {
		if (this._view) {
			this._view.webview.postMessage(message);
		} else {
			console.warn("Sidebar view not available to post message:", message.type);
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Get URIs for scripts and styles
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

		// Generate a nonce for inline scripts/styles if needed (though prefer external files)
		const nonce = getNonce();

		// Create options for the model dropdown
		const modelOptionsHtml = AVAILABLE_GEMINI_MODELS.map(
			(modelName) =>
				`<option value="${modelName}" ${
					modelName === this._selectedModelName ? "selected" : ""
				}>${modelName}</option>`
		).join("");

		// This HTML is generated dynamically and includes all necessary elements,
		// CSS/JS links, and IDs referenced by the webview's main.ts script.
		// The static src/sidebar/webview/index.html file is intentionally not used
		// to allow for dynamic population of elements like the model dropdown.
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="
						default-src 'none';
						style-src ${webview.cspSource} 'unsafe-inline';
						img-src ${webview.cspSource} https: data:;
						font-src ${webview.cspSource};
						script-src 'nonce-${nonce}';
						connect-src 'none';
				">
				<link href="${stylesUri}" rel="stylesheet">
				<title>Minovative Mind Chat (BETA)</title>
		</head>
		<body>
				<div class="chat-controls">
					 <h1>Minovative Mind (BETA)</h1>
						<div class="button-group">
								<button id="save-chat-button" title="Save Chat">S</button> <!-- Icon added by JS -->
								<button id="load-chat-button" title="Load Chat">L</button> <!-- Icon added by JS -->
								<button id="clear-chat-button" title="Clear Chat">C</button> <!-- Icon added by JS -->
						</div>
				</div>
				<div id="status-area"></div>
				<div id="chat-container"></div>

				<!-- Plan confirmation buttons will be injected here by JS -->
				
				<div id="input-container">
						<textarea id="chat-input" rows="3" placeholder="Enter message or @plan [request]..."></textarea>

					<div style="display: flex; flex-direction: column; gap: 5px;">
						<button id="stop-button" title="Stop Current AI Operation" disabled>Stop</button> <!-- Icon maybe added by JS later -->
						<button id="send-button" title="Send Message">S</button> <!-- Icon added by JS -->
					</div>
				</div>


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
								<button id="prev-key-button" title="Previous Key" disabled>&lt;</button> <!-- Icon added by JS -->
								<button id="next-key-button" title="Next Key" disabled>&gt;</button> <!-- Icon added by JS -->
								<button id="delete-key-button" title="Delete Current Key" disabled>Del</button> <!-- Icon added by JS -->
						</div>
						<div class="add-key-container">
							<input type="password" id="add-key-input" placeholder="Add new Gemini API Key">
							<button id="add-key-button" title="Add API Key">Add</button> <!-- Icon added by JS -->
						</div>
						<div id="api-key-status"></div>
						<p><small>Keys are stored securely using VS Code SecretStorage.</small></p>
				</div>
				<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
		 </body>
		</html>`;
	}
	// --- End Utility Methods ---
} // End SidebarProvider class

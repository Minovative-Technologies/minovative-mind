// src/sidebar/SidebarProvider.ts
import * as vscode from "vscode";
import { getNonce } from "../utilities/nonce";
import { generateContent, resetClient } from "../ai/gemini";
import { scanWorkspace } from "../context/workspaceScanner";
import { buildContextString } from "../context/contextBuilder";
import * as path from "path"; // Import path for joining paths correctly
import {
	ExecutionPlan,
	isCreateDirectoryStep,
	isCreateFileStep,
	isModifyFileStep,
	parseAndValidatePlan,
	PlanStepAction,
} from "../ai/workflowPlanner";

// Secret storage keys
const GEMINI_API_KEYS_LIST_SECRET_KEY = "geminiApiKeysList"; // Stores array of key strings
const GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY = "geminiActiveApiKeyIndex"; // Stores index (as string)

// Type for the data sent to the webview regarding keys
interface ApiKeyInfo {
	maskedKey: string; // e.g., "Key ending in ...1234"
	index: number;
	isActive: boolean;
}
interface KeyUpdateData {
	keys: ApiKeyInfo[];
	activeIndex: number;
	totalKeys: number;
}

// Define the structure for saving/loading chat history (matches webview expectation)
interface ChatMessage {
	sender: "User" | "Gemini" | "System"; // Keep sender simple for saving
	text: string;
	className: string; // Keep class for potential styling on load
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
	private _apiKeyList: string[] = []; // Cache the list of keys
	private _activeKeyIndex: number = -1; // Cache the active index, -1 if none
	private _chatHistory: HistoryEntry[] = []; // Store chat history using Gemini structure
	private _currentPlan: ExecutionPlan | null = null; // Store the plan awaiting confirmation or execution

	constructor(
		private readonly _extensionUri_in: vscode.Uri,
		context: vscode.ExtensionContext
	) {
		this._extensionUri = _extensionUri_in;
		this._secretStorage = context.secrets;

		// Listen for changes in secret storage
		context.secrets.onDidChange((e) => {
			if (
				e.key === GEMINI_API_KEYS_LIST_SECRET_KEY ||
				e.key === GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
			) {
				console.log(`Secret key changed: ${e.key}. Reloading keys.`);
				this._loadKeysFromStorage(); // Reload keys if secrets change externally
			}
		});
		this._loadKeysFromStorage(); // Load initial keys on activation
	}

	// --- Key Management Logic ---

	/** Loads keys and active index from secret storage and updates cache */
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

			// Validate index against the newly loaded list
			if (potentialIndex < 0 || potentialIndex >= this._apiKeyList.length) {
				potentialIndex = this._apiKeyList.length > 0 ? 0 : -1; // Default to 0 if keys exist, else -1
				if (
					potentialIndex !== -1 &&
					potentialIndex !==
						(activeIndexStr ? parseInt(activeIndexStr, 10) : -2)
				) {
					// Only save if we actually changed it from a stored value
					await this._secretStorage.store(
						GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
						String(potentialIndex)
					);
					console.log(`Corrected active index to ${potentialIndex}`);
				} else if (potentialIndex === -1 && activeIndexStr !== null) {
					// If we had a stored index but now have no keys, clear the stored index
					await this._secretStorage.delete(
						GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
					);
					console.log(
						`Cleared active index from storage as key list is empty.`
					);
				}
			}
			this._activeKeyIndex = potentialIndex;

			console.log(
				`Loaded ${this._apiKeyList.length} keys. Active index: ${this._activeKeyIndex}`
			);
			resetClient(); // Reset Gemini client as keys/active key might have changed
			this._updateWebviewKeyList(); // Notify webview
		} catch (error) {
			console.error("Error loading API keys from storage:", error);
			this._apiKeyList = [];
			this._activeKeyIndex = -1;
			vscode.window.showErrorMessage("Failed to load API keys.");
			this._updateWebviewKeyList(); // Notify webview even on error (empty list)
		}
	}

	/** Saves the current key list and active index to secret storage */
	private async _saveKeysToStorage() {
		let saveError: any = null;
		try {
			await this._secretStorage.store(
				GEMINI_API_KEYS_LIST_SECRET_KEY,
				JSON.stringify(this._apiKeyList)
			);
			// Only store active index if there are keys
			if (this._activeKeyIndex !== -1) {
				await this._secretStorage.store(
					GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
					String(this._activeKeyIndex)
				);
			} else {
				// If no keys, ensure the active index is also removed from storage
				await this._secretStorage.delete(
					GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
				);
			}

			console.log(
				`Saved ${this._apiKeyList.length} keys. Active index: ${this._activeKeyIndex}`
			);
			resetClient(); // Reset Gemini client as keys/active key might have changed
		} catch (error) {
			saveError = error; // Store error to handle after UI update
			console.error("Error saving API keys to storage:", error);
			// The webview status message will be handled by _updateWebviewKeyList
		}
		// Update the webview *after* attempting the save, regardless of success/failure.
		// This ensures the webview reflects the cached state (_apiKeyList, _activeKeyIndex).
		this._updateWebviewKeyList();
		// If there was an error during save, notify the user via status AFTER updating the list display
		if (saveError) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Error: Failed to save key changes.",
			});
		}
	}

	/** Adds a new API key */
	private async _addApiKey(key: string) {
		if (this._apiKeyList.includes(key)) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: `Info: Key ...${key.slice(-4)} is already stored.`,
			});
			return;
		}

		this._apiKeyList.push(key);
		if (this._activeKeyIndex === -1) {
			this._activeKeyIndex = this._apiKeyList.length - 1; // Make the new key active if none were active
		} else {
			// If keys already exist and one was active, make the *new* key the active one
			this._activeKeyIndex = this._apiKeyList.length - 1;
		}
		// Save changes BEFORE sending success message
		await this._saveKeysToStorage();
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ending in ...${key.slice(-4)} added and set as active.`,
		});
	}

	/** Deletes the currently active API key */
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
			});
			return;
		}

		console.log(
			`[Minovative Mind] Proceeding to delete key at index ${
				this._activeKeyIndex
			}: ...${this._apiKeyList[this._activeKeyIndex].slice(-4)}`
		);

		const deletedKey = this._apiKeyList[this._activeKeyIndex];
		this._apiKeyList.splice(this._activeKeyIndex, 1);

		const oldIndex = this._activeKeyIndex;
		if (this._apiKeyList.length === 0) {
			this._activeKeyIndex = -1;
		} else if (this._activeKeyIndex >= this._apiKeyList.length) {
			this._activeKeyIndex = this._apiKeyList.length - 1;
		}
		// If index is within bounds after splice, it stays pointing to the *new* element at that index

		console.log(
			`[Minovative Mind] Key deleted. Old index: ${oldIndex}, New active index: ${this._activeKeyIndex}`
		);

		await this._saveKeysToStorage(); // This will trigger _updateWebviewKeyList

		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ...${deletedKey.slice(-4)} deleted.`,
		});
	}

	/** Switches to the next API key in the list */
	private async _switchToNextApiKey() {
		if (this._apiKeyList.length <= 1 || this._activeKeyIndex === -1) {
			// No other keys or no active key to start with
			return;
		}
		this._activeKeyIndex = (this._activeKeyIndex + 1) % this._apiKeyList.length; // Wrap around
		await this._saveKeysToStorage(); // Save the new active index
		const newKey = this._apiKeyList[this._activeKeyIndex];
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Switched to key ...${newKey.slice(-4)}.`,
		});
	}

	/** Switches to the previous API key in the list */
	private async _switchToPreviousApiKey() {
		if (this._apiKeyList.length <= 1 || this._activeKeyIndex === -1) {
			// No other keys or no active key to start with
			return;
		}
		this._activeKeyIndex =
			(this._activeKeyIndex - 1 + this._apiKeyList.length) %
			this._apiKeyList.length; // Wrap around
		await this._saveKeysToStorage(); // Save the new active index
		const newKey = this._apiKeyList[this._activeKeyIndex];
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Switched to key ...${newKey.slice(-4)}.`,
		});
	}

	/** Sends the current list of keys (masked) and active state to the webview */
	private _updateWebviewKeyList() {
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

	/** Gets the currently active API key string */
	public getActiveApiKey(): string | undefined {
		if (
			this._activeKeyIndex >= 0 &&
			this._activeKeyIndex < this._apiKeyList.length
		) {
			return this._apiKeyList[this._activeKeyIndex];
		}
		return undefined;
	}

	// --- Chat History & Actions ---

	private _addHistoryEntry(role: "user" | "model", text: string) {
		this._chatHistory.push({ role, parts: [{ text }] });
		// Optional: Add logic here to prune history if it gets too long
		// e.g., Keep last N messages or last X tokens
		const MAX_HISTORY_ITEMS = 50; // Arbitrary limit
		if (this._chatHistory.length > MAX_HISTORY_ITEMS) {
			this._chatHistory.shift(); // Remove oldest message
		}
	}

	private async _clearChat() {
		this._chatHistory = [];
		this.postMessageToWebview({ type: "chatCleared" });
		this.postMessageToWebview({
			type: "statusUpdate",
			value: "Chat cleared.",
		});
		// Re-enable input after clearing chat
		this.postMessageToWebview({ type: "reenableInput" });
	}

	private async _saveChat() {
		const options: vscode.SaveDialogOptions = {
			saveLabel: "Save Chat History",
			filters: {
				"JSON Files": ["json"],
				"Text Files": ["txt"], // Allow saving as plain text too (might lose structure)
			},
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
						sender: entry.role === "user" ? "User" : "Gemini",
						text: entry.parts[0].text,
						className: entry.role === "user" ? "user-message" : "ai-message", // Simple mapping, could enhance
					})
				);

				const contentString = JSON.stringify(saveableHistory, null, 2); // Pretty print JSON
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
				"JSON Files": ["json"],
				"All Files": ["*"],
			},
		};

		const fileUris = await vscode.window.showOpenDialog(options);
		if (fileUris && fileUris.length > 0) {
			const fileUri = fileUris[0];
			try {
				const contentBytes = await vscode.workspace.fs.readFile(fileUri);
				const contentString = Buffer.from(contentBytes).toString("utf-8");
				const loadedData: any = JSON.parse(contentString);

				// Validate and convert back to internal format
				if (
					Array.isArray(loadedData) &&
					loadedData.every(
						(item) =>
							item &&
							typeof item.sender === "string" &&
							typeof item.text === "string" &&
							(item.sender === "User" ||
								item.sender === "Gemini" ||
								item.sender === "System") // Validate sender type
					)
				) {
					// Clear current history before loading
					this._chatHistory = [];
					this._chatHistory = loadedData.map(
						(item: ChatMessage): HistoryEntry => ({
							role: item.sender === "User" ? "user" : "model", // Basic mapping
							parts: [{ text: item.text }],
						})
					);

					// Send the loaded history to the webview for display
					this.postMessageToWebview({
						type: "restoreHistory",
						value: loadedData, // Send the saveable format back for display
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
			],
		};

		// Set the HTML content
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(async (data) => {
			console.log(`[Provider] Message received: ${data.type}`); // Log message type

			switch (data.type) {
				// --- Plan Execution Handling ---
				case "planRequest": {
					const userRequest = data.value;
					console.log("Plan request received:", userRequest);
					const activeKey = this.getActiveApiKey();
					if (!activeKey) {
						this.postMessageToWebview({
							type: "aiResponse",
							value:
								"Error: No active API Key set. Please add or select a key to generate a plan.",
							isError: true,
						});
						// Re-enable input as the action failed immediately
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					// Add user's @plan message to history before processing
					this._addHistoryEntry("user", `@plan ${userRequest}`);
					await this._handlePlanRequest(userRequest, activeKey);
					break;
				}
				case "confirmPlanExecution": {
					// The plan data is sent with the message
					const planToExecute = data.value as ExecutionPlan | null;
					const currentActiveKey = this.getActiveApiKey(); // Get key again just before execution

					if (!currentActiveKey) {
						this.postMessageToWebview({
							type: "statusUpdate",
							value: "Error: Cannot execute plan - no active API key.",
							isError: true,
						});
						// Re-enable input if cancelling due to no key
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					if (planToExecute) {
						// Pass the key to the execution method
						await this._executePlan(planToExecute, currentActiveKey);
					} else {
						console.error(
							"Received confirmPlanExecution but plan data was missing or invalid."
						);
						this.postMessageToWebview({
							type: "statusUpdate",
							value:
								"Error: Failed to confirm plan execution - missing plan data.",
							isError: true,
						});
						// Re-enable input on error
						this.postMessageToWebview({ type: "reenableInput" });
					}
					break;
				}
				case "cancelPlanExecution": {
					console.log("Plan execution cancelled by user.");
					this._currentPlan = null; // Clear any pending plan
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Plan execution cancelled.",
					});
					// Add cancellation to history
					this._addHistoryEntry("model", "Plan execution cancelled by user.");
					// Re-enable input (Webview handles this now)
					// this.postMessageToWebview({ type: "reenableInput" }); // Webview manages this on hide
					break;
				}

				// --- Regular Chat Handling ---
				case "chatMessage": {
					const userMessage = data.value;
					console.log(`Regular chat message received: ${userMessage}`);
					const activeKey = this.getActiveApiKey();

					if (!activeKey) {
						this.postMessageToWebview({
							type: "aiResponse",
							value:
								"Error: No active API Key set. Please add or select a key.",
							isError: true,
						});
						// Re-enable input
						this.postMessageToWebview({ type: "reenableInput" });
						return;
					}
					// Add user message to history before processing
					this._addHistoryEntry("user", userMessage);
					// Handle the regular chat flow
					await this._handleRegularChat(userMessage, activeKey);
					break;
				}

				// --- Key Management & Other Actions ---
				case "addApiKey":
					if (typeof data.value === "string") {
						await this._addApiKey(data.value.trim());
					}
					break;
				case "requestDeleteConfirmation": // Keep this logic
					await this._requestDeleteConfirmation(); // Refactored for clarity
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
				case "webviewReady":
					console.log("Webview reported ready.");
					this._updateWebviewKeyList(); // Send initial key list state
					this._restoreChatHistoryToWebview(); // Send existing chat history
					// No need to re-enable input here, webview does it based on key list state
					break;
				// 'reenableInput' message from webview is just an acknowledgement
				case "reenableInput":
					console.log("Webview reported input re-enabled.");
					break;

				default:
					console.warn(`Unknown message type received: ${data.type}`);
			}
		});
	}

	/** Helper to restore history to webview */
	private _restoreChatHistoryToWebview() {
		const historyForWebview: ChatMessage[] = this._chatHistory.map((entry) => ({
			sender: entry.role === "user" ? "User" : "Gemini",
			text: entry.parts[0].text,
			// Determine className based on role
			className: entry.role === "user" ? "user-message" : "ai-message",
			// System messages added directly via postMessage in _handlePlanRequest or _executePlan
		}));
		this.postMessageToWebview({
			type: "restoreHistory",
			value: historyForWebview,
		});
	}

	/** Helper to show delete confirmation */
	private async _requestDeleteConfirmation() {
		const keyToDeleteIndex = this._activeKeyIndex;
		let keyIdentifier = "the active key";
		if (keyToDeleteIndex >= 0 && keyToDeleteIndex < this._apiKeyList.length) {
			keyIdentifier = `key ...${this._apiKeyList[keyToDeleteIndex].slice(-4)}`;
		} else {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Error: Cannot request deletion, no active key selected.",
				isError: true,
			});
			return;
		}

		const confirmation = await vscode.window.showWarningMessage(
			`Are you sure you want to delete ${keyIdentifier}?`,
			{ modal: true },
			"Delete Key"
		);

		if (confirmation === "Delete Key") {
			// Double-check index hasn't changed while dialog was open (unlikely with modal=true)
			if (this._activeKeyIndex === keyToDeleteIndex) {
				await this._deleteActiveApiKey(); // Call the actual deletion logic
			} else {
				this.postMessageToWebview({
					type: "apiKeyStatus",
					value: "Info: Active key changed, deletion aborted.",
					isError: false, // Use info style for this
				});
			}
		} else {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Key deletion cancelled.",
				isError: false, // Use info style for this
			});
		}
	}

	// --- Planning Workflow Logic ---

	/**
	 * Creates the prompt for requesting an execution plan from the AI.
	 * @param userRequest The user's high-level feature request.
	 * @param projectContext The stringified project context.
	 * @returns The formatted prompt string.
	 */
	private _createPlanningPrompt(
		userRequest: string,
		projectContext: string
	): string {
		// Keep the existing JSON format description
		const jsonFormatDescription = `
		{
			"planDescription": "Brief summary of the overall goal.",
			"steps": [
				{
					"step": 1,
					"action": "create_directory | create_file | modify_file",
					"description": "What this step does.",
					"path": "relative/path/to/target", // Required for create/modify actions
					// --- Specific properties based on action ---
					// For "create_directory": Nothing else needed.
					// For "create_file":
					// "content": "Full initial file content (only for simple files, less than 10 lines)"
					// OR
					// "generate_prompt": "Detailed prompt for AI to generate content later (for complex files)"
					// Do NOT include both "content" and "generate_prompt".
					// For "modify_file":
					// "modification_prompt": "Detailed prompt describing exact changes needed (e.g., function signature, logic change). This will be used in a subsequent AI call."
				},
				// ... more steps
			]
		}`;

		return `
You are an expert AI programmer assisting within VS Code. Your task is to create a step-by-step execution plan in JSON format to fulfill the user's request, considering the provided project context.

**Goal:** Generate ONLY a valid JSON object representing the plan. Do NOT include any introductory text, explanations, apologies, or markdown formatting like \`\`\`json ... \`\`\` around the JSON output. The entire response must be the JSON plan itself.

**Instructions for Plan Generation:**
1.  **Analyze Request:** Understand the user's high-level request: "${userRequest}".
2.  **Analyze Context:** Use the project context (file structure, existing code snippets) to determine necessary actions (creating directories/files, modifying existing files). Identify correct relative paths from the workspace root. Ensure paths are valid and do not contain forbidden characters or traverse upwards outside the root.
3.  **Break Down:** Decompose the request into logical, sequential steps. Each step should represent a single file system operation (create dir, create file, modify file). Number steps starting from 1.
4.  **Specify Actions & Paths:** For each step, define the 'action' and the relative 'path' from the workspace root.
5.  **Detail Prompts/Content:**
    *   For **create_directory**: Only 'path' and 'description' are needed besides 'step' and 'action'.
    *   For **create_file**: Provide 'path' and 'description'. If the file is very simple (e.g., basic config, < 10 lines), provide the exact raw 'content' (as a string). Otherwise, provide a detailed 'generate_prompt' (as a string) for a *separate* AI call to generate the content later. Do NOT provide both 'content' and 'generate_prompt'. The 'generate_prompt' should be specific enough for another AI call to produce the full file content later.
    *   For **modify_file**: Provide 'path' and 'description' and a detailed 'modification_prompt' (as a string) describing the exact changes (e.g., "In the 'login' function, add a try-catch block around the API call.", "Import the 'Logger' class from 'src/utils/logger.ts' and add logging statements at the beginning and end of the 'processData' method."). This prompt will be used in a subsequent AI call for the modification.
6.  **JSON Output:** Format the plan strictly according to the JSON structure below. Ensure correct step numbering.

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

	/**
	 * Handles the workflow for generating and confirming an execution plan.
	 * @param userRequest The user's high-level feature request.
	 * @param apiKey The active API key.
	 */
	private async _handlePlanRequest(
		userRequest: string,
		apiKey: string
	): Promise<void> {
		// Send immediate feedback to webview
		this.postMessageToWebview({
			type: "aiResponse", // Reuse aiResponse with isLoading
			value: "Minovative Mind is generating an execution plan...",
			isLoading: true,
		});
		this._currentPlan = null; // Clear any previous pending plan

		// 1. Build Context
		const projectContext = await this._buildProjectContext();
		if (projectContext.startsWith("[Error")) {
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error generating plan: Failed to build project context. ${projectContext}`,
				isLoading: false,
				isError: true,
			});
			// Re-enable input
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}

		// 2. Create Planning Prompt
		const planningPrompt = this._createPlanningPrompt(
			userRequest,
			projectContext
		);

		// --- DIAGNOSTIC LOG (optional) ---
		// console.log("--- Sending Planning Prompt to Gemini ---");
		// console.log(planningPrompt);
		// console.log("--- End Planning Prompt ---");

		// 3. Call AI for Plan Generation
		let planJsonString = "";
		try {
			// Use a *separate* history or no history for planning calls.
			// Let's stick with *no* chat history for the planning call itself
			// to ensure the AI focuses on the JSON plan format strictly.
			planJsonString = await generateContent(apiKey, planningPrompt);

			// --- DIAGNOSTIC LOG (optional) ---
			// console.log("--- Received Plan Response from Gemini ---");
			// console.log(planJsonString);
			// console.log("--- End Plan Response ---");

			// Attempt to clean potential markdown fences or surrounding text
			planJsonString = planJsonString
				.replace(/^```json\n?/, "") // Remove ```json potentially followed by newline
				.replace(/^```\n?/, "") // Remove ``` potentially followed by newline
				.replace(/\n?```$/, "") // Remove ``` at the end
				.trim();

			// Basic check if the response looks like JSON before parsing
			if (
				!planJsonString.startsWith("{") ||
				!planJsonString.endsWith("}") ||
				planJsonString.length < 10 // Minimum length for a valid plan
			) {
				console.error("AI response doesn't look like JSON:", planJsonString);
				throw new Error(
					"AI did not return a valid JSON plan. Ensure the model is instructed to ONLY output JSON.\nRaw Response:\n" +
						planJsonString.substring(0, 500) +
						(planJsonString.length > 500 ? "..." : "") // Log partial raw response
				);
			}
		} catch (error) {
			console.error("Error getting plan from Gemini:", error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error generating plan: ${errorMsg}`,
				isLoading: false,
				isError: true,
			});
			// Add error to history as well
			this._addHistoryEntry("model", `Error generating plan: ${errorMsg}`);
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}

		// 4. Parse and Validate
		const plan: ExecutionPlan | null = parseAndValidatePlan(planJsonString);

		if (!plan) {
			const errorDetail =
				"Failed to parse or validate the execution plan JSON received from the AI. The response might be malformed. Check the Developer Tools console for the raw response.";
			console.error(errorDetail, "Raw:", planJsonString); // Log raw response on error
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error: ${errorDetail}`,
				isLoading: false,
				isError: true,
			});
			// Add the failure and raw response to chat history for user visibility
			this._addHistoryEntry(
				"model",
				`Error: Failed to parse/validate plan.\nRaw Response:\n\`\`\`json\n${planJsonString}\n\`\`\``
			);
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}

		// 5. Store and Present Plan for Confirmation
		this._currentPlan = plan; // Store the valid plan
		// Add the received plan (stringified) to chat history for review
		this._addHistoryEntry(
			"model",
			`Plan Generated:\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\``
		);

		// Format a user-friendly display text for the chat window
		let planDisplayText = `**Execution Plan Proposed:**\n*${
			plan.planDescription || "No description provided."
		}*\n\n`;
		if (plan.steps && plan.steps.length > 0) {
			plan.steps.forEach((step, index) => {
				planDisplayText += `**Step ${index + 1}: ${
					step.action ? step.action.replace(/_/g, " ") : "Unknown Action"
				}**\n`;
				planDisplayText += `   - ${step.description || "No description."}\n`;
				if (step.path) {
					planDisplayText += `   - Path: \`${step.path}\`\n`;
				}
				if (isCreateFileStep(step)) {
					if (step.content !== undefined) {
						// Use !== undefined as content could be empty string
						planDisplayText += `   - Content: Provided (short)\n`;
					} else if (step.generate_prompt) {
						planDisplayText += `   - To Generate: ${step.generate_prompt.substring(
							0,
							80
						)}...\n`;
					}
				} else if (isModifyFileStep(step)) {
					planDisplayText += `   - To Modify: ${step.modification_prompt.substring(
						0,
						80
					)}...\n`;
				}
				planDisplayText += "\n"; // Add newline after each step
			});
		} else {
			planDisplayText += "The AI did not generate any steps for this plan.\n\n";
		}
		planDisplayText += `\nDo you want to execute this plan?`; // Prompt for action

		// Send message to webview to display the plan and confirmation buttons
		this.postMessageToWebview({
			type: "aiResponse",
			value: planDisplayText, // Send formatted plan text for display
			isLoading: false, // Turn off loading spinner
			requiresConfirmation: true, // Flag for webview to show buttons
			planData: plan, // Send the actual plan object to webview state for execution
		});

		// Input will be disabled by the webview upon receiving requiresConfirmation: true
	}

	/**
	 * Handles regular (non-planning) chat messages.
	 * @param userMessage The user's message.
	 * @param apiKey The active API key.
	 */
	private async _handleRegularChat(
		userMessage: string,
		apiKey: string
	): Promise<void> {
		this.postMessageToWebview({
			type: "aiResponse",
			value: "Minovative Mind is thinking...",
			isLoading: true,
		});
		this._currentPlan = null; // Clear any pending plan if regular chat starts

		const projectContext = await this._buildProjectContext();
		if (projectContext.startsWith("[Error")) {
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error processing message: Failed to build project context. ${projectContext}`,
				isLoading: false,
				isError: true,
			});
			// Re-enable input
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}

		// Prepare history for the API call (ensure the last user message isn't sent *in* the history)
		// This prevents the model from seeing the current user message twice (once in history, once in prompt)
		const historyForApi = [...this._chatHistory];
		if (
			historyForApi.length > 0 &&
			historyForApi[historyForApi.length - 1].role === "user" &&
			historyForApi[historyForApi.length - 1].parts[0].text === userMessage // Make sure it's the current message
		) {
			historyForApi.pop();
		}

		// Construct the prompt (keep existing logic, ensure Markdown is allowed for chat)
		const finalPrompt = `
You are an AI assistant called Minovative Mind integrated into VS Code. Below is some context about the user's current project. Use this context ONLY as background information to help answer the user's query accurately. Do NOT explicitly mention that you analyzed the context or summarize the project files unless the user specifically asks you to. Focus directly on answering the user's query. Use Markdown formatting for code blocks where appropriate. Keep things concise but informative.

*** Project Context (Reference Only) ***
${projectContext}
*** End Project Context ***

--- User Query ---
${userMessage}
--- End User Query ---

Assistant Response:
`;
		// --- DIAGNOSTIC LOG (optional) ---
		// console.log("--- Sending Regular Chat Prompt to Gemini ---");
		// console.log(finalPrompt);
		// console.log("--- End Regular Chat Prompt ---");

		try {
			const aiResponseText = await generateContent(
				apiKey,
				finalPrompt,
				historyForApi // Pass history
			);

			this._addHistoryEntry("model", aiResponseText); // Add AI response to history
			this.postMessageToWebview({
				// Send response to webview
				type: "aiResponse",
				value: aiResponseText,
				isLoading: false,
				isError: aiResponseText.toLowerCase().startsWith("error:"),
			});
		} catch (error) {
			console.error("Unhandled error during chat generation:", error);
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error: ${errorMessage}`,
				isLoading: false,
				isError: true,
			});
			// Add error to history
			this._addHistoryEntry("model", `Error: ${errorMessage}`);
		}
		// Re-enable input (handled by webview based on isLoading=false)
		// this.postMessageToWebview({ type: "reenableInput" }); // Webview manages this
	}

	/**
	 * Builds the project context string.
	 * @returns Project context string or an error placeholder.
	 */
	private async _buildProjectContext(): Promise<string> {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders && workspaceFolders.length > 0) {
				const rootFolder = workspaceFolders[0];
				console.log("Scanning workspace for context...");
				const relevantFiles = await scanWorkspace({
					respectGitIgnore: true,
					// Consider adding settings here later for custom ignores, maxDepth, etc.
				});

				if (relevantFiles.length > 0) {
					console.log(
						`Found ${relevantFiles.length} relevant files. Building context string...`
					);
					const projectContext = await buildContextString(
						relevantFiles,
						rootFolder.uri
						// Consider adding settings here later for maxFileLength, maxTotalLength
					);
					console.log(`Context built (${projectContext.length} characters).`);
					return projectContext;
				} else {
					console.log("No relevant files found for context.");
					return "[No relevant files found in workspace]";
				}
			} else {
				console.log("No workspace open, skipping context building.");
				return "[No workspace open]";
			}
		} catch (scanOrBuildError) {
			console.error(
				"Error during workspace scan or context build:",
				scanOrBuildError
			);
			vscode.window.showErrorMessage("Failed to prepare project context.");
			return `[Error building project context: ${
				scanOrBuildError instanceof Error
					? scanOrBuildError.message
					: String(scanOrBuildError)
			}]`;
		}
	}

	// --- Plan Execution Logic ---
	private async _executePlan(
		plan: ExecutionPlan,
		apiKey: string
	): Promise<void> {
		this.postMessageToWebview({
			type: "statusUpdate",
			value: `Starting execution: ${plan.planDescription}`,
		});
		// Don't add the execution plan JSON to history again, it was added after generation.
		// Just add a simple message indicating execution started.
		this._addHistoryEntry("model", "Initiating plan execution...");

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
			this.postMessageToWebview({ type: "reenableInput" }); // Re-enable input on immediate failure
			return;
		}
		const rootUri = workspaceFolders[0].uri;
		let executionOk = true;
		let stepIndex = 0; // Use index to iterate, step.step is just for logging

		// Wrap execution in VS Code Progress Notification
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Minovative Mind: Executing Plan - ${
					plan.planDescription || "No description"
				}`,
				cancellable: false, // Making this cancellable requires cancellation token propagation
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
					executionOk = true; // Consider no steps as successful execution of an empty plan
					return; // Exit progress callback
				}

				for (const step of plan.steps!) {
					// Use ! assertion after checking totalSteps
					stepIndex++; // Increment step index for progress reporting
					const stepDescription = step.description || "No description";
					const stepPath = step.path || "";

					progress.report({
						message: `Step ${step.step}/${totalSteps}: ${step.action.replace(
							/_/g,
							" "
						)} - ${stepPath}...`,
						increment: (1 / totalSteps) * 100, // Estimate progress
					});

					this.postMessageToWebview({
						type: "statusUpdate",
						value: `Executing Step ${
							step.step
						}/${totalSteps}: ${step.action.replace(/_/g, " ")} - ${stepPath}`,
					});

					try {
						switch (step.action) {
							case PlanStepAction.CreateDirectory:
								if (isCreateDirectoryStep(step)) {
									// Check for valid path
									if (
										!step.path ||
										path.isAbsolute(step.path) ||
										step.path.includes("..")
									) {
										throw new Error(`Invalid directory path: ${step.path}`);
									}
									const dirUri = vscode.Uri.joinPath(rootUri, step.path);
									// Use `createDirectory` with `recursive: true` for nested directories
									await vscode.workspace.fs.createDirectory(dirUri);
									console.log(`Created directory: ${step.path}`);
									this._addHistoryEntry(
										"model",
										`Step ${step.step} OK: Created directory \`${step.path}\``
									);
								} else {
									throw new Error("Invalid CreateDirectoryStep structure.");
								}
								break;

							case PlanStepAction.CreateFile:
								if (isCreateFileStep(step)) {
									// Check for valid path
									if (
										!step.path ||
										path.isAbsolute(step.path) ||
										step.path.includes("..")
									) {
										throw new Error(`Invalid file path: ${step.path}`);
									}
									const fileUri = vscode.Uri.joinPath(rootUri, step.path);
									let contentToWrite = "";

									if (step.content !== undefined && step.content !== null) {
										// Check specifically for presence
										contentToWrite = step.content;
										console.log(
											`Step ${step.step}: Using provided content for ${step.path}`
										);
									} else if (step.generate_prompt) {
										// --- AI Call for Content Generation ---
										console.log(
											`Step ${step.step}: Calling AI to generate content for ${step.path}`
										);
										this.postMessageToWebview({
											type: "statusUpdate",
											value: `Step ${step.step}/${totalSteps}: Generating content for ${step.path}...`,
										});

										const generationPrompt = `
										You are an AI programmer. Generate the complete raw file content for the following request.
										Provide ONLY the raw code or text for the file, without any explanations, comments about the code, or markdown formatting like backticks. The entire response must be the file content. Add comments to your code to help the user understand the code

										File Path: ${step.path}
										Instructions: ${step.generate_prompt}

										File Content:
										`;
										// Consider adding relevant context snippet here if possible/needed
										// For now, let's omit history for content generation to keep it focused
										contentToWrite = await generateContent(
											apiKey,
											generationPrompt
										);

										// Basic check for errors from generation API call
										if (contentToWrite.toLowerCase().startsWith("error:")) {
											throw new Error(
												`AI content generation failed: ${contentToWrite}`
											);
										}
										// Attempt to remove potential markdown fences or surrounding text
										contentToWrite = contentToWrite
											.replace(/^```[a-z]*\n?/, "") // Remove leading fence
											.replace(/^```\n?/, "") // Remove leading fence without language
											.replace(/\n?```$/, "") // Remove trailing fence
											.trim();

										console.log(
											`Step ${step.step}: Generated content (${contentToWrite.length} chars) for ${step.path}`
										);
										// --- End AI Call ---
									} else {
										// Case where neither content nor generate_prompt is provided (handled by validator, but defensive)
										throw new Error(
											"CreateFileStep must have 'content' or 'generate_prompt'."
										);
									}
									await vscode.workspace.fs.writeFile(
										fileUri,
										Buffer.from(contentToWrite, "utf-8")
									);
									console.log(`Created file: ${step.path}`);
									this._addHistoryEntry(
										"model",
										`Step ${step.step} OK: Created file \`${step.path}\``
									);
									// Optional: Open the newly created file
									// vscode.window.showTextDocument(fileUri);
								} else {
									throw new Error("Invalid CreateFileStep structure.");
								}
								break;

							case PlanStepAction.ModifyFile:
								if (isModifyFileStep(step)) {
									// Check for valid path
									if (
										!step.path ||
										path.isAbsolute(step.path) ||
										step.path.includes("..")
									) {
										throw new Error(
											`Invalid file path for modification: ${step.path}`
										);
									}
									const fileUri = vscode.Uri.joinPath(rootUri, step.path);
									let existingContent = "";
									try {
										const contentBytes = await vscode.workspace.fs.readFile(
											fileUri
										);
										existingContent =
											Buffer.from(contentBytes).toString("utf-8");
									} catch (readError: any) {
										// Handle file not found specifically
										if (readError.code === "FileNotFound") {
											throw new Error(
												`File to modify not found: \`${step.path}\``
											);
										}
										throw readError; // Re-throw other read errors
									}

									// --- AI Call for Modification ---
									console.log(
										`Step ${step.step}: Calling AI to modify content for ${step.path}`
									);
									this.postMessageToWebview({
										type: "statusUpdate",
										value: `Step ${step.step}/${totalSteps}: Generating modifications for ${step.path}...`,
									});

									const modificationPrompt = `
You are an AI programmer. Modify the following code based on the instructions.
Provide ONLY the complete, raw, modified code for the entire file. Do not include explanations, comments about the changes (unless specifically asked in the instructions), or markdown formatting. The entire response must be the final file content.

File Path: ${step.path}
Modification Instructions: ${step.modification_prompt}

--- Existing File Content ---
\`\`\`
${existingContent}
\`\`\`
--- End Existing File Content ---

Complete Modified File Content:
`;
									// Again, omit history for modification generation focus
									let modifiedContent = await generateContent(
										apiKey,
										modificationPrompt
									);

									// Basic check for errors from modification API call
									if (modifiedContent.toLowerCase().startsWith("error:")) {
										throw new Error(
											`AI modification failed: ${modifiedContent}`
										);
									}
									// Attempt to remove potential markdown fences
									modifiedContent = modifiedContent
										.replace(/^```[a-z]*\n?/, "") // Remove leading fence
										.replace(/^```\n?/, "") // Remove leading fence without language
										.replace(/\n?```$/, "") // Remove trailing fence
										.trim();

									if (modifiedContent === existingContent) {
										console.log(
											`Step ${step.step}: AI returned identical content for ${step.path}. Skipping write.`
										);
										this._addHistoryEntry(
											"model",
											`Step ${step.step} OK: Modification for \`${step.path}\` resulted in no changes.`
										);
									} else {
										// --- Apply Edit ---
										const edit = new vscode.WorkspaceEdit();
										// To replace the entire file, get the range from start (0,0)
										// to the end of the last line of the existing content.
										const lastLine = existingContent.split(/\r?\n/).length - 1;
										const fullRange = new vscode.Range(
											new vscode.Position(0, 0),
											new vscode.Position(
												lastLine,
												existingContent.split(/\r?\n/)[lastLine].length
											)
										);

										// Clear the file content first to handle cases where new content is shorter
										edit.replace(
											fileUri,
											new vscode.Range(
												new vscode.Position(0, 0),
												new vscode.Position(9999, 9999)
											),
											""
										);
										// Then insert the new content
										edit.insert(
											fileUri,
											new vscode.Position(0, 0),
											modifiedContent
										);

										const success = await vscode.workspace.applyEdit(edit);
										if (!success) {
											throw new Error(
												`Failed to apply modifications to \`${step.path}\``
											);
										}
										console.log(`Modified file: ${step.path}`);
										this._addHistoryEntry(
											"model",
											`Step ${step.step} OK: Modified file \`${step.path}\``
										);
										// Optional: Open the modified file after it's changed
										// vscode.window.showTextDocument(fileUri);
									}
									// --- End Apply Edit ---
								} else {
									throw new Error("Invalid ModifyFileStep structure.");
								}
								break;

							default:
								console.warn(`Unsupported plan action: ${step.action}`);
								this.postMessageToWebview({
									type: "statusUpdate",
									value: `Step ${step.step}/${totalSteps} SKIPPED: Unsupported action ${step.action}`,
								});
								this._addHistoryEntry(
									"model",
									`Step ${step.step} SKIPPED: Unsupported action ${step.action}`
								);
								// Do not set executionOk = false or break; for unsupported actions, just skip
								break;
						}
					} catch (error) {
						executionOk = false;
						const errorMsg =
							error instanceof Error ? error.message : String(error);
						console.error(
							`Error executing step ${step.step} (${step.action}, Path: ${stepPath}):`,
							error
						);
						this.postMessageToWebview({
							type: "statusUpdate",
							value: `Error on Step ${step.step}/${totalSteps}: ${errorMsg}`,
							isError: true,
						});
						this._addHistoryEntry(
							"model",
							`Step ${step.step} FAILED: ${errorMsg}`
						);
						break; // Stop execution on the first error
					}
				} // End loop through steps

				// Report final progress
				progress.report({
					message: executionOk ? "Execution complete." : "Execution failed.",
					increment: 100,
				});
			} // End progress task function
		); // End withProgress

		// Execution finished (either succeeded or failed)
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
			// The specific step failure was already added to history
		}

		// Re-enable input after execution attempt (whether success or failure)
		this.postMessageToWebview({ type: "reenableInput" });
	} // End _executePlan

	/** Post message helper */
	public postMessageToWebview(message: any) {
		if (this._view) {
			this._view.webview.postMessage(message);
		} else {
			console.warn("Sidebar view not available to post message:", message);
		}
	}

	// --- HTML Generation ---
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

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="
						default-src 'none';
						style-src ${webview.cspSource} 'unsafe-inline';
						/* font-src ${webview.cspSource}; */ /* Comment out if not using icons */
						img-src ${webview.cspSource} https: data:;
						script-src 'nonce-${nonce}';
						connect-src 'none';
				">
				<link href="${stylesUri}" rel="stylesheet">
				<title>Minovative Mind Chat</title>
		</head>
		<body>
				<!-- Chat Area -->
				<div class="chat-controls">
					 <h1>Minovative Mind</h1>
						<div>
								<button id="save-chat-button" title="Save Chat">Save</button>
								<button id="load-chat-button" title="Load Chat">Load</button>
								<button id="clear-chat-button" title="Clear Chat">Clear</button>
						</div>
				</div>
				<div id="chat-container">
						<!-- Chat messages and dynamically added plan confirmation buttons will appear here -->
				</div>

				<!-- Status Area -->
				<div id="status-area"></div>

				<!-- Input Area -->
				<div id="input-container">
						<textarea id="chat-input" rows="3" placeholder="Enter message or @plan [request]..."></textarea>
						<button id="send-button" title="Send Message">Send</button>
				</div>

				<!-- API Key Management -->
				<div class="section">
						<h2>API Key Management</h2>
						<div class="key-management-controls">
								 <button id="prev-key-button" title="Previous Key" disabled>&lt;</button>
								 <span id="current-key-display">No keys stored</span>
								<button id="next-key-button" title="Next Key" disabled>&gt;</button>
								<button id="delete-key-button" title="Delete Current Key" disabled>Del</button>
						</div>
						 <div id="api-key-status">Please add an API key.</div>

						<div class="add-key-container">
								<input type="password" id="add-key-input" placeholder="Add new Gemini API Key">
								<button id="add-key-button" title="Add API Key">Add</button>
						</div>
						<p><small>Keys are stored securely using VS Code SecretStorage.</small></p>
				</div>

				<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
		 </body>
		</html>`;
	}
}

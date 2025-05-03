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
	isRunCommandStep, // <-- Import the new type guard
	parseAndValidatePlan,
} from "../ai/workflowPlanner";

// Secret storage keys
const GEMINI_API_KEYS_LIST_SECRET_KEY = "geminiApiKeysList";
const GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY = "geminiActiveApiKeyIndex";

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
	private _apiKeyList: string[] = [];
	private _activeKeyIndex: number = -1;
	private _chatHistory: HistoryEntry[] = [];
	private _currentPlan: ExecutionPlan | null = null;

	constructor(
		private readonly _extensionUri_in: vscode.Uri,
		context: vscode.ExtensionContext
	) {
		this._extensionUri = _extensionUri_in;
		this._secretStorage = context.secrets;

		// Keep the onDidChange listener
		context.secrets.onDidChange((e) => {
			if (
				e.key === GEMINI_API_KEYS_LIST_SECRET_KEY ||
				e.key === GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
			) {
				console.log(`Secret key changed: ${e.key}. Reloading keys.`);
				// Use the new initialize method for reloads too, ensuring consistency
				this.initialize().catch((err) => {
					console.error("Error reloading keys on secret change:", err);
					// Handle potential errors during reload if necessary
				});
			}
		});
		// REMOVE this._loadKeysFromStorage(); from here
	}

	/**
	 * Asynchronously initializes the provider by loading keys from storage.
	 * Should be called after construction and awaited in extension.ts.
	 */
	public async initialize(): Promise<void> {
		console.log("SidebarProvider initializing: Loading keys...");
		await this._loadKeysFromStorage();
		console.log("SidebarProvider initialization complete.");
	}

	// --- Key Management Logic ---

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
				// Update storage only if correction was needed or list is empty
				const storedIndex = activeIndexStr ? parseInt(activeIndexStr, 10) : -2; // Use -2 to differentiate from valid -1
				if (potentialIndex !== storedIndex) {
					if (potentialIndex !== -1) {
						await this._secretStorage.store(
							GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
							String(potentialIndex)
						);
						console.log(`Corrected active index to ${potentialIndex}`);
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
			// It's okay to reset the client here, initialization will happen on first use
			resetClient();
			// Update webview *if* it's already resolved.
			// If called during initial activation, _view will be undefined, which is fine.
			this._updateWebviewKeyList();
		} catch (error) {
			console.error("Error loading API keys from storage:", error);
			this._apiKeyList = [];
			this._activeKeyIndex = -1;
			vscode.window.showErrorMessage("Failed to load API keys.");
			// Ensure webview is updated even on error
			this._updateWebviewKeyList();
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
			resetClient();
		} catch (error) {
			saveError = error;
			console.error("Error saving API keys to storage:", error);
		}
		this._updateWebviewKeyList();
		if (saveError) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Error: Failed to save key changes.",
			});
		}
	}

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
		await this._saveKeysToStorage();
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
				isError: true, // Added for consistency
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

		console.log(
			`[Minovative Mind] Key deleted. Old index: ${oldIndex}, New active index: ${this._activeKeyIndex}`
		);

		await this._saveKeysToStorage();

		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ...${deletedKey.slice(-4)} deleted.`,
		});
	}

	private async _switchToNextApiKey() {
		if (this._apiKeyList.length <= 1 || this._activeKeyIndex === -1) {
			return;
		}
		this._activeKeyIndex = (this._activeKeyIndex + 1) % this._apiKeyList.length;
		await this._saveKeysToStorage();
		const newKey = this._apiKeyList[this._activeKeyIndex];
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Switched to key ...${newKey.slice(-4)}.`,
		});
	}

	private async _switchToPreviousApiKey() {
		if (this._apiKeyList.length <= 1 || this._activeKeyIndex === -1) {
			return;
		}
		this._activeKeyIndex =
			(this._activeKeyIndex - 1 + this._apiKeyList.length) %
			this._apiKeyList.length;
		await this._saveKeysToStorage();
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
		return undefined;
	}

	// --- Chat History & Actions ---

	private _addHistoryEntry(role: "user" | "model", text: string) {
		this._chatHistory.push({ role, parts: [{ text }] });
		const MAX_HISTORY_ITEMS = 50;
		if (this._chatHistory.length > MAX_HISTORY_ITEMS) {
			this._chatHistory.shift();
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
				"Text Files": ["txt"],
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

				if (
					Array.isArray(loadedData) &&
					loadedData.every(
						(item) =>
							item &&
							typeof item.sender === "string" &&
							typeof item.text === "string" &&
							(item.sender === "User" ||
								item.sender === "Gemini" ||
								item.sender === "System")
					)
				) {
					this._chatHistory = []; // Clear current history
					this._chatHistory = loadedData.map(
						(item: ChatMessage): HistoryEntry => ({
							role: item.sender === "User" ? "user" : "model",
							parts: [{ text: item.text }],
						})
					);

					this.postMessageToWebview({
						type: "restoreHistory",
						value: loadedData,
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

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (data) => {
			console.log(`[Provider] Message received: ${data.type}`);

			switch (data.type) {
				// --- Plan Execution Handling ---
				case "planRequest": {
					const userRequest = data.value;
					const activeKey = this.getActiveApiKey();
					if (!activeKey) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: No active API Key set.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					this._addHistoryEntry("user", `@plan ${userRequest}`);
					await this._handlePlanRequest(userRequest, activeKey);
					break;
				}
				case "confirmPlanExecution": {
					const planToExecute = data.value as ExecutionPlan | null;
					const currentActiveKey = this.getActiveApiKey();
					if (!currentActiveKey) {
						this.postMessageToWebview({
							type: "statusUpdate",
							value: "Error: Cannot execute plan - no active API key.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					if (planToExecute) {
						await this._executePlan(planToExecute, currentActiveKey);
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
					if (!activeKey) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: No active API Key set.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						return;
					}
					this._addHistoryEntry("user", userMessage);
					await this._handleRegularChat(userMessage, activeKey);
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
				case "webviewReady":
					this._updateWebviewKeyList();
					this._restoreChatHistoryToWebview();
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
			`Are you sure you want to delete ${keyIdentifier}?`,
			{ modal: true },
			"Delete Key"
		);

		if (confirmation === "Delete Key") {
			if (this._activeKeyIndex === keyToDeleteIndex) {
				await this._deleteActiveApiKey();
			} else {
				this.postMessageToWebview({
					type: "apiKeyStatus",
					value: "Info: Active key changed, deletion aborted.",
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
					"generate_prompt": "...", // For complex create_file
					"modification_prompt": "...", // For modify_file
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
    *   For **create_directory**: Provide 'path' and 'description'.
    *   For **create_file**: Provide 'path', 'description', and EITHER 'content' (for simple files <10 lines) OR a specific 'generate_prompt'.
    *   For **modify_file**: Provide 'path', 'description', and a detailed 'modification_prompt'.
    *   For **run_command**: Provide 'description' and the exact shell 'command' to run (e.g., "npm install @fortawesome/fontawesome-svg-core --save", "yarn add react-router-dom", "pnpm install --save-dev eslint"). **IMPORTANT:** Use this action for installing/adding dependencies *instead* of modifying package.json directly for dependencies. Base the command (npm/yarn/pnpm) on the project's likely package manager (check for lock files mentioned in context). Determine if it's a dev dependency (--save-dev / -D) or regular dependency. Place this step *after* any steps that might require the dependency.
6.  JSON Output: Format the plan strictly according to the JSON structure below. Ensure correct step numbering and only include relevant properties for each action type.

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
		apiKey: string
	): Promise<void> {
		this.postMessageToWebview({
			type: "aiResponse",
			value: "Minovative Mind is generating an execution plan...",
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
			planJsonString = await generateContent(apiKey, planningPrompt);
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
		this._addHistoryEntry(
			"model",
			`Plan Generated:\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\``
		);

		let planDisplayText = `**Execution Plan Proposed:**\n*${
			plan.planDescription || "No description."
		}*\n\n`;
		if (plan.steps && plan.steps.length > 0) {
			plan.steps.forEach((step: PlanStep, index: number) => {
				// Added types here
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
				} else if (isRunCommandStep(step)) {
					planDisplayText += `   - Command: \`${step.command}\`\n`;
				}
				planDisplayText += "\n";
			});
		} else {
			planDisplayText += "The AI did not generate any steps for this plan.\n\n";
		}
		planDisplayText += `\nDo you want to execute this plan?`;

		this.postMessageToWebview({
			type: "aiResponse",
			value: planDisplayText,
			isLoading: false,
			requiresConfirmation: true,
			planData: plan,
		});
	}

	private async _handleRegularChat(
		userMessage: string,
		apiKey: string
	): Promise<void> {
		this.postMessageToWebview({
			type: "aiResponse",
			value: "Minovative Mind is thinking...",
			isLoading: true,
		});
		this._currentPlan = null;

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
		if (
			historyForApi.length > 0 &&
			historyForApi[historyForApi.length - 1].role === "user" &&
			historyForApi[historyForApi.length - 1].parts[0].text === userMessage
		) {
			historyForApi.pop();
		}

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

		try {
			const aiResponseText = await generateContent(
				apiKey,
				finalPrompt,
				historyForApi
			);
			this._addHistoryEntry("model", aiResponseText);
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
			if (workspaceFolders && workspaceFolders.length > 0) {
				const rootFolder = workspaceFolders[0];
				const relevantFiles = await scanWorkspace({ respectGitIgnore: true });
				if (relevantFiles.length > 0) {
					return await buildContextString(relevantFiles, rootFolder.uri);
				} else {
					return "[No relevant files found in workspace]";
				}
			} else {
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
					progress.report({
						message: `Step ${step.step}/${totalSteps}: ${step.action.replace(
							/_/g,
							" "
						)}...`,
						increment: (1 / totalSteps) * 100,
					});
					const stepPath = step.path || "";
					const stepCommand = step.command || ""; // For logging RunCommand

					this.postMessageToWebview({
						type: "statusUpdate",
						value: `Executing Step ${
							step.step
						}/${totalSteps}: ${step.action.replace(/_/g, " ")} ${
							step.action === PlanStepAction.RunCommand
								? `- '${stepCommand}'`
								: `- ${stepPath}`
						}`,
					});

					try {
						switch (step.action) {
							case PlanStepAction.CreateDirectory:
							case PlanStepAction.CreateFile:
							case PlanStepAction.ModifyFile:
								if (isCreateDirectoryStep(step)) {
									const dirUri = vscode.Uri.joinPath(rootUri, step.path);
									await vscode.workspace.fs.createDirectory(dirUri);
								} else if (isCreateFileStep(step)) {
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
								} else if (isModifyFileStep(step)) {
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
										const lastLine = existingContent.split(/\r?\n/).length - 1;
										const fullRange = new vscode.Range(
											new vscode.Position(0, 0),
											new vscode.Position(
												lastLine,
												existingContent.split(/\r?\n/)[lastLine].length
											)
										);
										// Clear first, then insert (safer for shorter replacements)
										edit.replace(
											fileUri,
											new vscode.Range(
												new vscode.Position(0, 0),
												new vscode.Position(9999, 9999)
											),
											""
										);
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
									} else {
										console.log(
											`Step ${step.step}: AI returned identical content for ${step.path}. Skipping write.`
										);
										this._addHistoryEntry(
											"model",
											`Step ${step.step} OK: Modification for \`${step.path}\` resulted in no changes.`
										);
										continue; // Skip the final log for this specific case
									}
								} else {
									throw new Error(
										`Internal error: Step ${step.step} action ${step.action} structure mismatch.`
									);
								}
								console.log(`${step.action} OK: ${stepPath}`);
								this._addHistoryEntry(
									"model",
									`Step ${step.step} OK: ${step.action.replace(
										/_/g,
										" "
									)} \`${stepPath}\``
								);
								break;

							case PlanStepAction.RunCommand:
								if (isRunCommandStep(step)) {
									const commandToRun = step.command;
									const userChoice = await vscode.window.showWarningMessage(
										`The plan wants to run a command in the terminal:\n\n\`${commandToRun}\`\n\nThis could install packages or modify your system. Allow?`,
										{ modal: true },
										"Allow Command",
										"Skip Command"
									);

									if (userChoice === "Allow Command") {
										try {
											const term = vscode.window.createTerminal({
												name: `Plan Step ${step.step}`,
												cwd: rootUri.fsPath,
											});
											term.sendText(commandToRun);
											term.show();
											this.postMessageToWebview({
												type: "statusUpdate",
												value: `Step ${step.step}: Running command '${commandToRun}' in terminal...`,
											});
											this._addHistoryEntry(
												"model",
												`Step ${step.step} OK: User allowed running command \`${commandToRun}\`.`
											);
										} catch (termError) {
											const errorMsg =
												termError instanceof Error
													? termError.message
													: String(termError);
											throw new Error(
												`Failed to run command '${commandToRun}': ${errorMsg}`
											); // Treat terminal error as plan failure
										}
									} else {
										this.postMessageToWebview({
											type: "statusUpdate",
											value: `Step ${step.step}: Skipped command '${commandToRun}'.`,
											isError: false,
										});
										this._addHistoryEntry(
											"model",
											`Step ${step.step} SKIPPED: User did not allow command \`${commandToRun}\`.`
										);
										// Continue the plan even if command is skipped
									}
								} else {
									throw new Error("Invalid RunCommandStep structure.");
								}
								break;

							default:
								console.warn(`Unsupported plan action: ${step.action}`);
								this._addHistoryEntry(
									"model",
									`Step ${step.step} SKIPPED: Unsupported action ${step.action}`
								);
								break;
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
			console.warn("Sidebar view not available to post message:", message);
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
		// --- Font Awesome CDN Link ---
		const fontAwesomeUri =
			"https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"; // Using CDNJS as an example

		const nonce = getNonce();

		// --- Updated CSP ---
		const cspSource = webview.cspSource;
		const csp = `
			default-src 'none';
			style-src ${cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com;
			font-src https://cdnjs.cloudflare.com;
			img-src ${cspSource} https: data:;
			script-src 'nonce-${nonce}';
			connect-src 'none';
		`;

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="${csp}">
				<link href="${stylesUri}" rel="stylesheet">
				<!-- Font Awesome -->
				<link href="${fontAwesomeUri}" rel="stylesheet" integrity="sha512-SnH5WK+bZxgPHs44uWIX+LLJAJ9/2PkPKZ5QiAj6Ta86w+fsb2TkcmfRyVX3pBnMFcV7oQPJkl9QevSCWr3W6A==" crossorigin="anonymous" referrerpolicy="no-referrer" />
				<title>Minovative Mind Chat</title>
		</head>
		<body>
				<div class="chat-controls">
					 <h1>Minovative Mind</h1> <!-- Example Icon -->
						<div>
								<button id="save-chat-button" title="Save Chat"><i class="fa-regular fa-floppy-disk"></i></button>
								<button id="load-chat-button" title="Load Chat"><i class="fa-regular fa-folder-open"></i></button>
								<button id="clear-chat-button" title="Clear Chat"><i class="fa-solid fa-trash-can"></i></button>
						</div>
				</div>
				<div id="chat-container">
						<!-- Chat messages will appear here -->
				</div>
                <!-- Plan confirmation buttons will be injected after chat-container by main.ts if needed -->
				<div id="status-area"></div>
				<div id="input-container">
						<textarea id="chat-input" rows="3" placeholder="Enter message or @plan [request]..."></textarea>
						<button id="send-button" title="Send Message"><i class="fa-solid fa-paper-plane"></i></button>
				</div>
				<div class="section">
						<h2><i class="fa-solid fa-key"></i> API Key Management</h2>
						<div class="key-management-controls">
								 <button id="prev-key-button" title="Previous Key" disabled><i class="fa-solid fa-chevron-left"></i></button>
								 <span id="current-key-display">No keys stored</span>
								<button id="next-key-button" title="Next Key" disabled><i class="fa-solid fa-chevron-right"></i></button>
								<button id="delete-key-button" title="Delete Current Key" disabled><i class="fa-solid fa-minus"></i></button>
						</div>
						 <div id="api-key-status">Please add an API key.</div>
						<div class="add-key-container">
								<input type="password" id="add-key-input" placeholder="Add new Gemini API Key">
								<button id="add-key-button" title="Add API Key"><i class="fa-solid fa-plus"></i></button>
						</div>
						<p><small>Keys are stored securely using VS Code SecretStorage.</small></p>
				</div>
				<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
		 </body>
		</html>`;
	}
}

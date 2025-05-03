import * as vscode from "vscode";
import { getNonce } from "../utilities/nonce";
import { generateContent, resetClient } from "../ai/gemini";
import { scanWorkspace } from "../context/workspaceScanner";
import { buildContextString } from "../context/contextBuilder";

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

// Define the structure for saving/loading chat history
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
				this._loadKeysFromStorage(); // Reload keys if secrets change externally
			}
		});
		this._loadKeysFromStorage(); // Load initial keys
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

			// Validate index
			if (potentialIndex < 0 || potentialIndex >= this._apiKeyList.length) {
				potentialIndex = this._apiKeyList.length > 0 ? 0 : -1; // Default to 0 if keys exist, else -1
				if (potentialIndex !== -1) {
					// Save the corrected default index if necessary
					await this._secretStorage.store(
						GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
						String(potentialIndex)
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
			await this._secretStorage.store(
				GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
				String(this._activeKeyIndex)
			);
			console.log(
				`Saved ${this._apiKeyList.length} keys. Active index: ${this._activeKeyIndex}`
			);
			resetClient(); // Reset Gemini client as keys/active key might have changed
		} catch (error) {
			saveError = error; // Store error to handle after UI update
			console.error("Error saving API keys to storage:", error);
			vscode.window.showErrorMessage("Failed to save API key changes.");
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
		// ... (Input validation and existing key check remain the same) ...
		if (this._apiKeyList.includes(key)) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: `Info: Key ...${key.slice(-4)} is already stored.`,
			});
			return;
		}

		this._apiKeyList.push(key);
		if (this._activeKeyIndex === -1) {
			this._activeKeyIndex = 0;
		}
		// Save changes BEFORE sending success message
		await this._saveKeysToStorage();
		// If saveKeys didn't report an error via apiKeyStatus, send success
		// (We check the status div in webview to avoid double messages if save failed)
		// A bit complex, maybe simplify later. For now, let saveKeys handle error messages.
		// If save was successful, the key list update will show the new key.
		// Let's just rely on the list update as confirmation for now.
		// this.postMessageToWebview({ type: 'apiKeyStatus', value: `Key ending in ...${key.slice(-4)} added.` });
	}

	/** Deletes the currently active API key */
	private async _deleteActiveApiKey() {
		// --- DIAGNOSTIC LOG ---
		console.log(
			`[Minovative Mind] Attempting delete. Current active index: ${this._activeKeyIndex}, Key list length: ${this._apiKeyList.length}`
		);

		if (
			this._activeKeyIndex === -1 ||
			this._activeKeyIndex >= this._apiKeyList.length
		) {
			// --- DIAGNOSTIC LOG ---
			console.log(
				"[Minovative Mind] Delete blocked: Invalid active key index."
			);
			// --- Refined Error Message ---
			this.postMessageToWebview({
				type: "apiKeyStatus",
				// Provide more context in the error message
				value:
					this._apiKeyList.length === 0
						? "Error: Cannot delete, key list is empty."
						: "Error: No active key selected to delete.",
			});
			return; // Exit if no valid active key
		}

		// --- DIAGNOSTIC LOG ---
		console.log(
			`[Minovative Mind] Proceeding to delete key at index ${
				this._activeKeyIndex
			}: ...${this._apiKeyList[this._activeKeyIndex].slice(-4)}`
		);

		// Get the key string *before* splicing
		const deletedKey = this._apiKeyList[this._activeKeyIndex];
		// Remove from list
		this._apiKeyList.splice(this._activeKeyIndex, 1);

		// Adjust active index logic
		const oldIndex = this._activeKeyIndex; // Keep track for logging
		if (this._apiKeyList.length === 0) {
			this._activeKeyIndex = -1;
		} else if (this._activeKeyIndex >= this._apiKeyList.length) {
			// If we deleted the last item
			this._activeKeyIndex = this._apiKeyList.length - 1; // Adjust to the new last item
		}
		// Note: If we deleted an item *before* the end, the _activeKeyIndex
		// might now point to the item that shifted into the deleted slot,
		// which is acceptable behavior for this adjustment logic.

		// --- DIAGNOSTIC LOG ---
		console.log(
			`[Minovative Mind] Key deleted. Old index: ${oldIndex}, New active index: ${this._activeKeyIndex}`
		);

		// Save changes, which will trigger _updateWebviewKeyList
		await this._saveKeysToStorage();

		// Send confirmation status AFTER saving and UI update attempt
		// This message might overwrite a save error message, which is acceptable here.
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ...${deletedKey.slice(-4)} deleted.`,
		});
	}

	/** Switches to the next API key in the list */
	private async _switchToNextApiKey() {
		if (this._apiKeyList.length <= 1) {
			return;
		} // No other keys to switch to

		this._activeKeyIndex = (this._activeKeyIndex + 1) % this._apiKeyList.length; // Wrap around
		await this._saveKeysToStorage(); // Save the new active index
	}

	/** Switches to the previous API key in the list */
	private async _switchToPreviousApiKey() {
		if (this._apiKeyList.length <= 1) {
			return;
		} // No other keys to switch to

		this._activeKeyIndex =
			(this._activeKeyIndex - 1 + this._apiKeyList.length) %
			this._apiKeyList.length; // Wrap around
		await this._saveKeysToStorage(); // Save the new active index
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
		// Renamed slightly for convention
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
		// to avoid excessive memory usage or overly large save files.
		// e.g., if (this._chatHistory.length > MAX_HISTORY_LENGTH) { this._chatHistory.shift(); }
	}

	private async _clearChat() {
		this._chatHistory = [];
		this.postMessageToWebview({ type: "chatCleared" });
		this.postMessageToWebview({
			type: "statusUpdate", // Use a general status update message type
			value: "Chat cleared.",
		});
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
				// Convert internal history to simpler save format
				const saveableHistory: ChatMessage[] = this._chatHistory.map(
					(entry) => ({
						sender: entry.role === "user" ? "User" : "Gemini",
						text: entry.parts[0].text, // Assuming single text part
						className: entry.role === "user" ? "user-message" : "ai-message",
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
				});
			}
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
							typeof item.text === "string"
					)
				) {
					this._chatHistory = loadedData.map(
						(item: ChatMessage): HistoryEntry => ({
							role: item.sender === "User" ? "user" : "model", // Basic mapping
							parts: [{ text: item.text }],
						})
					);

					// Send the loaded history to the webview for display
					this.postMessageToWebview({
						type: "restoreHistory",
						value: loadedData, // Send the saveable format back
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
				});
			}
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
			// Allow scripts in the webview
			enableScripts: true,

			// Restrict the webview to only loading resources from the 'dist', 'media', and 'src/sidebar/webview' directories
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, "dist"),
				vscode.Uri.joinPath(this._extensionUri, "media"),
				vscode.Uri.joinPath(this._extensionUri, "src", "sidebar", "webview"),
			],
		};

		// Set the HTML content (this line remains the same)
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview (this part remains the same)
		webviewView.webview.onDidReceiveMessage(async (data) => {
			switch (data.type) {
				case "addApiKey": // Renamed from apiKeyUpdate
					if (typeof data.value === "string") {
						await this._addApiKey(data.value.trim());
					}
					break;
				case "deleteActiveApiKey": // This case might become redundant now, but leave it for now
					console.warn(
						"[Provider] Received direct 'deleteActiveApiKey' message. This might be deprecated. Use 'requestDeleteConfirmation'."
					);
					// You could still call the confirmation logic here as a fallback if needed
					// Or just call _deleteActiveApiKey if you want to bypass confirmation from old messages
					await this._deleteActiveApiKey();
					break;

				case "requestDeleteConfirmation": {
					console.log(
						"[Provider] Received 'requestDeleteConfirmation'. Showing confirmation dialog."
					);
					// Get the key details *before* showing the dialog, in case it gets deleted while waiting
					const keyToDeleteIndex = this._activeKeyIndex;
					let keyIdentifier = "the active key";
					if (
						keyToDeleteIndex >= 0 &&
						keyToDeleteIndex < this._apiKeyList.length
					) {
						keyIdentifier = `key ...${this._apiKeyList[keyToDeleteIndex].slice(
							-4
						)}`;
					} else {
						// If somehow no key is active, prevent deletion attempt
						console.log(
							"[Provider] Delete confirmation requested, but no valid key is active."
						);
						this.postMessageToWebview({
							type: "apiKeyStatus",
							value: "Error: Cannot request deletion, no active key selected.",
						});
						return; // Exit early
					}

					const confirmation = await vscode.window.showWarningMessage(
						`Are you sure you want to delete ${keyIdentifier}?`,
						{ modal: true }, // Makes the dialog block interaction until closed
						"Delete Key" // Action button text
						// Add "Cancel" button text here if you want it explicitly,
						// otherwise dismissing the dialog counts as cancel.
					);

					if (confirmation === "Delete Key") {
						console.log(
							"[Provider] User confirmed deletion. Calling _deleteActiveApiKey."
						);
						// Double-check the index hasn't changed unexpectedly (unlikely with modal)
						if (this._activeKeyIndex === keyToDeleteIndex) {
							await this._deleteActiveApiKey();
						} else {
							console.warn(
								"[Provider] Active key index changed between confirmation request and execution. Aborting delete."
							);
							this.postMessageToWebview({
								type: "apiKeyStatus",
								value: "Info: Active key changed, deletion aborted.",
							});
						}
					} else {
						console.log("[Provider] User cancelled deletion.");
						this.postMessageToWebview({
							type: "apiKeyStatus",
							value: "Key deletion cancelled.", // Notify webview
						});
					}
					break;
				}
				// --- END NEW CASE ---

				case "switchToNextKey":
					await this._switchToNextApiKey();
					break;
				case "switchToPrevKey":
					await this._switchToPreviousApiKey();
					break;
				case "chatMessage": {
					const userMessage = data.value;
					console.log(`Chat message received: ${userMessage}`);
					const activeKey = this.getActiveApiKey();

					if (!activeKey) {
						this.postMessageToWebview({
							type: "aiResponse",
							value:
								"Error: No active API Key set. Please add or select a key.",
							isError: true, // Add flag for webview styling
						});
						return;
					}

					// Add user message to history *before* sending to AI
					this._addHistoryEntry("user", userMessage);

					let projectContext = "";
					// ... (keep existing context building logic) ...
					const workspaceFolders = vscode.workspace.workspaceFolders;
					if (workspaceFolders && workspaceFolders.length > 0) {
						const rootFolder = workspaceFolders[0];
						try {
							console.log("Scanning workspace for context...");
							const relevantFiles = await scanWorkspace({
								respectGitIgnore: true,
							});

							if (relevantFiles.length > 0) {
								console.log("Building context string...");
								projectContext = await buildContextString(
									relevantFiles,
									rootFolder.uri
								);
								console.log(`Context built (${projectContext.length} chars).`);
							} else {
								console.log("No relevant files found for context.");
								projectContext = "[No relevant files found in workspace]";
							}
						} catch (scanOrBuildError) {
							console.error(
								"Error during workspace scan or context build:",
								scanOrBuildError
							);
							vscode.window.showErrorMessage(
								"Failed to prepare project context."
							);
							projectContext = "[Error building project context]";
						}
					} else {
						console.log("No workspace open, skipping context building.");
						projectContext = "[No workspace open]";
					}

					this.postMessageToWebview({
						type: "aiResponse",
						value: "Gemini is thinking...",
						isLoading: true, // Add flag
					}); // Show thinking message immediately

					try {
						// Prepare history for the API call (use a copy)
						// Note: The Gemini SDK's startChat likely handles history limits,
						// but you could implement truncation here if needed.
						const historyForApi = [...this._chatHistory];
						// Remove the last user message from history sent *to* the API,
						// as it's part of the current prompt.
						historyForApi.pop();

						const finalPrompt = `
						You are an AI assistant called Minovative Mind integrated into VS Code. Below is some context about the user's current project. Use this context ONLY as background information to help answer the user's query accurately. Do NOT explicitly mention that you analyzed the context or summarize the project files unless the user specifically asks you to. Focus directly on answering the user's query. Dont use Markdown formatting. Keep things concise but informative.
						
						*** Project Context (Reference Only) ***
						${projectContext}
						*** End Project Context ***
						
						--- User Query ---
						${userMessage}
						--- End User Query ---
						
						Assistant Response:
						`;

						console.log("--- Sending Final Prompt to Gemini ---");
						console.log(
							finalPrompt.length > 1000
								? finalPrompt.substring(0, 1000) +
										"... (prompt truncated in log)"
								: finalPrompt
						);
						console.log("--- End Final Prompt ---");

						// Pass history to generateContent
						const aiResponseText = await generateContent(
							activeKey,
							finalPrompt,
							historyForApi // <-- Pass history here
						);

						// Add AI response to history *after* getting it
						this._addHistoryEntry("model", aiResponseText);

						// Send response to webview
						this.postMessageToWebview({
							type: "aiResponse",
							value: aiResponseText,
							isLoading: false,
							isError: aiResponseText.toLowerCase().startsWith("error:"),
						});
					} catch (error) {
						console.error("Unhandled error during chat generation:", error);
						const errorMessage =
							error instanceof Error ? error.message : String(error);
						// Don't add error to history, just display it
						this.postMessageToWebview({
							type: "aiResponse",
							value: `Error: ${errorMessage}`,
							isLoading: false,
							isError: true,
						});
					}
					break;
				} // End chatMessage case

				// --- New Cases for Chat Actions ---
				case "clearChatRequest":
					await this._clearChat();
					break;
				case "saveChatRequest":
					await this._saveChat();
					break;
				case "loadChatRequest":
					await this._loadChat();
					break;

				// --- Webview Ready Case ---
				case "webviewReady": {
					console.log("Webview reported ready.");
					this._updateWebviewKeyList(); // Send initial key list
					// Send existing chat history on ready
					const historyForWebview: ChatMessage[] = this._chatHistory.map(
						(entry) => ({
							sender: entry.role === "user" ? "User" : "Gemini",
							text: entry.parts[0].text,
							className: entry.role === "user" ? "user-message" : "ai-message",
						})
					);
					this.postMessageToWebview({
						type: "restoreHistory",
						value: historyForWebview,
					});
					break;
				}
			}
		});
	}

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
					 <h1>Chat</h1>
						<div>
								<button id="save-chat-button" title="Save Chat">Save</button>
								<button id="load-chat-button" title="Load Chat">Load</button>
								<button id="clear-chat-button" title="Clear Chat">Clear</button>
						</div>
				</div>
				<div id="chat-container">
						<!-- Chat messages will appear here -->
				</div>
				<div id="input-container">
						<textarea id="chat-input" rows="3" placeholder="Enter your message..."></textarea>
						<button id="send-button" title="Send Message">Send</button>
				</div>

				 <!-- Status Area -->
				 <div id="status-area"></div>

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

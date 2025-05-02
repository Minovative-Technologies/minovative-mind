import * as vscode from "vscode";
import { getNonce } from "../utilities/nonce";
import { generateContent, resetClient } from "../ai/gemini";

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

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "minovativeMindSidebarView";

	private _view?: vscode.WebviewView;
	private readonly _extensionUri: vscode.Uri;
	private readonly _secretStorage: vscode.SecretStorage;
	private _apiKeyList: string[] = []; // Cache the list of keys
	private _activeKeyIndex: number = -1; // Cache the active index, -1 if none

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
		if (
			this._activeKeyIndex === -1 ||
			this._activeKeyIndex >= this._apiKeyList.length
		) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Error: No active key selected or key list is empty.",
			});
			return;
		}

		// Get the key string *before* splicing
		const deletedKey = this._apiKeyList[this._activeKeyIndex];
		// Remove from list
		this._apiKeyList.splice(this._activeKeyIndex, 1);

		// Adjust active index logic (remains the same)
		if (this._apiKeyList.length === 0) {
			this._activeKeyIndex = -1;
		} else if (this._activeKeyIndex >= this._apiKeyList.length) {
			this._activeKeyIndex = this._apiKeyList.length - 1;
		}

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
	private _getActiveApiKey(): string | undefined {
		if (
			this._activeKeyIndex >= 0 &&
			this._activeKeyIndex < this._apiKeyList.length
		) {
			return this._apiKeyList[this._activeKeyIndex];
		}
		return undefined;
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
			],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(async (data) => {
			switch (data.type) {
				case "addApiKey": // Renamed from apiKeyUpdate
					if (typeof data.value === "string") {
						await this._addApiKey(data.value.trim());
					}
					break;
				case "deleteActiveApiKey":
					await this._deleteActiveApiKey();
					break;
				case "switchToNextKey":
					await this._switchToNextApiKey();
					break;
				case "switchToPrevKey":
					await this._switchToPreviousApiKey();
					break;
				case "chatMessage": {
					const userMessage = data.value;
					console.log(`Chat message received: ${userMessage}`);
					const activeKey = this._getActiveApiKey(); // Use helper

					if (!activeKey) {
						this.postMessageToWebview({
							type: "aiResponse",
							value:
								"Error: No active API Key set. Please add or select a key.",
						});
						return;
					}

					this.postMessageToWebview({
						type: "aiResponse",
						value: "Gemini is thinking...",
					}); // Loading indicator
					try {
						const aiResponse = await generateContent(activeKey, userMessage);
						this.postMessageToWebview({
							type: "aiResponse",
							value: aiResponse,
						});
					} catch (error) {
						console.error("Unhandled error during chat generation:", error);
						const errorMessage =
							error instanceof Error ? error.message : String(error);
						this.postMessageToWebview({
							type: "aiResponse",
							value: `Error: ${errorMessage}`,
						});
					}
					break;
				}
				case "webviewReady": {
					console.log("Webview reported ready.");
					this._updateWebviewKeyList(); // Send initial key list
					break;
				}
				// apiKeyStatus is now primarily sent FROM provider TO webview
				// case 'apiKeyStatus': ...
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
		const nonce = getNonce();

		// Updated HTML with new key management controls
		return `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
                     <title>Minovative Mind Chat</title>
                     <style>
                        /* Basic styles using theme variables (keep previous styles) */
                        body { font-family: var(--vscode-font-family, sans-serif); padding: 0 10px 10px 10px; color: var(--vscode-editor-foreground); background-color: var(--vscode-sideBar-background); }
                        h1, h2 { color: var(--vscode-sideBar-titleForeground); border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-contrastBorder)); padding-bottom: 5px; font-weight: normal; margin-top: 15px; margin-bottom: 10px; }
                        h1:first-of-type { margin-top: 0; }
                        #chat-container { margin-bottom: 10px; max-height: calc(100vh - 300px); /* Adjust dynamically maybe? */ height: 45vh; overflow-y: auto; border: 1px solid var(--vscode-input-border, var(--vscode-contrastBorder)); padding: 5px; background-color: var(--vscode-editor-background); }
                        #chat-container p { margin: 3px 0; word-wrap: break-word; }
                        #chat-container p.user-message strong { color: var(--vscode-terminal-ansiBrightBlue); }
                        #chat-container p.ai-message strong { color: var(--vscode-terminal-ansiBrightGreen); }
                        #chat-container p.system-message strong { color: var(--vscode-descriptionForeground); }
                        #chat-container p.error-message { color: var(--vscode-errorForeground); }
                        #chat-container p.loading-message { color: var(--vscode-descriptionForeground); font-style: italic; }

                        #input-container { display: flex; margin-bottom: 15px; }
                        #chat-input { flex-grow: 1; margin-right: 5px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); padding: 6px; font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size); }
                        button { cursor: pointer; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid var(--vscode-button-border, transparent); padding: 6px 12px; font-size: var(--vscode-font-size); }
                        button:hover { background-color: var(--vscode-button-hoverBackground); }
                        button:disabled { opacity: 0.6; cursor: not-allowed; }

                        .section { margin-top: 15px; border-top: 1px solid var(--vscode-editorWidget-border, var(--vscode-contrastBorder)); padding-top: 10px; }
                        .key-management-controls { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; }
                        .key-management-controls button { padding: 4px 8px; font-size: 0.9em; }
                        .key-management-controls span { font-size: 0.9em; color: var(--vscode-descriptionForeground); margin: 0 5px; text-align: center; flex-grow: 1; }
                        .add-key-container { display: flex; margin-top: 8px; }
                        #add-key-input { flex-grow: 1; margin-right: 5px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); padding: 6px; }
                        #add-key-button { padding: 6px 10px; } /* Match chat send button */
                        #api-key-status { font-size: 0.9em; margin-top: 5px; color: var(--vscode-descriptionForeground); min-height: 1.2em; text-align: center; }
                     </style>
                </head>
                <body>
                    <h1>Chat</h1>
                    <div id="chat-container">
                        <!-- Chat messages will appear here -->
                    </div>
                    <div id="input-container">
                        <textarea id="chat-input" rows="3" placeholder="Enter your message..."></textarea>
                        <button id="send-button">Send</button>
                    </div>

                    <div class="section">
                        <h2>API Key Management</h2>
                        <div class="key-management-controls">
                            <button id="prev-key-button" title="Previous Key" disabled><</button>
                            <span id="current-key-display">No keys stored</span>
                            <button id="next-key-button" title="Next Key" disabled>></button>
                            <button id="delete-key-button" title="Delete Current Key" disabled>Delete</button>
                        </div>
                         <div id="api-key-status">Please add an API key.</div> <!-- General status -->

                        <div class="add-key-container">
                            <input type="password" id="add-key-input" placeholder="Add new Gemini API Key">
                            <button id="add-key-button">Add Key</button>
                        </div>
                        <p><small>Keys are stored securely using VS Code SecretStorage.</small></p>
                    </div>

                    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
                 </body>
                </html>`;
	}
} // End of class

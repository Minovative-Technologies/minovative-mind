import * as vscode from "vscode";
import { generateContent, resetClient } from "../ai/gemini"; // Import Gemini functions
import { getNonce } from "../utilities/nonce";

// Define a key for storing the API key in SecretStorage
const GEMINI_API_KEY_SECRET_KEY = "geminiApiKey";

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "minovativeMindSidebarView";

	private _view?: vscode.WebviewView;
	private readonly _extensionUri: vscode.Uri;
	private readonly _secretStorage: vscode.SecretStorage;
	private _currentApiKey: string | undefined; // Cache the current key

	constructor(
		private readonly _extensionUri_in: vscode.Uri,
		context: vscode.ExtensionContext // Pass the full context
	) {
		this._extensionUri = _extensionUri_in;
		this._secretStorage = context.secrets;
		// Listen for changes in secret storage (e.g., key deleted externally)
		context.secrets.onDidChange((e) => {
			if (e.key === GEMINI_API_KEY_SECRET_KEY) {
				this._updateApiKeyCache(); // Update cache if our key changed
			}
		});
		this._updateApiKeyCache(); // Load initial key status
	}

	// Helper to load/update the cached API key
	private async _updateApiKeyCache() {
		this._currentApiKey = await this._secretStorage.get(
			GEMINI_API_KEY_SECRET_KEY
		);
		if (!this._currentApiKey) {
			resetClient(); // Ensure Gemini client is reset if key is removed
			console.log("API Key removed or not set.");
		} else {
			console.log("API Key loaded into cache.");
			// Optional: Could attempt pre-initialization here, but maybe better on demand
		}
		// Notify webview about the current key status
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: this._currentApiKey ? "API Key is set." : "API Key not set.",
		});
	}

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
				case "apiKeyUpdate": {
					if (typeof data.value === "string" && data.value.trim() !== "") {
						const newKey = data.value.trim();
						try {
							await this._secretStorage.store(
								GEMINI_API_KEY_SECRET_KEY,
								newKey
							);
							this._currentApiKey = newKey; // Update cache immediately
							resetClient(); // Reset client to use new key on next call
							vscode.window.showInformationMessage(
								"Gemini API Key stored successfully!"
							);
							this.postMessageToWebview({
								type: "apiKeyStatus",
								value: "API Key saved successfully.",
							});
						} catch (error) {
							console.error("Failed to store API key:", error);
							vscode.window.showErrorMessage("Failed to store API key.");
							this.postMessageToWebview({
								type: "apiKeyStatus",
								value: "Error: Could not save API Key.",
							});
						}
					} else {
						this.postMessageToWebview({
							type: "apiKeyStatus",
							value: "Error: Invalid API Key provided.",
						});
					}
					break;
				}
				case "chatMessage": {
					const userMessage = data.value;
					console.log(`Chat message received: ${userMessage}`);

					if (!this._currentApiKey) {
						this.postMessageToWebview({
							type: "aiResponse",
							value:
								"Error: API Key not set. Please save your key in the sidebar.",
						});
						return; // Stop processing if no key
					}

					// Show loading indicator in webview (optional)
					this.postMessageToWebview({
						type: "aiResponse",
						value: "Gemini is thinking...",
					});

					try {
						// Call the Gemini API
						const aiResponse = await generateContent(
							this._currentApiKey,
							userMessage /*, chatHistory */
						);

						// Send the actual response back
						this.postMessageToWebview({
							type: "aiResponse",
							value: aiResponse,
						});
					} catch (error) {
						// Error handling is mostly within generateContent, but catch unexpected issues
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
					// Send the current key status from cache
					this.postMessageToWebview({
						type: "apiKeyStatus",
						value: this._currentApiKey ? "API Key is set." : "API Key not set.",
					});
					break;
				}
			}
		});
	}

	// Method to send messages to the webview
	public postMessageToWebview(message: any) {
		if (this._view) {
			this._view.webview.postMessage(message);
		} else {
			console.warn("Sidebar view not available to post message:", message);
		}
	}

	// _getHtmlForWebview method remains the same...
	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Get the local path to the bundled script
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "dist", "webview.js")
		);

		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();

		// Use VS Code theme variables for colors and styles
		return `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
                     <title>Minovative Mind Chat</title>
                     <style>
                        /* Same styles as before, using VS Code theme variables */
                        body {
                            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif);
                            padding: 0 10px 10px 10px;
                            color: var(--vscode-editor-foreground);
                            background-color: var(--vscode-sideBar-background);
                        }
                        h1, h2 {
                            color: var(--vscode-sideBar-titleForeground); /* Changed for better sidebar contrast */
                            border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-contrastBorder));
                            padding-bottom: 5px;
                            font-weight: normal; /* Less imposing */
                        }
                        #chat-container {
                            margin-bottom: 10px;
                            max-height: calc(100vh - 250px); /* Adjust based on other elements */
                            height: 55vh; /* Adjust height as needed */
                            overflow-y: auto;
                            border: 1px solid var(--vscode-input-border, var(--vscode-contrastBorder));
                            padding: 5px;
                            background-color: var(--vscode-editor-background);
                        }
                        #chat-container p {
                            margin: 3px 0;
                            word-wrap: break-word; /* Wrap long words/code */
                        }
                         #chat-container p.user-message strong { color: var(--vscode-terminal-ansiBrightBlue); } /* User message color */
                         #chat-container p.ai-message strong { color: var(--vscode-terminal-ansiBrightGreen); } /* AI message color */
                         #chat-container p.system-message strong { color: var(--vscode-descriptionForeground); } /* System message color */
                         #chat-container p.error-message { color: var(--vscode-errorForeground); } /* Error message color */
                         #chat-container p.loading-message { color: var(--vscode-descriptionForeground); font-style: italic; } /* Loading message color */

                        #input-container { display: flex; margin-bottom: 15px; }
                        #chat-input {
                            flex-grow: 1;
                            margin-right: 5px;
                            background-color: var(--vscode-input-background);
                            border: 1px solid var(--vscode-input-border);
                            color: var(--vscode-input-foreground);
                            padding: 6px;
                            font-family: var(--vscode-editor-font-family, monospace); /* Use editor font for input */
                            font-size: var(--vscode-editor-font-size);
                        }
                        button {
                            cursor: pointer;
                            background-color: var(--vscode-button-background);
                            color: var(--vscode-button-foreground);
                            border: 1px solid var(--vscode-button-border, transparent);
                            padding: 6px 12px;
                            font-size: var(--vscode-font-size);
                        }
                        button:hover { background-color: var(--vscode-button-hoverBackground); }
                        button:disabled { opacity: 0.7; cursor: default; }

                        .api-key-section { margin-top: 15px; border-top: 1px solid var(--vscode-editorWidget-border, var(--vscode-contrastBorder)); padding-top: 10px; }
                        .api-key-section label { display: block; margin-bottom: 4px; }
                        #api-key-input {
                            width: calc(100% - 14px); /* Adjust for padding/border */
                            margin-bottom: 5px;
                            background-color: var(--vscode-input-background);
                            border: 1px solid var(--vscode-input-border);
                            color: var(--vscode-input-foreground);
                            padding: 6px;
                        }
                        #api-key-status { font-size: 0.9em; margin-top: 5px; color: var(--vscode-descriptionForeground); min-height: 1.2em; /* Prevent layout shift */ }
                     </style>
                </head>
                <body>
                    <h1>Minovative Mind</h1>

                    <div id="chat-container">
                        <!-- Chat messages will appear here -->
                    </div>

                    <div id="input-container">
                        <textarea id="chat-input" rows="3" placeholder="Enter your message..."></textarea>
                        <button id="send-button">Send</button>
                    </div>

                    <div class="api-key-section">
                        <h2>API Key Management</h2>
                        <label for="api-key-input">Gemini API Key:</label>
                        <input type="password" id="api-key-input" placeholder="Enter or update key">
                        <button id="save-key-button">Save Key</button>
                        <div id="api-key-status">Status: Initializing...</div>
                        <p><small>API keys are stored securely using VS Code SecretStorage.</small></p>
                    </div>

                    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
                 </body>
                </html>`;
	}
}

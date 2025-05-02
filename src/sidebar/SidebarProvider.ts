import * as vscode from "vscode";

// Define a key for storing the API key in SecretStorage
const GEMINI_API_KEY_SECRET_KEY = "geminiApiKey"; // Store multiple keys later

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "minovativeMindSidebarView";

	private _view?: vscode.WebviewView;
	private readonly _extensionUri: vscode.Uri;
	private readonly _secretStorage: vscode.SecretStorage; // Add secret storage instance

	constructor(
		private readonly _extensionUri_in: vscode.Uri,
		context: vscode.ExtensionContext // Pass the full context
	) {
		this._extensionUri = _extensionUri_in;
		this._secretStorage = context.secrets; // Initialize secret storage
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
			// Make handler async
			switch (data.type) {
				case "apiKeyUpdate": {
					if (typeof data.value === "string" && data.value.trim() !== "") {
						try {
							// Store the API key securely
							await this._secretStorage.store(
								GEMINI_API_KEY_SECRET_KEY,
								data.value.trim()
							);
							vscode.window.showInformationMessage(
								"Gemini API Key stored successfully!"
							); // Dev feedback
							// Send success message back to webview
							this.postMessageToWebview({
								type: "apiKeyStatus",
								value: "API Key saved successfully.",
							});
						} catch (error) {
							console.error("Failed to store API key:", error);
							vscode.window.showErrorMessage("Failed to store API key.");
							// Send failure message back to webview
							this.postMessageToWebview({
								type: "apiKeyStatus",
								value: "Error: Could not save API Key.",
							});
						}
					} else {
						// Send invalid input message back to webview
						this.postMessageToWebview({
							type: "apiKeyStatus",
							value: "Error: Invalid API Key provided.",
						});
					}
					break;
				}
				case "chatMessage": {
					// Handle incoming chat message from webview (placeholder for now)
					const userMessage = data.value;
					console.log(`Chat message received: ${userMessage}`);
					// TODO: Get API key from storage, call Gemini, handle response
					// For now, just echo back
					const apiKey = await this._secretStorage.get(
						GEMINI_API_KEY_SECRET_KEY
					);
					if (!apiKey) {
						this.postMessageToWebview({
							type: "aiResponse",
							value:
								"Error: API Key not set. Please save your key in the sidebar.",
						});
						return; // Stop processing if no key
					}
					this.postMessageToWebview({
						type: "aiResponse",
						value: `(Using key ending in ${apiKey.slice(
							-4
						)}): You said: ${userMessage}`,
					});
					break;
				}
				case "webviewReady": {
					// Webview is ready, maybe send initial state if needed (e.g., if key is set)
					console.log("Webview reported ready.");
					const apiKey = await this._secretStorage.get(
						GEMINI_API_KEY_SECRET_KEY
					);
					if (apiKey) {
						this.postMessageToWebview({
							type: "apiKeyStatus",
							value: "API Key is set.",
						});
					} else {
						this.postMessageToWebview({
							type: "apiKeyStatus",
							value: "API Key not set.",
						});
					}
					break;
				}
			}
		});
	}

	// Method to send messages to the webview
	public postMessageToWebview(message: any) {
		if (this._view) {
			this._view.webview.postMessage(message);
		}
	}

	// _getHtmlForWebview method remains the same...
	// ... (keep the existing HTML generation code here) ...
	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Get the local path to the bundled script
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "dist", "webview.js")
		);

		// Get the local path to the CSS styles
		const stylesUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "dist", "styles.css")
		);

		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();

		// TODO: We need to bundle styles.css or move it to dist manually for now.
		// For simplicity now, let's assume styles.css is copied to dist or use inline styles.

		return `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
                     <!--<link href="${stylesUri}" rel="stylesheet">-->
                     <title>Minovative Mind Chat</title>
                     <style>
                        /* Basic styles - move to styles.css later */
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif; padding: 0 10px 10px 10px; color: var(--vscode-editor-foreground); background-color: var(--vscode-sideBar-background); }
                        h1, h2 { color: var(--vscode-textLink-foreground); border-bottom: 1px solid var(--vscode-editorWidget-border); padding-bottom: 5px;}
                        #chat-container { margin-bottom: 10px; max-height: 40vh; height: 40vh; overflow-y: auto; border: 1px solid var(--vscode-input-border); padding: 5px; background-color: var(--vscode-editor-background); }
                        #chat-container p { margin: 3px 0;}
                        #input-container { display: flex; margin-bottom: 15px; }
                        #chat-input { flex-grow: 1; margin-right: 5px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); padding: 4px; }
                        button { cursor: pointer; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid var(--vscode-button-border); padding: 4px 10px; }
                        button:hover { background-color: var(--vscode-button-hoverBackground); }
                        .api-key-section { margin-top: 15px; border-top: 1px solid var(--vscode-editorWidget-border); padding-top: 10px; }
                        .api-key-section label { display: block; margin-bottom: 4px; }
                        #api-key-input { width: calc(100% - 12px); margin-bottom: 5px; background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); padding: 4px; }
                        #api-key-status { font-size: 0.9em; margin-top: 5px; color: var(--vscode-descriptionForeground); }
                     </style>
                </head>
                <body>
                    <h1>Minovative Mind</h1>

                    <div id="chat-container">
                        <!-- Chat messages will appear here -->
                        <p>Welcome! Ask a question or describe the code you want to generate.</p>
                    </div>

                    <div id="input-container">
                        <textarea id="chat-input" rows="3" placeholder="Enter your message..."></textarea>
                        <button id="send-button">Send</button>
                    </div>

                    <div class="api-key-section">
                        <h2>API Key Management</h2>
                        <label for="api-key-input">Gemini API Key:</label>
                        <input type="password" id="api-key-input" placeholder="Enter key">
                        <button id="save-key-button">Save Key</button>
                        <div id="api-key-status">Status: Unknown</div> <!-- Added status display -->
                        <!-- Add buttons for rotate/delete later -->
                        <p><small>API keys are stored securely.</small></p>
                    </div>

                    <!-- Include the bundled webview script -->
                     <!-- Use type="module" if webpack libraryTarget is 'module' -->
                    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
                 </body>
                </html>`;
	}
} // End of class

// Function to generate a nonce (security measure) - Keep this function
function getNonce() {
	let text = "";
	const possible =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

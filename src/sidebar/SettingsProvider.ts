// src/sidebar/SettingsProvider.ts
import * as vscode from "vscode";
import { getSettingsHtml } from "./ui/webviewHelper"; // Assuming this exists and is adapted
import { getNonce } from "../utilities/nonce";
import { SidebarProvider } from "./SidebarProvider"; // To communicate auth state
import { SettingsWebviewMessage } from "./common/sidebarTypes";

export class SettingsProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "minovativeMindSidebarViewSettings";
	private _view?: vscode.WebviewView;
	private readonly _extensionUri: vscode.Uri;
	private _sidebarProviderInstance: SidebarProvider; // Instance of the main sidebar

	/**
	 * Firebase configuration object that contains the credentials and identifiers needed
	 * to initialize Firebase services within the application.
	 *
	 * The configuration values are loaded from environment variables.
	 *
	 * @property {string} apiKey - API key for Firebase authentication.
	 * @property {string} authDomain - Authorized domain for Firebase.
	 * @property {string} projectId - Unique identifier for the Firebase project.
	 * @property {string} storageBucket - Cloud Storage bucket name for Firebase.
	 * @property {string} messagingSenderId - Sender ID for Firebase Cloud Messaging.
	 * @property {string} appId - Unique Firebase application identifier.
	 * @property {string} measurementId - Identifier for Google Analytics integration.
	 */
	firebaseConfig = {
		apiKey: "AIzaSyDHhKj6_dF-WaUSwE7Ma2Mvjj4MWENiVko",
		authDomain: "minovative-mind.firebaseapp.com",
		projectId: "minovative-mind",
		storageBucket: "minovative-mind.firebasestorage.app",
		messagingSenderId: "752295179042",
		appId: "1:752295179042:web:1ec7c527a7a91be7b5ab7b",
		measurementId: "G-GBDQZ8CPM9",
	};

	constructor(
		extensionUri: vscode.Uri,
		sidebarProviderInstance: SidebarProvider
	) {
		this._extensionUri = extensionUri;
		this._sidebarProviderInstance = sidebarProviderInstance;
	}

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken
	): Promise<void> {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, "dist"),
				vscode.Uri.joinPath(this._extensionUri, "media"),
				vscode.Uri.joinPath(this._extensionUri, "src", "sidebar", "webview"),
				// Add your actual 'dist' or script output directory if different
			],
		};

		const nonce = getNonce();
		// Assuming getSettingsHtml is adapted to take script and style URIs and nonce
		// and correctly points to a settings.js file we will create.
		const scriptUri = webviewView.webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "dist", "settingsWebview.js") // Matches webpack output
		);

		const styleUri = webviewView.webview.asWebviewUri(
			vscode.Uri.joinPath(
				this._extensionUri,
				"src",
				"sidebar",
				"webview",
				"settings.css"
			) // CSS for settings
		);

		webviewView.webview.html = await getSettingsHtml(
			webviewView.webview,
			this._extensionUri,
			scriptUri, // Pass the settings script URI
			styleUri, // Pass the settings style URI
			nonce
		);

		webviewView.webview.onDidReceiveMessage(
			async (message: SettingsWebviewMessage) => {
				switch (message.command) {
					case "settingsWebviewReady":
						console.log("Settings webview ready, sending initialize message.");
						this._view?.webview.postMessage({
							command: "initialize",
							firebaseConfig: this.firebaseConfig,
						});
						break;
					case "authStateUpdated":
						this._sidebarProviderInstance.updateUserAuthAndTier(
							message.payload
						);
						// You might want to confirm to the settings webview that state was received
						// Or reflect some global state if needed
						break;
					case "openUrl":
						try {
							await vscode.env.openExternal(vscode.Uri.parse(message.url));
						} catch (e) {
							const error = e as Error;
							vscode.window.showErrorMessage(
								`Failed to open URL: ${message.url}. Error: ${error.message}`
							);
						}
						break;
					// Handle other messages from settings webview if any
				}
			}
		);
	}

	public updateView(/* data for update if needed */): void {
		if (this._view) {
			// Example: this._view.webview.postMessage({ command: 'someUpdate', ... });
		}
	}
}

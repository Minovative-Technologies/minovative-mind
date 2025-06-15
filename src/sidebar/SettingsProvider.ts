// src/sidebar/SettingsProvider.ts
import * as vscode from "vscode";
import { getSettingsHtml } from "./ui/webviewHelper"; // Assuming this exists and is adapted
import { getNonce } from "../utilities/nonce";
import { SidebarProvider } from "./SidebarProvider"; // To communicate auth state
import {
	SettingsWebviewMessage,
	AuthStateUpdatePayload,
} from "./common/sidebarTypes"; // Added AuthStateUpdatePayload

export class SettingsProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "minovativeMindSidebarViewSettings";
	private _view?: vscode.WebviewView;
	private readonly _extensionUri: vscode.Uri;
	private _sidebarProviderInstance: SidebarProvider; // Instance of the main sidebar

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
		console.log(
			"[SettingsProvider] resolveWebviewView called. Setting webview options."
		);

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, "dist"),
				vscode.Uri.joinPath(this._extensionUri, "media"),
				vscode.Uri.joinPath(this._extensionUri, "src", "sidebar", "webview"),
				// your actual 'dist' or script output directory if different
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

		// Subscribe to auth state changes from SidebarProvider
		const disposable = this._sidebarProviderInstance.onDidAuthStateChange(
			(payload: AuthStateUpdatePayload) => {
				console.log(
					"[SettingsProvider] Auth state change detected, updating settings webview.",
					payload
				);
				this._view?.webview.postMessage({
					command: "authStateUpdated",
					payload: payload,
				});
			}
		);
		// Dispose of the subscription when the webview is disposed
		webviewView.onDidDispose(() => disposable.dispose());

		webviewView.webview.onDidReceiveMessage(
			async (message: SettingsWebviewMessage) => {
				console.log(
					`[SettingsProvider] Received message from webview: ${message.command}`
				);
				switch (message.command) {
					case "settingsWebviewReady":
						console.log("Settings webview ready, requesting auth state.");
						// Request current auth state from SidebarProvider and post to webview
						const authStatePayload =
							this._sidebarProviderInstance.getAuthStatePayload(); // Assumes this method exists on SidebarProvider
						console.log(
							"[SettingsProvider] Sending authStateUpdated with payload:",
							authStatePayload
						);
						this._view?.webview.postMessage({
							command: "authStateUpdated", // New command for the webview to receive auth state
							payload: authStatePayload,
						});
						break;
					case "signInRequest":
						console.log(
							"Received signInRequest from settings webview. Forwarding to SidebarProvider."
						);
						this._sidebarProviderInstance.triggerSignIn(
							message.payload.email,
							message.payload.password
						); // Assumes this method exists on SidebarProvider to trigger command
						break;
					case "signOutRequest":
						console.log(
							"Received signOutRequest from settings webview. Forwarding to SidebarProvider."
						);
						this._sidebarProviderInstance.triggerSignOut(); // Assumes this method exists on SidebarProvider to trigger command
						break;
					case "authStateUpdated":
						this._sidebarProviderInstance.updateUserAuthAndTier(
							message.payload
						);
						// You might want to confirm to the settings webview that state was received
						// Or reflect some global state if needed
						break;
					case "manageSubscriptionRequest":
						this._sidebarProviderInstance.openStripeCustomerPortal();
						break;
					case "openUrl":
						// Adjust the openUrl handler to ensure the correct Stripe portal URL is generated
						if (message.url === "stripeCustomerPortal") {
							console.log("Received request to open Stripe Customer Portal.");
							// Delegate to SidebarProvider to get UID and open the correct URL
							this._sidebarProviderInstance.openStripeCustomerPortal(); // Assumes this method exists on SidebarProvider
						} else {
							try {
								await vscode.env.openExternal(vscode.Uri.parse(message.url));
							} catch (e) {
								const error = e as Error;
								vscode.window.showErrorMessage(
									`Failed to open URL: ${message.url}. Error: ${error.message}`
								);
							}
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

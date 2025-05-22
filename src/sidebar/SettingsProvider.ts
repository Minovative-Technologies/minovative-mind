import * as vscode from "vscode";
import { getSettingsHtml } from "./ui/webviewHelper";

export class SettingsProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "minovativeMindSidebarViewSettings";

	private _view?: vscode.WebviewView;
	private readonly _extensionUri: vscode.Uri;

	constructor(private readonly _extensionUri_in: vscode.Uri) {
		this._extensionUri = _extensionUri_in;
	}

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): Promise<void> {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, "dist"),
				vscode.Uri.joinPath(this._extensionUri, "media"),
				vscode.Uri.joinPath(this._extensionUri, "src", "sidebar", "webview"),
			],
		};

		const scriptUri = webviewView.webview.asWebviewUri(
			vscode.Uri.joinPath(
				this._extensionUri,
				"src",
				"sidebar",
				"webview",
				"settings.js"
			)
		);
		const styleUri = webviewView.webview.asWebviewUri(
			vscode.Uri.joinPath(
				this._extensionUri,
				"src",
				"sidebar",
				"webview",
				"settings.css"
			)
		);

		const nonce = getNonce();

		webviewView.webview.html = await getSettingsHtml(
			webviewView.webview,
			this._extensionUri,
			scriptUri,
			styleUri,
			nonce
		);

		webviewView.webview.onDidReceiveMessage(async (data) => {
			console.log(`[SettingsProvider] Message received: ${data.type}`);
			// Future logic for chat messages will go here
		});
	}
}

function getNonce() {
	let text = "";
	const possible =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

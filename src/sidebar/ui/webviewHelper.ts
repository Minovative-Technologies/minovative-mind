// src/sidebar/ui/webviewHelper.ts
import * as vscode from "vscode";
import { getNonce } from "../../utilities/nonce"; // Adjusted path

export async function getHtmlForWebview(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	availableModels: readonly string[], // Pass as parameter
	selectedModel: string // Pass as parameter
): Promise<string> {
	const scriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "dist", "webview.js")
	);
	const stylesUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "src", "sidebar", "webview", "style.css")
	);
	const nonce = getNonce();

	const modelOptionsHtml = availableModels
		.map(
			(modelName) =>
				`<option value="${modelName}" ${
					modelName === selectedModel ? "selected" : ""
				}>${modelName}</option>`
		)
		.join("");

	// Assuming index.html is in src/sidebar/webview/
	const htmlFileUri = vscode.Uri.joinPath(
		extensionUri,
		"src",
		"sidebar",
		"webview",
		"index.html"
	);
	try {
		const fileContentBytes = await vscode.workspace.fs.readFile(htmlFileUri);
		let htmlContent = Buffer.from(fileContentBytes).toString("utf-8");

		// Replace placeholders
		htmlContent = htmlContent.replace(/__CSP_SOURCE__/g, webview.cspSource);
		htmlContent = htmlContent.replace(/__NONCE__/g, nonce);
		htmlContent = htmlContent.replace(/__STYLES_URI__/g, stylesUri.toString());
		htmlContent = htmlContent.replace(
			/__MODEL_OPTIONS_HTML__/g,
			modelOptionsHtml
		);
		htmlContent = htmlContent.replace(/__SCRIPT_URI__/g, scriptUri.toString());

		return htmlContent;
	} catch (e) {
		console.error("Error reading webview HTML file:", e);
		return `<html><body>Error loading webview: ${e}</body></html>`;
	}
}

export async function getSettingsHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	scriptUri: vscode.Uri,
	styleUri: vscode.Uri,
	nonce: string
): Promise<string> {
	const htmlFileUri = vscode.Uri.joinPath(
		extensionUri,
		"src",
		"sidebar",
		"webview",
		"settings.html"
	);

	try {
		const fileContentBytes = await vscode.workspace.fs.readFile(htmlFileUri);
		let htmlContent = Buffer.from(fileContentBytes).toString("utf-8");

		// Replace placeholders
		htmlContent = htmlContent.replace(/__CSP_SOURCE__/g, webview.cspSource);
		htmlContent = htmlContent.replace(/__NONCE__/g, nonce);
		htmlContent = htmlContent.replace(/__SCRIPT_URI__/g, scriptUri.toString());
		htmlContent = htmlContent.replace(/__STYLES_URI__/g, styleUri.toString());

		return htmlContent;
	} catch (e) {
		console.error("Error reading chat view HTML file:", e);
		return `<html><body>Error loading chat view: ${e}</body></html>`;
	}
}

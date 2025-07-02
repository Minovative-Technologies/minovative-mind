import { VsCodeApi } from "../types/webviewTypes";

declare const acquireVsCodeApi: () => VsCodeApi;
export const vscode = acquireVsCodeApi();

/**
 * Posts a message to the VS Code extension.
 * This is a utility wrapper around the VS Code webview API's postMessage function.
 * @param message The message payload to send to the extension.
 */
export function postMessageToExtension(message: any): void {
	vscode.postMessage(message);
}

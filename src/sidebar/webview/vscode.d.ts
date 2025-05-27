// src/sidebar/webview/vscode.d.ts
export interface VsCodeWebviewApi {
	postMessage(message: Record<string, unknown>): void;
	getState(): Record<string, unknown> | undefined;
	setState(newState: Record<string, unknown>): void;
}

declare global {
	const acquireVsCodeApi: () => VsCodeWebviewApi;
}

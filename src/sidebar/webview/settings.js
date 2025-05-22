// JavaScript for the new Chat View
// This file will contain logic for handling chat messages, UI updates, etc.

const vscode = acquireVsCodeApi();

window.addEventListener("message", (event) => {
	const message = event.data;
	console.log(`[Settings] Message from extension: ${message.type}`);
	// Handle messages from the extension here
});

// Example: Send a message to the extension
// vscode.postMessage({ type: 'chatMessage', value: 'Hello from webview!' });

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

// Get references to the buttons
const apiUsageButton = document.getElementById("apiUsageButton");
const minovativeMindWebsiteButton = document.getElementById(
	"minovativeMindWebsiteButton"
);

// Add click listener for API Usage Button
if (apiUsageButton) {
	apiUsageButton.addEventListener("click", () => {
		vscode.postMessage({
			type: "openUrl",
			url: "https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas",
		});
	});
} else {
	console.warn("API Usage button not found.");
}

// Add click listener for Minovative Mind Website Button
if (minovativeMindWebsiteButton) {
	minovativeMindWebsiteButton.addEventListener("click", () => {
		vscode.postMessage({
			type: "openUrl",
			url: "https://minovativemind.dev",
		});
	});
} else {
	console.warn("Minovative Mind Website button not found.");
}

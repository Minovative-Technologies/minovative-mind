import { RequiredDomElements } from "../types/webviewTypes";
import { appState } from "../state/appState";

export function updateApiKeyStatus(
	elements: RequiredDomElements,
	text: string
): void {
	const sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
	elements.apiKeyStatusDiv.textContent = sanitizedText;
	const lowerText = text.toLowerCase();
	if (lowerText.startsWith("error:")) {
		elements.apiKeyStatusDiv.style.color = "var(--vscode-errorForeground)";
	} else if (
		lowerText.startsWith("info:") ||
		lowerText.includes("success") ||
		lowerText.includes("key added") ||
		lowerText.includes("key deleted") ||
		lowerText.includes("using key") ||
		lowerText.includes("switched to key") ||
		lowerText.startsWith("adding") ||
		lowerText.startsWith("switching") ||
		lowerText.startsWith("waiting") ||
		lowerText.endsWith("cancelled.")
	) {
		elements.apiKeyStatusDiv.style.color =
			"var(--vscode-editorInfo-foreground)";
	} else {
		elements.apiKeyStatusDiv.style.color =
			"var(--vscode-descriptionForeground)";
	}
}

export function updateStatus(
	elements: RequiredDomElements,
	text: string,
	isError: boolean = false
): void {
	const sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
	elements.statusArea.textContent = sanitizedText;
	elements.statusArea.style.color = isError
		? "var(--vscode-errorForeground)"
		: "var(--vscode-descriptionForeground)";

	if (!isError) {
		setTimeout(() => {
			// Only clear if the current content is still the one set by this timeout
			if (elements.statusArea.textContent === sanitizedText) {
				elements.statusArea.textContent = "";
			}
		}, 30000); // 30 seconds for non-error messages
	} else {
		setTimeout(() => {
			// Only clear if the current content is still the one set by this timeout
			if (elements.statusArea.textContent === sanitizedText) {
				elements.statusArea.textContent = "";
			}
		}, 45000); // 45 seconds for error messages
	}
}

export function updateEmptyChatPlaceholderVisibility(
	elements: RequiredDomElements
): void {
	console.log("[DEBUG] updateEmptyChatPlaceholderVisibility called.");

	const actualMessages = Array.from(elements.chatContainer.children).filter(
		(child) =>
			child.classList.contains("message") &&
			!child.classList.contains("loading-message")
	);

	if (actualMessages.length > 0) {
		elements.emptyChatPlaceholder.style.display = "none";
		elements.chatContainer.style.display = "flex";
	} else {
		elements.emptyChatPlaceholder.style.display = "flex";
		elements.chatContainer.style.display = "none";
	}
	console.log(
		`[DEBUG] actualMessages.length: ${actualMessages.length}, emptyChatPlaceholder.style.display: ${elements.emptyChatPlaceholder.style.display}`
	);
}

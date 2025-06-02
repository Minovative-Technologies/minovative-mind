import * as vscode from "vscode";

export function cleanCodeOutput(codeString: string): string {
	if (!codeString) {
		return "";
	}
	return codeString
		.replace(/^```(?:\w+)?\n*/, "")
		.replace(/\n*```$/, "")
		.trim();
}

export async function applyAITextEdits(
	editor: vscode.TextEditor,
	originalContent: string,
	modifiedContent: string,
	token: vscode.CancellationToken
): Promise<void> {
	if (token.isCancellationRequested) {
		return;
	}

	if (originalContent === modifiedContent) {
		// No changes, nothing to apply
		return;
	}

	// Basic diffing algorithm: Find common prefix and suffix to identify the changed range.
	// This approach works well for a single contiguous block of changes.
	let commonPrefixLength = 0;
	const minLength = Math.min(originalContent.length, modifiedContent.length);

	// Find common prefix
	while (
		commonPrefixLength < minLength &&
		originalContent[commonPrefixLength] === modifiedContent[commonPrefixLength]
	) {
		commonPrefixLength++;
	}

	let commonSuffixLength = 0;
	const originalEndIndex = originalContent.length - 1;
	const modifiedEndIndex = modifiedContent.length - 1;

	// Find common suffix, ensuring it doesn't overlap with the common prefix
	while (
		originalEndIndex - commonSuffixLength >= commonPrefixLength &&
		modifiedEndIndex - commonSuffixLength >= commonPrefixLength &&
		originalContent[originalEndIndex - commonSuffixLength] ===
			modifiedContent[modifiedEndIndex - commonSuffixLength]
	) {
		commonSuffixLength++;
	}

	if (token.isCancellationRequested) {
		return;
	}

	// Define the range to replace in the original document
	const startPosition = editor.document.positionAt(commonPrefixLength);
	const endPosition = editor.document.positionAt(
		originalContent.length - commonSuffixLength
	);

	const rangeToReplace = new vscode.Range(startPosition, endPosition);

	// The new text to insert for the modified range
	const newText = modifiedContent.substring(
		commonPrefixLength,
		modifiedContent.length - commonSuffixLength
	);

	// Apply the edit
	// Use `editor.edit()` for applying changes to the active text editor.
	await editor.edit(
		(editBuilder) => {
			editBuilder.replace(rangeToReplace, newText);
		},
		{
			undoStopBefore: true, // Make this edit a separate undo stop
			undoStopAfter: true,
		}
	);
}

// src/utils/codeUtils.ts
import * as vscode from "vscode";
import { generatePreciseTextEdits } from "../utils/diffingUtils";

export function cleanCodeOutput(codeString: string): string {
	if (!codeString) {
		return "";
	}

	let contentToProcess = codeString;

	// Step 1: Globally remove all Markdown code block fences (```...```) from the extracted content.
	let cleanedStringContent = contentToProcess.replace(
		/^```(?:\S+)?\s*\n?|\n?```$/gm,
		""
	);

	return cleanedStringContent;
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

	// Generate precise text edits based on the original and modified content
	const preciseEdits = await generatePreciseTextEdits(
		originalContent,
		modifiedContent,
		editor.document
	);

	if (token.isCancellationRequested) {
		return;
	}

	// Apply the edit
	await editor.edit(
		(editBuilder) => {
			for (const edit of preciseEdits) {
				editBuilder.replace(edit.range, edit.newText);
			}
		},
		{
			undoStopBefore: true, // Make this edit a separate undo stop
			undoStopAfter: true,
		}
	);
}

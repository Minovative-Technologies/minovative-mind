import * as vscode from "vscode";
import { generatePreciseTextEdits } from "../utils/diffingUtils";

export function cleanCodeOutput(codeString: string): string {
	if (!codeString) {
		return "";
	}

	// Step 1: Globally remove all Markdown code block fences (```, ```lang, etc.) and trim whitespace.
	const cleanedStringInitial = codeString.replace(/```(?:\w+)?\n?/g, "").trim();

	// Step 2: Define a regular expression constant fileHeaderRegex
	// This regex matches patterns like "--- Relevant File: ... ---", "--- File: ... ---", or "--- Path: ... ---".
	// The 'i' flag makes it case-insensitive, and 'm' makes '^' and '$' match start/end of lines.
	const fileHeaderRegex =
		/^---\s*(?:Relevant\s+)?(?:File|Path):\s*[^-\n]+\s*---$/im;

	// Step 3: Split the cleanedStringInitial into individual lines.
	const lines = cleanedStringInitial.split("\n");

	// Step 4: Initialize an empty array filteredLines and a boolean flag inContentBlock.
	const filteredLines: string[] = [];
	let inContentBlock = false;

	// Step 5: Iterate through each line.
	for (const line of lines) {
		if (!inContentBlock) {
			// If inContentBlock is false:
			// If the line is empty or matches fileHeaderRegex, continue (skip).
			if (line.trim() === "" || fileHeaderRegex.test(line)) {
				continue;
			} else {
				// Otherwise (first actual code line found), set inContentBlock = true
				// and push the line to filteredLines.
				inContentBlock = true;
				filteredLines.push(line);
			}
		} else {
			// If inContentBlock is true:
			// If the line matches fileHeaderRegex, break the loop immediately.
			if (fileHeaderRegex.test(line)) {
				break;
			} else {
				// Otherwise, push the line to filteredLines.
				filteredLines.push(line);
			}
		}
	}

	// Step 6: Join filteredLines back into a single string using newline characters (\n)
	// and apply a final trim() to remove any remaining leading/trailing empty lines.
	return filteredLines.join("\n").trim();
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
	// Use `editor.edit()` for applying changes to the active text editor.
	await editor.edit(
		(editBuilder) => {
			// Iterate through preciseEdits and apply each one
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

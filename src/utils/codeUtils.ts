import * as vscode from "vscode";
import { generatePreciseTextEdits } from "../utils/diffingUtils";

export function cleanCodeOutput(codeString: string): string {
	if (!codeString) {
		return "";
	}

	// Step 1: Extract content from Markdown fenced code blocks, preserving file header logic.
	// Define regex to find Markdown fenced code blocks (e.g., ```typescript\ncode\n```)
	const fencedCodeRegex = /(?:```(?:\w+)?\n|```\n)([\s\S]*?)(?:\n```)/g;
	let extractedCodeContent = "";
	let foundFences = false;
	let match;

	// Iterate through all fenced code blocks
	while ((match = fencedCodeRegex.exec(codeString)) !== null) {
		// Append the captured code content (group 1)
		extractedCodeContent += match[1];
		foundFences = true;
	}

	// Determine the content to process: extracted code if fences found, otherwise original string
	const contentToProcess = foundFences ? extractedCodeContent : codeString;

	// Step 2: Define a regular expression constant fileHeaderRegex
	// This regex matches patterns like "---\\s*(?:Relevant\\s+)?(?:File|Path):\\s*[^-\\n]+\\s*---"$
	// The 'i' flag makes it case-insensitive, and 'm' makes '^' and '$' match start/end of lines.
	const fileHeaderRegex =
		/^---\s*(?:Relevant\s+)?(?:File|Path):\s*[^-\n]+\s*---$/im;

	// Step 3: Split the content to process into individual lines.
	const lines = contentToProcess.split("\n");

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
	return filteredLines
		.join("\n")
		.replace(/<ctrl63>/g, "")
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

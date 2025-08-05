// src/utils/codeUtils.ts
import * as vscode from "vscode";
import { generatePreciseTextEdits } from "../utils/diffingUtils";
import { BEGIN_CODEX_REGEX } from "./extractingDelimiters";

export function cleanCodeOutput(codeString: string): string {
	if (!codeString) {
		return "";
	}

	let contentToProcess = codeString;

	// --- NEW: Prioritize extracting content between delimiters ---
	// This is the primary mechanism to isolate the intended code block and discard extraneous text.
	const delimiterMatch = codeString.match(BEGIN_CODEX_REGEX);

	if (delimiterMatch && delimiterMatch[1]) {
		// If delimiters are found, the content to process is ONLY what's inside them.
		// This effectively throws away any text before XBEGIN_CODEX or after XEND_CODEX.
		contentToProcess = delimiterMatch[1];
	}

	// Step 1: Globally remove all Markdown code block fences (```...```) from the extracted content.
	let cleanedStringContent = contentToProcess.replace(
		/^```(?:\S+)?\s*\n?|\n?```$/gm,
		""
	);

	// Step 2: Define a regular expression for file headers.
	const fileHeaderRegex =
		/^---\s*(?:Relevant\s+)?(?:File|Path):\s*[^-\n]+\s*---$/im;

	// Step 3: Split the content into lines for filtering.
	const lines = cleanedStringContent.split("\n");

	// Step 4: Initialize an empty array to hold the filtered lines.
	const filteredLines: string[] = [];
	let inContentBlock = false;

	// Step 5: Iterate through each line to filter out headers and blank lines.
	for (const line of lines) {
		if (!inContentBlock) {
			if (line.trim() === "" || fileHeaderRegex.test(line)) {
				continue;
			} else {
				inContentBlock = true;
				filteredLines.push(line);
			}
		} else {
			if (fileHeaderRegex.test(line)) {
				break;
			} else {
				filteredLines.push(line);
			}
		}
	}

	// Step 6: Join the filtered lines and apply a final trim.
	let finalCleanedOutput = filteredLines.join("\n").trim();

	return finalCleanedOutput;
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

import * as vscode from "vscode";
import { generatePreciseTextEdits } from "../utils/diffingUtils";
import { InlineEditInstruction } from "../ai/enhancedCodeGeneration";

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

/**
 * Apply inline edit instructions directly to the editor
 */
export async function applyInlineEditInstructions(
	editor: vscode.TextEditor,
	editInstructions: InlineEditInstruction[],
	token: vscode.CancellationToken
): Promise<void> {
	if (token.isCancellationRequested) {
		return;
	}

	if (editInstructions.length === 0) {
		return;
	}

	// Sort edits by line number to apply them in order
	const sortedEdits = [...editInstructions].sort(
		(a, b) => a.startLine - b.startLine
	);

	// Apply the edits
	await editor.edit(
		(editBuilder) => {
			for (const edit of sortedEdits) {
				// Convert 1-based line numbers to 0-based positions
				const startLine = Math.max(0, edit.startLine - 1);
				const endLine = Math.max(0, edit.endLine - 1);

				// Get the actual positions in the document
				const startPos = editor.document.positionAt(
					editor.document.offsetAt(new vscode.Position(startLine, 0))
				);
				const endPos = editor.document.positionAt(
					editor.document.offsetAt(new vscode.Position(endLine, 0)) +
						editor.document.lineAt(endLine).text.length
				);

				// Create the range and apply the edit
				const range = new vscode.Range(startPos, endPos);
				editBuilder.replace(range, edit.newText);
			}
		},
		{
			undoStopBefore: true,
			undoStopAfter: true,
		}
	);
}

/**
 * Convert inline edit instructions to VS Code text edits
 */
export function convertInlineEditsToTextEdits(
	document: vscode.TextDocument,
	editInstructions: InlineEditInstruction[]
): { range: vscode.Range; newText: string }[] {
	const textEdits: { range: vscode.Range; newText: string }[] = [];

	for (const edit of editInstructions) {
		// Convert 1-based line numbers to 0-based positions
		const startLine = Math.max(0, edit.startLine - 1);
		const endLine = Math.max(0, edit.endLine - 1);

		// Get the actual positions in the document
		const startPos = document.positionAt(
			document.offsetAt(new vscode.Position(startLine, 0))
		);
		const endPos = document.positionAt(
			document.offsetAt(new vscode.Position(endLine, 0)) +
				document.lineAt(endLine).text.length
		);

		// Create the range and add the edit
		const range = new vscode.Range(startPos, endPos);
		textEdits.push({
			range,
			newText: edit.newText,
		});
	}

	return textEdits;
}

/**
 * Validate inline edit instructions against the current document
 */
export function validateInlineEditInstructions(
	document: vscode.TextDocument,
	editInstructions: InlineEditInstruction[]
): { isValid: boolean; issues: string[] } {
	const issues: string[] = [];
	const totalLines = document.lineCount;

	for (const edit of editInstructions) {
		// Check line number validity
		if (edit.startLine < 1 || edit.startLine > totalLines) {
			issues.push(
				`Invalid start line: ${edit.startLine} (file has ${totalLines} lines)`
			);
		}

		if (edit.endLine < 1 || edit.endLine > totalLines) {
			issues.push(
				`Invalid end line: ${edit.endLine} (file has ${totalLines} lines)`
			);
		}

		// Check that start <= end
		if (edit.startLine > edit.endLine) {
			issues.push(
				`Invalid range: start line (${edit.startLine}) > end line (${edit.endLine})`
			);
		}

		// Check for empty newText in non-deletion edits
		if (!edit.newText.trim() && edit.startLine !== edit.endLine) {
			issues.push(
				`Empty newText for non-deletion edit at lines ${edit.startLine}-${edit.endLine}`
			);
		}
	}

	// Check for overlapping edits
	const sortedEdits = [...editInstructions].sort(
		(a, b) => a.startLine - b.startLine
	);
	for (let i = 0; i < sortedEdits.length - 1; i++) {
		const current = sortedEdits[i];
		const next = sortedEdits[i + 1];

		if (current.endLine >= next.startLine) {
			issues.push(
				`Overlapping edits: lines ${current.startLine}-${current.endLine} and ${next.startLine}-${next.endLine}`
			);
		}
	}

	return {
		isValid: issues.length === 0,
		issues,
	};
}

import * as vscode from "vscode";
import { diff_match_patch } from "diff-match-patch";

export async function generatePreciseTextEdits(
	originalContent: string,
	modifiedContent: string,
	document: vscode.TextDocument
): Promise<{ range: vscode.Range; newText: string }[]> {
	const dmp = new diff_match_patch();

	// Compute the diffs between originalContent and modifiedContent
	// The diff_main function returns an array of arrays. Each inner array has
	// two elements: an operation code (DIFF_INSERT, DIFF_DELETE, DIFF_EQUAL)
	// and the text associated with that operation.
	const diffs = dmp.diff_main(originalContent, modifiedContent);

	const edits: { range: vscode.Range; newText: string }[] = [];
	let originalPosOffset = 0; // Tracks the current character offset in the original content

	for (const diff of diffs) {
		const [type, text] = diff;

		// DIFF_EQUAL (0): Text is present in both original and modified.
		// No edit is needed; we just advance our position in the original content.
		if (type === diff_match_patch.DIFF_EQUAL) {
			originalPosOffset += text.length;
		}
		// DIFF_INSERT (1): Text was added in the modified content.
		// We need to insert this text at the current position in the original document.
		else if (type === diff_match_patch.DIFF_INSERT) {
			const startPos = document.positionAt(originalPosOffset);
			const endPos = document.positionAt(originalPosOffset); // For an insertion, the range is a single point
			edits.push({
				range: new vscode.Range(startPos, endPos),
				newText: text,
			});
			// For insertions, the originalPosOffset does NOT advance because
			// the insertion happens *at* this point, it doesn't consume original text.
		}
		// DIFF_DELETE (-1): Text was removed from the original content.
		// We need to delete this text from the original document.
		else if (type === diff_match_patch.DIFF_DELETE) {
			const startPos = document.positionAt(originalPosOffset);
			const endPos = document.positionAt(originalPosOffset + text.length);
			edits.push({
				range: new vscode.Range(startPos, endPos),
				newText: "", // Empty string signifies deletion
			});
			// For deletions, the originalPosOffset *does* advance by the length
			// of the deleted text, as that portion of the original document has now been processed.
			originalPosOffset += text.length;
		}
	}

	return edits;
}

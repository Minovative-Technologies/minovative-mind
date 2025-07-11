import * as vscode from "vscode";

export function hasMergeConflicts(fileContent: string): boolean {
	const conflictMarkers = [
		/<{7} /g,
		/=+/g,
		/>{7} /g,
		/\|{7} /g, // For common ancestor marker
	];
	return conflictMarkers.some((regex) => regex.test(fileContent));
}

/**
 * Gets all merge conflict ranges within a document.
 * @param document The text document to analyze.
 * @returns An array of vscode.Range objects representing complete conflict blocks.
 */
export function getMergeConflictRanges(
	document: vscode.TextDocument
): vscode.Range[] {
	const conflictRanges: vscode.Range[] = [];
	const lines = document.getText().split(/\r?\n/);

	let inConflict = false;
	let conflictStart: vscode.Position | undefined;

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		const position = new vscode.Position(lineIndex, 0);

		// Check for conflict start marker
		if (line.startsWith("<<<<<<< ")) {
			if (!inConflict) {
				inConflict = true;
				conflictStart = position;
			}
		}
		// Check for conflict end marker
		else if (line.startsWith(">>>>>>> ")) {
			if (inConflict && conflictStart) {
				// Create range from start to end of conflict (inclusive)
				const conflictEnd = new vscode.Position(lineIndex, line.length);
				conflictRanges.push(new vscode.Range(conflictStart, conflictEnd));
				inConflict = false;
				conflictStart = undefined;
			}
		}
	}

	return conflictRanges;
}

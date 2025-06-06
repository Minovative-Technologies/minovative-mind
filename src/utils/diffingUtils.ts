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

export async function generateFileChangeSummary(
	oldContent: string,
	newContent: string,
	filePath: string
): Promise<{ summary: string; addedLines: string[]; removedLines: string[] }> {
	const dmp = new diff_match_patch();
	const diffs = dmp.diff_main(oldContent, newContent);

	let addedLines: string[] = [];
	let removedLines: string[] = [];
	let totalInsertions = 0;
	let totalDeletions = 0;

	for (const diff of diffs) {
		const [type, text] = diff;
		if (type === diff_match_patch.DIFF_INSERT) {
			// Ensure empty strings from split are filtered out for cleaner results
			addedLines.push(...text.split("\n").filter((line) => line !== ""));
			totalInsertions += text.length;
		} else if (type === diff_match_patch.DIFF_DELETE) {
			// Ensure empty strings from split are filtered out for cleaner results
			removedLines.push(...text.split("\n").filter((line) => line !== ""));
			totalDeletions += text.length;
		}
	}

	const addedContentFlat = addedLines.join("\n");
	const removedContentFlat = removedLines.join("\n");

	// Maps to store identified entities: name -> type (e.g., 'function', 'class', 'method', 'variable')
	const addedEntities = new Map<string, string>();
	const removedEntities = new Map<string, string>();

	// Helper to extract entities from a given content string
	const collectEntities = (content: string, targetMap: Map<string, string>) => {
		let match;

		// Regex for function declarations (e.g., `function name()`, `const name = () => {}`, class methods)
		// Capture group 1: standalone function `function name(...)`
		// Capture group 2: variable-assigned function `const name = (...) =>`
		// Capture group 3: class method `methodName(...)`
		const functionRegex =
			/(?:(?:export|declare)\s+)?(?:async\s+)?function\s+(\w+)\s*\(|(?:\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)\s*=>|function\s*\(|$))|(?:\b(?:public|private|protected|static|async)?\s*(\w+)\s*\([^)]*\)\s*\{)/g;
		while ((match = functionRegex.exec(content)) !== null) {
			const name = match[1] || match[2] || match[3];
			if (name) {
				targetMap.set(name, match[3] ? "method" : "function");
			}
		}
		functionRegex.lastIndex = 0; // Reset regex for next use

		// Regex for class declarations
		const classRegex = /(?:(?:export|declare)\s+)?class\s+(\w+)/g;
		while ((match = classRegex.exec(content)) !== null) {
			const name = match[1];
			if (name) {
				targetMap.set(name, "class");
			}
		}
		classRegex.lastIndex = 0;

		// Regex for variable declarations (trying to avoid functions captured above)
		// It attempts to match a variable name followed by `=`, but not immediately by `async` or `function`
		const variableRegex =
			/(?:(?:export|declare)\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?!async\s+)(?!function\s*)[^;,\n]*;?\s*(?:\n|$)/g;
		while ((match = variableRegex.exec(content)) !== null) {
			const name = match[1];
			// Only add if not already identified as a function/method
			if (name && !targetMap.has(name)) {
				targetMap.set(name, "variable");
			}
		}
		variableRegex.lastIndex = 0;

		// Regex for interface/type alias declarations
		const interfaceTypeAliasRegex =
			/(?:(?:export|declare)\s+)?(?:interface|type)\s+(\w+)/g;
		while ((match = interfaceTypeAliasRegex.exec(content)) !== null) {
			const name = match[1];
			if (name) {
				targetMap.set(name, "type/interface");
			}
		}
		interfaceTypeAliasRegex.lastIndex = 0;

		// Regex for enum declarations
		const enumRegex = /(?:(?:export|declare)\s+)?enum\s+(\w+)/g;
		while ((match = enumRegex.exec(content)) !== null) {
			const name = match[1];
			if (name) {
				targetMap.set(name, "enum");
			}
		}
		enumRegex.lastIndex = 0;
	};

	collectEntities(addedContentFlat, addedEntities);
	collectEntities(removedContentFlat, removedEntities);

	const summaries: string[] = [];
	const processedNames = new Set<string>(); // To prevent duplicate summaries for the same named entity

	// 1. Identify modified entities (present in both added and removed content with same name and type)
	for (const [name, type] of addedEntities.entries()) {
		if (removedEntities.has(name) && removedEntities.get(name) === type) {
			summaries.push(`modified ${type} \`${name}\``);
			processedNames.add(name);
		}
	}

	// 2. Identify purely added entities
	for (const [name, type] of addedEntities.entries()) {
		if (!processedNames.has(name)) {
			summaries.push(`added ${type} \`${name}\``);
			processedNames.add(name);
		}
	}

	// 3. Identify purely removed entities
	for (const [name, type] of removedEntities.entries()) {
		if (!processedNames.has(name)) {
			summaries.push(`removed ${type} \`${name}\``);
			processedNames.add(name);
		}
	}

	let finalSummary = summaries.length > 0 ? summaries.join(", ") : "";

	const totalChangesLength = totalInsertions + totalDeletions;

	// Add general summary if specific entities aren't found or changes are extensive
	if (finalSummary === "") {
		if (totalInsertions > 0 && totalDeletions === 0) {
			finalSummary = "added new content";
		} else if (totalDeletions > 0 && totalInsertions === 0) {
			finalSummary = "removed content";
		} else if (totalInsertions > 0 && totalDeletions > 0) {
			if (totalChangesLength > 500) {
				// Arbitrary threshold for "major changes"
				finalSummary = "major changes detected";
			} else if (totalChangesLength > 0) {
				finalSummary = "modified existing content";
			}
		} else {
			finalSummary = "no significant changes"; // Fallback, should rarely happen if diffs exist
		}
	} else if (
		totalInsertions > 0 &&
		totalDeletions > 0 &&
		summaries.length < 5
	) {
		// If some specific changes were found but there's also substantial general modification not covered by specific entities
		if (totalChangesLength > 200) {
			// A larger threshold for considering general modification
			finalSummary += ", modified existing content";
		}
	}

	// Prepend the file path
	const summaryWithFilePath = `${filePath}: ${finalSummary}`;

	return {
		summary: summaryWithFilePath,
		addedLines: addedLines,
		removedLines: removedLines,
	};
}

import * as vscode from "vscode";
import { generatePreciseTextEdits } from "../utils/diffingUtils";

export function cleanCodeOutput(codeString: string): string {
	if (!codeString) {
		return "";
	}

	const originalLength = codeString.length;

	// Heuristic thresholds to identify non-code or severely malformed output
	const MIN_CODE_LENGTH_FOR_DELIMITER_MATCH = 10; // Minimum content length if delimiters are found
	const MIN_ALPHANUMERIC_RATIO = 0.2; // At least 20% of characters should be alphanumeric
	const MIN_CODE_ELEMENT_DENSITY = 0.01; // At least 1% of non-whitespace characters should be part of a common keyword/structural element
	const MIN_CODE_LINES = 3; // Minimum meaningful lines expected for actual code
	const MAX_LENGTH_REDUCTION_RATIO = 0.95; // If more than 95% of content is stripped (and original was substantial), it's suspicious

	// 1. Check for BEGIN_CODE and END_CODE delimiters.
	// Use the regex /(?:BEGIN_CODE)\n?([\s\S]*?)\n?(?:END_CODE)/i to capture content strictly between delimiters.
	const delimiterMatch = codeString.match(
		/(?:BEGIN_CODE)\n?([\s\S]*?)\n?(?:END_CODE)/i
	);

	// 2. If delimiters are found and content is captured, trim and return it immediately.
	if (delimiterMatch && delimiterMatch[1]) {
		const extracted = delimiterMatch[1].trim();
		// If delimiters are present but the extracted content is extremely short,
		// and the original input was substantial, consider it malformed.
		if (
			extracted.length < MIN_CODE_LENGTH_FOR_DELIMITER_MATCH &&
			originalLength > MIN_CODE_LENGTH_FOR_DELIMITER_MATCH
		) {
			console.warn(
				"CleanCodeOutput: Delimiter match yielded extremely short content, treating as malformed."
			);
			return "";
		}
		return extracted;
	}

	// 3. If delimiters are not found, continue with the existing cleaning logic.

	// Step 1: Globally remove all Markdown code block fences (, , etc.)
	// Replaced the old regex /(?:\w+)?\n?/g with a more precise one for Markdown code block fences.
	let cleanedStringContent = codeString.replace(/(?:^|\s)[a-zA-Z0-9]*\n?/g, "");

	// Step 2: Define a regular expression constant fileHeaderRegex
	// This regex matches patterns like "--- Relevant File: ... ---", "--- File: ... ---", or "--- Path: ... ---".
	// The 'i' flag makes it case-insensitive, and 'm' makes '^' and '$' match start/end of lines.
	const fileHeaderRegex =
		/^---\s*(?:Relevant\s+)?(?:File|Path):\s*[^-\n]+\s*---$/im;

	// Step 3: Split the cleanedStringContent into individual lines.
	const lines = cleanedStringContent.split("\n");

	// Step 4: Initialize an empty array filteredLines and a boolean flag inContentBlock.
	const filteredLines: string[] = [];
	let inContentBlock = false;

	// Step 5: Iterate through each line to filter out file headers and leading/trailing empty lines.
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
				break; // Stop when another header is encountered (e.g., multiple file snippets)
			} else {
				// Otherwise, push the line to filteredLines.
				filteredLines.push(line);
			}
		}
	}

	// Step 6: Join filteredLines back into a single string and apply a final trim.
	let finalCleanedOutput = filteredLines.join("\n").trim();

	// --- Heuristic Checks for fundamentally malformed output ---

	// Heuristic 1: If the final cleaned output is empty, and the original was not, it's a severe cleaning failure.
	if (finalCleanedOutput.length === 0) {
		if (originalLength > 0) {
			console.warn(
				"CleanCodeOutput: Cleaned output became empty from non-empty input, indicating severe malformation or non-code."
			);
		}
		return "";
	}

	// Heuristic 2: Significant length reduction for substantial original inputs
	// This helps detect cases where most of the content was not code but was stripped.
	if (
		originalLength > 50 &&
		(originalLength - finalCleanedOutput.length) / originalLength >
			MAX_LENGTH_REDUCTION_RATIO
	) {
		console.warn(
			"CleanCodeOutput: Output significantly shorter than input (after general cleaning), indicating potential garbled output."
		);
		return "";
	}

	// Heuristic 3: Character set density (e.g., high density of non-alphanumeric/control characters)
	// Code should have a reasonable proportion of alphanumeric characters.
	const alphanumericChars = finalCleanedOutput.match(/[a-zA-Z0-9]/g);
	if (
		!alphanumericChars ||
		alphanumericChars.length / finalCleanedOutput.length <
			MIN_ALPHANUMERIC_RATIO
	) {
		console.warn(
			"CleanCodeOutput: Low alphanumeric character density, likely not code."
		);
		return "";
	}

	// Heuristic 4: Presence of expected code structure elements (keywords, brackets, semicolons)
	// Check for a minimum density of common code constructs (structural chars or keywords).
	const nonWhitespaceContent = finalCleanedOutput.replace(/\s/g, "");
	if (nonWhitespaceContent.length === 0) {
		// If only whitespace left after non-whitespace check, it's essentially empty.
		return "";
	}

	// Common structural characters found in code
	const structuralChars = finalCleanedOutput.match(
		/[{}[\]();=:<>,.?/!@#$%^&*-+_|\\]/g
	);
	// Common programming language keywords (case-sensitive as typically found in code)
	const keywords = finalCleanedOutput.match(
		/\b(function|class|import|const|let|var|if|for|while|return|export|public|private|protected|static|new|this|await|async)\b/g
	);

	const totalCodeElements =
		(structuralChars?.length || 0) + (keywords?.length || 0);

	if (
		totalCodeElements / nonWhitespaceContent.length <
		MIN_CODE_ELEMENT_DENSITY
	) {
		console.warn(
			"CleanCodeOutput: Low density of common code keywords/structural elements, likely not code."
		);
		return "";
	}

	// Heuristic 5: Minimum number of meaningful lines for code
	// Output that results in very few non-empty lines is suspicious.
	const linesAfterHeuristics = finalCleanedOutput
		.split("\n")
		.filter((line) => line.trim().length > 0);
	if (linesAfterHeuristics.length < MIN_CODE_LINES) {
		console.warn(
			"CleanCodeOutput: Output has too few meaningful lines, likely not code."
		);
		return "";
	}

	// All heuristic checks passed, return the cleaned and validated code.
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

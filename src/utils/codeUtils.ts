// src/utils/codeUtils.ts
import * as vscode from "vscode";
import { generatePreciseTextEdits } from "../utils/diffingUtils";

export function cleanCodeOutput(codeString: string): string {
	if (!codeString) {
		return "";
	}

	const originalLength = codeString.length;
	let contentToProcess = codeString;

	// --- NEW: Prioritize extracting content between delimiters ---
	// This is the primary mechanism to isolate the intended code block and discard extraneous text.
	const BEGIN_CODE_REGEX = /BEGIN_CODE\n?([\s\S]*?)\n?END_CODE/i;
	const delimiterMatch = codeString.match(BEGIN_CODE_REGEX);

	if (delimiterMatch && delimiterMatch[1]) {
		// If delimiters are found, the content to process is ONLY what's inside them.
		// This effectively throws away any text before BEGIN_CODE or after END_CODE.
		contentToProcess = delimiterMatch[1];
	} else {
		// Fallback for cases where the AI fails to use delimiters.
		// The original string is processed, but we first remove the delimiters themselves
		// in case of partial or mismatched tags.
		contentToProcess = codeString.replace(/BEGIN_CODE|END_CODE/gi, "");
	}
	// --- END NEW LOGIC ---

	// Heuristic thresholds to identify non-code or severely malformed output
	const MIN_ALPHANUMERIC_RATIO = 0.2; // At least 20% of characters should be alphanumeric
	const MIN_CODE_ELEMENT_DENSITY = 0.01; // At least 1% of non-whitespace characters should be part of a common keyword/structural element
	const MIN_CODE_LINES = 3; // Minimum meaningful lines expected for actual code
	const MAX_LENGTH_REDUCTION_RATIO = 0.95; // If more than 95% of content is stripped (and original was substantial), it's suspicious

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

	// --- Heuristic Checks for fundamentally malformed output ---

	// Heuristic 1: Check if the output became empty after cleaning.
	if (finalCleanedOutput.length === 0) {
		if (originalLength > 0) {
			console.warn(
				"CleanCodeOutput: Cleaned output became empty from non-empty input, indicating severe malformation or non-code."
			);
		}
		return "";
	}

	// Heuristic 2: Check for significant length reduction.
	if (
		originalLength > 50 &&
		(originalLength - finalCleanedOutput.length) / originalLength >
			MAX_LENGTH_REDUCTION_RATIO
	) {
		console.warn(
			"CleanCodeOutput: Output significantly shorter than input (after general cleaning), indicating potential garbled output."
		);
		// Do not return "" here, as valid extraction can cause significant reduction. This is a warning.
	}

	// Heuristic 3: Check alphanumeric character density.
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

	// Heuristic 4: Check for code structure element density.
	const nonWhitespaceContent = finalCleanedOutput.replace(/\s/g, "");
	if (nonWhitespaceContent.length === 0) {
		return "";
	}

	const structuralChars = finalCleanedOutput.match(
		/[{}[\]();=:<>,.?/!@#$%^&*-+_|\\]/g
	);
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

	// Heuristic 5: Check for a minimum number of meaningful lines.
	const linesAfterHeuristics = finalCleanedOutput
		.split("\n")
		.filter((line) => line.trim().length > 0);
	if (linesAfterHeuristics.length < MIN_CODE_LINES) {
		// Allow single-line outputs if they seem valid, but warn for very short multi-line results.
		if (linesAfterHeuristics.length > 1) {
			console.warn(
				"CleanCodeOutput: Output has very few meaningful lines, might not be complete code."
			);
		}
	}

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

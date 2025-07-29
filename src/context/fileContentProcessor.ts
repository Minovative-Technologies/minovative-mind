import * as vscode from "vscode";
import {
	ActiveSymbolDetailedInfo,
	MAX_REFERENCED_TYPE_CONTENT_CHARS_CONSTANT,
} from "../services/contextService";

// Define what constitutes a "major" symbol kind for content prioritization
const MAJOR_SYMBOL_KINDS: vscode.SymbolKind[] = [
	vscode.SymbolKind.Class,
	vscode.SymbolKind.Function,
	vscode.SymbolKind.Method,
	vscode.SymbolKind.Interface,
	vscode.SymbolKind.Enum,
	vscode.SymbolKind.Namespace,
	vscode.SymbolKind.Constructor,
	vscode.SymbolKind.Module,
	// Add other relevant major types as needed
];

/**
 * Helper to extract content string from a specific VS Code Range within the full file content.
 * Handles multiline ranges correctly.
 * @param fullContent The entire file content as a single string.
 * @param range The VS Code Range object specifying the start and end of the desired content.
 * @returns The extracted string content for the given range.
 */
function extractContentForRange(
	fullContent: string,
	range: vscode.Range
): string {
	const lines = fullContent.split("\n");
	const startLine = range.start.line;
	const endLine = range.end.line;

	if (startLine < 0 || endLine >= lines.length || startLine > endLine) {
		return ""; // Invalid range
	}

	let contentLines: string[] = [];
	for (let i = startLine; i <= endLine; i++) {
		let line = lines[i];
		if (i === startLine) {
			line = line.substring(range.start.character);
		}
		if (i === endLine) {
			line = line.substring(
				0,
				range.end.character - (i === startLine ? range.start.character : 0)
			);
		}
		contentLines.push(line);
	}
	return contentLines.join("\n");
}

/**
 * Extracts and summarizes relevant content from a file based on symbol information.
 * Prioritizes the active symbol's definition and major symbol definitions.
 * @param fileContent The full content of the file.
 * @param documentSymbols An array of DocumentSymbols for the file.
 * @param activeSymbolDetailedInfo Detailed information about the active symbol, if any, *and if it belongs to this file*.
 * @param maxAllowedLength The maximum character length for the summarized content.
 * @returns A string containing the intelligently summarized file content.
 */
export function intelligentlySummarizeFileContent(
	fileContent: string,
	documentSymbols: vscode.DocumentSymbol[] | undefined,
	activeSymbolDetailedInfo: ActiveSymbolDetailedInfo | undefined,
	maxAllowedLength: number
): string {
	let currentLength = 0;
	const collectedParts: string[] = [];
	const includedRanges: vscode.Range[] = []; // To track content ranges already added

	/**
	 * Adds a content block to the summary if space allows and it doesn't significantly overlap
	 * with already included content.
	 * @param contentRaw The raw string content to add.
	 * @param range The VS Code Range of the content.
	 * @param header Optional header for the section.
	 * @param footer Optional footer for the section.
	 * @param desiredBlockLength Optional preferred maximum length for the raw content part of the block.
	 * @returns True if content was added, false otherwise.
	 */
	const addContentBlock = (
		contentRaw: string,
		range: vscode.Range,
		header?: string,
		footer?: string,
		desiredBlockLength?: number // NEW PARAMETER
	): boolean => {
		if (currentLength >= maxAllowedLength) {
			return false;
		}

		// Check for significant overlap with existing ranges
		const isSubstantiallyOverlapping = includedRanges.some((existingRange) => {
			const intersection = existingRange.intersection(range);
			return (
				intersection &&
				!intersection.isEmpty &&
				intersection.end.line - intersection.start.line + 1 >=
					(range.end.line - range.start.line + 1) * 0.7
			); // 70% overlap or more
		});

		if (isSubstantiallyOverlapping) {
			return false;
		}

		const headerPart = header ? `${header}\n` : "";
		const footerPart = footer ? `\n${footer}` : "";
		let contentToUse = contentRaw;

		// Apply desiredBlockLength if provided and contentRaw exceeds it
		if (
			desiredBlockLength !== undefined &&
			contentToUse.length > desiredBlockLength
		) {
			contentToUse = contentToUse.substring(0, desiredBlockLength);
		}

		let combinedContent = headerPart + contentToUse + footerPart;

		const remainingSpace = maxAllowedLength - currentLength;
		if (combinedContent.length > remainingSpace) {
			combinedContent = combinedContent.substring(0, remainingSpace);
			if (remainingSpace > 30) {
				// Add truncation message if enough space
				combinedContent += "\n// ... (section truncated)";
			}
			// If after truncation, it's too small or empty, don't add.
			if (combinedContent.length < 10 && contentToUse.length > 0) {
				// Check contentToUse.length for non-empty source
				return false;
			}
		}

		if (combinedContent.length > 0) {
			collectedParts.push(combinedContent);
			currentLength += combinedContent.length;
			includedRanges.push(range);
			return true;
		}
		return false;
	};

	// --- Prioritized Content Candidates ---
	interface ContentCandidate {
		priority: number; // Higher number = higher priority
		range: vscode.Range;
		header?: string;
		footer?: string;
		desiredBlockLength?: number; // NEW
	}

	const candidates: ContentCandidate[] = [];

	// Helper to check if a location is within the current file being summarized
	const isLocationInCurrentFile = (
		location: vscode.Location | undefined,
		currentFilePath: string // This should be activeSymbolDetailedInfo.filePath
	): boolean => {
		if (!location || !location.uri || !currentFilePath) {
			return false;
		}
		const locationNormalizedPath = location.uri.fsPath.replace(/\\/g, "/");
		const currentFileNormalizedPath = currentFilePath.replace(/\\/g, "/");
		return locationNormalizedPath === currentFileNormalizedPath;
	};

	// 1. Candidate: Active Symbol's Full Definition (Highest Priority)
	if (activeSymbolDetailedInfo && activeSymbolDetailedInfo.fullRange) {
		candidates.push({
			priority: 3, // Highest priority
			range: activeSymbolDetailedInfo.fullRange,
			header: `// --- Active Symbol: ${activeSymbolDetailedInfo.name} ---`,
			footer: `// --- End Active Symbol ---`,
			// desiredBlockLength is omitted, allowing this primary block to take its full available space
		});
	}

	// 1.5. Candidates: Call Hierarchy details within the current file
	if (activeSymbolDetailedInfo && activeSymbolDetailedInfo.filePath) {
		const currentFileNormalizedPath = activeSymbolDetailedInfo.filePath.replace(
			/\\/g,
			"/"
		);

		// Incoming Calls whose source is within the current file
		if (activeSymbolDetailedInfo.incomingCalls) {
			for (const call of activeSymbolDetailedInfo.incomingCalls) {
				if (call.fromRanges && call.fromRanges.length > 0) {
					if (isLocationInCurrentFile(call.from, currentFileNormalizedPath)) {
						candidates.push({
							priority: 2.75, // Just below active symbol, above major symbols
							range: call.fromRanges[0], // Use the first range of the call source
							header: `// --- Incoming Call: ${call.from.name} (${
								vscode.SymbolKind[call.from.kind]
							}) ---`,
							footer: `// --- End Incoming Call ---`,
							desiredBlockLength: MAX_REFERENCED_TYPE_CONTENT_CHARS_CONSTANT, // Apply a cap to this sub-section
						});
					}
				}
			}
		}

		// Outgoing Calls whose target is within the current file
		if (activeSymbolDetailedInfo.outgoingCalls) {
			for (const call of activeSymbolDetailedInfo.outgoingCalls) {
				if (call.to && call.to.range) {
					if (isLocationInCurrentFile(call.to, currentFileNormalizedPath)) {
						candidates.push({
							priority: 2.75,
							range: call.to.range, // Use the range of the call target
							header: `// --- Outgoing Call: ${call.to.name} (${
								vscode.SymbolKind[call.to.kind]
							}) ---`,
							footer: `// --- End Outgoing Call ---`,
							desiredBlockLength: MAX_REFERENCED_TYPE_CONTENT_CHARS_CONSTANT, // Apply a cap to this sub-section
						});
					}
				}
			}
		}
	}

	// 2. Candidates: Major Symbol Definitions
	if (documentSymbols) {
		const majorSymbols = documentSymbols
			.filter((symbol) => MAJOR_SYMBOL_KINDS.includes(symbol.kind))
			.sort((a, b) => a.range.start.line - b.range.start.line); // Sort by appearance in file

		for (const symbol of majorSymbols) {
			// Use symbol.range which typically covers the entire block of the symbol
			candidates.push({
				priority: 2, // High priority
				range: symbol.range,
				header: `// --- Definition: ${vscode.SymbolKind[symbol.kind]} ${
					symbol.name
				} ---`,
				footer: `// --- End Definition ---`,
			});
		}
	}

	// 3. Candidate: File Header (e.g., imports, file-level comments)
	const fileLines = fileContent.split("\n");
	// Try to capture initial lines until the first major symbol or a reasonable line count (e.g., 20 lines)
	let headerEndLine = Math.min(20, fileLines.length - 1);
	if (documentSymbols && documentSymbols.length > 0) {
		headerEndLine = Math.min(
			headerEndLine,
			documentSymbols[0].range.start.line - 1
		);
	}
	if (headerEndLine >= 0) {
		candidates.push({
			priority: 1, // Medium priority
			range: new vscode.Range(
				0,
				0,
				headerEndLine,
				fileLines[headerEndLine]?.length || 0
			),
		});
	}

	// Sort candidates: highest priority first, then by line number for a stable order
	candidates.sort((a, b) => {
		if (b.priority !== a.priority) {
			return b.priority - a.priority;
		}
		return a.range.start.line - b.range.start.line;
	});

	// --- Process Candidates ---
	for (const candidate of candidates) {
		if (currentLength >= maxAllowedLength) {
			break;
		}

		const contentExtracted = extractContentForRange(
			fileContent,
			candidate.range
		);
		if (!contentExtracted) {
			continue;
		}

		addContentBlock(
			contentExtracted,
			candidate.range,
			candidate.header,
			candidate.footer,
			candidate.desiredBlockLength // Pass desiredBlockLength
		);
	}

	// --- Fallback: Add additional context if space remains ---
	// This is a simpler approach for content not covered by symbols, by taking top/bottom snippets.
	if (currentLength < maxAllowedLength) {
		const lines = fileContent.split("\n");

		let topSnippetContent: string[] = [];
		let bottomSnippetContent: string[] = [];

		// Attempt to get a snippet from the very top, avoiding already included ranges
		for (
			let i = 0;
			i < lines.length &&
			currentLength + topSnippetContent.join("\n").length < maxAllowedLength;
			i++
		) {
			const lineRange = new vscode.Range(i, 0, i, lines[i].length);
			const isLineCovered = includedRanges.some(
				(r) => r.contains(lineRange.start) && r.contains(lineRange.end)
			);
			if (!isLineCovered) {
				topSnippetContent.push(lines[i]);
			}
			// Removed arbitrary line limits to allow filling remaining space more effectively
		}
		if (topSnippetContent.length > 0) {
			const snippetStartLine = 0;
			const snippetEndLine = topSnippetContent.length - 1;
			const snippetEndChar = lines[snippetEndLine]?.length || 0;
			addContentBlock(
				topSnippetContent.join("\n"),
				new vscode.Range(snippetStartLine, 0, snippetEndLine, snippetEndChar),
				"// --- Top of file (general context) ---",
				"// --- End Top of file ---"
			);
		}

		// Attempt to get a snippet from the very bottom, avoiding already included ranges
		for (
			let i = lines.length - 1;
			i >= 0 &&
			currentLength + bottomSnippetContent.join("\n").length < maxAllowedLength;
			i--
		) {
			const lineRange = new vscode.Range(i, 0, i, lines[i].length);
			const isLineCovered = includedRanges.some(
				(r) => r.contains(lineRange.start) && r.contains(lineRange.end)
			);
			if (!isLineCovered) {
				bottomSnippetContent.unshift(lines[i]); // Add to beginning to maintain order
			}
			// Removed arbitrary line limits to allow filling remaining space more effectively
		}
		if (bottomSnippetContent.length > 0) {
			const snippetStartLine = lines.length - bottomSnippetContent.length;
			const snippetEndLine = lines.length - 1;
			const snippetEndChar = lines[snippetEndLine]?.length || 0;
			addContentBlock(
				bottomSnippetContent.join("\n"),
				new vscode.Range(snippetStartLine, 0, snippetEndLine, snippetEndChar),
				"// --- Bottom of file (general context) ---",
				"// --- End Bottom of file ---"
			);
		}
	}

	// Final assembly: Sort the collected parts by their original line numbers for coherence
	// This requires storing original line info in addContentBlock or sorting by range.
	// For simplicity, for now, we'll just join with a clear separator,
	// assuming `addContentBlock` implicitly tries to add in a sensible order via candidate sorting.
	// A more robust solution might piece together the file, identifying gaps and filling them.

	// If no content was added, return a message
	if (collectedParts.length === 0 && fileContent.length > 0) {
		return `// File content (original length: ${
			fileContent.length
		}) could not be summarized within limits or contained no major symbols.\n// Snippet (first 100 chars): ${fileContent.substring(
			0,
			Math.min(100, fileContent.length)
		)}...`;
	}

	// Join parts with a clear separator for readability
	let finalContent = collectedParts.join(
		"\n\n// --- Non-contiguous section; gap in content --- \n\n"
	);

	// One final truncation in case the markers added pushed it over, or a minor miscalculation
	if (finalContent.length > maxAllowedLength) {
		finalContent = finalContent.substring(0, maxAllowedLength);
		if (maxAllowedLength > 30) {
			finalContent +=
				"\n// ... (final content truncated to fit total file length limit)";
		} else {
			finalContent = ""; // If too small to even show a message
		}
	}

	return finalContent.trim();
}

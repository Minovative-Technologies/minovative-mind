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
	vscode.SymbolKind.Variable, // Variables can also be major, especially constants
	vscode.SymbolKind.Constant, // Explicitly add constant
	vscode.SymbolKind.TypeParameter, // Consider if these are important for summary
	vscode.SymbolKind.Property, // For classes/interfaces, these are important
	vscode.SymbolKind.Field, // For classes/interfaces, these are important
];

// Define what constitutes an "exported" symbol kind, often a subset of major
const EXPORTED_SYMBOL_KINDS: vscode.SymbolKind[] = [
	vscode.SymbolKind.Class,
	vscode.SymbolKind.Function,
	vscode.SymbolKind.Interface,
	vscode.SymbolKind.Enum,
	vscode.SymbolKind.Variable,
	vscode.SymbolKind.Constant,
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
	// Iterate through lines within the range
	for (let i = startLine; i <= endLine; i++) {
		let line = lines[i];
		if (i === startLine) {
			line = line.substring(range.start.character);
		}
		if (i === endLine) {
			// Ensure we don't truncate past the start character if it's a single line
			const startCharForEndLine = i === startLine ? range.start.character : 0;
			line = line.substring(0, range.end.character - startCharForEndLine);
		}
		contentLines.push(line);
	}
	return contentLines.join("\n");
}

/**
 * Extracts and summarizes relevant content from a file based on symbol information.
 * Prioritizes the active symbol's definition, major symbol definitions, imports, and exports.
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
	const collectedParts: { content: string; startLine: number }[] = [];
	const includedRanges: vscode.Range[] = []; // To track content ranges already added
	const fileLines = fileContent.split("\n");

	/**
	 * Checks if a given range substantially overlaps with any already included ranges.
	 * "Substantially" means more than 70% of the candidate range is already covered.
	 * @param candidateRange The range to check for overlap.
	 * @returns True if there's a substantial overlap, false otherwise.
	 */
	const isSubstantiallyOverlapping = (
		candidateRange: vscode.Range
	): boolean => {
		for (const existingRange of includedRanges) {
			const intersection = existingRange.intersection(candidateRange);
			if (
				intersection &&
				!intersection.isEmpty &&
				intersection.end.line - intersection.start.line + 1 >=
					(candidateRange.end.line - candidateRange.start.line + 1) * 0.7
			) {
				return true; // 70% or more of the candidate range is covered
			}
		}
		return false;
	};

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
		desiredBlockLength?: number
	): boolean => {
		if (currentLength >= maxAllowedLength) {
			return false;
		}

		if (isSubstantiallyOverlapping(range)) {
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
			} else {
				// If after truncation, it's too small or empty to be meaningful
				return false;
			}
		}

		if (combinedContent.length > 0) {
			collectedParts.push({
				content: combinedContent,
				startLine: range.start.line,
			});
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
		desiredBlockLength?: number;
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
			priority: 5, // Highest priority
			range: activeSymbolDetailedInfo.fullRange,
			header: `// --- Active Symbol: ${activeSymbolDetailedInfo.name} (${
				vscode.SymbolKind[
					activeSymbolDetailedInfo.kind as keyof typeof vscode.SymbolKind
				] || "Unknown"
			}) ---`,
			footer: `// --- End Active Symbol ---`,
		});
	}

	// 2. Candidate: File Preamble / Top-level comments (e.g., file-level JSDoc, license)
	// Capture initial comments or file-level descriptions.
	let preambleEndLine = -1;
	for (let i = 0; i < fileLines.length && i < 20; i++) {
		// Check first 20 lines for preamble
		const line = fileLines[i].trim();
		if (
			line.startsWith("//") ||
			line.startsWith("/*") ||
			line.startsWith("*") ||
			line.startsWith("#") ||
			line === ""
		) {
			preambleEndLine = i;
		} else {
			break; // Stop at first line of actual code
		}
	}
	if (preambleEndLine >= 0) {
		candidates.push({
			priority: 4.5,
			range: new vscode.Range(
				0,
				0,
				preambleEndLine,
				fileLines[preambleEndLine]?.length || 0
			),
			header: "// --- File Preamble (License, high-level description) ---",
			footer: "// --- End File Preamble ---",
			desiredBlockLength: Math.floor(maxAllowedLength * 0.15), // Cap preamble to 15% of total
		});
	}

	// 3. Candidate: Import Statements and Module-level setup
	// Identify the block of import statements and early declarations, typically at the top of the file.
	let importAndSetupEndLine = -1;
	let foundFirstCodeOrImportLine = false;
	const importKeywords = [
		"import ",
		"require(",
		"from ",
		"using ",
		"package ",
		"module ",
	];
	const topLevelDeclKeywords = [
		"class ",
		"const ",
		"let ",
		"var ",
		"interface ",
		"enum ",
		"type ",
		"func ",
		"function ",
	];

	for (let i = 0; i < fileLines.length; i++) {
		const line = fileLines[i].trim();

		const isImportLike = importKeywords.some((keyword) =>
			line.startsWith(keyword)
		);
		const isTopLevelDeclLike = topLevelDeclKeywords.some((keyword) =>
			line.startsWith(keyword)
		);
		const isCommentOrEmpty =
			line === "" ||
			line.startsWith("//") ||
			line.startsWith("/*") ||
			line.startsWith("*") ||
			line.startsWith("#");

		if (isImportLike || (isTopLevelDeclLike && i < 50)) {
			// Consider early top-level decls as setup
			if (importAndSetupEndLine === -1) {
				importAndSetupEndLine = i;
			}
			importAndSetupEndLine = i;
			foundFirstCodeOrImportLine = true;
		} else if (!isCommentOrEmpty && foundFirstCodeOrImportLine) {
			// This is a non-empty line that is definitely not an import or early top-level declaration.
			// This marks the end of the import/setup block.
			break;
		}
		// If it's a blank line or comment, continue
		if (i === fileLines.length - 1 && importAndSetupEndLine !== -1) {
			importAndSetupEndLine = i; // If reached end of file and found imports
		}
	}

	if (importAndSetupEndLine >= 0) {
		// Ensure import block doesn't overlap with preamble
		const startLineForImports = Math.max(preambleEndLine + 1, 0);
		if (importAndSetupEndLine >= startLineForImports) {
			candidates.push({
				priority: 4, // High priority for imports
				range: new vscode.Range(
					startLineForImports,
					0,
					importAndSetupEndLine,
					fileLines[importAndSetupEndLine]?.length || 0
				),
				header: "// --- Imports and Module-level setup ---",
				footer: "// --- End Imports and Module-level setup ---",
				desiredBlockLength: Math.floor(maxAllowedLength * 0.2), // Cap imports to 20%
			});
		}
	}

	// 4. Candidates: Exported Major Symbols
	if (documentSymbols) {
		const exportedSymbols = documentSymbols
			.filter(
				(symbol) =>
					EXPORTED_SYMBOL_KINDS.includes(symbol.kind) &&
					symbol.range.start.line >= importAndSetupEndLine + 1 // Ensure it's below the import/setup block
			)
			.sort((a, b) => a.range.start.line - b.range.start.line);

		for (const symbol of exportedSymbols) {
			candidates.push({
				priority: 3.5, // Just below file purpose/imports, above general major symbols
				range: symbol.range,
				header: `// --- Exported ${vscode.SymbolKind[symbol.kind]} ${
					symbol.name
				} ---`,
				footer: `// --- End Exported ${vscode.SymbolKind[symbol.kind]} ---`,
			});
		}
	}

	// 5. Candidates: Call Hierarchy details within the current file (adjusted priority)
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
							priority: 3.25, // High priority
							range: call.fromRanges[0], // Use the first range of the call source
							header: `// --- Incoming Call Context: ${call.from.name} (${
								vscode.SymbolKind[call.from.kind]
							}) ---`,
							footer: `// --- End Incoming Call Context ---`,
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
							priority: 3.25,
							range: call.to.range, // Use the range of the call target
							header: `// --- Outgoing Call Context: ${call.to.name} (${
								vscode.SymbolKind[call.to.kind]
							}) ---`,
							footer: `// --- End Outgoing Call Context ---`,
							desiredBlockLength: MAX_REFERENCED_TYPE_CONTENT_CHARS_CONSTANT, // Apply a cap to this sub-section
						});
					}
				}
			}
		}
	}

	// 6. Candidates: Other Major Symbol Definitions (non-exported or nested)
	if (documentSymbols) {
		const otherMajorSymbols = documentSymbols
			.filter(
				(symbol) =>
					MAJOR_SYMBOL_KINDS.includes(symbol.kind) &&
					// Exclude symbols already considered as active or explicitly exported top-level
					!(
						activeSymbolDetailedInfo &&
						activeSymbolDetailedInfo.fullRange &&
						activeSymbolDetailedInfo.fullRange.isEqual(symbol.range)
					) &&
					!(
						EXPORTED_SYMBOL_KINDS.includes(symbol.kind) &&
						symbol.range.start.line >= importAndSetupEndLine + 1
					)
			)
			.sort((a, b) => a.range.start.line - b.range.start.line); // Sort by appearance in file

		for (const symbol of otherMajorSymbols) {
			candidates.push({
				priority: 3, // High priority
				range: symbol.range,
				header: `// --- Definition: ${vscode.SymbolKind[symbol.kind]} ${
					symbol.name
				} ---`,
				footer: `// --- End Definition ---`,
			});
		}
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
		if (!contentExtracted || contentExtracted.trim().length === 0) {
			continue;
		}

		addContentBlock(
			contentExtracted,
			candidate.range,
			candidate.header,
			candidate.footer,
			candidate.desiredBlockLength
		);
	}

	// --- Fallback: Add additional context if space remains ---
	// This is a simpler approach for content not covered by symbols, by taking contiguous snippets.
	if (currentLength < maxAllowedLength) {
		// Attempt to get content from top to fill gaps
		let currentLine = 0;
		while (currentLine < fileLines.length && currentLength < maxAllowedLength) {
			const lineRange = new vscode.Range(
				currentLine,
				0,
				currentLine,
				fileLines[currentLine]?.length || 0
			);
			// Check if this line is already covered by an included range
			const isLineCovered = includedRanges.some(
				(r) =>
					r.contains(lineRange.start) ||
					r.contains(lineRange.end) ||
					(r.start.line <= lineRange.start.line &&
						r.end.line >= lineRange.end.line)
			);

			if (!isLineCovered) {
				// Find a contiguous block of uncovered lines
				let blockStartLine = currentLine;
				let blockEndLine = currentLine;
				while (blockEndLine + 1 < fileLines.length) {
					const nextLineRange = new vscode.Range(
						blockEndLine + 1,
						0,
						blockEndLine + 1,
						fileLines[blockEndLine + 1]?.length || 0
					);
					const isNextLineCovered = includedRanges.some(
						(r) =>
							r.contains(nextLineRange.start) ||
							r.contains(nextLineRange.end) ||
							(r.start.line <= nextLineRange.start.line &&
								r.end.line >= nextLineRange.end.line)
					);
					if (isNextLineCovered) {
						break;
					}
					blockEndLine++;
				}

				const snippetRange = new vscode.Range(
					blockStartLine,
					0,
					blockEndLine,
					fileLines[blockEndLine]?.length || 0
				);
				const snippetContent = extractContentForRange(
					fileContent,
					snippetRange
				);

				if (snippetContent.trim().length > 0) {
					// Add with a lower priority header
					const added = addContentBlock(
						snippetContent,
						snippetRange,
						`// --- General Context (Lines ${blockStartLine + 1}-${
							blockEndLine + 1
						}) ---`,
						`// --- End General Context ---`,
						Math.min(
							maxAllowedLength - currentLength,
							MAX_REFERENCED_TYPE_CONTENT_CHARS_CONSTANT
						) // Limit snippet length
					);
					if (!added) {
						// If it wasn't added (e.g., too small remaining space), stop trying.
						break;
					}
				}
				currentLine = blockEndLine + 1; // Move past the block we just processed
			} else {
				currentLine++; // Move to the next line if current one is covered
			}
		}
	}

	// Final assembly: Sort the collected parts by their original line numbers for coherence
	collectedParts.sort((a, b) => a.startLine - b.startLine);

	// Join parts with a clear separator for readability
	let finalContent = collectedParts
		.map((p) => p.content)
		.join("\n\n// --- Non-contiguous section; gap in content --- \n\n");

	// One final truncation in case the markers added pushed it over, or a minor miscalculation
	if (finalContent.length > maxAllowedLength) {
		finalContent = finalContent.substring(0, maxAllowedLength);
		if (maxAllowedLength > 50) {
			// Enough space for a meaningful message
			finalContent +=
				"\n// ... (final content truncated to fit total file length limit)";
		} else {
			finalContent = ""; // If too small to even show a message
		}
	}

	// If no content was added, return a message
	if (finalContent.trim().length === 0 && fileContent.length > 0) {
		return `// File content (original length: ${
			fileContent.length
		}) could not be summarized within limits or contained no major symbols.\n// Snippet (first 100 chars): ${fileContent.substring(
			0,
			Math.min(100, fileContent.length)
		)}...`;
	}

	return finalContent.trim();
}

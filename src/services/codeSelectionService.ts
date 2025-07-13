import * as vscode from "vscode";
import { getSymbolsInDocument } from "./symbolService";

export class CodeSelectionService {
	/**
	 * Finds the smallest enclosing symbol (function, class, variable declaration) that contains the given position.
	 * @param document The text document to search in.
	 * @param position The cursor position.
	 * @param symbols Optional pre-fetched document symbols for performance.
	 * @returns The smallest enclosing symbol, or undefined if none found.
	 */
	public static async findEnclosingSymbol(
		document: vscode.TextDocument,
		position: vscode.Position,
		symbols?: vscode.DocumentSymbol[]
	): Promise<vscode.DocumentSymbol | undefined> {
		try {
			// Get symbols if not provided
			const documentSymbols =
				symbols || (await getSymbolsInDocument(document.uri));
			if (!documentSymbols || documentSymbols.length === 0) {
				return undefined;
			}

			// Recursively search for the smallest enclosing symbol
			const findSmallestEnclosing = (
				symbols: vscode.DocumentSymbol[]
			): vscode.DocumentSymbol | undefined => {
				let bestMatch: vscode.DocumentSymbol | undefined;
				let smallestRange = Number.MAX_SAFE_INTEGER;

				for (const symbol of symbols) {
					// Check if the symbol contains the position
					if (symbol.range.contains(position)) {
						const rangeSize = symbol.range.end.line - symbol.range.start.line;

						// If this symbol is smaller than our current best match, update it
						if (rangeSize < smallestRange) {
							smallestRange = rangeSize;
							bestMatch = symbol;
						}

						// Recursively check children for an even smaller match
						if (symbol.children && symbol.children.length > 0) {
							const childMatch = findSmallestEnclosing(symbol.children);
							if (childMatch) {
								const childRangeSize =
									childMatch.range.end.line - childMatch.range.start.line;
								if (childRangeSize < smallestRange) {
									smallestRange = childRangeSize;
									bestMatch = childMatch;
								}
							}
						}
					}
				}

				return bestMatch;
			};

			return findSmallestEnclosing(documentSymbols);
		} catch (error) {
			console.warn(`Error finding enclosing symbol: ${error}`);
			return undefined;
		}
	}

	/**
	 * Finds the smallest enclosing symbol that contains diagnostics, prioritizing by severity.
	 * @param document The text document to search in.
	 * @param allDiagnostics All diagnostics in the document.
	 * @param symbols Optional pre-fetched document symbols for performance.
	 * @returns The best matching symbol with diagnostics, or undefined if none found.
	 */
	public static async findSymbolWithDiagnostics(
		document: vscode.TextDocument,
		allDiagnostics: vscode.Diagnostic[],
		symbols?: vscode.DocumentSymbol[]
	): Promise<vscode.DocumentSymbol | undefined> {
		try {
			// Get symbols if not provided
			const documentSymbols =
				symbols || (await getSymbolsInDocument(document.uri));
			if (!documentSymbols || documentSymbols.length === 0) {
				return undefined;
			}

			// Flatten all symbols for easier iteration
			const allSymbols: vscode.DocumentSymbol[] = [];
			const flattenSymbols = (symbols: vscode.DocumentSymbol[]) => {
				for (const symbol of symbols) {
					allSymbols.push(symbol);
					if (symbol.children && symbol.children.length > 0) {
						flattenSymbols(symbol.children);
					}
				}
			};
			flattenSymbols(documentSymbols);

			let bestSymbol: vscode.DocumentSymbol | undefined;
			let highestSeverity = -1; // Lower values are higher priority
			let smallestRange = Number.MAX_SAFE_INTEGER;
			let earliestLine = Number.MAX_SAFE_INTEGER;

			for (const symbol of allSymbols) {
				// Check if this symbol contains any diagnostics
				const symbolDiagnostics = allDiagnostics.filter((diagnostic) =>
					symbol.range.intersection(diagnostic.range)
				);

				if (symbolDiagnostics.length > 0) {
					// Find the highest severity diagnostic in this symbol
					const maxSeverity = Math.min(
						...symbolDiagnostics.map((d) => d.severity)
					);
					const rangeSize = symbol.range.end.line - symbol.range.start.line;
					const startLine = symbol.range.start.line;

					// Prioritize by severity first, then by range size, then by line number
					let shouldUpdate = false;

					if (maxSeverity < highestSeverity) {
						// Higher priority severity
						shouldUpdate = true;
					} else if (maxSeverity === highestSeverity) {
						if (rangeSize < smallestRange) {
							// Same severity, smaller range
							shouldUpdate = true;
						} else if (
							rangeSize === smallestRange &&
							startLine < earliestLine
						) {
							// Same severity, same range size, earlier line
							shouldUpdate = true;
						}
					}

					if (shouldUpdate) {
						bestSymbol = symbol;
						highestSeverity = maxSeverity;
						smallestRange = rangeSize;
						earliestLine = startLine;
					}
				}
			}

			return bestSymbol;
		} catch (error) {
			console.warn(`Error finding symbol with diagnostics: ${error}`);
			return undefined;
		}
	}

	/**
	 * Helper function to flatten a hierarchical list of DocumentSymbols into a single array.
	 * @param symbols The array of DocumentSymbols to flatten.
	 * @returns A new array containing all symbols from the hierarchy.
	 */
	private static flattenSymbols(
		symbols: vscode.DocumentSymbol[]
	): vscode.DocumentSymbol[] {
		const all: vscode.DocumentSymbol[] = [];
		const traverse = (s: vscode.DocumentSymbol[]) => {
			for (const sym of s) {
				all.push(sym);
				if (sym.children && sym.children.length > 0) {
					traverse(sym.children);
				}
			}
		};
		traverse(symbols);
		return all;
	}

	/**
	 * Finds the most relevant symbol for a code fix, prioritizing diagnostics near the cursor.
	 * Filters diagnostics by proximity to cursor, sorts them by severity and proximity,
	 * then finds the smallest enclosing symbol for the highest priority diagnostic.
	 * Falls back to the smallest enclosing symbol at the cursor if no relevant diagnostic is found.
	 *
	 * @param document The text document to search in.
	 * @param cursorPosition The current position of the cursor.
	 * @param allDiagnostics All diagnostics currently present in the document.
	 * @param symbols Optional pre-fetched document symbols for performance.
	 * @returns The best matching symbol for a fix, or undefined if none found.
	 */
	public static async findRelevantSymbolForFix(
		document: vscode.TextDocument,
		cursorPosition: vscode.Position,
		allDiagnostics: vscode.Diagnostic[],
		symbols?: vscode.DocumentSymbol[]
	): Promise<vscode.DocumentSymbol | undefined> {
		try {
			const documentSymbols =
				symbols || (await getSymbolsInDocument(document.uri));
			if (!documentSymbols || documentSymbols.length === 0) {
				// Fallback if no symbols found in document
				return this.findEnclosingSymbol(
					document,
					cursorPosition,
					documentSymbols
				);
			}

			const LINE_RADIUS = 5; // Consider diagnostics within +/- 5 lines of the cursor
			const relevantDiagnostics = allDiagnostics.filter((diag) => {
				const diagStartLine = diag.range.start.line;
				const diagEndLine = diag.range.end.line;
				const cursorLine = cursorPosition.line;

				// Check if any part of the diagnostic range overlaps with the cursor's line or is within the radius
				return (
					(diagStartLine >= cursorLine - LINE_RADIUS &&
						diagStartLine <= cursorLine + LINE_RADIUS) ||
					(diagEndLine >= cursorLine - LINE_RADIUS &&
						diagEndLine <= cursorLine + LINE_RADIUS) ||
					(cursorLine >= diagStartLine && cursorLine <= diagEndLine) // Cursor is inside the diagnostic range
				);
			});

			if (relevantDiagnostics.length === 0) {
				// Fallback if no relevant diagnostics found near the cursor
				return this.findEnclosingSymbol(
					document,
					cursorPosition,
					documentSymbols
				);
			}

			// Sort diagnostics: severity (Error first), then proximity to cursor, then range size
			relevantDiagnostics.sort((a, b) => {
				// 1. Severity: Error (0) > Warning (1) > Info (2) > Hint (3)
				if (a.severity !== b.severity) {
					return a.severity - b.severity; // Lower severity value means higher priority
				}
				// 2. Proximity to cursor: absolute difference in start line
				const proximityA = Math.abs(a.range.start.line - cursorPosition.line);
				const proximityB = Math.abs(b.range.start.line - cursorPosition.line);
				if (proximityA !== proximityB) {
					return proximityA - proximityB;
				}
				// 3. Range size (lines): smaller range first
				const rangeSizeA = a.range.end.line - a.range.start.line;
				const rangeSizeB = b.range.end.line - b.range.start.line;
				if (rangeSizeA !== rangeSizeB) {
					return rangeSizeA - rangeSizeB;
				}
				// 4. Character proximity (for same line, same range size)
				return a.range.start.character - b.range.start.character;
			});

			const allFlatSymbols =
				CodeSelectionService.flattenSymbols(documentSymbols);

			let bestSymbolForFix: vscode.DocumentSymbol | undefined;
			// Score for symbol suitability: Lower is better.
			// Combines diagnostic severity (primary), symbol range size (secondary), and diagnostic proximity (tertiary).
			let bestScore = Number.MAX_SAFE_INTEGER;

			for (const diag of relevantDiagnostics) {
				let smallestEnclosingSymbolForThisDiag:
					| vscode.DocumentSymbol
					| undefined;
				let currentSmallestRangeSize = Number.MAX_SAFE_INTEGER;

				// Find the smallest symbol that fully contains the current diagnostic's range
				for (const symbol of allFlatSymbols) {
					if (symbol.range.contains(diag.range)) {
						const symbolRangeSize =
							symbol.range.end.line - symbol.range.start.line;
						if (symbolRangeSize < currentSmallestRangeSize) {
							currentSmallestRangeSize = symbolRangeSize;
							smallestEnclosingSymbolForThisDiag = symbol;
						}
					}
				}

				if (smallestEnclosingSymbolForThisDiag) {
					// Calculate a combined score
					const score =
						diag.severity * 10000 + // High weight for severity
						currentSmallestRangeSize * 100 + // Medium weight for symbol size
						Math.abs(diag.range.start.line - cursorPosition.line); // Low weight for diagnostic line proximity

					if (score < bestScore) {
						bestScore = score;
						bestSymbolForFix = smallestEnclosingSymbolForThisDiag;
					}
				}
			}

			if (bestSymbolForFix) {
				return bestSymbolForFix;
			}

			// Final fallback if no symbol was found containing any relevant diagnostic
			return this.findEnclosingSymbol(
				document,
				cursorPosition,
				documentSymbols
			);
		} catch (error) {
			console.warn(`Error finding relevant symbol for fix: ${error}`);
			return undefined;
		}
	}

	/**
	 * Finds a logical code unit (e.g., function, class) encompassing the cursor position
	 * for a custom prompt. It tries to expand a selection from a smaller component (like a variable)
	 * to its containing major code unit.
	 *
	 * @param document The text document to search in.
	 * @param cursorPosition The current position of the cursor.
	 * @param symbols Optional pre-fetched document symbols for performance.
	 * @returns The DocumentSymbol for the determined logical code unit, or undefined.
	 */
	public static async findLogicalCodeUnitForPrompt(
		document: vscode.TextDocument,
		cursorPosition: vscode.Position,
		symbols?: vscode.DocumentSymbol[]
	): Promise<vscode.DocumentSymbol | undefined> {
		try {
			const documentSymbols =
				symbols || (await getSymbolsInDocument(document.uri));
			if (!documentSymbols || documentSymbols.length === 0) {
				return undefined;
			}

			// Define what constitutes a "major code unit"
			const majorCodeUnitKinds = new Set<vscode.SymbolKind>([
				vscode.SymbolKind.Function,
				vscode.SymbolKind.Method,
				vscode.SymbolKind.Class,
				vscode.SymbolKind.Interface,
				vscode.SymbolKind.Enum,
				vscode.SymbolKind.Namespace,
				vscode.SymbolKind.Module, // e.g., for ES modules, file scope in some languages
				vscode.SymbolKind.Constructor,
				vscode.SymbolKind.Struct,
				vscode.SymbolKind.Package, // e.g., in Go, Java
			]);

			// Start by finding the smallest immediate enclosing symbol at the cursor position
			let currentCandidateSymbol: vscode.DocumentSymbol | undefined =
				await this.findEnclosingSymbol(
					document,
					cursorPosition,
					documentSymbols
				);

			if (!currentCandidateSymbol) {
				return undefined; // No symbol found at cursor
			}

			// The symbol we will eventually return (initially the innermost found)
			let logicalUnitSymbol: vscode.DocumentSymbol = currentCandidateSymbol;

			// Helper to find the smallest symbol that strictly contains a target range
			// This effectively finds the immediate parent in the symbol hierarchy.
			const findSmallestStrictlyEnclosingRange = (
				searchSymbols: vscode.DocumentSymbol[],
				targetRange: vscode.Range
			): vscode.DocumentSymbol | undefined => {
				let bestMatch: vscode.DocumentSymbol | undefined;
				let smallestSize = Number.MAX_SAFE_INTEGER;

				for (const symbol of searchSymbols) {
					// Check if this symbol contains the targetRange and is strictly larger than it
					if (
						symbol.range.contains(targetRange) &&
						!symbol.range.isEqual(targetRange)
					) {
						const currentSize = symbol.range.end.line - symbol.range.start.line;
						if (currentSize < smallestSize) {
							smallestSize = currentSize;
							bestMatch = symbol;
						}
						// Recursively check children for a more immediate parent
						const childMatch = findSmallestStrictlyEnclosingRange(
							symbol.children,
							targetRange
						);
						if (childMatch) {
							const childSize =
								childMatch.range.end.line - childMatch.range.start.line;
							if (childSize < smallestSize) {
								smallestSize = childSize;
								bestMatch = childMatch;
							}
						}
					}
				}
				return bestMatch;
			};

			// Traverse upwards until a major code unit is found
			// `tempSymbol` helps us walk up the hierarchy from `currentCandidateSymbol`
			let tempSymbol: vscode.DocumentSymbol | undefined =
				currentCandidateSymbol;

			while (tempSymbol) {
				// If the current symbol is already a major code unit, this is our best logical unit
				if (majorCodeUnitKinds.has(tempSymbol.kind)) {
					logicalUnitSymbol = tempSymbol;
					break;
				}

				// If it's not a major unit, try to find its immediate parent
				const immediateParent = findSmallestStrictlyEnclosingRange(
					documentSymbols,
					tempSymbol.range
				);

				if (immediateParent) {
					// Update tempSymbol to its parent and continue the loop
					tempSymbol = immediateParent;
				} else {
					// No more enclosing symbols found (e.g., reached global scope or file level,
					// and the last symbol considered wasn't a major unit).
					// In this case, `logicalUnitSymbol` retains the last non-major symbol it was set to,
					// which is the largest meaningful unit found that is not a major code unit.
					break;
				}
			}

			return logicalUnitSymbol; // Return the determined logical unit
		} catch (error) {
			console.warn(`Error finding logical code unit for prompt: ${error}`);
			return undefined;
		}
	}
}

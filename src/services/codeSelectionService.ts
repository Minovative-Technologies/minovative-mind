import * as vscode from "vscode";
import { getSymbolsInDocument } from "./symbolService";
import { DiagnosticService } from "../utils/diagnosticUtils";

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
}

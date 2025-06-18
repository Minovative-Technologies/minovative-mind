// src/context/contextBuilder.ts
import * as vscode from "vscode";
import * as path from "path";
import { createAsciiTree } from "../utilities/treeFormatter";
import { FileChangeEntry } from "../types/workflow";
import { ActiveSymbolDetailedInfo } from "../services/contextService";

// Constants for context building
const MAX_REFERENCED_TYPE_CONTENT_CHARS = 5000; // Adjust for desired content length
const MAX_REFERENCED_TYPES_TO_INCLUDE = 10; // To limit the number of definitions included

// Configuration for context building - Adjusted for large context windows
interface ContextConfig {
	maxFileLength: number; // Maximum characters per file content
	maxTotalLength: number; // Approximate total character limit for the context string
	maxSymbolEntriesPerFile: number; // Maximum symbol entries to include per file
	maxTotalSymbolChars: number; // Approximate total character limit for the symbol info block
	maxActiveSymbolDetailChars: number;
}

// Default configuration - Adjusted for ~1M token models
export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
	maxFileLength: 5 * 1024 * 1024, // Approx 5MB in characters
	maxTotalLength: 5 * 1024 * 1024, // Approx 5MB in characters
	maxSymbolEntriesPerFile: 10, // Default to 10 symbols per file
	maxTotalSymbolChars: 100000, // Default to 100KB for the entire symbols section
	maxActiveSymbolDetailChars: 100000, // Default to 100KB
};

/**
 * Builds a textual context string from a list of file URIs.
 * Reads file content, formats it, and applies limits.
 * Now tailored for larger context window models.
 * @param relevantFiles An array of vscode.Uri objects for relevant files.
 * @param workspaceRoot The root URI of the workspace for relative paths.
 * @param config Optional configuration for context building.
 * @param recentChanges Optional array of recent file changes to include.
 * @param dependencyGraph Optional map representing file import/dependency relations.
 * @param documentSymbols Optional map containing document symbols for relevant files.
 * @param activeSymbolDetailedInfo Optional detailed information about the active symbol.
 * @returns A promise that resolves to the generated context string.
 */
export async function buildContextString(
	relevantFiles: vscode.Uri[],
	workspaceRoot: vscode.Uri,
	config: ContextConfig = DEFAULT_CONTEXT_CONFIG,
	recentChanges?: FileChangeEntry[],
	dependencyGraph?: Map<string, string[]>,
	documentSymbols?: Map<string, vscode.DocumentSymbol[] | undefined>,
	activeSymbolDetailedInfo?: ActiveSymbolDetailedInfo
): Promise<string> {
	let context = `Project Context (Workspace: ${path.basename(
		workspaceRoot.fsPath
	)}):\n`;
	context += `Relevant files identified: ${relevantFiles.length}\n\n`;
	let currentTotalLength = context.length;
	let filesSkippedForTotalSize = 0; // For file *content* skipping

	// --- Generate ASCII Tree ---
	context += "File Structure:\n";
	const rootName = path.basename(workspaceRoot.fsPath);
	const relativePaths = relevantFiles.map((uri) =>
		// Normalize paths to use forward slashes for consistent tree building
		path.relative(workspaceRoot.fsPath, uri.fsPath).replace(/\\/g, "/")
	);
	let fileStructureString = createAsciiTree(relativePaths, rootName);

	// Check if the generated tree itself exceeds the total limit
	const treeHeaderLength = "File Structure:\n".length + "\n\n".length; // Account for header and spacing
	const treeStringLength = fileStructureString.length;

	if (
		currentTotalLength + treeHeaderLength + treeStringLength >
		config.maxTotalLength
	) {
		console.warn(
			`Generated file structure tree (${treeStringLength} chars) exceeds total context limit (${config.maxTotalLength} chars). Truncating structure.`
		);
		const availableLength =
			config.maxTotalLength - currentTotalLength - treeHeaderLength - 50; // Reserve space for headers/footers/truncation message
		fileStructureString =
			fileStructureString.substring(
				0,
				availableLength > 0 ? availableLength : 0
			) + "\n... (File structure truncated due to size limit)";
		context += fileStructureString + "\n\n";
		currentTotalLength = config.maxTotalLength; // Maxed out after adding truncated structure
		console.log(
			`Truncated context size after adding structure: ${currentTotalLength} chars.`
		);
	} else {
		context += fileStructureString + "\n\n";
		currentTotalLength += treeHeaderLength + treeStringLength; // Update length
		console.log(
			`Context size after adding structure: ${currentTotalLength} chars.`
		);
	}
	// --- END: Generate ASCII Tree ---

	// Recent Project Changes ---
	if (recentChanges && recentChanges.length > 0) {
		let changesSummarySection =
			"*** Recent Project Changes (During Current Workflow Execution) ***\n";

		for (const change of recentChanges) {
			const formattedChange =
				`--- File ${change.changeType.toUpperCase()}: ${
					change.filePath
				} ---\n` + `${change.summary}\n\n`;

			if (
				currentTotalLength +
					changesSummarySection.length +
					formattedChange.length >
				config.maxTotalLength
			) {
				changesSummarySection +=
					"... (additional changes omitted due to context limit)\n";
				break; // Truncate and stop adding changes
			}
			changesSummarySection += formattedChange;
		}
		context += changesSummarySection;
		currentTotalLength += changesSummarySection.length;
		console.log(
			`Context size after adding recent changes: ${currentTotalLength} chars.`
		);
	}
	// --- END: Recent Project Changes ---

	// A direct list of existing relative file paths ---
	let existingPathsSection = "Existing Relative File Paths:\n";
	const maxPathsToList = 1000; // Limit the number of paths to avoid excessive context
	let pathsAddedCount = 0;

	for (const fileUri of relevantFiles) {
		if (pathsAddedCount >= maxPathsToList) {
			existingPathsSection += "... (additional paths omitted due to limit)\n";
			break;
		}
		const relativePath = path
			.relative(workspaceRoot.fsPath, fileUri.fsPath)
			.replace(/\\\\/g, "/");
		existingPathsSection += `- ${relativePath}\n`;
		pathsAddedCount++;
	}
	existingPathsSection += "\n"; // Add a newline for separation

	// Check if adding this section exceeds total context limit
	if (
		currentTotalLength + existingPathsSection.length >
		config.maxTotalLength
	) {
		console.warn(
			`Existing paths list exceeds total context limit. Truncating.`
		);
		const availableLength = config.maxTotalLength - currentTotalLength - 50; // Reserve space for truncation message
		existingPathsSection =
			existingPathsSection.substring(
				0,
				availableLength > 0 ? availableLength : 0
			) + "\n... (Existing paths list truncated due to size limit)\n\n";
		context += existingPathsSection;
		currentTotalLength = config.maxTotalLength; // Maxed out after adding truncated structure
	} else {
		context += existingPathsSection;
		currentTotalLength += existingPathsSection.length;
	}
	console.log(
		`Context size after adding existing paths list: ${currentTotalLength} chars.`
	);
	// --- END: Direct list of existing relative file paths ---

	// --- Symbol Information ---
	let symbolInfoSection = "";
	if (documentSymbols && documentSymbols.size > 0) {
		symbolInfoSection += "Symbol Information:\n";
		let currentSymbolSectionLength = symbolInfoSection.length;
		let totalSymbolsAdded = 0;
		let filesWithSymbolsAdded = 0;

		for (const fileUri of relevantFiles) {
			const relativePath = path
				.relative(workspaceRoot.fsPath, fileUri.fsPath)
				.replace(/\\/g, "/");
			const symbolsForFile = documentSymbols.get(relativePath);

			if (symbolsForFile && symbolsForFile.length > 0) {
				let symbolsAddedToFile = 0;
				let fileSymbolContent = `--- File: ${relativePath} ---\n`;
				let fileSymbolContentLength = fileSymbolContent.length;

				for (const symbol of symbolsForFile) {
					if (
						symbolsAddedToFile >= config.maxSymbolEntriesPerFile ||
						currentSymbolSectionLength + fileSymbolContentLength + 50 >
							config.maxTotalSymbolChars // 50 for truncation message and buffer
					) {
						fileSymbolContent += `... (${
							symbolsForFile.length - symbolsAddedToFile
						} more symbols omitted for this file)\n`;
						fileSymbolContentLength += `... (${
							symbolsForFile.length - symbolsAddedToFile
						} more symbols omitted for this file)\n`.length;
						break;
					}

					const symbolDetail = symbol.detail
						? ` (Detail: ${symbol.detail})`
						: "";
					const symbolLine = `- [${vscode.SymbolKind[symbol.kind]}] ${
						symbol.name
					} (Line ${symbol.range.start.line + 1})${symbolDetail}\n`;

					if (
						currentSymbolSectionLength +
							fileSymbolContentLength +
							symbolLine.length >
						config.maxTotalSymbolChars
					) {
						fileSymbolContent +=
							"... (remaining symbols omitted due to total symbol context limit)\n";
						fileSymbolContentLength +=
							"... (remaining symbols omitted due to total symbol context limit)\n"
								.length;
						break; // Stop adding symbols to this file and overall
					}
					fileSymbolContent += symbolLine;
					fileSymbolContentLength += symbolLine.length;
					symbolsAddedToFile++;
					totalSymbolsAdded++;
				}
				fileSymbolContent += "\n"; // Newline after each file's symbols

				symbolInfoSection += fileSymbolContent;
				currentSymbolSectionLength += fileSymbolContentLength;
				filesWithSymbolsAdded++;

				if (currentSymbolSectionLength >= config.maxTotalSymbolChars) {
					symbolInfoSection =
						symbolInfoSection.substring(
							0,
							config.maxTotalSymbolChars - 50 // Leave space for truncation message
						) + "\n... (Symbol information truncated due to size limit)\n\n";
					break; // Stop processing further files for symbols
				}
			}
		}
		if (filesWithSymbolsAdded > 0) {
			symbolInfoSection += "\n"; // Add final newline if any symbols were added
		} else {
			symbolInfoSection = ""; // Clear section if no symbols were added at all
		}
	}

	if (symbolInfoSection.length > 0) {
		// Check if adding this section exceeds total context limit
		if (currentTotalLength + symbolInfoSection.length > config.maxTotalLength) {
			console.warn(
				`Symbol information section exceeds total context limit. Truncating.`
			);
			const availableLength = config.maxTotalLength - currentTotalLength - 50; // Reserve space for truncation message
			symbolInfoSection =
				symbolInfoSection.substring(
					0,
					availableLength > 0 ? availableLength : 0
				) + "\n... (Symbol information truncated due to size limit)\n\n";
		}
		context += symbolInfoSection;
		currentTotalLength += symbolInfoSection.length;
		console.log(
			`Context size after adding symbol info: ${currentTotalLength} chars.`
		);
	}
	// --- END: Symbol Information ---

	// --- Active Symbol Detailed Information ---
	let activeSymbolDetailSection = "";
	if (activeSymbolDetailedInfo && activeSymbolDetailedInfo.name) {
		activeSymbolDetailSection += `Active Symbol Detail: ${activeSymbolDetailedInfo.name}\n`;

		const formatLocation = (
			location: vscode.Location | vscode.Location[] | undefined
		): string => {
			if (!location) {
				return "N/A";
			}
			const actualLocation = Array.isArray(location)
				? location.length > 0
					? location[0]
					: undefined
				: location;
			if (!actualLocation || !actualLocation.uri) {
				return "N/A";
			}

			const relativePath = path
				.relative(workspaceRoot.fsPath, actualLocation.uri.fsPath)
				.replace(/\\/g, "/");
			return `${relativePath}:${actualLocation.range.start.line + 1}`;
		};

		const formatLocations = (
			locations: vscode.Location[] | undefined
		): string => {
			if (!locations || locations.length === 0) {
				return "None";
			}
			return locations.map((loc) => formatLocation(loc)).join(", ");
		};

		const formatIncomingCalls = (
			calls: vscode.CallHierarchyIncomingCall[] | undefined
		): string => {
			if (!calls || calls.length === 0) {
				return `No Incoming Calls`;
			}
			const limitedCalls = calls.slice(0, 5); // Limit to top 5
			const formatted = limitedCalls
				.map((call) => {
					// Use call.from.uri and the first range from call.fromRanges
					if (!call.from || !call.from.uri) {
						return `${call.from?.name || "Unknown"} (N/A:URI_Missing)`;
					}
					const relativePath = path
						.relative(workspaceRoot.fsPath, call.from.uri.fsPath)
						.replace(/\\/g, "/");
					const lineNumber =
						call.fromRanges.length > 0
							? call.fromRanges[0].start.line + 1
							: "N/A";
					const fromDetail = call.from.detail
						? ` (Detail: ${call.from.detail})`
						: "";
					return `${call.from.name} (${relativePath}:${lineNumber})${fromDetail}`;
				})
				.join("\n  - ");
			const more = calls.length > 5 ? `\n  ... (${calls.length - 5} more)` : "";
			return `  - ${formatted}${more}`;
		};

		const formatOutgoingCalls = (
			calls: vscode.CallHierarchyOutgoingCall[] | undefined
		): string => {
			if (!calls || calls.length === 0) {
				return `No Outgoing Calls`;
			}
			const limitedCalls = calls.slice(0, 5); // Limit to top 5
			const formatted = limitedCalls
				.map((call) => {
					// Use call.to.uri and call.to.range
					if (!call.to || !call.to.uri) {
						return `${call.to?.name || "Unknown"} (N/A:URI_Missing)`;
					}
					const relativePath = path
						.relative(workspaceRoot.fsPath, call.to.uri.fsPath)
						.replace(/\\/g, "/");
					const toDetail = call.to.detail ? ` (Detail: ${call.to.detail})` : "";
					return `${call.to.name} (${relativePath}:${
						call.to.range.start.line + 1
					})${toDetail}`;
				})
				.join("\n  - ");
			const more = calls.length > 5 ? `\n  ... (${calls.length - 5} more)` : "";
			return `  - ${formatted}${more}`;
		};

		activeSymbolDetailSection += `  Definition: ${formatLocation(
			activeSymbolDetailedInfo.definition
		)}\n`;
		activeSymbolDetailSection += `  Type Definition: ${formatLocation(
			activeSymbolDetailedInfo.typeDefinition
		)}\n`;
		activeSymbolDetailSection += `  Implementations: ${formatLocations(
			activeSymbolDetailedInfo.implementations
		)}\n`;
		activeSymbolDetailSection += `  Detail: ${
			activeSymbolDetailedInfo.detail || "N/A"
		}\n`;

		// 1. Add fullRange
		if (activeSymbolDetailedInfo.fullRange) {
			activeSymbolDetailSection += `  Full Range: Lines ${
				activeSymbolDetailedInfo.fullRange.start.line + 1
			}-${activeSymbolDetailedInfo.fullRange.end.line + 1}\n`;
		}

		// 2. Add childrenHierarchy
		if (activeSymbolDetailedInfo.childrenHierarchy) {
			activeSymbolDetailSection += `  Children Hierarchy:\n${activeSymbolDetailedInfo.childrenHierarchy}\n`;
		}

		// 3. Add referencedTypeDefinitions
		if (
			activeSymbolDetailedInfo.referencedTypeDefinitions &&
			activeSymbolDetailedInfo.referencedTypeDefinitions.length > 0
		) {
			activeSymbolDetailSection += `  Referenced Type Definitions:\n`;
			let count = 0;
			for (const def of activeSymbolDetailedInfo.referencedTypeDefinitions) {
				if (count >= MAX_REFERENCED_TYPES_TO_INCLUDE) {
					activeSymbolDetailSection += `    ... (${
						activeSymbolDetailedInfo.referencedTypeDefinitions.length - count
					} more referenced types omitted)\n`;
					break;
				}

				const relativePath = def.filePath;
				let contentPreview = def.content;
				if (contentPreview.length > MAX_REFERENCED_TYPE_CONTENT_CHARS) {
					contentPreview =
						contentPreview.substring(0, MAX_REFERENCED_TYPE_CONTENT_CHARS) +
						"\n... (content truncated)";
				}
				activeSymbolDetailSection += `    File: ${relativePath}\n`;
				activeSymbolDetailSection += `    Content:\n\`\`\`\n${contentPreview}\n\`\`\`\n`;
				count++;
			}
		}

		activeSymbolDetailSection += `  Incoming Calls:\n${formatIncomingCalls(
			activeSymbolDetailedInfo.incomingCalls
		)}\n`;
		activeSymbolDetailSection += `  Outgoing Calls:\n${formatOutgoingCalls(
			activeSymbolDetailedInfo.outgoingCalls
		)}\n`;
		activeSymbolDetailSection += `\n`; // Add a newline for separation

		// Truncation logic for active symbol detail section
		if (activeSymbolDetailSection.length > config.maxActiveSymbolDetailChars) {
			const truncateMessage =
				"\n... (Active symbol detail truncated due to section size limit)\n";
			const availableLength =
				config.maxActiveSymbolDetailChars - truncateMessage.length;
			if (availableLength > 0) {
				activeSymbolDetailSection =
					activeSymbolDetailSection.substring(0, availableLength) +
					truncateMessage;
			} else {
				activeSymbolDetailSection = truncateMessage; // If no space, just the message
			}
		}

		// Add to total context if not empty after truncation
		if (activeSymbolDetailSection.length > 0) {
			if (
				currentTotalLength + activeSymbolDetailSection.length >
				config.maxTotalLength
			) {
				console.warn(
					`Active symbol detail section exceeds total context limit. Truncating.`
				);
				const availableLength = config.maxTotalLength - currentTotalLength - 50; // Reserve space for truncation message
				activeSymbolDetailSection =
					activeSymbolDetailSection.substring(
						0,
						availableLength > 0 ? availableLength : 0
					) +
					"\n... (Active symbol detail truncated due to total size limit)\n\n";
			}
			context += activeSymbolDetailSection;
			currentTotalLength += activeSymbolDetailSection.length;
			console.log(
				`Context size after adding active symbol detail: ${currentTotalLength} chars.`
			);
		}
	}
	// --- END: Active Symbol Detailed Information ---

	context += "File Contents (partial):\n"; // This line is already there, ensure it follows the new section
	const contentHeaderLength = "File Contents (partial):\n".length;
	currentTotalLength += contentHeaderLength;

	let contentAdded = false; // Track if any content was added

	for (const fileUri of relevantFiles) {
		// Check if we have *any* space left for content after the structure and recent changes
		if (currentTotalLength >= config.maxTotalLength) {
			filesSkippedForTotalSize =
				relevantFiles.length - relevantFiles.indexOf(fileUri);
			console.log(
				`Skipping remaining ${filesSkippedForTotalSize} file contents as total limit reached.`
			);
			break; // Stop processing file contents immediately
		}

		const relativePath = path
			.relative(workspaceRoot.fsPath, fileUri.fsPath)
			.replace(/\\/g, "/");
		const fileHeader = `--- File: ${relativePath} ---\n`;

		// BEGIN: Dependency Graph Logic
		let importRelationsDisplay = "";
		if (dependencyGraph) {
			const imports = dependencyGraph.get(relativePath);
			if (imports && imports.length > 0) {
				const maxImportsToDisplay = 10;
				const displayedImports = imports
					.slice(0, maxImportsToDisplay)
					.map((imp) => `'${imp}'`)
					.join(", ");
				const remainingImportsCount = imports.length - maxImportsToDisplay;
				const suffix =
					remainingImportsCount > 0
						? ` (and ${remainingImportsCount} more)`
						: "";
				importRelationsDisplay = `imports: ${displayedImports}${suffix}\n`;
			} else {
				importRelationsDisplay = `imports: No Imports\n`;
			}
		} else {
			importRelationsDisplay = `imports: No Imports (Dependency graph not provided)\n`;
		}
		// END: Dependency Graph Logic

		let fileContent = "";
		let truncated = false;

		try {
			const contentBytes = await vscode.workspace.fs.readFile(fileUri);
			fileContent = Buffer.from(contentBytes).toString("utf-8");

			// Apply per-file length limit
			if (fileContent.length > config.maxFileLength) {
				fileContent = fileContent.substring(0, config.maxFileLength);
				truncated = true;
			}
		} catch (error) {
			console.warn(`Could not read file content for ${relativePath}:`, error);
			fileContent = `[Error reading file: ${
				error instanceof Error ? error.message : String(error)
			}]`;
			truncated = true; // Mark as truncated/incomplete due to error
		}

		const contentToAdd =
			fileHeader +
			importRelationsDisplay +
			fileContent +
			(truncated ? "\n[...truncated]" : "") +
			"\n\n";
		const estimatedLengthIncrease = contentToAdd.length;

		// Check if adding *this* file's content exceeds the total length limit
		if (currentTotalLength + estimatedLengthIncrease > config.maxTotalLength) {
			// Try adding a truncated version if it fits
			const availableContentSpace = config.maxTotalLength - currentTotalLength;
			const minContentHeader = `--- File: ${relativePath} --- [...content omitted]\n\n`;
			if (availableContentSpace > minContentHeader.length) {
				// Try to fit at least the header and some truncated content
				const maxAllowedContentLength =
					availableContentSpace -
					fileHeader.length -
					importRelationsDisplay.length - // Account for new import relations
					"\n[...truncated]\n\n".length;
				if (maxAllowedContentLength > 50) {
					// Only add if we can fit a reasonable snippet
					const partialContentToAdd =
						fileHeader +
						importRelationsDisplay +
						fileContent.substring(0, maxAllowedContentLength) +
						"\n[...truncated]\n\n";
					context += partialContentToAdd;
					currentTotalLength += partialContentToAdd.length;
					console.log(
						`Added truncated content for ${relativePath} to fit total limit.`
					);
					contentAdded = true;
				}
			}
			// Calculate remaining skipped files after this potentially truncated one
			filesSkippedForTotalSize =
				relevantFiles.length - relevantFiles.indexOf(fileUri);
			console.log(
				`Skipping remaining ${filesSkippedForTotalSize} file contents as total limit reached.`
			);
			break; // Stop processing further files
		}

		context += contentToAdd;
		currentTotalLength += estimatedLengthIncrease;
		contentAdded = true;
	}

	// the final skipped message if needed
	if (!contentAdded && currentTotalLength < config.maxTotalLength) {
		context += "\n(No file content included due to size limits or errors)";
	} else if (filesSkippedForTotalSize > 0) {
		context += `\n... (Content from ${filesSkippedForTotalSize} more files omitted due to total size limit)`;
	}

	// Diagnostic log for final size
	console.log(`Final context size: ${currentTotalLength} characters.`);
	return context.trim(); // Remove any trailing whitespace
}

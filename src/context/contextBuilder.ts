import * as vscode from "vscode";
import * as path from "path";
import { createAsciiTree } from "../utilities/treeFormatter";
import { FileChangeEntry } from "../types/workflow";
import { ActiveSymbolDetailedInfo } from "../services/contextService";
import { intelligentlySummarizeFileContent } from "./fileContentProcessor";

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
	maxFileLength: 1 * 1024 * 1024, // Approx 1MB in characters
	maxTotalLength: 1 * 1024 * 1024, // Approx 1MB in characters
	maxSymbolEntriesPerFile: 10, // Default to 10 symbols per file
	maxTotalSymbolChars: 100000, // Default to 100KB for the entire symbols section
	maxActiveSymbolDetailChars: 100000, // Default to 100KB
};

/**
 * Interface for files considered during prioritization, including a relevance score.
 */
interface PrioritizedFile {
	uri: vscode.Uri;
	score: number;
}

/**
 * Formats a list of file change entries into a string section for AI context,
 * listing only the paths of created or modified files.
 * @param changeLog An array of FileChangeEntry objects representing recent changes.
 * @returns A formatted string of changed file paths, or an empty string if no relevant changes.
 */
function _formatFileChangePathsForContext(
	changeLog: FileChangeEntry[],
	rootFolderUri: vscode.Uri
): string {
	if (!changeLog || changeLog.length === 0) {
		return ""; // No changes to report
	}

	const changedFilePaths: string[] = [];
	const processedPaths = new Set<string>(); // To track unique paths and avoid duplicates

	for (const entry of changeLog) {
		// Only consider 'created' or 'modified' entries and ensure the path is unique
		if (
			(entry.changeType === "created" || entry.changeType === "modified") &&
			!processedPaths.has(entry.filePath)
		) {
			changedFilePaths.push(entry.filePath);
			processedPaths.add(entry.filePath);
		}
	}

	if (changedFilePaths.length === 0) {
		return ""; // No relevant changes after filtering
	}

	// Sort paths alphabetically for consistent output
	changedFilePaths.sort();

	const header = "--- Modified/Created File Paths ---";
	const footer = "--- End Modified/Created File Paths ---";
	// Prefix each path with '- ' and join with newlines
	const pathsList = changedFilePaths.map((p) => `- ${p}`).join("\n");

	return `${header}\n${pathsList}\n${footer}`;
}

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
 * @param reverseDependencyGraph Optional map representing reverse file import/dependency relations.
 * @returns A promise that resolves to the generated context string.
 */
export async function buildContextString(
	relevantFiles: vscode.Uri[],
	workspaceRoot: vscode.Uri,
	config: ContextConfig = DEFAULT_CONTEXT_CONFIG,
	recentChanges?: FileChangeEntry[],
	dependencyGraph?: Map<string, string[]>,
	documentSymbols?: Map<string, vscode.DocumentSymbol[] | undefined>,
	activeSymbolDetailedInfo?: ActiveSymbolDetailedInfo,
	reverseDependencyGraph?: Map<string, string[]> // NEW parameter for prioritization
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
	const treeStringInitialLength = fileStructureString.length;

	if (
		currentTotalLength + treeHeaderLength + treeStringInitialLength >
		config.maxTotalLength
	) {
		console.warn(
			`Generated file structure tree (${treeStringInitialLength} chars) exceeds total context limit (${config.maxTotalLength} chars). Truncating structure.`
		);
		const availableLength =
			config.maxTotalLength - currentTotalLength - treeHeaderLength - 50; // Reserve space for headers/footers/truncation message
		fileStructureString =
			fileStructureString.substring(
				0,
				availableLength > 0 ? availableLength : 0
			) +
			`\n... (File structure truncated from ${treeStringInitialLength} chars to ${Math.max(
				0,
				availableLength
			)} chars due to total context limit)`;
		context += fileStructureString + "\n\n";
		currentTotalLength = config.maxTotalLength; // Maxed out after adding truncated structure
		console.log(
			`Truncated context size after adding structure: ${currentTotalLength} chars.`
		);
	} else {
		context += fileStructureString + "\n\n";
		currentTotalLength += treeHeaderLength + treeStringInitialLength; // Update length
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
			.replace(/\\/g, "/");
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
		const originalLength = existingPathsSection.length;
		existingPathsSection =
			existingPathsSection.substring(
				0,
				availableLength > 0 ? availableLength : 0
			) +
			`\n... (Existing paths list truncated from ${originalLength} chars to ${Math.max(
				0,
				availableLength
			)} chars due to total size limit)\n\n`;
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

	// --- Modified/Created File Paths Section (NEW) ---
	const fileChangePathsSection = _formatFileChangePathsForContext(
		recentChanges || [], // Pass the recentChanges argument from buildContextString
		workspaceRoot
	);
	if (fileChangePathsSection) {
		// Add 2 for newlines separating this section from others
		if (
			currentTotalLength + fileChangePathsSection.length + 2 >
			config.maxTotalLength
		) {
			console.warn(
				`Modified/Created file paths section exceeds total context limit. Truncating.`
			);
			const availableLength = config.maxTotalLength - currentTotalLength - 50; // Reserve space for truncation message
			let truncatedSection = fileChangePathsSection;
			const originalLength = fileChangePathsSection.length; // Capture original length

			if (availableLength > 0) {
				truncatedSection =
					truncatedSection.substring(0, availableLength) +
					`\n... (Modified/Created paths truncated from ${originalLength} chars to ${availableLength} chars due to total size limit)`;
			} else {
				truncatedSection =
					"\n... (Modified/Created paths section omitted due to total size limit)";
			}
			context += truncatedSection + "\n\n";
			currentTotalLength = config.maxTotalLength; // Maxed out
		} else {
			context += fileChangePathsSection + "\n\n";
			currentTotalLength += fileChangePathsSection.length + 2; // +2 for newlines
			console.log(
				`Context size after adding modified/created paths: ${currentTotalLength} chars.`
			);
		}
	}
	// --- END: Modified/Created File Paths Section ---

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
			const originalLength = symbolInfoSection.length;
			symbolInfoSection =
				symbolInfoSection.substring(
					0,
					availableLength > 0 ? availableLength : 0
				) +
				`\n... (Symbol information truncated from ${originalLength} chars to ${Math.max(
					0,
					availableLength
				)} chars due to size limit)\n\n`;
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
			activeSymbolDetailedInfo.referencedTypeDefinitions.size > 0
		) {
			activeSymbolDetailSection += `  Referenced Type Definitions:\n`;
			let count = 0;
			for (const [
				filePath,
				content,
			] of activeSymbolDetailedInfo.referencedTypeDefinitions) {
				if (count >= MAX_REFERENCED_TYPES_TO_INCLUDE) {
					activeSymbolDetailSection += `    ... (${
						activeSymbolDetailedInfo.referencedTypeDefinitions.size - count
					} more referenced types omitted)\n`;
					break;
				}

				const joinedContent = content.join("\n"); // Add this line
				const fullFileContent = joinedContent; // Change this line
				let processedContent = fullFileContent;
				if (processedContent.length > MAX_REFERENCED_TYPE_CONTENT_CHARS) {
					processedContent =
						processedContent.substring(0, MAX_REFERENCED_TYPE_CONTENT_CHARS) +
						"\n... (content truncated)";
				}
				let contentPreview: string[] = [processedContent];
				activeSymbolDetailSection += `    File: ${filePath}\n`;
				activeSymbolDetailSection += `    Content:\n\`\`\`\n${contentPreview[0]}\n\`\`\`\n`;
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
				const availableLength =
					currentTotalLength - activeSymbolDetailSection.length - 50; // Reserve space for truncation message
				const originalLength = activeSymbolDetailSection.length;
				activeSymbolDetailSection =
					activeSymbolDetailSection.substring(
						0,
						availableLength > 0 ? availableLength : 0
					) +
					`\n... (Active symbol detail truncated from ${originalLength} chars to ${Math.max(
						0,
						availableLength
					)} chars due to total size limit)\n\n`;
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

	// --- Dynamic File Prioritization for Content Inclusion ---
	let prioritizedFiles: PrioritizedFile[] = relevantFiles.map((uri) => ({
		uri,
		score: 0,
	}));

	// Assign scores based on relevance
	for (const pf of prioritizedFiles) {
		const relativePath = path
			.relative(workspaceRoot.fsPath, pf.uri.fsPath)
			.replace(/\\/g, "/");

		// Highest priority: Active file
		if (activeSymbolDetailedInfo?.filePath === relativePath) {
			pf.score += 1000;
			// Even higher if its definition is the active symbol's full range
			if (
				activeSymbolDetailedInfo.fullRange &&
				activeSymbolDetailedInfo.filePath === relativePath
			) {
				pf.score += 200;
			}
		}

		// High priority: Files related to active symbol (definitions, implementations, references, call hierarchy)
		const activeSymbolRelatedPaths: Set<string> = new Set();
		if (activeSymbolDetailedInfo) {
			if (activeSymbolDetailedInfo.definition) {
				const definitionLoc = Array.isArray(activeSymbolDetailedInfo.definition)
					? activeSymbolDetailedInfo.definition[0]
					: activeSymbolDetailedInfo.definition;
				if (definitionLoc?.uri) {
					activeSymbolRelatedPaths.add(
						path
							.relative(workspaceRoot.fsPath, definitionLoc.uri.fsPath)
							.replace(/\\/g, "/")
					);
				}
			}
			if (activeSymbolDetailedInfo.typeDefinition) {
				const typeDefLoc = Array.isArray(
					activeSymbolDetailedInfo.typeDefinition
				)
					? activeSymbolDetailedInfo.typeDefinition[0]
					: activeSymbolDetailedInfo.typeDefinition;
				if (typeDefLoc?.uri) {
					activeSymbolRelatedPaths.add(
						path
							.relative(workspaceRoot.fsPath, typeDefLoc.uri.fsPath)
							.replace(/\\/g, "/")
					);
				}
			}
			activeSymbolDetailedInfo.implementations?.forEach((loc) =>
				activeSymbolRelatedPaths.add(
					path
						.relative(workspaceRoot.fsPath, loc.uri.fsPath)
						.replace(/\\/g, "/")
				)
			);
			activeSymbolDetailedInfo.referencedTypeDefinitions?.forEach((_, fp) =>
				activeSymbolRelatedPaths.add(fp)
			);
			activeSymbolDetailedInfo.incomingCalls?.forEach((call) =>
				activeSymbolRelatedPaths.add(
					path
						.relative(workspaceRoot.fsPath, call.from.uri.fsPath)
						.replace(/\\/g, "/")
				)
			);
			activeSymbolDetailedInfo.outgoingCalls?.forEach((call) =>
				activeSymbolRelatedPaths.add(
					path
						.relative(workspaceRoot.fsPath, call.to.uri.fsPath)
						.replace(/\\/g, "/")
				)
			);
		}
		if (activeSymbolRelatedPaths.has(relativePath)) {
			pf.score += 500;
		}

		// Medium-high priority: Direct dependencies of other highly-scored files or the active file
		const directDependencies = dependencyGraph?.get(relativePath);
		if (directDependencies && directDependencies.length > 0) {
			pf.score += 100; // Bonus for files that import others
		}

		// Medium priority: Files that import the active file (reverse dependencies) or are imported by other relevant files
		const reverseDependencies = reverseDependencyGraph?.get(relativePath);
		if (reverseDependencies && reverseDependencies.length > 0) {
			pf.score += 80; // Bonus for files that are imported by others
		}

		// Low-medium priority: Files with significant symbols, even if not directly related to active symbol
		if (
			documentSymbols?.get(relativePath)?.length &&
			documentSymbols.get(relativePath)!.length >
				config.maxSymbolEntriesPerFile / 2
		) {
			pf.score += 50;
		}
	}

	// Sort files: active file first, then by score (descending), then by path for tie-breaking
	prioritizedFiles.sort((a, b) => {
		// Keep active file absolutely first if it's present and highly scored
		const aIsActiveFile =
			activeSymbolDetailedInfo?.filePath &&
			path.relative(workspaceRoot.fsPath, a.uri.fsPath).replace(/\\/g, "/") ===
				activeSymbolDetailedInfo.filePath;
		const bIsActiveFile =
			activeSymbolDetailedInfo?.filePath &&
			path.relative(workspaceRoot.fsPath, b.uri.fsPath).replace(/\\/g, "/") ===
				activeSymbolDetailedInfo.filePath;

		if (aIsActiveFile && !bIsActiveFile) {
			return -1;
		}
		if (!aIsActiveFile && bIsActiveFile) {
			return 1;
		}

		if (b.score !== a.score) {
			return b.score - a.score; // Higher score comes first
		}
		return a.uri.fsPath.localeCompare(b.uri.fsPath); // Alphabetical for tie-breaking
	});

	// Update relevantFiles to be the newly sorted list for content processing
	const sortedRelevantFiles = prioritizedFiles.map((pf) => pf.uri);
	// --- END Dynamic File Prioritization for Content Inclusion ---

	for (const fileUri of sortedRelevantFiles) {
		// Check if we have *any* space left for content after the structure and recent changes
		if (currentTotalLength >= config.maxTotalLength) {
			filesSkippedForTotalSize =
				sortedRelevantFiles.length - sortedRelevantFiles.indexOf(fileUri);
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

		let fileContentRaw = "";
		let fileContentForContext = "";
		let truncatedForSmartSummary = false;

		try {
			const contentBytes = await vscode.workspace.fs.readFile(fileUri);
			fileContentRaw = Buffer.from(contentBytes).toString("utf-8");

			const symbolsForFile = documentSymbols?.get(relativePath);

			// Determine if this is the active file for active symbol prioritization
			const isActiveFile = activeSymbolDetailedInfo?.filePath === relativePath;
			let activeSymbolInfoForCurrentFile: ActiveSymbolDetailedInfo | undefined =
				undefined;
			if (isActiveFile) {
				activeSymbolInfoForCurrentFile = activeSymbolDetailedInfo;
			}

			fileContentForContext = intelligentlySummarizeFileContent(
				fileContentRaw,
				symbolsForFile,
				activeSymbolInfoForCurrentFile,
				config.maxFileLength
			);

			if (fileContentForContext.length < fileContentRaw.length) {
				truncatedForSmartSummary = true;
			}
		} catch (error) {
			console.warn(
				`Could not read or intelligently summarize file content for ${relativePath}:`,
				error
			);
			fileContentForContext = `[Error reading/summarizing file: ${
				error instanceof Error ? error.message : String(error)
			}]`;
			truncatedForSmartSummary = true; // Mark as truncated/incomplete due to error
		}

		const contentToAdd =
			fileHeader +
			importRelationsDisplay +
			fileContentForContext +
			(truncatedForSmartSummary
				? "\n[...content intelligently summarized]"
				: "") +
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
					"\n[...content intelligently summarized]\n\n".length; // Use the new message length
				if (maxAllowedContentLength > 50) {
					// Only add if we can fit a reasonable snippet
					const partialContentToAdd =
						fileHeader +
						importRelationsDisplay +
						fileContentForContext.substring(0, maxAllowedContentLength) +
						"\n[...content intelligently summarized]\n\n"; // Use the new message
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
				sortedRelevantFiles.length - sortedRelevantFiles.indexOf(fileUri);
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

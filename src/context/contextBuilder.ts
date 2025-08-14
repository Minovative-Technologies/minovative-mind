import * as vscode from "vscode";
import * as path from "path";
import { createAsciiTree } from "../utils/treeFormatter";
import { FileChangeEntry } from "../types/workflow";
import { ActiveSymbolDetailedInfo } from "../services/contextService";
import { intelligentlySummarizeFileContent } from "./fileContentProcessor";
import { DEFAULT_SIZE } from "../sidebar/common/sidebarConstants";

// Constants for context building
const MAX_REFERENCED_TYPE_CONTENT_CHARS = 8000;
const MAX_REFERENCED_TYPES_TO_INCLUDE = 20;

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
	maxFileLength: DEFAULT_SIZE, // Approx 1MB in characters
	maxTotalLength: DEFAULT_SIZE, // Approx 1MB in characters
	maxSymbolEntriesPerFile: 20, // Default to 10 symbols per file
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
 * Initializes the build context string with workspace name and file count header.
 * @param workspaceRoot The root URI of the workspace.
 * @param relevantFiles An array of vscode.Uri objects for relevant files.
 * @returns An object containing the initial context string and its length.
 */
function _initializeBuildContext(
	workspaceRoot: vscode.Uri,
	relevantFiles: vscode.Uri[]
): { context: string; currentTotalLength: number } {
	let context = `Project Context (Workspace: ${path.basename(
		workspaceRoot.fsPath
	)}):\n`;
	context += `Relevant files identified: ${relevantFiles.length}\n\n`;
	const currentTotalLength = context.length;
	console.log(
		`Context initialized. Current size: ${currentTotalLength} chars.`
	);
	return { context, currentTotalLength };
}

/**
 * Manages the generation and addition of the file structure ASCII tree to the context.
 * Applies length checks against `config.maxTotalLength` and handles truncation.
 * @param relevantFiles An array of vscode.Uri objects for relevant files.
 * @param workspaceRoot The root URI of the workspace for relative paths.
 * @param currentContext The current context string.
 * @param currentTotalLength The current total length of the context string.
 * @param config Configuration for context building.
 * @returns An object containing the updated context string and its length.
 */
function _addFileStructureToContext(
	relevantFiles: vscode.Uri[],
	workspaceRoot: vscode.Uri,
	currentContext: string,
	currentTotalLength: number,
	config: ContextConfig
): { context: string; currentTotalLength: number } {
	let context = currentContext;
	let length = currentTotalLength;

	const rootName = path.basename(workspaceRoot.fsPath);
	const relativePaths = relevantFiles.map((uri) =>
		path.relative(workspaceRoot.fsPath, uri.fsPath).replace(/\\/g, "/")
	);
	let fileStructureString = createAsciiTree(relativePaths, rootName);

	const treeHeader = "File Structure:\n";
	const treeFooter = "\n\n"; // Consistent spacing
	const estimatedSectionLength =
		treeHeader.length + fileStructureString.length + treeFooter.length;

	if (length + estimatedSectionLength > config.maxTotalLength) {
		console.warn(
			`Generated file structure tree (${fileStructureString.length} chars) exceeds total context limit (${config.maxTotalLength} chars). Truncating structure.`
		);
		const availableLengthForContent =
			config.maxTotalLength - length - treeHeader.length - treeFooter.length; // Reserve space for header, footer, and truncation message
		const truncationMessage = `\n... (File structure truncated from ${
			fileStructureString.length
		} chars to ${Math.max(
			0,
			availableLengthForContent
		)} chars due to total context limit)`;

		fileStructureString =
			fileStructureString.substring(
				0,
				Math.max(0, availableLengthForContent - truncationMessage.length)
			) + truncationMessage;

		context += treeHeader + fileStructureString + treeFooter;
		length = config.maxTotalLength; // Maxed out after adding truncated structure
		console.log(
			`Truncated context size after adding structure: ${length} chars.`
		);
	} else {
		context += treeHeader + fileStructureString + treeFooter;
		length += estimatedSectionLength;
		console.log(`Context size after adding structure: ${length} chars.`);
	}
	return { context, currentTotalLength: length };
}

/**
 * Handles the formatting and addition of `recentChanges` to the context.
 * Applies length checks and truncation.
 * @param recentChanges Optional array of recent file changes to include.
 * @param currentContext The current context string.
 * @param currentTotalLength The current total length of the context string.
 * @param config Configuration for context building.
 * @returns An object containing the updated context string and its length.
 */
function _addRecentChangesToContext(
	recentChanges: FileChangeEntry[] | undefined,
	currentContext: string,
	currentTotalLength: number,
	config: ContextConfig
): { context: string; currentTotalLength: number } {
	let context = currentContext;
	let length = currentTotalLength;

	if (recentChanges && recentChanges.length > 0) {
		const changesHeader =
			"*** Recent Project Changes (During Current Workflow Execution) ***\n";
		let changesSectionContent = [];
		let tempLength = changesHeader.length;

		// Build changes content into an array for efficient length checking and joining
		for (const change of recentChanges) {
			const formattedChange =
				`--- File ${change.changeType.toUpperCase()}: ${
					change.filePath
				} ---\n` + `${change.summary}\n\n`;

			if (
				length + tempLength + formattedChange.length >
				config.maxTotalLength
			) {
				changesSectionContent.push(
					"... (additional changes omitted due to context limit)"
				);
				tempLength +=
					changesSectionContent[changesSectionContent.length - 1].length;
				break; // Truncate and stop adding changes
			}
			changesSectionContent.push(formattedChange);
			tempLength += formattedChange.length;
		}

		const fullChangesSection = changesHeader + changesSectionContent.join("");

		// Final check and truncate if necessary after joining
		if (length + fullChangesSection.length > config.maxTotalLength) {
			console.warn(
				`Recent changes section exceeds total context limit. Truncating.`
			);
			const availableLength = config.maxTotalLength - length - 50; // Reserve space for truncation message
			const originalLength = fullChangesSection.length;
			const truncatedSection =
				fullChangesSection.substring(
					0,
					availableLength > 0 ? availableLength : 0
				) +
				`\n... (Recent changes truncated from ${originalLength} chars to ${Math.max(
					0,
					availableLength
				)} chars due to total size limit)\n\n`; // Add final newlines
			context += truncatedSection;
			length = config.maxTotalLength;
		} else {
			context += fullChangesSection;
			length += fullChangesSection.length;
		}
		console.log(`Context size after adding recent changes: ${length} chars.`);
	}
	return { context, currentTotalLength: length };
}

/**
 * Formats and adds a list of `relevantFiles` paths to the context.
 * Applies length checks and handles truncation.
 * @param relevantFiles An array of vscode.Uri objects for relevant files.
 * @param workspaceRoot The root URI of the workspace.
 * @param currentContext The current context string.
 * @param currentTotalLength The current total length of the context string.
 * @param config Configuration for context building.
 * @returns An object containing the updated context string and its length.
 */
function _addExistingFilePathsSection(
	relevantFiles: vscode.Uri[],
	workspaceRoot: vscode.Uri,
	currentContext: string,
	currentTotalLength: number,
	config: ContextConfig
): { context: string; currentTotalLength: number } {
	let context = currentContext;
	let length = currentTotalLength;
	const pathList: string[] = ["Existing Relative File Paths:\n"];
	const maxPathsToList = 1000; // Limit the number of paths to avoid excessive context
	let pathsAddedCount = 0;

	for (const fileUri of relevantFiles) {
		if (pathsAddedCount >= maxPathsToList) {
			pathList.push("... (additional paths omitted due to limit)");
			break;
		}
		const relativePath = path
			.relative(workspaceRoot.fsPath, fileUri.fsPath)
			.replace(/\\/g, "/");
		pathList.push(`- ${relativePath}`);
		pathsAddedCount++;
	}
	pathList.push("\n"); // Add a newline for separation

	let existingPathsSection = pathList.join("\n");

	if (length + existingPathsSection.length > config.maxTotalLength) {
		console.warn(
			`Existing paths list exceeds total context limit. Truncating.`
		);
		const availableLength = config.maxTotalLength - length - 50; // Reserve space for truncation message
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
		length = config.maxTotalLength;
	} else {
		context += existingPathsSection;
		length += existingPathsSection.length;
	}
	console.log(
		`Context size after adding existing paths list: ${length} chars.`
	);
	return { context, currentTotalLength: length };
}

/**
 * Formats and adds the `_formatFileChangePathsForContext` generated section to the context.
 * Applies length checks against `config.maxTotalLength` and handles truncation.
 * @param recentChanges Optional array of recent file changes to include.
 * @param workspaceRoot The root URI of the workspace.
 * @param currentContext The current context string.
 * @param currentTotalLength The current total length of the context string.
 * @param config Configuration for context building.
 * @returns An object containing the updated context string and its length.
 */
function _addModifiedCreatedPathsSection(
	recentChanges: FileChangeEntry[] | undefined,
	workspaceRoot: vscode.Uri,
	currentContext: string,
	currentTotalLength: number,
	config: ContextConfig
): { context: string; currentTotalLength: number } {
	let context = currentContext;
	let length = currentTotalLength;

	const fileChangePathsSection = _formatFileChangePathsForContext(
		recentChanges || [],
		workspaceRoot
	);

	if (fileChangePathsSection) {
		// Add 2 for newlines separating this section from others
		const estimatedLength = fileChangePathsSection.length + 2;
		if (length + estimatedLength > config.maxTotalLength) {
			console.warn(
				`Modified/Created file paths section exceeds total context limit. Truncating.`
			);
			const availableLength = config.maxTotalLength - length - 50; // Reserve space for truncation message
			const originalLength = fileChangePathsSection.length;
			let truncatedSection = "";

			if (availableLength > 0) {
				truncatedSection =
					fileChangePathsSection.substring(0, availableLength) +
					`\n... (Modified/Created paths truncated from ${originalLength} chars to ${availableLength} chars due to total size limit)`;
			} else {
				truncatedSection =
					"\n... (Modified/Created paths section omitted due to total size limit)";
			}
			context += truncatedSection + "\n\n";
			length = config.maxTotalLength; // Maxed out
		} else {
			context += fileChangePathsSection + "\n\n";
			length += estimatedLength;
			console.log(
				`Context size after adding modified/created paths: ${length} chars.`
			);
		}
	}
	return { context, currentTotalLength: length };
}

/**
 * Processes `documentSymbols`, respects limits like `config.maxSymbolEntriesPerFile` and `config.maxTotalSymbolChars`,
 * handles truncation, and adds the formatted symbol information to the context.
 * @param documentSymbols Optional map containing document symbols for relevant files.
 * @param relevantFiles An array of vscode.Uri objects for relevant files.
 * @param workspaceRoot The root URI of the workspace.
 * @param currentContext The current context string.
 * @param currentTotalLength The current total length of the context string.
 * @param config Configuration for context building.
 * @returns An object containing the updated context string and its length.
 */
function _addSymbolInfoSection(
	documentSymbols: Map<string, vscode.DocumentSymbol[] | undefined> | undefined,
	relevantFiles: vscode.Uri[],
	workspaceRoot: vscode.Uri,
	currentContext: string,
	currentTotalLength: number,
	config: ContextConfig
): { context: string; currentTotalLength: number } {
	let context = currentContext;
	let length = currentTotalLength;
	const symbolInfoParts: string[] = [];

	if (documentSymbols && documentSymbols.size > 0) {
		symbolInfoParts.push("Symbol Information:\n");
		let currentSymbolSectionLength = symbolInfoParts[0].length;

		for (const fileUri of relevantFiles) {
			const relativePath = path
				.relative(workspaceRoot.fsPath, fileUri.fsPath)
				.replace(/\\/g, "/");
			const symbolsForFile = documentSymbols.get(relativePath);

			if (symbolsForFile && symbolsForFile.length > 0) {
				let fileSymbolContentParts: string[] = [
					`--- File: ${relativePath} ---\n`,
				];
				let fileSymbolContentLength = fileSymbolContentParts[0].length;
				let symbolsAddedToFile = 0;

				for (const symbol of symbolsForFile) {
					// Check against per-file symbol limit and total symbol section limit
					if (
						symbolsAddedToFile >= config.maxSymbolEntriesPerFile ||
						currentSymbolSectionLength + fileSymbolContentLength + 50 >
							config.maxTotalSymbolChars
					) {
						fileSymbolContentParts.push(
							`... (${
								symbolsForFile.length - symbolsAddedToFile
							} more symbols omitted for this file)\n`
						);
						fileSymbolContentLength +=
							fileSymbolContentParts[fileSymbolContentParts.length - 1].length;
						break;
					}

					const symbolDetail = symbol.detail
						? ` (Detail: ${symbol.detail})`
						: "";
					const symbolLine = `- [${vscode.SymbolKind[symbol.kind]}] ${
						symbol.name
					} (Line ${symbol.range.start.line + 1})${symbolDetail}\n`;

					// Check if adding this symbol exceeds the total symbol section limit
					if (
						currentSymbolSectionLength +
							fileSymbolContentLength +
							symbolLine.length >
						config.maxTotalSymbolChars
					) {
						fileSymbolContentParts.push(
							"... (remaining symbols omitted due to total symbol context limit)\n"
						);
						fileSymbolContentLength +=
							fileSymbolContentParts[fileSymbolContentParts.length - 1].length;
						break; // Stop adding symbols to this file and overall
					}
					fileSymbolContentParts.push(symbolLine);
					fileSymbolContentLength += symbolLine.length;
					symbolsAddedToFile++;
				}
				fileSymbolContentParts.push("\n"); // Newline after each file's symbols
				currentSymbolSectionLength += fileSymbolContentLength;
				symbolInfoParts.push(...fileSymbolContentParts);

				if (currentSymbolSectionLength >= config.maxTotalSymbolChars) {
					// This means the section is already truncated within this loop, before final join
					const truncationMessage =
						"\n... (Symbol information truncated due to section size limit)\n\n";
					symbolInfoParts[0] = symbolInfoParts
						.join("")
						.substring(
							0,
							config.maxTotalSymbolChars - truncationMessage.length
						);
					symbolInfoParts.push(truncationMessage);
					break; // Stop processing further files for symbols
				}
			}
		}

		let symbolInfoSection = symbolInfoParts.join("");

		// Final check against total context limit for the entire symbol section
		if (symbolInfoSection.length > 0) {
			if (length + symbolInfoSection.length > config.maxTotalLength) {
				console.warn(
					`Symbol information section exceeds total context limit. Truncating.`
				);
				const availableLength = config.maxTotalLength - length - 50; // Reserve space for truncation message
				const originalLength = symbolInfoSection.length;
				symbolInfoSection =
					symbolInfoSection.substring(
						0,
						availableLength > 0 ? availableLength : 0
					) +
					`\n... (Symbol information truncated from ${originalLength} chars to ${Math.max(
						0,
						availableLength
					)} chars due to total size limit)\n\n`;
			}
			context += symbolInfoSection;
			length += symbolInfoSection.length;
			console.log(`Context size after adding symbol info: ${length} chars.`);
		}
	}
	return { context, currentTotalLength: length };
}

/**
 * Formats and appends `activeSymbolDetailedInfo` to the context.
 * Applies `config.maxActiveSymbolDetailChars` and overall length limits, handling truncation.
 * @param activeSymbolDetailedInfo Optional detailed information about the active symbol.
 * @param workspaceRoot The root URI of the workspace.
 * @param currentContext The current context string.
 * @param currentTotalLength The current total length of the context string.
 * @param config Configuration for context building.
 * @returns An object containing the updated context string and its length.
 */
function _addActiveSymbolDetailSection(
	activeSymbolDetailedInfo: ActiveSymbolDetailedInfo | undefined,
	workspaceRoot: vscode.Uri,
	currentContext: string,
	currentTotalLength: number,
	config: ContextConfig
): { context: string; currentTotalLength: number } {
	let context = currentContext;
	let length = currentTotalLength;
	const activeSymbolDetailParts: string[] = [];

	if (activeSymbolDetailedInfo && activeSymbolDetailedInfo.name) {
		activeSymbolDetailParts.push(
			`Active Symbol Detail: ${activeSymbolDetailedInfo.name}\n`
		);

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

		const formatCallHierarchy = (
			calls:
				| vscode.CallHierarchyIncomingCall[]
				| vscode.CallHierarchyOutgoingCall[]
				| undefined,
			type: "incoming" | "outgoing"
		): string => {
			if (!calls || calls.length === 0) {
				return type === "incoming" ? `No Incoming Calls` : `No Outgoing Calls`;
			}
			const limitedCalls = calls.slice(0, 5); // Limit to top 5
			const formatted = limitedCalls
				.map((call) => {
					const item =
						type === "incoming"
							? (call as vscode.CallHierarchyIncomingCall).from
							: (call as vscode.CallHierarchyOutgoingCall).to;
					if (!item || !item.uri) {
						return `${item?.name || "Unknown"} (N/A:URI_Missing)`;
					}
					const relativePath = path
						.relative(workspaceRoot.fsPath, item.uri.fsPath)
						.replace(/\\/g, "/");
					const lineNumber =
						type === "incoming"
							? (call as vscode.CallHierarchyIncomingCall).fromRanges.length > 0
								? (call as vscode.CallHierarchyIncomingCall).fromRanges[0].start
										.line + 1
								: "N/A"
							: (call as vscode.CallHierarchyOutgoingCall).fromRanges.length > 0
							? (call as vscode.CallHierarchyOutgoingCall).fromRanges![0].start
									.line + 1
							: item.range.start.line + 1;
					const detail = item.detail ? ` (Detail: ${item.detail})` : "";
					return `${item.name} (${relativePath}:${lineNumber})${detail}`;
				})
				.join("\n  - ");
			const more = calls.length > 5 ? `\n  ... (${calls.length - 5} more)` : "";
			return `  - ${formatted}${more}`;
		};

		activeSymbolDetailParts.push(
			`  Definition: ${formatLocation(activeSymbolDetailedInfo.definition)}\n`,
			`  Type Definition: ${formatLocation(
				activeSymbolDetailedInfo.typeDefinition
			)}\n`,
			`  Implementations: ${formatLocations(
				activeSymbolDetailedInfo.implementations
			)}\n`,
			`  Detail: ${activeSymbolDetailedInfo.detail || "N/A"}\n`
		);

		if (activeSymbolDetailedInfo.fullRange) {
			activeSymbolDetailParts.push(
				`  Full Range: Lines ${
					activeSymbolDetailedInfo.fullRange.start.line + 1
				}-${activeSymbolDetailedInfo.fullRange.end.line + 1}\n`
			);
		}

		if (activeSymbolDetailedInfo.childrenHierarchy) {
			activeSymbolDetailParts.push(
				`  Children Hierarchy:\n${activeSymbolDetailedInfo.childrenHierarchy}\n`
			);
		}

		if (
			activeSymbolDetailedInfo.referencedTypeDefinitions &&
			activeSymbolDetailedInfo.referencedTypeDefinitions.size > 0
		) {
			activeSymbolDetailParts.push(`  Referenced Type Definitions:\n`);
			let count = 0;
			for (const [
				filePath,
				content,
			] of activeSymbolDetailedInfo.referencedTypeDefinitions) {
				if (count >= MAX_REFERENCED_TYPES_TO_INCLUDE) {
					activeSymbolDetailParts.push(
						`    ... (${
							activeSymbolDetailedInfo.referencedTypeDefinitions.size - count
						} more referenced types omitted)\n`
					);
					break;
				}

				const joinedContent = content.join("\n");
				let processedContent = joinedContent;
				if (processedContent.length > MAX_REFERENCED_TYPE_CONTENT_CHARS) {
					processedContent =
						processedContent.substring(0, MAX_REFERENCED_TYPE_CONTENT_CHARS) +
						"\n... (content truncated)";
				}
				activeSymbolDetailParts.push(
					`    File: ${filePath}\n`,
					`    Content:\n\`\`\`\n${processedContent}\n\`\`\`\n`
				);
				count++;
			}
		}

		activeSymbolDetailParts.push(
			`  Incoming Calls:\n${formatCallHierarchy(
				activeSymbolDetailedInfo.incomingCalls,
				"incoming"
			)}\n`,
			`  Outgoing Calls:\n${formatCallHierarchy(
				activeSymbolDetailedInfo.outgoingCalls,
				"outgoing"
			)}\n`,
			`\n` // Add a newline for separation
		);

		let activeSymbolDetailSection = activeSymbolDetailParts.join("");

		// Truncation logic for active symbol detail section based on its own config limit
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
			if (length + activeSymbolDetailSection.length > config.maxTotalLength) {
				console.warn(
					`Active symbol detail section exceeds total context limit. Truncating.`
				);
				const availableLength = config.maxTotalLength - length - 50; // Reserve space for truncation message
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
			length += activeSymbolDetailSection.length;
			console.log(
				`Context size after adding active symbol detail: ${length} chars.`
			);
		}
	}
	return { context, currentTotalLength: length };
}

/**
 * Encapsulates the entire dynamic file prioritization logic (scoring and sorting `relevantFiles`).
 * Uses `dependencyGraph`, `reverseDependencyGraph`, `activeSymbolDetailedInfo`, `documentSymbols`, and `config`.
 * @param relevantFiles An array of vscode.Uri objects for relevant files.
 * @param workspaceRoot The root URI of the workspace.
 * @param dependencyGraph Optional map representing file import/dependency relations.
 * @param reverseDependencyGraph Optional map representing reverse file import/dependency relations.
 * @param activeSymbolDetailedInfo Optional detailed information about the active symbol.
 * @param documentSymbols Optional map containing document symbols for relevant files.
 * @param config Configuration for context building.
 * @returns A sorted array of `vscode.Uri[]` representing the prioritized files.
 */
function _prioritizeFilesForContext(
	relevantFiles: vscode.Uri[],
	workspaceRoot: vscode.Uri,
	dependencyGraph: Map<string, string[]> | undefined,
	reverseDependencyGraph: Map<string, string[]> | undefined,
	activeSymbolDetailedInfo: ActiveSymbolDetailedInfo | undefined,
	documentSymbols: Map<string, vscode.DocumentSymbol[] | undefined> | undefined,
	config: ContextConfig
): vscode.Uri[] {
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

	return prioritizedFiles.map((pf) => pf.uri);
}

/**
 * Iterates through prioritized files, reads their content, intelligently summarizes it,
 * constructs the content block (including imports), applies strict length checks,
 * and handles truncation for each file. It tracks skipped files due to limits.
 * @param sortedRelevantFiles A sorted array of vscode.Uri objects for files.
 * @param workspaceRoot The root URI of the workspace.
 * @param config Configuration for context building.
 * @param currentContext The current context string.
 * @param currentTotalLength The current total length of the context string.
 * @param filesSkippedForTotalSize The number of files skipped so far due to total size limits.
 * @param dependencyGraph Optional map representing file import/dependency relations.
 * @param documentSymbols Optional map containing document symbols for relevant files.
 * @param activeSymbolDetailedInfo Optional detailed information about the active symbol.
 * @returns A promise that resolves to an object containing the updated context string, its length, and the updated skipped file count.
 */
async function _processFileContentsForContext(
	sortedRelevantFiles: vscode.Uri[],
	workspaceRoot: vscode.Uri,
	config: ContextConfig,
	currentContext: string,
	currentTotalLength: number,
	filesSkippedForTotalSize: number,
	dependencyGraph?: Map<string, string[]>,
	documentSymbols?: Map<string, vscode.DocumentSymbol[] | undefined>,
	activeSymbolDetailedInfo?: ActiveSymbolDetailedInfo
): Promise<{
	context: string;
	currentTotalLength: number;
	filesSkippedForTotalSize: number;
}> {
	let context = currentContext;
	let length = currentTotalLength;
	let skippedCount = filesSkippedForTotalSize;
	let contentAdded = false; // Track if any content was added

	const contentHeader = "File Contents (partial):\n";
	context += contentHeader;
	length += contentHeader.length;

	for (const fileUri of sortedRelevantFiles) {
		// Check if we have *any* space left for content
		if (length >= config.maxTotalLength) {
			skippedCount =
				sortedRelevantFiles.length - sortedRelevantFiles.indexOf(fileUri);
			console.log(
				`Skipping remaining ${skippedCount} file contents as total limit reached.`
			);
			break; // Stop processing file contents immediately
		}

		const relativePath = path
			.relative(workspaceRoot.fsPath, fileUri.fsPath)
			.replace(/\\/g, "/");
		const fileHeader = `--- File: ${relativePath} ---\n`;

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

		let fileContentRaw = "";
		let fileContentForContext = "";
		let truncatedForSmartSummary = false;

		try {
			const contentBytes = await vscode.workspace.fs.readFile(fileUri);
			fileContentRaw = Buffer.from(contentBytes).toString("utf-8");

			const symbolsForFile = documentSymbols?.get(relativePath);

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

		const summaryTruncationMessage = "\n[...content intelligently summarized]";
		const closingNewlines = "\n\n";

		const baseContentLength =
			fileHeader.length +
			importRelationsDisplay.length +
			closingNewlines.length;

		let contentToAdd = "";
		let estimatedLengthIncrease = 0;

		// Calculate how much space is remaining in the total context
		const availableTotalContextSpace = config.maxTotalLength - length;

		// Determine the actual length of the summarized content we can try to add
		// This must respect individual file max length AND total context max length.
		const maxSummarizedContentLength = Math.min(
			config.maxFileLength, // Max per file
			availableTotalContextSpace -
				baseContentLength -
				summaryTruncationMessage.length // Space left in total, considering header/footer/truncation message
		);

		if (maxSummarizedContentLength <= 0) {
			// Cannot even fit the header and truncation message for this file, skip.
			skippedCount =
				sortedRelevantFiles.length - sortedRelevantFiles.indexOf(fileUri);
			console.log(
				`Skipping remaining ${skippedCount} file contents as total limit reached before adding ${relativePath}.`
			);
			break;
		}

		// Truncate fileContentForContext if it exceeds the calculated maxSummarizedContentLength
		let actualFileContentToAdd = fileContentForContext;
		let currentFileTruncatedForTotalSize = false;

		if (fileContentForContext.length > maxSummarizedContentLength) {
			actualFileContentToAdd = fileContentForContext.substring(
				0,
				maxSummarizedContentLength
			);
			truncatedForSmartSummary = true; // Mark as truncated, even if originally wasn't (now it is for total size)
			currentFileTruncatedForTotalSize = true;
		}

		contentToAdd =
			fileHeader +
			importRelationsDisplay +
			actualFileContentToAdd +
			(truncatedForSmartSummary ? summaryTruncationMessage : "") +
			closingNewlines;

		estimatedLengthIncrease = contentToAdd.length;

		// If after all calculations, it's still too large for the remaining total context,
		// or if we truncated it to something too small, log and skip/further truncate.
		if (length + estimatedLengthIncrease > config.maxTotalLength) {
			// This scenario means maxSummarizedContentLength was still too optimistic or a small message overflowed.
			// It should ideally not be hit if `maxSummarizedContentLength` is calculated correctly,
			// but as a failsafe, we truncate to exactly what fits + a minimal message.
			const finalAvailableSpace = config.maxTotalLength - length;
			if (
				finalAvailableSpace >
				(fileHeader + summaryTruncationMessage + closingNewlines).length
			) {
				const truncateContentTo =
					finalAvailableSpace -
					(
						fileHeader +
						importRelationsDisplay +
						summaryTruncationMessage +
						closingNewlines
					).length;
				contentToAdd =
					fileHeader +
					importRelationsDisplay +
					actualFileContentToAdd.substring(0, Math.max(0, truncateContentTo)) +
					summaryTruncationMessage +
					closingNewlines;
				length += contentToAdd.length;
				context += contentToAdd;
				console.log(
					`Added heavily truncated content for ${relativePath} to fit total limit.`
				);
				contentAdded = true;
			} else {
				console.warn(
					`Could not fit even a minimal entry for ${relativePath} into total context.`
				);
			}
			skippedCount =
				sortedRelevantFiles.length - sortedRelevantFiles.indexOf(fileUri);
			console.log(
				`Skipping remaining ${skippedCount} file contents as total limit reached.`
			);
			break; // Stop processing further files
		}

		context += contentToAdd;
		length += estimatedLengthIncrease;
		contentAdded = true;
		console.log(
			`Added content for ${relativePath}. Current total size: ${length} chars.`
		);
	}

	// Add final skipped message if needed
	if (!contentAdded && length < config.maxTotalLength) {
		context += "\n(No file content included due to size limits or errors)";
	} else if (skippedCount > 0) {
		context += `\n... (Content from ${skippedCount} more files omitted due to total size limit)`;
	}

	return {
		context,
		currentTotalLength: length,
		filesSkippedForTotalSize: skippedCount,
	};
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
	reverseDependencyGraph?: Map<string, string[]>
): Promise<string> {
	let { context, currentTotalLength } = _initializeBuildContext(
		workspaceRoot,
		relevantFiles
	);
	let filesSkippedForTotalSize = 0; // For file *content* skipping

	// 1. Add File Structure
	({ context, currentTotalLength } = _addFileStructureToContext(
		relevantFiles,
		workspaceRoot,
		context,
		currentTotalLength,
		config
	));

	// If maxed out after adding structure, stop
	if (currentTotalLength >= config.maxTotalLength) {
		console.warn("Total context limit reached after file structure.");
		return context.trim();
	}

	// 2. Add Recent Project Changes
	({ context, currentTotalLength } = _addRecentChangesToContext(
		recentChanges,
		context,
		currentTotalLength,
		config
	));
	if (currentTotalLength >= config.maxTotalLength) {
		console.warn("Total context limit reached after recent changes.");
		return context.trim();
	}

	// 3. Add Existing File Paths Section
	({ context, currentTotalLength } = _addExistingFilePathsSection(
		relevantFiles,
		workspaceRoot,
		context,
		currentTotalLength,
		config
	));
	if (currentTotalLength >= config.maxTotalLength) {
		console.warn("Total context limit reached after existing file paths.");
		return context.trim();
	}

	// 4. Add Modified/Created File Paths Section
	({ context, currentTotalLength } = _addModifiedCreatedPathsSection(
		recentChanges,
		workspaceRoot,
		context,
		currentTotalLength,
		config
	));
	if (currentTotalLength >= config.maxTotalLength) {
		console.warn("Total context limit reached after modified/created paths.");
		return context.trim();
	}

	// 5. Add Symbol Information
	({ context, currentTotalLength } = _addSymbolInfoSection(
		documentSymbols,
		relevantFiles,
		workspaceRoot,
		context,
		currentTotalLength,
		config
	));
	if (currentTotalLength >= config.maxTotalLength) {
		console.warn("Total context limit reached after symbol information.");
		return context.trim();
	}

	// 6. Add Active Symbol Detailed Information
	({ context, currentTotalLength } = _addActiveSymbolDetailSection(
		activeSymbolDetailedInfo,
		workspaceRoot,
		context,
		currentTotalLength,
		config
	));
	if (currentTotalLength >= config.maxTotalLength) {
		console.warn("Total context limit reached after active symbol detail.");
		return context.trim();
	}

	// 7. Prioritize Files for Content Inclusion
	const sortedRelevantFiles = _prioritizeFilesForContext(
		relevantFiles,
		workspaceRoot,
		dependencyGraph,
		reverseDependencyGraph,
		activeSymbolDetailedInfo,
		documentSymbols,
		config
	);

	// 8. Process File Contents
	({ context, currentTotalLength, filesSkippedForTotalSize } =
		await _processFileContentsForContext(
			sortedRelevantFiles,
			workspaceRoot,
			config,
			context,
			currentTotalLength,
			filesSkippedForTotalSize,
			dependencyGraph,
			documentSymbols,
			activeSymbolDetailedInfo
		));

	// Diagnostic log for final size
	console.log(`Final context size: ${currentTotalLength} characters.`);
	return context.trim(); // Remove any trailing whitespace
}

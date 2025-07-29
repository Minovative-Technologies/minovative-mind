import * as vscode from "vscode";
import * as path from "path";
import type { GenerationConfig } from "@google/generative-ai";
import {
	HistoryEntry,
	PlanGenerationContext,
} from "../sidebar/common/sidebarTypes";
import { TEMPERATURE } from "../sidebar/common/sidebarConstants";
import * as SymbolService from "../services/symbolService";
import { ActiveSymbolDetailedInfo } from "../services/contextService";

const MAX_FILE_SUMMARY_LENGTH_FOR_AI_SELECTION = 350;
export { MAX_FILE_SUMMARY_LENGTH_FOR_AI_SELECTION };

// Cache interface for AI selection results
interface AISelectionCache {
	timestamp: number;
	selectedFiles: vscode.Uri[];
	userRequest: string;
	activeFile?: string;
	fileCount: number;
	heuristicFilesCount: number;
}

// Cache storage
const aiSelectionCache = new Map<string, AISelectionCache>();

// Configuration for AI selection
interface AISelectionOptions {
	useCache?: boolean;
	cacheTimeout?: number;
	maxPromptLength?: number;
	enableStreaming?: boolean;
	fallbackToHeuristics?: boolean;
}

export interface SelectRelevantFilesAIOptions {
	userRequest: string;
	chatHistory: ReadonlyArray<HistoryEntry>;
	allScannedFiles: ReadonlyArray<vscode.Uri>;
	projectRoot: vscode.Uri;
	activeEditorContext?: PlanGenerationContext["editorContext"];
	diagnostics?: string;
	fileDependencies?: Map<string, string[]>; // New optional property
	activeEditorSymbols?: vscode.DocumentSymbol[];
	preSelectedHeuristicFiles?: vscode.Uri[]; // NEW PROPERTY: Heuristically pre-selected files
	fileSummaries?: Map<string, string>;
	activeSymbolDetailedInfo?: ActiveSymbolDetailedInfo; // NEW: Add activeSymbolDetailedInfo
	aiModelCall: (
		prompt: string,
		modelName: string,
		history: HistoryEntry[] | undefined,
		requestType: string,
		generationConfig: GenerationConfig | undefined,
		streamCallbacks:
			| {
					onChunk: (chunk: string) => Promise<void> | void;
					onComplete?: () => void;
			  }
			| undefined,
		token: vscode.CancellationToken | undefined
	) => Promise<string>;
	modelName: string;
	cancellationToken?: vscode.CancellationToken;
	selectionOptions?: AISelectionOptions; // Selection options
}

/**
 * Generate cache key for AI selection
 */
function generateAISelectionCacheKey(
	userRequest: string,
	allScannedFiles: ReadonlyArray<vscode.Uri>,
	activeEditorContext?: PlanGenerationContext["editorContext"],
	preSelectedHeuristicFiles?: vscode.Uri[]
): string {
	const activeFile = activeEditorContext?.filePath || "";
	const heuristicFiles =
		preSelectedHeuristicFiles
			?.map((f) => f.fsPath)
			.sort()
			.join("|") || "";
	const fileCount = allScannedFiles.length;

	// Create a hash-like key from the request and context
	const keyComponents = [
		userRequest.substring(0, 100), // First 100 chars of request
		activeFile,
		heuristicFiles,
		fileCount.toString(),
	];

	return keyComponents.join("|");
}

/**
 * Truncate and optimize prompt for better performance
 */
function optimizePrompt(
	contextPrompt: string,
	dependencyInfo: string,
	fileListString: string,
	maxLength: number = 50000
): string {
	let totalLength =
		contextPrompt.length + dependencyInfo.length + fileListString.length;

	if (totalLength <= maxLength) {
		return contextPrompt + dependencyInfo + fileListString;
	}

	// Smart truncation strategy
	const targetLength = maxLength - 2000; // Leave room for instructions

	// Prioritize context prompt (most important)
	let optimizedContext = contextPrompt;
	let optimizedDependency = dependencyInfo;
	let optimizedFileList = fileListString;

	// If still too long, truncate file list (least important for selection)
	if (totalLength > targetLength) {
		const fileListLines = fileListString.split("\n");
		const maxFileLines = Math.floor(
			(targetLength - contextPrompt.length - dependencyInfo.length) / 100
		);

		if (fileListLines.length > maxFileLines) {
			optimizedFileList =
				fileListLines.slice(0, maxFileLines).join("\n") +
				`\n... and ${fileListLines.length - maxFileLines} more files`;
		}
	}

	// If still too long, truncate dependency info
	if (
		optimizedContext.length +
			optimizedDependency.length +
			optimizedFileList.length >
		targetLength
	) {
		const maxDependencyLength =
			targetLength - optimizedContext.length - optimizedFileList.length;
		if (optimizedDependency.length > maxDependencyLength) {
			optimizedDependency =
				optimizedDependency.substring(0, maxDependencyLength) +
				"...(truncated)";
		}
	}

	return optimizedContext + optimizedDependency + optimizedFileList;
}

/**
 * Uses an AI model to select the most relevant files for a given user request and context.
 * Now includes caching, better prompt optimization, and performance improvements.
 */
export async function selectRelevantFilesAI(
	options: SelectRelevantFilesAIOptions
): Promise<vscode.Uri[]> {
	const {
		userRequest,
		chatHistory,
		allScannedFiles,
		projectRoot,
		activeEditorContext,
		diagnostics,
		fileDependencies,
		activeEditorSymbols,
		preSelectedHeuristicFiles,
		fileSummaries,
		activeSymbolDetailedInfo, // NEW: Destructure activeSymbolDetailedInfo
		aiModelCall,
		modelName,
		cancellationToken,
		selectionOptions,
	} = options;

	if (allScannedFiles.length === 0) {
		return [];
	}

	// Check cache first
	const useCache = selectionOptions?.useCache ?? true;
	const cacheTimeout = selectionOptions?.cacheTimeout ?? 5 * 60 * 1000; // 5 minutes default

	if (useCache) {
		const cacheKey = generateAISelectionCacheKey(
			userRequest,
			allScannedFiles,
			activeEditorContext,
			preSelectedHeuristicFiles
		);

		const cached = aiSelectionCache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < cacheTimeout) {
			console.log(
				`Using cached AI selection results for request: ${userRequest.substring(
					0,
					50
				)}...`
			);
			return cached.selectedFiles;
		}
	}

	const relativeFilePaths = allScannedFiles.map((uri) =>
		path.relative(projectRoot.fsPath, uri.fsPath).replace(/\\/g, "/")
	);

	let contextPrompt = `User Request: "${userRequest}"\n`;

	// Add heuristically pre-selected files to the context prompt for AI's awareness
	if (preSelectedHeuristicFiles && preSelectedHeuristicFiles.length > 0) {
		const heuristicPaths = preSelectedHeuristicFiles.map((uri) =>
			path.relative(projectRoot.fsPath, uri.fsPath).replace(/\\/g, "/")
		);
		contextPrompt += `\nHeuristically Pre-selected Files (based on active file directory, direct dependencies, etc. These are strong candidates for relevance.): ${heuristicPaths
			.map((p) => `"${p}"`)
			.join(", ")}\n`;
	}

	if (activeEditorContext) {
		contextPrompt += `\nActive File: ${activeEditorContext.filePath}\n`;
		if (
			activeEditorContext.selectedText &&
			activeEditorContext.selectedText.trim().length > 0
		) {
			const preview = activeEditorContext.selectedText.substring(0, 200);
			contextPrompt += `Selected Text (preview): "${preview}"\n`;
		}

		// NEW: Feature activeSymbolDetailedInfo prominently if available
		if (activeSymbolDetailedInfo && activeSymbolDetailedInfo.name) {
			const symbolInfo = activeSymbolDetailedInfo;
			contextPrompt += `\n--- Active Symbol Detailed Information ---\n`;
			contextPrompt += `Symbol: "${symbolInfo.name}" (Type: ${
				symbolInfo.kind || "Unknown"
			})\n`;
			if (symbolInfo.detail) {
				contextPrompt += `Detail: ${symbolInfo.detail}\n`;
			}
			if (symbolInfo.filePath) {
				const relativeSymPath = path
					.relative(projectRoot.fsPath, symbolInfo.filePath)
					.replace(/\\/g, "/");
				let lineNumberDisplay = "N/A";
				const lineNumber = symbolInfo.fullRange?.start?.line;
				if (typeof lineNumber === "number") {
					lineNumberDisplay = (lineNumber + 1).toString();
				}
				contextPrompt += `File Location: ${relativeSymPath}:${lineNumberDisplay}\n`;
			}

			const MAX_RELATED_SYMBOL_FILES_PROMPT = 5; // Limit related files for prompt conciseness

			// References (general references, fetched if activeSymbolDetailedInfo doesn't explicitly contain them)
			try {
				const activeFileUri = vscode.Uri.file(activeEditorContext.filePath);
				const references = await SymbolService.findReferences(
					activeFileUri,
					activeEditorContext.selection.start, // Use selection start to find context for references
					cancellationToken
				);

				if (references) {
					const uniqueReferencePaths = new Set<string>();
					for (const ref of references) {
						if (ref.uri.fsPath !== activeFileUri.fsPath) {
							// Exclude self
							const relativeRefPath = path
								.relative(projectRoot.fsPath, ref.uri.fsPath)
								.replace(/\\/g, "/");
							if (relativeFilePaths.includes(relativeRefPath)) {
								// Only add if it's one of the scanned files
								uniqueReferencePaths.add(relativeRefPath);
							}
						}
						if (uniqueReferencePaths.size >= MAX_RELATED_SYMBOL_FILES_PROMPT) {
							break;
						}
					}
					if (uniqueReferencePaths.size > 0) {
						contextPrompt += `General References in: ${Array.from(
							uniqueReferencePaths
						)
							.map((p) => `"${p}"`)
							.join(", ")}\n`;
					}
				}
			} catch (error) {
				console.error(
					"[SmartContextSelector] Error finding general references for symbol:",
					symbolInfo.name,
					error
				);
			}

			// Incoming Calls
			if (symbolInfo.incomingCalls && symbolInfo.incomingCalls.length > 0) {
				const uniqueIncomingCallPaths = new Set<string>();
				for (const call of symbolInfo.incomingCalls) {
					const relativeCallPath = path
						.relative(projectRoot.fsPath, call.from.uri.fsPath)
						.replace(/\\/g, "/");
					if (
						relativeFilePaths.includes(relativeCallPath) &&
						relativeCallPath !== activeEditorContext?.documentUri?.fsPath
					) {
						uniqueIncomingCallPaths.add(relativeCallPath);
					}
					if (uniqueIncomingCallPaths.size >= MAX_RELATED_SYMBOL_FILES_PROMPT) {
						break;
					}
				}
				if (uniqueIncomingCallPaths.size > 0) {
					contextPrompt += `This symbol has Incoming Calls from (files): ${Array.from(
						uniqueIncomingCallPaths
					)
						.map((p) => `"${p}"`)
						.join(", ")}\n`;
				}
			}

			// Outgoing Calls
			if (symbolInfo.outgoingCalls && symbolInfo.outgoingCalls.length > 0) {
				const uniqueOutgoingCallPaths = new Set<string>();
				for (const call of symbolInfo.outgoingCalls) {
					const relativeCallPath = path
						.relative(projectRoot.fsPath, call.to.uri.fsPath)
						.replace(/\\/g, "/");
					if (
						relativeFilePaths.includes(relativeCallPath) &&
						relativeCallPath !== activeEditorContext?.documentUri?.fsPath
					) {
						uniqueOutgoingCallPaths.add(relativeCallPath);
					}
					if (uniqueOutgoingCallPaths.size >= MAX_RELATED_SYMBOL_FILES_PROMPT) {
						break;
					}
				}
				if (uniqueOutgoingCallPaths.size > 0) {
					contextPrompt += `This symbol has Outgoing Calls to (files): ${Array.from(
						uniqueOutgoingCallPaths
					)
						.map((p) => `"${p}"`)
						.join(", ")}\n`;
				}
			}

			// Referenced Type Definitions (briefly)
			if (
				symbolInfo.referencedTypeDefinitions &&
				symbolInfo.referencedTypeDefinitions.size > 0
			) {
				const typeDefPaths = Array.from(
					symbolInfo.referencedTypeDefinitions.keys()
				)
					.filter((p) => relativeFilePaths.includes(p)) // Only include scanned files
					.slice(0, MAX_RELATED_SYMBOL_FILES_PROMPT);
				if (typeDefPaths.length > 0) {
					contextPrompt += `This symbol references Types Defined in (files): ${typeDefPaths
						.map((p) => `"${p}"`)
						.join(", ")}\n`;
				}
			}
			contextPrompt += `--- End Active Symbol Detailed Information ---\n`;
		} else if (activeEditorSymbols && activeEditorContext.selection.start) {
			// Fallback to simpler symbol references if detailed info is not available
			const position = activeEditorContext.selection.start;
			const activeFileUri = vscode.Uri.file(activeEditorContext.filePath);

			const symbolAtCursor = activeEditorSymbols.find((symbol) =>
				symbol.range.contains(position)
			);

			if (symbolAtCursor) {
				contextPrompt += `\nCursor is currently on symbol: "${
					symbolAtCursor.name
				}" (Type: ${vscode.SymbolKind[symbolAtCursor.kind]})\n`;
				try {
					const references = await SymbolService.findReferences(
						activeFileUri,
						symbolAtCursor.selectionRange.start,
						cancellationToken
					);

					if (references) {
						const relatedFilePaths: Set<string> = new Set();
						const MAX_RELATED_FILES = 15; // Limit the number of related files to include

						for (const ref of references) {
							if (ref.uri.fsPath !== activeFileUri.fsPath) {
								// Exclude the active file itself
								const relativePath = path
									.relative(projectRoot.fsPath, ref.uri.fsPath)
									.replace(/\\/g, "/");
								// Ensure the path is one of the allScannedFiles to avoid hallucinating
								if (relativeFilePaths.includes(relativePath)) {
									relatedFilePaths.add(relativePath);
								}
								if (relatedFilePaths.size >= MAX_RELATED_FILES) {
									break; // Limit the number of files
								}
							}
						}

						if (relatedFilePaths.size > 0) {
							contextPrompt += `This symbol is referenced in the following related files: ${Array.from(
								relatedFilePaths
							)
								.map((p) => `"${p}"`)
								.join(", ")}\n`;
						}
					}
				} catch (error) {
					console.error(
						"[SmartContextSelector] Error finding references for symbol:",
						symbolAtCursor.name,
						error
					);
					// Continue without symbol reference info if error occurs
				}
			}
		}
	}

	if (diagnostics && diagnostics.trim().length > 0) {
		contextPrompt += `\nRelevant Diagnostics - Fix all Diagnostics:\n${diagnostics}\n`;
	}

	if (chatHistory.length > 0) {
		contextPrompt += "\nRecent Chat History (condensed):\n";
		// Include last 3-5 turns, or a summary
		const recentHistory = chatHistory.slice(-3); // Example: last 3 turns
		recentHistory.forEach((entry) => {
			const messageText = entry.parts.map((p: any) => p.text).join(" ");
			const preview =
				messageText.length > 150
					? messageText.substring(0, 150) + "..."
					: messageText;
			contextPrompt += `- ${entry.role}: ${preview}\n`;
		});
	}

	let dependencyInfo = "";
	if (fileDependencies && fileDependencies.size > 0) {
		dependencyInfo += "\nInternal File Relationships:\n";
		const MAX_DEPENDENCY_SECTION_CHARS = 100_000; // Limit for dependency section size
		let currentLength = dependencyInfo.length;

		for (const [sourceFile, importedFiles] of fileDependencies.entries()) {
			const line = `- ${sourceFile} imports: ${importedFiles.join(", ")}\n`;
			if (currentLength + line.length > MAX_DEPENDENCY_SECTION_CHARS) {
				dependencyInfo += "(...truncated due to length limit)\n";
				break;
			}
			dependencyInfo += line;
			currentLength += line.length;
		}
	}

	const fileListString = relativeFilePaths
		.map((p) => {
			let summary = fileSummaries?.get(p);
			if (summary) {
				summary = summary.replace(/\s+/g, " ").trim();
				if (summary.length > MAX_FILE_SUMMARY_LENGTH_FOR_AI_SELECTION) {
					summary =
						summary.substring(0, MAX_FILE_SUMMARY_LENGTH_FOR_AI_SELECTION - 3) +
						"...";
				}
				return `- "${p}" (Summary: ${summary})`;
			}
			return `- "${p}"`;
		})
		.join("\n");

	// Optimize prompt length
	const maxPromptLength = selectionOptions?.maxPromptLength ?? 50000;
	const optimizedPrompt = optimizePrompt(
		contextPrompt,
		dependencyInfo,
		fileListString,
		maxPromptLength
	);

	const selectionPrompt = `
	You are an AI assistant helping a developer focus on the most relevant parts of their codebase.
	Based on the user's request, active editor context, chat history, and the provided project file information, please select a subset of files from the "Available Project Files" list that are most pertinent to fulfilling the user's request.

	-- Context Prompt --
	${optimizedPrompt}
	-- End Context Prompt --

	Instructions for your response:
	1.  Analyze all the provided information to understand the user's goal.
	2.  Review the 'Heuristically Pre-selected Files' if present. While these files are initial candidates based on proximity, **your critical task is to select *only* the most directly relevant subset of files** from *all* available files (including and beyond the heuristically pre-selected ones) to address the user's request and provided diagnostics. **Actively discard any heuristically suggested files that do not directly contribute to solving the problem or fulfilling the request.** Prioritize files essential for the task over simply related ones.
	3.  If 'Active Symbol Detailed Information' is present, **pay close attention to the symbol's definitions, general references, incoming/outgoing calls, and referenced type definitions**. These relationships are crucial indicators of file relevance; prioritize files that define, implement, or are closely related via the call hierarchy or type definitions to the active symbol.
	4.  Carefully examine the 'Internal File Relationships' section if present, as it provides crucial context on how files relate to each other, forming logical modules or feature areas.
	5.  Identify which of the "Available Project Files" are most likely to be needed to understand the context or make the required changes. Prioritize files that are imported by the active file, or by other files you deem highly relevant to the user's request.
	6.  Return your selection as a JSON array of strings. Each string in the array must be an exact relative file path from the "Available Project Files" list.
	7.  If no specific files from the list seem particularly relevant *beyond the heuristically pre-selected ones* (e.g., the request is very general or can be answered without looking at other files beyond the active one and its immediate module), return an empty JSON array \`[]\`
	8.  Do NOT include any files not present in the "Available Project Files" list.
	9.  Your entire response should be ONLY the JSON array. Do not include any other text, explanations, or markdown formatting.

	JSON Array of selected file paths:
`;

	console.log(
		`[SmartContextSelector] Sending optimized prompt to AI for file selection (${selectionPrompt.length} chars):`,
		selectionPrompt
	);

	try {
		const generationConfig: GenerationConfig = {
			temperature: TEMPERATURE,
			responseMimeType: "application/json",
		};

		const aiResponse = await aiModelCall(
			selectionPrompt,
			modelName,
			undefined, // History is already part of the `selectionPrompt`
			"file_selection",
			generationConfig,
			undefined, // No stream callbacks for this call
			cancellationToken
		);

		console.log(
			"[SmartContextSelector] AI response for file selection:",
			aiResponse
		);

		let cleanedResponse = aiResponse.trim();

		// Check for and remove "" at the start of the response
		if (cleanedResponse.startsWith("")) {
			cleanedResponse = cleanedResponse.substring("".length).trim();
		}

		// Check for and remove "" at the end of the response
		if (cleanedResponse.endsWith("")) {
			cleanedResponse = cleanedResponse
				.substring(0, cleanedResponse.length - "".length)
				.trim();
		}

		// Apply a final trim to ensure no leading/trailing whitespace remains
		cleanedResponse = cleanedResponse.trim();

		const selectedPaths: unknown = JSON.parse(cleanedResponse);
		const aiSelectedFilesSet = new Set<vscode.Uri>(); // NEW: aiSelectedFilesSet initialization

		if (
			!Array.isArray(selectedPaths) ||
			!selectedPaths.every((p) => typeof p === "string")
		) {
			console.warn(
				"[SmartContextSelector] AI did not return a valid JSON array of strings. Falling back to heuristics + active file. Response:",
				selectedPaths
			);
			// Fallback logic for invalid AI response: combine pre-selected heuristics and active file
			let fallbackResultFiles: vscode.Uri[] = Array.from(
				preSelectedHeuristicFiles || []
			); // Start with heuristics
			if (
				activeEditorContext?.documentUri &&
				!fallbackResultFiles.some(
					(uri) => uri.fsPath === activeEditorContext.documentUri.fsPath
				)
			) {
				fallbackResultFiles.unshift(activeEditorContext.documentUri); // Add active file if not already present
			}
			const result = fallbackResultFiles; // Set result for caching and return

			// Cache the fallback result
			if (useCache) {
				const cacheKey = generateAISelectionCacheKey(
					userRequest,
					allScannedFiles,
					activeEditorContext,
					preSelectedHeuristicFiles
				);
				aiSelectionCache.set(cacheKey, {
					timestamp: Date.now(),
					selectedFiles: result,
					userRequest,
					activeFile: activeEditorContext?.filePath,
					fileCount: allScannedFiles.length,
					heuristicFilesCount: preSelectedHeuristicFiles?.length || 0,
				});
			}

			return result;
		}

		for (const selectedPath of selectedPaths as string[]) {
			const normalizedSelectedPath = selectedPath.replace(/\\/g, "/");
			// Find the original URI from allScannedFiles to preserve casing and ensure existence
			const originalUri = allScannedFiles.find(
				(uri) =>
					path
						.relative(projectRoot.fsPath, uri.fsPath)
						.replace(/\\/g, "/")
						.toLowerCase() === normalizedSelectedPath.toLowerCase()
			);
			if (originalUri) {
				aiSelectedFilesSet.add(originalUri); // Add AI-selected files to the set
			} else {
				console.warn(
					`[SmartContextSelector] AI selected a file not in the original scan or with altered path: ${selectedPath}`
				);
			}
		}

		let finalResultFiles: vscode.Uri[] = Array.from(aiSelectedFilesSet); // NEW: Create finalResultFiles from AI selection

		// NEW: Add active editor's file if it exists and is NOT already in aiSelectedFilesSet
		if (
			activeEditorContext?.documentUri &&
			!finalResultFiles.some(
				// Use `some` for URI comparison by `fsPath`
				(uri) => uri.fsPath === activeEditorContext.documentUri.fsPath
			)
		) {
			finalResultFiles.unshift(activeEditorContext.documentUri); // Ensure active file is first
		}

		// Cache the successful result
		const result = finalResultFiles; // Modified to use finalResultFiles
		if (useCache) {
			const cacheKey = generateAISelectionCacheKey(
				userRequest,
				allScannedFiles,
				activeEditorContext,
				preSelectedHeuristicFiles
			);
			aiSelectionCache.set(cacheKey, {
				timestamp: Date.now(),
				selectedFiles: result,
				userRequest,
				activeFile: activeEditorContext?.filePath,
				fileCount: allScannedFiles.length,
				heuristicFilesCount: preSelectedHeuristicFiles?.length || 0,
			});
		}

		// Return the final combined AI-selected and active files
		return result;
	} catch (error) {
		console.error(
			"[SmartContextSelector] Error during AI file selection:",
			error
		);
		// In case of an error (API error, parsing error, etc.),
		// fall back to the heuristically pre-selected files AND the active file.
		let fallbackResultFiles: vscode.Uri[] = Array.from(
			preSelectedHeuristicFiles || []
		); // Start with heuristics
		if (
			activeEditorContext?.documentUri &&
			!fallbackResultFiles.some(
				// Use `some` for URI comparison by `fsPath`
				(uri) => uri.fsPath === activeEditorContext.documentUri.fsPath
			)
		) {
			fallbackResultFiles.unshift(activeEditorContext.documentUri); // Add active file if not already present
		}
		const result = fallbackResultFiles; // Set result for caching and return

		// Cache the error fallback result
		if (useCache) {
			const cacheKey = generateAISelectionCacheKey(
				userRequest,
				allScannedFiles,
				activeEditorContext,
				preSelectedHeuristicFiles
			);
			aiSelectionCache.set(cacheKey, {
				timestamp: Date.now(),
				selectedFiles: result,
				userRequest,
				activeFile: activeEditorContext?.filePath,
				fileCount: allScannedFiles.length,
				heuristicFilesCount: preSelectedHeuristicFiles?.length || 0,
			});
		}

		return result;
	}
}

/**
 * Clear AI selection cache for a specific workspace or all workspaces
 */
export function clearAISelectionCache(workspacePath?: string): void {
	if (workspacePath) {
		// Clear entries for this workspace
		for (const [key, cache] of aiSelectionCache.entries()) {
			if (key.includes(workspacePath)) {
				aiSelectionCache.delete(key);
			}
		}
		console.log(`Cleared AI selection cache for: ${workspacePath}`);
	} else {
		aiSelectionCache.clear();
		console.log("Cleared all AI selection caches");
	}
}

/**
 * Get AI selection cache statistics
 */
export function getAISelectionCacheStats(): {
	size: number;
	entries: Array<{
		request: string;
		age: number;
		fileCount: number;
		selectedCount: number;
		heuristicCount: number;
	}>;
} {
	const entries = Array.from(aiSelectionCache.entries()).map(
		([key, cache]) => ({
			request: cache.userRequest.substring(0, 50) + "...",
			age: Date.now() - cache.timestamp,
			fileCount: cache.fileCount,
			selectedCount: cache.selectedFiles.length,
			heuristicCount: cache.heuristicFilesCount,
		})
	);

	return {
		size: aiSelectionCache.size,
		entries,
	};
}

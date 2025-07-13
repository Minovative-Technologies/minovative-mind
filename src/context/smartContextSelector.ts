import * as vscode from "vscode";
import * as path from "path";
import type { GenerationConfig } from "@google/generative-ai";
import {
	HistoryEntry,
	PlanGenerationContext,
} from "../sidebar/common/sidebarTypes";
import { TEMPERATURE } from "../sidebar/common/sidebarConstants";
import * as SymbolService from "../services/symbolService";

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

	// Initialize the set of final selected URIs with any heuristically pre-selected files
	const finalSelectedUris: Set<vscode.Uri> = new Set(
		preSelectedHeuristicFiles || []
	);

	// Ensure the active editor's file is always part of the final selection if available,
	// unless it's already included by the heuristics.
	if (
		activeEditorContext?.documentUri &&
		!finalSelectedUris.has(activeEditorContext.documentUri)
	) {
		finalSelectedUris.add(activeEditorContext.documentUri);
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

		if (activeEditorSymbols && activeEditorContext.selection.start) {
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
	2.  Crucially consider the 'Heuristically Pre-selected Files' if present; these files are highly likely to be relevant and should almost always be included unless explicitly contradictory to the request.
	3.  Carefully examine the 'Internal File Relationships' section if present, as it provides crucial context on how files relate to each other, forming logical modules or feature areas.
	4.  Identify which of the "Available Project Files" are most likely to be needed to understand the context or make the required changes. Prioritize files that are imported by the active file, or by other files you deem highly relevant to the user's request.
	5.  Return your selection as a JSON array of strings. Each string in the array must be an exact relative file path from the "Available Project Files" list.
	6.  If no specific files from the list seem particularly relevant *beyond the heuristically pre-selected ones* (e.g., the request is very general or can be answered without looking at other files beyond the active one and its immediate module), return an empty JSON array \`[]\`
	7.  Do NOT include any files not present in the "Available Project Files" list.
	8.  Your entire response should be ONLY the JSON array. Do not include any other text, explanations, or markdown formatting.

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
		if (cleanedResponse.startsWith("```json")) {
			cleanedResponse = cleanedResponse.substring(7);
			if (cleanedResponse.endsWith("```")) {
				cleanedResponse = cleanedResponse.substring(
					0,
					cleanedResponse.length - 3
				);
			}
		}
		cleanedResponse = cleanedResponse
			.replace(/^```json\s*/, "")
			.replace(/\s*```$/, "");

		const selectedPaths: unknown = JSON.parse(cleanedResponse);

		if (
			!Array.isArray(selectedPaths) ||
			!selectedPaths.every((p) => typeof p === "string")
		) {
			console.warn(
				"[SmartContextSelector] AI did not return a valid JSON array of strings. Returning heuristically pre-selected files. Response:",
				selectedPaths
			);
			// Fallback to just heuristic files if AI response is invalid
			const result = Array.from(finalSelectedUris);

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
				finalSelectedUris.add(originalUri); // Add AI-selected files to the set
			} else {
				console.warn(
					`[SmartContextSelector] AI selected a file not in the original scan or with altered path: ${selectedPath}`
				);
			}
		}

		// Cache the successful result
		const result = Array.from(finalSelectedUris);
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

		// Return the combined set of heuristic and AI-selected files
		return result;
	} catch (error) {
		console.error(
			"[SmartContextSelector] Error during AI file selection:",
			error
		);
		// In case of an error (API error, parsing error, etc.),
		// fall back to the heuristically pre-selected files.
		const result = Array.from(finalSelectedUris);

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

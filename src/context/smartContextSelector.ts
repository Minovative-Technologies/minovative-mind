import * as vscode from "vscode";
import * as path from "path";
import type { GenerationConfig } from "@google/generative-ai";
import {
	HistoryEntry,
	PlanGenerationContext,
} from "../sidebar/common/sidebarTypes";
import { TEMPERATURE } from "../sidebar/common/sidebarConstants";
import * as SymbolService from "../services/symbolService";
import { EmbeddingService } from "../services/embeddingService"; // NEW
import { calculateCosineSimilarity } from "../utils/vectorUtils"; // NEW

const MAX_FILE_SUMMARY_LENGTH_FOR_AI_SELECTION = 350;
export { MAX_FILE_SUMMARY_LENGTH_FOR_AI_SELECTION };

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
	fileEmbeddings?: Map<string, number[]>; // NEW PROPERTY: Pre-generated embeddings for all scanned files
	embeddingService: EmbeddingService; // NEW PROPERTY: The service to generate query embeddings
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
}

/**
 * Uses an AI model to select the most relevant files for a given user request and context.
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
		fileEmbeddings, // NEW: Destructure fileEmbeddings
		embeddingService, // NEW: Destructure embeddingService
		aiModelCall,
		modelName,
		cancellationToken,
	} = options;

	if (allScannedFiles.length === 0) {
		return [];
	}

	const SEMANTIC_SIMILARITY_THRESHOLD = 0.7; // New constant for minimum relevance score
	const MAX_SEMANTIC_FILES_TO_INCLUDE = 20; // Renamed from TOP_N_SEMANTIC_FILES

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

	// --- NEW: Semantic Search Logic ---
	let queryEmbedding: number[] | undefined;
	let semanticallySimilarFiles: { path: string; score: number }[] = [];

	// Combine user request and active editor context content for the query text
	let queryText = userRequest;
	if (activeEditorContext) {
		if (
			activeEditorContext.selectedText &&
			activeEditorContext.selectedText.trim().length > 0
		) {
			queryText += `\nSelected text from active editor: ${activeEditorContext.selectedText}`;
		} else if (
			activeEditorContext.instruction &&
			activeEditorContext.instruction.trim().length > 0
		) {
			queryText += `\nInstruction from active editor context: ${activeEditorContext.instruction}`;
		}
	}

	if (cancellationToken?.isCancellationRequested) {
		throw new Error("Operation cancelled by user.");
	}

	if (queryText.trim().length > 0) {
		try {
			queryEmbedding = await embeddingService.embed(
				queryText,
				cancellationToken
			);
			console.log(
				"[SmartContextSelector] Query embedding generated successfully."
			);
		} catch (error: any) {
			console.warn(
				`[SmartContextSelector] Failed to generate query embedding: ${error.message}`
			);
			// If query embedding fails, `queryEmbedding` will remain undefined, and semantic search will be skipped.
		}
	}

	if (queryEmbedding && fileEmbeddings && fileEmbeddings.size > 0) {
		if (cancellationToken?.isCancellationRequested) {
			throw new Error("Operation cancelled by user.");
		}

		for (const [filePath, fileEmbedding] of fileEmbeddings.entries()) {
			if (cancellationToken?.isCancellationRequested) {
				throw new Error("Operation cancelled by user.");
			}
			try {
				const score = calculateCosineSimilarity(queryEmbedding, fileEmbedding);
				if (!isNaN(score)) {
					// Ensure score is a valid number (not NaN from division by zero, etc.)
					semanticallySimilarFiles.push({ path: filePath, score });
				}
			} catch (e: any) {
				console.warn(
					`[SmartContextSelector] Error calculating similarity for ${filePath}: ${e.message}`
				);
			}
		}

		// Sort by score in descending order
		semanticallySimilarFiles.sort((a, b) => b.score - a.score);
		// Filter to include only files meeting the minimum relevance threshold
		semanticallySimilarFiles = semanticallySimilarFiles.filter(
			(file) => file.score >= SEMANTIC_SIMILARITY_THRESHOLD
		);
		// Apply the upper limit to the *filtered* list
		semanticallySimilarFiles = semanticallySimilarFiles.slice(
			0,
			MAX_SEMANTIC_FILES_TO_INCLUDE
		);
		console.log(
			`[SmartContextSelector] Identified ${semanticallySimilarFiles.length} semantically similar files (filtered by threshold >= ${SEMANTIC_SIMILARITY_THRESHOLD} and limited to max ${MAX_SEMANTIC_FILES_TO_INCLUDE}).`
		);

		// Add these semantically similar files to the final set of URIs *before* the AI performs its selection.
		// This ensures they are strong candidates for LLM consideration.
		for (const semanticFile of semanticallySimilarFiles) {
			const uriToAdd = allScannedFiles.find(
				(uri) =>
					path.relative(projectRoot.fsPath, uri.fsPath).replace(/\\/g, "/") ===
					semanticFile.path
			);
			if (uriToAdd && !finalSelectedUris.has(uriToAdd)) {
				finalSelectedUris.add(uriToAdd);
			}
		}
	}
	// --- END NEW: Semantic Search Logic ---

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

	const selectionPrompt = `
	You are an AI assistant helping a developer focus on the most relevant parts of their codebase.
	Based on the user's request, active editor context, chat history, and the provided project file information, please select a subset of files from the "Available Project Files" list that are most pertinent to fulfilling the user's request.

	-- Context Prompt --
	${contextPrompt}
	-- End Context Prompt --

	-- Dependency Info --
	${dependencyInfo}
	-- End Dependency Info --
    
    -- Semantically Similar Files (based on embedding similarity to user request and editor context) --
    ${
			semanticallySimilarFiles.length > 0
				? semanticallySimilarFiles
						.map((f) => `- "${f.path}" (Semantic Score: ${f.score.toFixed(2)})`)
						.join("\n")
				: "No additional semantically similar files identified beyond heuristic and active editor context."
		}
    -- End Semantically Similar Files --
	
	-- Available Project Files (with optional summaries) --
	${fileListString}
	-- End Available Project Files --

	Instructions for your response:
	1.  Analyze all the provided information to understand the user's goal.
	2.  Crucially consider the 'Heuristically Pre-selected Files' if present; these files are highly likely to be relevant and should almost always be included unless explicitly contradictory to the request.
 3.  Also, pay close attention to the 'Semantically Similar Files' section. These files have been identified as conceptually very close to the user's request and editor context through advanced AI analysis. They are strong candidates for inclusion and should be prioritized.
	4.  Carefully examine the 'Internal File Relationships' section if present, as it provides crucial context on how files relate to each other, forming logical modules or feature areas.
	5.  Identify which of the "Available Project Files" are most likely to be needed to understand the context or make the required changes. Prioritize files that are imported by the active file, or by other files you deem highly relevant to the user's request.
	6.  Return your selection as a JSON array of strings. Each string in the array must be an exact relative file path from the "Available Project Files" list.
	7.  If no specific files from the list seem particularly relevant *beyond the heuristically pre-selected ones and semantically similar ones* (e.g., the request is very general or can be answered without looking at other files beyond the active one and its immediate module), return an empty JSON array \`[]\`. This indicates you are not adding *new* files to the existing set of strong candidates.
	8.  Do NOT include any files not present in the "Available Project Files" list.
	9.  Your entire response should be ONLY the JSON array. Do not include any other text, explanations, or markdown formatting.

	JSON Array of selected file paths:
`;

	console.log(
		"[SmartContextSelector] Sending prompt to AI for file selection:",
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
				"[SmartContextSelector] AI did not return a valid JSON array of strings. Returning combined heuristic and semantic files. Response:",
				selectedPaths
			);
			// Fallback to just heuristic and semantic files if AI response is invalid
			return Array.from(finalSelectedUris);
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
		// Return the combined set of heuristic, semantic, and AI-selected files
		return Array.from(finalSelectedUris);
	} catch (error) {
		console.error(
			"[SmartContextSelector] Error during AI file selection:",
			error
		);
		// In case of an error (API error, parsing error, etc.),
		// fall back to the heuristically pre-selected files and semantically similar files.
		return Array.from(finalSelectedUris);
	}
}

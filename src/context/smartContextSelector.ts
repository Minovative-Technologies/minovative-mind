import * as vscode from "vscode";
import * as path from "path";
import type { GenerationConfig } from "@google/generative-ai";
import {
	HistoryEntry,
	PlanGenerationContext,
} from "../sidebar/common/sidebarTypes";

export interface SelectRelevantFilesAIOptions {
	userRequest: string;
	chatHistory: ReadonlyArray<HistoryEntry>;
	allScannedFiles: ReadonlyArray<vscode.Uri>;
	projectRoot: vscode.Uri;
	activeEditorContext?: PlanGenerationContext["editorContext"];
	diagnostics?: string;
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
		aiModelCall,
		modelName,
		cancellationToken,
	} = options;

	if (allScannedFiles.length === 0) {
		return [];
	}

	const relativeFilePaths = allScannedFiles.map((uri) =>
		path.relative(projectRoot.fsPath, uri.fsPath).replace(/\\/g, "/")
	);

	let contextPrompt = `User Request: "${userRequest}"\n`;

	if (activeEditorContext) {
		contextPrompt += `\nActive File: ${activeEditorContext.filePath}\n`;
		if (
			activeEditorContext.selectedText &&
			activeEditorContext.selectedText.trim().length > 0
		) {
			const preview = activeEditorContext.selectedText.substring(0, 200);
			contextPrompt += `Selected Text (preview): "${preview}"\n`;
		}
	}

	if (diagnostics && diagnostics.trim().length > 0) {
		contextPrompt += `\nRelevant Diagnostics:\n${diagnostics}\n`;
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

	const fileListString = relativeFilePaths.map((p) => `- "${p}"`).join("\n");

	const selectionPrompt = `
	You are an AI assistant helping a developer focus on the most relevant parts of their codebase.
	Based on the user's request, active editor context, and chat history provided below, please select a subset of files from the "Available Project Files" list that are most pertinent to fulfilling the user's request.

	${contextPrompt}

	Available Project Files:
	${fileListString}

	Instructions for your response:
	1.  Analyze all the provided information to understand the user's goal.
	2.  Identify which of the "Available Project Files" are most likely to be needed to understand the context or make the required changes.
	3.  Return your selection as a JSON array of strings. Each string in the array must be an exact relative file path from the "Available Project Files" list.
	4.  If no specific files from the list seem particularly relevant (e.g., the request is very general or can be answered without looking at other files beyond the active one), return an empty JSON array: [].
	5.  Do NOT include any files not present in the "Available Project Files" list.
	6.  Your entire response should be ONLY the JSON array. Do not include any other text, explanations, or markdown formatting.

	JSON Array of selected file paths:
`;

	console.log(
		"[SmartContextSelector] Sending prompt to AI for file selection:",
		selectionPrompt
	);

	try {
		const generationConfig: GenerationConfig = {
			temperature: 2,
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
				"[SmartContextSelector] AI did not return a valid JSON array of strings. Response:",
				selectedPaths
			);
			return []; // Fallback to empty or trigger broader context in caller
		}

		const validSelectedUris: vscode.Uri[] = [];
		const lowerCaseRelativeFilePaths = relativeFilePaths.map((p) =>
			p.toLowerCase()
		);

		for (const selectedPath of selectedPaths as string[]) {
			const normalizedSelectedPath = selectedPath.replace(/\\/g, "/");
			const originalPathIndex = lowerCaseRelativeFilePaths.indexOf(
				normalizedSelectedPath.toLowerCase()
			);
			if (originalPathIndex > -1) {
				// Find the original URI using the index from the non-lowercase 'relativeFilePaths'
				// to preserve casing from the file system
				const originalUri = allScannedFiles.find(
					(uri) =>
						path
							.relative(projectRoot.fsPath, uri.fsPath)
							.replace(/\\/g, "/")
							.toLowerCase() === normalizedSelectedPath.toLowerCase()
				);
				if (originalUri) {
					validSelectedUris.push(originalUri);
				}
			} else {
				console.warn(
					`[SmartContextSelector] AI selected a file not in the original scan or with altered path: ${selectedPath}`
				);
			}
		}
		return validSelectedUris;
	} catch (error) {
		console.error(
			"[SmartContextSelector] Error during AI file selection:",
			error
		);
		// In case of an error (API error, parsing error, etc.),
		// let the caller decide on the fallback (e.g., use all files).
		// For now, we throw to indicate failure at this stage.
		// The caller (_buildProjectContext) will catch this and can implement a fallback.
		throw error;
	}
}

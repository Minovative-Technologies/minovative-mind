// src/context/contextBuilder.ts
import * as vscode from "vscode";
import * as path from "path";

// Configuration for context building - Adjusted for large context windows
interface ContextConfig {
	// maxFiles: number; // Removed - Let maxTotalLength be the primary limit
	maxFileLength: number; // Maximum characters per file content
	maxTotalLength: number; // Approximate total character limit for the context string
}

// Default configuration - Adjusted for ~1M token models
const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
	// maxFiles: 500, // Removed - rely on total length primarily
	maxFileLength: 200 * 1024, // Approx 200KB in characters
	maxTotalLength: 1 * 1024 * 1024, // Approx 1MB in characters
};

/**
 * Builds a textual context string from a list of file URIs.
 * Reads file content, formats it, and applies limits.
 * Now tailored for larger context window models.
 *
 * @param relevantFiles An array of vscode.Uri objects for relevant files.
 * @param workspaceRoot The root URI of the workspace for relative paths.
 * @param config Optional configuration for context building.
 * @returns A promise that resolves to the generated context string.
 */
export async function buildContextString(
	relevantFiles: vscode.Uri[],
	workspaceRoot: vscode.Uri,
	config: ContextConfig = DEFAULT_CONTEXT_CONFIG
): Promise<string> {
	let context = `Project Context (Workspace: ${path.basename(
		workspaceRoot.fsPath
	)}):\n`;
	context += `Relevant files identified: ${relevantFiles.length}\n\n`;
	// let filesIncludedCount = 0; // No longer strictly needed unless for logging
	let currentTotalLength = context.length;
	let filesSkippedForTotalSize = 0;

	// Add file structure first (less token intensive)
	context += "File Structure:\n";
	const fileListString = relevantFiles
		.map((uri) => `- ${path.relative(workspaceRoot.fsPath, uri.fsPath)}`)
		.join("\n");

	// Check if just the file list exceeds the limit (highly unlikely but possible)
	if (currentTotalLength + fileListString.length + 10 > config.maxTotalLength) {
		console.warn(
			"File structure list alone exceeds total context length limit. Context will be truncated."
		);
		// Truncate file list - simple substring for now
		const availableLength = config.maxTotalLength - currentTotalLength - 50; // Reserve space for headers/footers
		context +=
			fileListString.substring(0, availableLength > 0 ? availableLength : 0) +
			"\n... (File list truncated)\n\n";
		return context.trim(); // Return early if structure alone is too big
	}

	context += fileListString + "\n\n";
	currentTotalLength += fileListString.length + 10; // Update length accounting for header

	context += "File Contents (partial):\n";
	currentTotalLength += 25; // Length of "File Contents (partial):\n"

	for (const fileUri of relevantFiles) {
		// Removed the maxFiles check

		const relativePath = path.relative(workspaceRoot.fsPath, fileUri.fsPath);
		const fileHeader = `--- File: ${relativePath} ---\n`;
		let fileContent = "";
		let truncated = false;

		try {
			const contentBytes = await vscode.workspace.fs.readFile(fileUri);
			fileContent = Buffer.from(contentBytes).toString("utf-8");

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
			fileHeader + fileContent + (truncated ? "\n[...truncated]" : "") + "\n\n";
		const estimatedLengthIncrease = contentToAdd.length;

		// Check if adding this file exceeds the total length limit
		if (currentTotalLength + estimatedLengthIncrease > config.maxTotalLength) {
			filesSkippedForTotalSize =
				relevantFiles.length - relevantFiles.indexOf(fileUri); // Calculate remaining files
			break; // Stop processing files
		}

		context += contentToAdd;
		currentTotalLength += estimatedLengthIncrease;
		// filesIncludedCount++; // No longer strictly needed
	}

	if (filesSkippedForTotalSize > 0) {
		context += `\n... (Content from ${filesSkippedForTotalSize} more files omitted due to total size limit)`;
	}

	// Diagnostic log for final size
	console.log(`Final context size: ${currentTotalLength} characters.`);
	return context.trim(); // Remove any trailing whitespace
}

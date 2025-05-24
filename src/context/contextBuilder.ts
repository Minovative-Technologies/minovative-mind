// src/context/contextBuilder.ts
import * as vscode from "vscode";
import * as path from "path";
import { createAsciiTree } from "../utilities/treeFormatter";

// Configuration for context building - Adjusted for large context windows
interface ContextConfig {
	maxFileLength: number; // Maximum characters per file content
	maxTotalLength: number; // Approximate total character limit for the context string
}

// Default configuration - Adjusted for ~1M token models
const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
	maxFileLength: 5 * 1024 * 1024, // Approx 5MB in characters
	maxTotalLength: 5 * 1024 * 1024, // Approx 5MB in characters
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

	context += "File Contents (partial):\n";
	const contentHeaderLength = "File Contents (partial):\n".length;
	currentTotalLength += contentHeaderLength;

	let contentAdded = false; // Track if any content was added

	for (const fileUri of relevantFiles) {
		// Check if we have *any* space left for content after the structure
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
			fileHeader + fileContent + (truncated ? "\n[...truncated]" : "") + "\n\n";
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
					"\n[...truncated]\n\n".length;
				if (maxAllowedContentLength > 50) {
					// Only add if we can fit a reasonable snippet
					const partialContentToAdd =
						fileHeader +
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

	// Add the final skipped message if needed
	if (!contentAdded && currentTotalLength < config.maxTotalLength) {
		context += "\n(No file content included due to size limits or errors)";
	} else if (filesSkippedForTotalSize > 0) {
		context += `\n... (Content from ${filesSkippedForTotalSize} more files omitted due to total size limit)`;
	}

	// Diagnostic log for final size
	console.log(`Final context size: ${currentTotalLength} characters.`);
	return context.trim(); // Remove any trailing whitespace
}

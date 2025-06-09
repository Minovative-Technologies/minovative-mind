// src/context/workspaceScanner.ts
import * as vscode from "vscode";
import BPromise from "bluebird"; // using bluebird map for concurrency control
import * as path from "path"; // Import path for joining
import { loadGitIgnoreMatcher } from "../utils/ignoreUtils"; // NEW IMPORT

// Interface for scan options (can be expanded later for settings)
interface ScanOptions {
	respectGitIgnore?: boolean;
	additionalIgnorePatterns?: string[];
	maxConcurrentReads?: number; // Optional concurrency limit
}

/**
 * Scans the workspace for relevant files, respecting .gitignore and default excludes.
 *
 * @param options Optional configuration for the scan.
 * @returns A promise that resolves to an array of vscode.Uri objects representing relevant files.
 */
export async function scanWorkspace(
	options?: ScanOptions
): Promise<vscode.Uri[]> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		console.warn("No workspace folder open.");
		return [];
	}

	// For simplicity, let's focus on the first workspace folder for now.
	// Multi-root workspaces can be handled later by iterating through workspaceFolders.
	const rootFolder = workspaceFolders[0];
	const relevantFiles: vscode.Uri[] = [];

	// Load gitignore rules and default patterns using the utility function
	const ig = await loadGitIgnoreMatcher(rootFolder.uri);

	// custom ignore patterns from options
	if (options?.additionalIgnorePatterns) {
		ig.add(options.additionalIgnorePatterns);
	}

	// Define concurrency (default to a reasonable number, e.g., 10)
	const concurrency = options?.maxConcurrentReads ?? 10;

	/**
	 * Recursively scans a directory.
	 * Uses Bluebird's map for controlled concurrency when reading subdirectories.
	 */
	async function _scanDir(dirUri: vscode.Uri): Promise<void> {
		// --- DIAGNOSTIC ---
		// console.log(`Scanning directory: ${dirUri.fsPath}`);

		try {
			const entries = await vscode.workspace.fs.readDirectory(dirUri);
			// Use Bluebird map for concurrent processing of directory entries
			await BPromise.map(
				entries,
				async ([name, type]) => {
					const fullUri = vscode.Uri.joinPath(dirUri, name);
					// Get relative path for ignore check (important!)
					const relativePath = path.relative(
						rootFolder.uri.fsPath,
						fullUri.fsPath
					);

					// --- DIAGNOSTIC ---
					// console.log(`Checking entry: ${relativePath}, Type: ${type}`);

					// Check if the path should be ignored
					// ignore() checks against the patterns added. It needs relative paths.
					// We also need to check directory patterns with a trailing slash.
					if (
						ig.ignores(relativePath) ||
						(type === vscode.FileType.Directory &&
							ig.ignores(relativePath + "/"))
					) {
						// --- DIAGNOSTIC ---
						// console.log(`Ignoring: ${relativePath}`);
						return; // Skip ignored files/directories
					}

					if (type === vscode.FileType.File) {
						// --- DIAGNOSTIC ---
						// console.log(`Adding file: ${relativePath}`);
						relevantFiles.push(fullUri);
					} else if (type === vscode.FileType.Directory) {
						// --- DIAGNOSTIC ---
						// console.log(`Recursing into directory: ${relativePath}`);
						// Recursively scan subdirectories - await here ensures full scan before map continues
						await _scanDir(fullUri);
					}
					// Ignore symlinks and other types for now
				},
				{ concurrency: concurrency }
			); // Apply concurrency limit here
		} catch (error) {
			console.error(`Error reading directory ${dirUri.fsPath}:`, error);
			// Optionally show a warning to the user, but be mindful of noise if many folders are unreadable
			// vscode.window.showWarningMessage(`Could not read directory: ${dirUri.fsPath}`);
		}
	}

	console.log(`Starting workspace scan in: ${rootFolder.uri.fsPath}`);
	await _scanDir(rootFolder.uri); // Start the scan from the root
	console.log(
		`Workspace scan finished. Found ${relevantFiles.length} relevant files.`
	);
	return relevantFiles;
}

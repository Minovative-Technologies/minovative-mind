// src/context/workspaceScanner.ts
import * as vscode from "vscode";
import ignore from "ignore"; // Import the 'ignore' library
import BPromise from "bluebird"; // using bluebird map for concurrency control
import * as path from "path"; // Import path for joining

// Default patterns to ignore, mimicking common project build/dependency folders and git
const DEFAULT_IGNORE_PATTERNS: string[] = [
	// --- Common Build/Dependency Folders ---
	"node_modules",
	".git", // Git directory
	"dist",
	"out",
	"build",
	"target", // Common in Java/Rust
	"bin", // Common for compiled binaries/scripts
	"obj", // Common for .NET

	// --- Hidden Files/Folders (Dotfiles/Dotfolders) ---
	".vscode", // VS Code workspace settings
	".idea", // JetBrains IDE settings
	".settings", // Eclipse settings
	".github", // GitHub specific files (workflows, etc.)
	".gitlab", // GitLab specific files
	".env*", // Environment variables (e.g., .env, .env.local)
	".DS_Store", // macOS folder metadata
	".classpath", // Java classpath file
	".project", // Eclipse project file
	".cache", // Common cache directory
	".npm", // npm cache/config
	".yarn", // Yarn cache/config

	// --- Lock Files ---
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"composer.lock", // PHP
	"Gemfile.lock", // Ruby
	"Pipfile.lock", // Python
	"poetry.lock", // Python

	// --- Log Files ---
	"*.log",

	// --- Temporary/System Files ---
	"*.swp", // Vim swap files
	"*.swo", // Vim swap files
	"*~", // Backup files

	// --- Compiled Code/Cache ---
	"*.pyc",
	"__pycache__",

	// --- Media & Archive Files (already present, kept for completeness) ---
	"*.vsix",
	// Images
	"*.png",
	"*.jpg",
	"*.jpeg",
	"*.gif",
	"*.bmp",
	"*.tiff",
	"*.ico",
	"*.webp",
	// Scalable Vector Graphics
	"*.svg",
	// Video
	"*.mp4",
	"*.webm",
	"*.avi",
	"*.mov",
	"*.wmv",
	"*.flv",
	"*.mkv",
	// Audio
	"*.mp3",
	"*.wav",
	"*.ogg",
	"*.aac",
	// Fonts
	"*.woff",
	"*.woff2",
	"*.ttf",
	"*.otf",
	"*.eot",
	// Archives
	"*.zip",
	"*.rar",
	"*.7z",
	"*.tar",
	"*.gz",
	// Documents (often not needed for code context)
	"*.pdf",
	"*.doc",
	"*.docx",
	"*.ppt",
	"*.pptx",
	"*.xls",
	"*.xlsx",
];

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
	const ig = ignore(); // Create an ignore instance

	// Add default ignore patterns
	ig.add(DEFAULT_IGNORE_PATTERNS);

	// Add custom ignore patterns from options
	if (options?.additionalIgnorePatterns) {
		ig.add(options.additionalIgnorePatterns);
	}

	// Respect .gitignore if enabled (default to true)
	if (options?.respectGitIgnore !== false) {
		const gitIgnoreUri = vscode.Uri.joinPath(rootFolder.uri, ".gitignore");
		try {
			const gitIgnoreContentBytes = await vscode.workspace.fs.readFile(
				gitIgnoreUri
			);
			const gitIgnoreContent = Buffer.from(gitIgnoreContentBytes).toString(
				"utf-8"
			);
			console.log("Found .gitignore, adding rules.");
			ig.add(gitIgnoreContent);
		} catch (error) {
			// It's okay if .gitignore doesn't exist
			if (
				error instanceof vscode.FileSystemError &&
				error.code === "FileNotFound"
			) {
				console.log(".gitignore not found in root, skipping.");
			} else {
				console.error("Error reading .gitignore:", error);
				vscode.window.showWarningMessage("Error reading .gitignore file.");
			}
		}
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

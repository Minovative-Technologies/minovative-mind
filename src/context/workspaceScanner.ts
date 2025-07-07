// src/context/workspaceScanner.ts
import * as vscode from "vscode";
import BPromise from "bluebird"; // using bluebird map for concurrency control
import * as path from "path";
import { loadGitIgnoreMatcher } from "../utils/ignoreUtils";

// Interface for scan options (can be expanded later for settings)
interface ScanOptions {
	respectGitIgnore?: boolean;
	additionalIgnorePatterns?: string[];
	maxConcurrentReads?: number; // Optional concurrency limit
	maxConcurrency?: number; // Alternative name for maxConcurrentReads
	fileTypeFilter?: string[]; // NEW: Filter by file extensions
	maxFileSize?: number; // NEW: Skip files larger than this (in bytes)
	useCache?: boolean; // NEW: Enable caching of scan results
	cacheTimeout?: number; // NEW: Cache timeout in milliseconds
}

// NEW: Cache interface for scan results
interface ScanCache {
	timestamp: number;
	files: vscode.Uri[];
	workspacePath: string;
}

// NEW: File type patterns for better filtering
const RELEVANT_FILE_EXTENSIONS = [
	// Source code files
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".java",
	".kt",
	".scala",
	".groovy",
	".cpp",
	".cc",
	".cxx",
	".c",
	".h",
	".hpp",
	".cs",
	".vb",
	".fs",
	".fsx",
	".go",
	".rs",
	".swift",
	".kt",
	".scala",
	".php",
	".rb",
	".pl",
	".pm",
	".html",
	".htm",
	".css",
	".scss",
	".sass",
	".less",
	".vue",
	".svelte",
	".jsx",
	".tsx",
	".json",
	".yaml",
	".yml",
	".toml",
	".ini",
	".cfg",
	".xml",
	".svg",
	".md",
	".txt",
	// Configuration files
	".config",
	".conf",
	".properties",
	// Build files
	"package.json",
	"tsconfig.json",
	"webpack.config.js",
	"vite.config.js",
	"rollup.config.js",
	"jest.config.js",
	"Dockerfile",
	"docker-compose.yml",
	"docker-compose.yaml",
	".gitignore",
	".eslintrc",
	".prettierrc",
	// Documentation
	"README.md",
	"CHANGELOG.md",
	"LICENSE",
	"CONTRIBUTING.md",
];

// NEW: Cache storage
const scanCache = new Map<string, ScanCache>();

/**
 * Scans the workspace for relevant files, respecting .gitignore and default excludes.
 * Now includes caching, better file filtering, and performance optimizations.
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
	const workspacePath = rootFolder.uri.fsPath;

	// NEW: Check cache first
	const useCache = options?.useCache ?? true;
	const cacheTimeout = options?.cacheTimeout ?? 5 * 60 * 1000; // 5 minutes default

	if (useCache) {
		const cached = scanCache.get(workspacePath);
		if (cached && Date.now() - cached.timestamp < cacheTimeout) {
			console.log(`Using cached scan results for: ${workspacePath}`);
			return cached.files;
		}
	}

	const relevantFiles: vscode.Uri[] = [];

	// Load gitignore rules and default patterns using the utility function
	const ig = await loadGitIgnoreMatcher(rootFolder.uri);

	// custom ignore patterns from options
	if (options?.additionalIgnorePatterns) {
		ig.add(options.additionalIgnorePatterns);
	}

	// Define concurrency (default to a reasonable number, e.g., 10)
	const concurrency = options?.maxConcurrentReads ?? 10;
	const maxFileSize = options?.maxFileSize ?? 1024 * 1024; // 1MB default
	const fileTypeFilter = options?.fileTypeFilter ?? RELEVANT_FILE_EXTENSIONS;

	/**
	 * NEW: Check if a file should be included based on size and type
	 */
	function shouldIncludeFile(filePath: string, fileSize?: number): boolean {
		// Check file size
		if (fileSize !== undefined && fileSize > maxFileSize) {
			return false;
		}

		// Check file extension
		const ext = path.extname(filePath).toLowerCase();
		const fileName = path.basename(filePath).toLowerCase();

		// Include files with relevant extensions or specific filenames
		return fileTypeFilter.some((pattern) => {
			if (pattern.startsWith(".")) {
				return ext === pattern;
			}
			return fileName === pattern;
		});
	}

	/**
	 * Recursively scans a directory.
	 * Uses Bluebird's map for controlled concurrency when reading subdirectories.
	 * Now includes better error handling and performance optimizations.
	 */
	async function _scanDir(dirUri: vscode.Uri): Promise<void> {
		try {
			const entries = await vscode.workspace.fs.readDirectory(dirUri);

			// NEW: Pre-filter entries to reduce processing
			const relevantEntries = entries.filter(([name, type]) => {
				const fullPath = path.join(dirUri.fsPath, name);
				const relativePath = path.relative(workspacePath, fullPath);

				// Skip ignored paths early
				if (
					ig.ignores(relativePath) ||
					(type === vscode.FileType.Directory && ig.ignores(relativePath + "/"))
				) {
					return false;
				}

				// For files, check if they should be included
				if (type === vscode.FileType.File) {
					return shouldIncludeFile(relativePath);
				}

				return true; // Include directories for further scanning
			});

			// Use Bluebird map for concurrent processing of directory entries
			await BPromise.map(
				relevantEntries,
				async ([name, type]) => {
					const fullUri = vscode.Uri.joinPath(dirUri, name);
					const relativePath = path.relative(workspacePath, fullUri.fsPath);

					if (type === vscode.FileType.File) {
						// NEW: Check file size before adding
						try {
							const stat = await vscode.workspace.fs.stat(fullUri);
							if (shouldIncludeFile(relativePath, stat.size)) {
								relevantFiles.push(fullUri);
							}
						} catch (statError) {
							// If we can't get file size, include it anyway
							relevantFiles.push(fullUri);
						}
					} else if (type === vscode.FileType.Directory) {
						// Recursively scan subdirectories
						await _scanDir(fullUri);
					}
					// Ignore symlinks and other types for now
				},
				{ concurrency: concurrency }
			);
		} catch (error) {
			console.error(`Error reading directory ${dirUri.fsPath}:`, error);
		}
	}

	console.log(`Starting optimized workspace scan in: ${workspacePath}`);
	const startTime = Date.now();

	await _scanDir(rootFolder.uri); // Start the scan from the root

	const scanTime = Date.now() - startTime;
	console.log(
		`Workspace scan finished in ${scanTime}ms. Found ${relevantFiles.length} relevant files.`
	);

	// NEW: Cache the results
	if (useCache) {
		scanCache.set(workspacePath, {
			timestamp: Date.now(),
			files: relevantFiles,
			workspacePath,
		});
	}

	return relevantFiles;
}

/**
 * NEW: Clear scan cache for a specific workspace or all workspaces
 */
export function clearScanCache(workspacePath?: string): void {
	if (workspacePath) {
		scanCache.delete(workspacePath);
		console.log(`Cleared scan cache for: ${workspacePath}`);
	} else {
		scanCache.clear();
		console.log("Cleared all scan caches");
	}
}

/**
 * NEW: Get cache statistics
 */
export function getScanCacheStats(): {
	size: number;
	entries: Array<{ path: string; age: number }>;
} {
	const entries = Array.from(scanCache.entries()).map(([path, cache]) => ({
		path,
		age: Date.now() - cache.timestamp,
	}));

	return {
		size: scanCache.size,
		entries,
	};
}

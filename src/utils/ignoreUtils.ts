import * as vscode from "vscode";
import ignore from "ignore";

// Default patterns to ignore, mimicking common project build/dependency folders and git
export const DEFAULT_IGNORE_PATTERNS: string[] = [
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

/**
 * Loads .gitignore rules from the workspace root and combines them with default ignore patterns.
 * Returns an 'ignore' instance configured with these rules.
 * @param workspaceRootUri The URI of the workspace root.
 * @returns A configured 'ignore' instance.
 */
export async function loadGitIgnoreMatcher(workspaceRootUri: vscode.Uri) {
	const ig = ignore();
	ig.add(DEFAULT_IGNORE_PATTERNS);

	const gitIgnoreUri = vscode.Uri.joinPath(workspaceRootUri, ".gitignore");
	try {
		const gitIgnoreContentBytes = await vscode.workspace.fs.readFile(
			gitIgnoreUri
		);
		const gitIgnoreContent = Buffer.from(gitIgnoreContentBytes).toString(
			"utf-8"
		);
		console.log("Found .gitignore, adding rules to matcher.");
		ig.add(gitIgnoreContent);
	} catch (error) {
		if (
			error instanceof vscode.FileSystemError &&
			error.code === "FileNotFound"
		) {
			console.log(".gitignore not found in root, skipping loading its rules.");
		} else {
			console.error("Error reading .gitignore for ignoreUtils:", error);
		}
	}
	return ig;
}

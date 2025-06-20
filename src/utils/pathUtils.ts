// src/utils/pathUtils.ts
import * as vscode from "vscode";
import * as path from "path";

/**
 * Converts an absolute file system path to a path relative to the workspace root.
 * If the path is outside the workspace, it returns a less specific representation (e.g., just the basename).
 * This prevents exposing full system paths to the user for files outside the current project.
 *
 * @param absolutePath The absolute file system path (e.g., '/Users/name/project/src/file.ts').
 * @param workspaceRootUri The URI of the workspace root (e.g., vscode.Uri for '/Users/name/project').
 * @returns A workspace-relative path (e.g., 'src/file.ts') or a sanitized version (e.g., 'file.ts') if outside the workspace.
 */
export function getWorkspaceRelativePath(
	absolutePath: string,
	workspaceRootUri: vscode.Uri
): string {
	try {
		const workspaceFsPath = workspaceRootUri.fsPath;
		// Normalize paths to ensure consistent comparison across different OS (e.g., Windows '\' vs '/' )
		const normalizedAbsolutePath = path.normalize(absolutePath);
		const normalizedWorkspaceFsPath = path.normalize(workspaceFsPath);

		// Check if the absolute path starts with the workspace root path
		if (normalizedAbsolutePath.startsWith(normalizedWorkspaceFsPath)) {
			// Path is within the workspace, calculate relative path
			const relativePath = path.relative(
				normalizedWorkspaceFsPath,
				normalizedAbsolutePath
			);
			// Ensure forward slashes for consistent display across platforms
			return relativePath.replace(/\\/g, "/");
		} else {
			// Path is outside the workspace, return only the file/directory name
			return path.basename(absolutePath);
		}
	} catch (e) {
		console.warn(`[PathUtils] Error sanitizing path '${absolutePath}': ${e}`);
		// Fallback to basename in case of any unexpected errors
		return path.basename(absolutePath);
	}
}

/**
 * Scans an entire error message string for occurrences of absolute file paths
 * and replaces them with their workspace-relative equivalents. This function
 * uses a regular expression to identify common path patterns within messages.
 *
 * @param errorMessage The original error message string that might contain absolute paths.
 * @param workspaceRootUri The URI of the workspace root.
 * @returns The sanitized error message with paths replaced.
 */
export function sanitizeErrorMessagePaths(
	errorMessage: string,
	workspaceRootUri: vscode.Uri
): string {
	if (!errorMessage) {
		return "";
	}

	// Regular expression to find strings that look like absolute file paths.
	// It's designed to capture paths potentially enclosed in quotes (single, double, or smart quotes)
	// or just raw absolute paths.
	// (?:['“"]?)       - Non-capturing group for optional opening quotes
	// (                - Start capturing group for the path itself (p1)
	//   [\/\\]        - Must start with a forward or backward slash (common for absolute paths)
	//   (?:[a-zA-Z]:)? - Optional Windows drive letter (e.g., C:)
	//   (?:[^<>:"|\\?*\n\r']+\/?)*? - Non-greedy match for path segments:
	//      [^<>:"|\\?*\n\r']+ - One or more characters NOT typical invalid path chars or quotes
	//      \/?               - Optional trailing slash for directories
	// )
	// (?:['”"]?)       - Non-capturing group for optional closing quotes
	const pathRegex = new RegExp(
		"(?:['“\\\"]?)([\\/\\\\](?:[a-zA-Z]:)?(?:[^<>:\"|\\\\?\\*\\n\\r']+\\\\/?)*?)(?:['”\\\"]?)",
		"g"
	);

	return errorMessage.replace(pathRegex, (match: string, p1: string) => {
		// p1 is the actual captured path string (without the surrounding quotes, if any)
		if (p1 && (path.isAbsolute(p1) || p1.startsWith(workspaceRootUri.fsPath))) {
			// Only process if the captured string is an absolute path or looks like it's within the workspace
			const sanitizedPath = getWorkspaceRelativePath(p1, workspaceRootUri);

			// Re-add the original quotes if they were part of the match
			if (match.startsWith("'") && match.endsWith("'")) {
				return `'${sanitizedPath}'`;
			}
			if (match.startsWith("“") && match.endsWith("”")) {
				return `“${sanitizedPath}”`;
			}
			if (match.startsWith('"') && match.endsWith('"')) {
				return `"${sanitizedPath}"`;
			}

			return sanitizedPath; // Return the relative path without quotes if none were found
		}
		return match; // If not an absolute path, return the original match unchanged
	});
}

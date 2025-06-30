// src/sidebar/services/gitService.ts
import * as vscode from "vscode"; // For workspaceFolders, though rootPath is passed
import { exec, ChildProcess } from "child_process";
import * as util from "util";

const execPromise = util.promisify(exec);

export async function getGitStagedDiff(rootPath: string): Promise<string> {
	// Original _getGitStagedDiff logic
	return new Promise((resolve, reject) => {
		const command = "git diff --staged";
		exec(command, { cwd: rootPath }, (error, stdout, stderr) => {
			if (error) {
				console.error(`Error executing 'git diff --staged': ${error.message}`);
				if (stderr) {
					console.error(`stderr from 'git diff --staged': ${stderr}`);
				}
				reject(
					new Error(
						`Failed to execute 'git diff --staged': ${error.message}${
							stderr ? `\nStderr: ${stderr}` : ""
						}`
					)
				);
				return;
			}
			if (stderr) {
				// Stderr from 'git diff --staged' is not always an error (e.g., warnings about line endings)
				console.warn(
					`stderr from 'git diff --staged' (command successful): ${stderr}`
				);
			}
			resolve(stdout.trim());
		});
	});
}

// Helper for staging all changes. Returns a ChildProcess for cancellation.
export function stageAllChanges(
	rootPath: string,
	token: vscode.CancellationToken, // For cancellation
	onProcess: (process: ChildProcess) => void, // Callback to register the process for external cancellation
	onOutput: (
		type: "stdout" | "stderr" | "status",
		data: string,
		isError?: boolean
	) => void
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const gitAddProcess = exec(
			"git add .",
			{ cwd: rootPath },
			(error, stdout, stderr) => {
				if (token.isCancellationRequested) {
					reject(new Error("Operation cancelled by user."));
					return;
				}
				if (error) {
					const errorMessage = `Failed to stage changes (git add .): ${
						error.message
					}${stdout ? `\nStdout:\n${stdout}` : ""}${
						stderr ? `\nStderr:\n${stderr}` : ""
					}`;
					onOutput("stderr", errorMessage, true);
					reject(
						new Error(`Failed to stage changes (git add .): ${error.message}`)
					);
					return;
				}
				if (stdout) {
					onOutput("stdout", `'git add .' stdout:\n${stdout.trim()}`);
				}
				if (stderr) {
					onOutput(
						"stderr",
						`'git add .' stderr (non-fatal):\n${stderr.trim()}`
					);
				} // Treat as warning
				onOutput("status", "Changes staged successfully.");
				resolve();
			}
		);
		onProcess(gitAddProcess); // Register the process

		const cancellationListener = token.onCancellationRequested(() => {
			if (gitAddProcess && !gitAddProcess.killed) {
				gitAddProcess.kill();
				console.log("Attempted to kill git add . process due to cancellation.");
			}
			cancellationListener.dispose(); // Clean up listener
			reject(new Error("Operation cancelled by user.")); // Ensure promise rejects
		});
		// If already cancelled
		if (token.isCancellationRequested) {
			if (gitAddProcess && !gitAddProcess.killed) {
				gitAddProcess.kill();
			}
			cancellationListener.dispose();
			reject(new Error("Operation cancelled by user."));
		}
	});
}

// This function now only *constructs* the command. Execution is handled by SidebarProvider.
export function constructGitCommitCommand(commitMessage: string): {
	command: string;
	displayMessage: string;
} {
	let cleanedCommitMessage = commitMessage.trim();
	cleanedCommitMessage = cleanedCommitMessage
		.replace(/^```.*?(\r?\n|$)/s, "")
		.replace(/(\r?\n|^)```$/s, "")
		.trim();

	if (
		(cleanedCommitMessage.startsWith('"') &&
			cleanedCommitMessage.endsWith('"')) ||
		(cleanedCommitMessage.startsWith("'") && cleanedCommitMessage.endsWith("'"))
	) {
		cleanedCommitMessage = cleanedCommitMessage.substring(
			1,
			cleanedCommitMessage.length - 1
		);
	}

	if (!cleanedCommitMessage) {
		throw new Error("AI generated an empty commit message after cleaning.");
	}

	const messageParts = cleanedCommitMessage.split(/\r?\n\r?\n/, 2);
	let subject = messageParts[0]
		.replace(/`/g, "\\`") // Escape backticks for shell interpretation
		.replace(/"/g, '\\"')
		.replace(/\r?\n/g, " ")
		.trim();

	if (!subject) {
		throw new Error(
			"AI generated an empty commit message subject after cleaning and processing."
		);
	}

	let gitCommitCommand = `git commit -m "${subject}"`;
	let fullMessageForDisplay = subject;

	if (messageParts.length > 1) {
		let body = messageParts[1]
			.replace(/`/g, "\\`") // Escape backticks for shell interpretation
			.replace(/"/g, '\\"')
			.trim();
		if (body) {
			gitCommitCommand += ` -m "${body}"`;
			fullMessageForDisplay += `\n\n${body}`;
		}
	}
	return { command: gitCommitCommand, displayMessage: fullMessageForDisplay };
}

/**
 * Retrieves the content of a file from the Git index (staged version).
 * Logs stderr as a warning but returns stdout if present.
 *
 * @param rootPath The root path of the Git repository.
 * @param filePath The path to the file relative to the rootPath.
 * @returns The content of the file from the Git index.
 * @throws Error if the command fails to execute or returns an empty stdout with stderr.
 */
export async function getGitFileContentFromIndex(
	rootPath: string,
	filePath: string
): Promise<string> {
	try {
		// Use proper quoting for filePath to handle spaces or special characters
		// Replace existing double quotes with escaped ones to ensure correct shell parsing.
		const command = `git show :"${filePath.replace(/"/g, '\\"')}"`;
		const { stdout, stderr } = await execPromise(command, { cwd: rootPath });

		if (stderr) {
			// Log stderr as a warning. If stdout is present, it means the command was largely successful.
			if (stdout.trim().length > 0) {
				console.warn(
					`[GitService] stderr from 'git show :"${filePath}"' (non-fatal): ${stderr.trim()}`
				);
			} else {
				// If stdout is empty but stderr exists, it typically indicates an error or no content.
				// Re-throwing here allows the calling function to decide how to handle an empty result with warnings/errors.
				console.error(
					`[GitService] Error or no content from index for '${filePath}': ${stderr.trim()}`
				);
				throw new Error(
					`Failed to get file content from index for '${filePath}': ${stderr.trim()}`
				);
			}
		}
		return stdout.trim();
	} catch (error: any) {
		console.error(
			`[GitService] Failed to get file content from index for '${filePath}' in '${rootPath}': ${
				error.message || error
			}`
		);
		throw new Error(
			`Failed to get staged file content for '${filePath}': ${
				error.message || error
			}`
		);
	}
}

/**
 * Retrieves the content of a file from the Git HEAD (last committed version).
 * Handles specific error messages for new files by returning an empty string.
 *
 * @param rootPath The root path of the Git repository.
 * @param filePath The path to the file relative to the rootPath.
 * @returns The content of the file from Git HEAD, or an empty string if the file is new.
 * @throws Error for any other unhandled Git errors.
 */
export async function getGitFileContentFromHead(
	rootPath: string,
	filePath: string
): Promise<string> {
	try {
		// Use proper quoting for filePath to handle spaces or special characters
		// Replace existing double quotes with escaped ones to ensure correct shell parsing.
		const command = `git show HEAD:"${filePath.replace(/"/g, '\\"')}"`;
		const { stdout, stderr } = await execPromise(command, { cwd: rootPath });

		if (stderr) {
			// Log stderr as a warning, similar to getGitFileContentFromIndex.
			if (stdout.trim().length > 0) {
				console.warn(
					`[GitService] stderr from 'git show HEAD:"${filePath}"' (non-fatal): ${stderr.trim()}`
				);
			} else {
				console.error(
					`[GitService] Error or no content from HEAD for '${filePath}': ${stderr.trim()}`
				);
				throw new Error(
					`Failed to get file content from HEAD for '${filePath}': ${stderr.trim()}`
				);
			}
		}
		return stdout.trim();
	} catch (error: any) {
		const errorOutput = error.stderr || error.message || String(error);
		const lowerErrorMessage = errorOutput.toLowerCase();

		// Use a single, comprehensive regex to match common "file not found in HEAD" errors.
		// The 'i' flag ensures case-insensitive matching for robustness, though lowerErrorMessage is already lowercased.
		const gitHeadFileNotFoundRegex =
			/(unknown revision|path not in the working tree|exists on disk, but not in 'head')/i;

		if (gitHeadFileNotFoundRegex.test(lowerErrorMessage)) {
			console.log(
				`[GitService] File '${filePath}' not found in HEAD or not tracked by HEAD. Returning empty string.`
			);
			return ""; // File is new, no old content to compare against
		} else {
			// Re-throw other errors
			console.error(
				`[GitService] Failed to get file content from HEAD for '${filePath}' in '${rootPath}': ${errorOutput}`
			);
			throw new Error(
				`Failed to get HEAD file content for '${filePath}': ${errorOutput}`
			);
		}
	}
}

export async function getGitStagedFiles(rootPath: string): Promise<string[]> {
	try {
		const { stdout } = await execPromise("git diff --name-only --cached", {
			cwd: rootPath,
		});
		return stdout
			.trim()
			.split("\n")
			.filter((line) => line.length > 0);
	} catch (error: any) {
		console.error(
			`Error getting staged files for ${rootPath}: ${error.message || error}`
		);
		return [];
	}
}

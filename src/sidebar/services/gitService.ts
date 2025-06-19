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

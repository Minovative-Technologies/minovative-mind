import { ChildProcess, spawn } from "child_process";
import * as vscode from "vscode";

/**
 * Interface for the result object returned by the executeCommand function.
 *
 * @interface CommandResult
 * @property {string} stdout - The standard output from the executed command.
 * @property {string} stderr - The standard error output from the executed command.
 * @property {number | null} exitCode - The exit code of the command. Null if the process exited due to a signal or could not be spawned.
 */
export interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

/**
 * Executes a shell command, captures its stdout and stderr, and handles cancellation.
 * It adds the spawned child process to a provided tracking array (`activeChildProcesses`)
 * immediately and removes it upon the command's completion (success, failure, or cancellation).
 *
 * @param {string} commandString - The full command string to execute (e.g., "npm install").
 * @param {string} cwd - The current working directory for the command execution.
 * @param {vscode.CancellationToken} token - A VS Code CancellationToken to observe for cancellation requests.
 * @param {ChildProcess[]} activeChildProcesses - An array to which the spawned ChildProcess will be added
 *   and from which it will be removed. This allows for global management of active child processes.
 * @returns {Promise<CommandResult>} A Promise that resolves with an object containing
 *   `stdout`, `stderr`, and `exitCode`. The Promise will reject only if the command
 *   fails to spawn (e.g., command not found, permissions error).
 *
 * @remarks
 * - Using `shell: true` can be a security risk if `commandString` originates from untrusted user input,
 *   as it allows for shell command injection. Ensure `commandString` is sanitized or controlled.
 * - If the command is cancelled, it will be killed via `child.kill()` (SIGTERM). The `exitCode`
 *   in this scenario might be `null` or a specific non-zero value (e.g., 130 for SIGTERM on Linux).
 */
export async function executeCommand(
	commandString: string,
	cwd: string,
	token: vscode.CancellationToken,
	activeChildProcesses: ChildProcess[]
): Promise<CommandResult> {
	const stdoutChunks: Buffer[] = [];
	const stderrChunks: Buffer[] = [];
	let cancellationInitiatedByToken: boolean = false;

	return new Promise<CommandResult>((resolve, reject) => {
		// Spawn the child process
		const child: ChildProcess = spawn(commandString, { cwd, shell: true });

		// Add the child process to the active tracking array immediately
		activeChildProcesses.push(child);

		// Function to clean up resources: remove from active processes and dispose cancellation listener
		const cleanup = (): void => {
			const index: number = activeChildProcesses.indexOf(child);
			if (index > -1) {
				activeChildProcesses.splice(index, 1);
			}
			disposable.dispose(); // Dispose of the cancellation listener to prevent memory leaks
		};

		// Register a listener for cancellation requests from the VS Code token
		const disposable: vscode.Disposable = token.onCancellationRequested(() => {
			if (!child.killed) {
				console.log(
					`Command execution cancelled. Killing process PID: ${
						child.pid ?? "N/A"
					} for command: "${commandString}"`
				);
				cancellationInitiatedByToken = true; // Mark that cancellation was initiated by our token
				child.kill(); // Send SIGTERM to the child process
			}
		});

		// Collect stdout data chunks
		child.stdout?.on("data", (data: Buffer) => {
			stdoutChunks.push(data);
		});

		// Collect stderr data chunks
		child.stderr?.on("data", (data: Buffer) => {
			stderrChunks.push(data);
		});

		// Handle errors that occur during spawning or execution of the command
		// This event is typically emitted if the command cannot be found, permissions are denied, etc.
		child.on("error", (err: Error) => {
			const errorMessage: string = `Failed to execute command "${commandString}" in "${cwd}" or internal error: ${err.message}`;
			console.error(
				`Command Spawn Error [PID: ${
					child.pid ?? "N/A"
				}] for command: "${commandString}":`,
				errorMessage,
				err
			);
			cleanup(); // Ensure cleanup even if the process failed to spawn
			reject(new Error(errorMessage)); // Reject the promise as the command couldn't even start
		});

		// Handle the process 'close' event, which fires when the process exits
		// (either successfully, with an error code, or due to a signal).
		child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
			const stdout: string = Buffer.concat(stdoutChunks).toString("utf8");
			const stderr: string = Buffer.concat(stderrChunks).toString("utf8");
			const exitCode: number | null = code;

			console.log(
				`Command finished [PID: ${
					child.pid ?? "N/A"
				}] for command: "${commandString}" with exit code: ${exitCode}, signal: ${
					signal ?? "N/A"
				}`
			);
			if (stderr) {
				// Log stderr output, especially if the command was not explicitly cancelled.
				// During cancellation, stderr might contain irrelevant output as process is abruptly stopped.
				if (!cancellationInitiatedByToken) {
					console.warn(
						`Command stderr [PID: ${child.pid ?? "N/A"}]:\n${stderr}`
					);
				}
			}

			cleanup(); // Always clean up when the process closes

			if (cancellationInitiatedByToken || token.isCancellationRequested) {
				// If cancellation was initiated by our token, resolve with the available output.
				// A common exit code for SIGTERM (which child.kill() sends) is 130 on Unix-like systems.
				console.log(
					`Command [PID: ${
						child.pid ?? "N/A"
					}] was killed due to external cancellation request.`
				);
				// Prefer the actual exit code if available, otherwise default for SIGTERM.
				resolve({
					stdout,
					stderr,
					exitCode: exitCode ?? (signal === "SIGTERM" ? 130 : null),
				});
			} else {
				// Resolve with stdout, stderr, and exitCode. The caller should inspect exitCode
				// to determine if the command completed successfully (typically exitCode === 0).
				resolve({ stdout, stderr, exitCode });
			}
		});

		// Immediately check if the token was already cancelled before the promise or spawning completed.
		// This ensures quick termination for already-cancelled operations.
		if (token.isCancellationRequested) {
			console.log(
				`Token already cancelled upon command initiation. Killing command [PID: ${
					child.pid ?? "N/A"
				}] immediately for command: "${commandString}"`
			);
			cancellationInitiatedByToken = true;
			child.kill();
		}
	});
}

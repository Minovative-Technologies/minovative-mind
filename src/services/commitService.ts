import * as vscode from "vscode";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import {
	getGitStagedDiff,
	getGitStagedFiles,
	getGitFileContentFromIndex,
	getGitFileContentFromHead,
	stageAllChanges,
} from "../sidebar/services/gitService";
import { ERROR_OPERATION_CANCELLED } from "../ai/gemini";
import { ChildProcess } from "child_process";
import { generateFileChangeSummary } from "../utils/diffingUtils";
import { DEFAULT_FLASH_LITE_MODEL } from "../sidebar/common/sidebarConstants";
import { executeCommand } from "../utils/commandExecution"; // Import robust command executor

export class CommitService {
	private minovativeMindTerminal: vscode.Terminal | undefined; // Terminal instance for Git operations

	constructor(private provider: SidebarProvider) {}

	/**
	 * Handles the /commit command by staging changes, generating a commit message via AI,
	 * and presenting it for user review. Integrates cancellation.
	 * @param token A CancellationToken to observe cancellation requests.
	 */
	public async handleCommitCommand(
		token: vscode.CancellationToken
	): Promise<void> {
		const { settingsManager } = this.provider;
		const modelName = DEFAULT_FLASH_LITE_MODEL; // Use the default model for commit messages

		let success = false;
		let errorMessage: string | null = null;
		let operationId: string | null = null;

		try {
			operationId = this.provider.currentActiveChatOperationId;

			if (token.isCancellationRequested) {
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			this.provider.postMessageToWebview({
				type: "aiResponseStart",
				value: {
					modelName,
					relevantFiles: [] as string[],
					operationId: operationId!,
				},
			});
			this.provider.chatHistoryManager.addHistoryEntry("user", "/commit");

			const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!rootPath) {
				throw new Error("No workspace folder open for git.");
			}

			const onProcessCallback = (process: ChildProcess) => {
				console.log(
					`[CommitService] Git process started: PID ${process.pid}, Command: 'git add .'`
				);
			};

			const onOutputCallback = (
				type: "stdout" | "stderr" | "status",
				data: string,
				isError?: boolean
			) => {
				this.provider.postMessageToWebview({
					type: "gitProcessUpdate",
					value: { type, data, isError },
				});

				if (type === "stderr" || isError) {
					this.provider.chatHistoryManager.addHistoryEntry(
						"model",
						`Git Staging Error: ${data}`
					);
				} else if (type === "stdout") {
					console.log(`[CommitService] Git stdout: ${data}`);
				}
			};

			await stageAllChanges(
				rootPath,
				token,
				onProcessCallback,
				onOutputCallback
			);
			if (token.isCancellationRequested) {
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			const diff = await getGitStagedDiff(rootPath);
			const stagedFiles = await getGitStagedFiles(rootPath);

			if (!diff || diff.trim() === "") {
				success = true;
				errorMessage = "No changes staged to commit.";
				return;
			}

			const fileSummaries: string[] = [];
			for (const filePath of stagedFiles) {
				if (token.isCancellationRequested) {
					throw new Error(ERROR_OPERATION_CANCELLED);
				}
				const oldContent = await getGitFileContentFromHead(rootPath, filePath);
				const newContent = await getGitFileContentFromIndex(rootPath, filePath);
				const { summary } = await generateFileChangeSummary(
					oldContent,
					newContent,
					filePath
				);
				fileSummaries.push(summary);
			}

			const detailedSummaries =
				fileSummaries.length > 0
					? "Summary of File Changes:\n" +
					  fileSummaries.map((s) => `- ${s}`).join("\n") +
					  "\n\n"
					: "";

			// Clear, deterministic prompt that instructs the model to output ONLY the commit message.
			// Important constraints:
			//  - First line must be an imperative subject (e.g., "Add X to Y"), <= 72 chars (50 recommended).
			//  - Optional blank line, then body (wrap ~72 chars).
			//  - Do NOT start the subject with '-', '*', or any symbol that could be parsed as an option.
			//  - Do NOT include quotes (\" or `) or backticks; remove or replace them with plain text.
			//  - Do NOT include shell characters like $(), &&, ||, ; anywhere.
			//  - Use plain text only; markdown lists are acceptable inside the body but the response MUST be raw text (no commentary or code fences).
			//  - Output exactly the commit message text only, nothing else.
			const commitMessagePrompt = `
You are an expert Git author. Produce one commit message only — nothing else, no commentary, no headings, no code fences.

FORMAT REQUIREMENTS (strict):
1) First non-empty line = SUBJECT (imperative mood, e.g., "Add feature X", "Fix bug Y").
   - SUBJECT must NOT begin with '-', '*', or any punctuation that could look like a CLI flag.
   - SUBJECT must be <= 72 characters (50 chars recommended). If longer, shorten to <=72.
2) OPTIONAL: blank line, then BODY. Wrap lines at ~72 chars. Body may include short markdown-style lists for clarity but do not use code fences.
3) DO NOT USE double quotes (\\"), backticks (\`), or backslashes (\\). Replace them with plain text. Do not include shell-like constructs such as $(), &&, ||, or ';'.
4) Output only the commit message text (subject and optional body). Do not prepend "Commit Message:" or any metadata.

Context (file-level summaries follow). Use them to craft a concise, accurate subject and an optional explanatory body.
${detailedSummaries}
Overall Staged Diff:
\`\`\`diff
${diff}
\`\`\`
`;

			let commitMessage =
				await this.provider.aiRequestService.generateWithRetry(
					[{ text: commitMessagePrompt }],
					modelName,
					undefined,
					"commit message generation",
					undefined,
					undefined,
					token
				);

			if (token.isCancellationRequested) {
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			// ENHANCEMENT: Sanitize and validate the AI-generated message
			const validatedMessage =
				this._validateAndSanitizeCommitMessage(commitMessage);

			const trimmedCommitMessage = validatedMessage.trim();
			if (
				trimmedCommitMessage.toLowerCase().startsWith("error:") ||
				trimmedCommitMessage === ""
			) {
				console.error(
					`[CommitService] AI generated an invalid or error-prefixed commit message: "${commitMessage}"`
				);
				const userFacingError = `AI failed to generate a valid commit message. Received: "${trimmedCommitMessage.substring(
					0,
					150
				)}${
					trimmedCommitMessage.length > 150 ? "..." : ""
				}". Please try again or provide more context.`;
				throw new Error(userFacingError);
			}

			this.provider.chatHistoryManager.addHistoryEntry(
				"model",
				validatedMessage
			);

			this.provider.pendingCommitReviewData = {
				commitMessage: validatedMessage, // Use the validated message directly
				stagedFiles,
			};
			success = true;
		} catch (error: any) {
			errorMessage = error.message;
			success = false;
		} finally {
			const isCancellation = errorMessage === ERROR_OPERATION_CANCELLED;
			const isCommitReviewPending =
				success && !!this.provider.pendingCommitReviewData;

			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: isCommitReviewPending,
				error: isCancellation
					? "Commit operation cancelled."
					: isCommitReviewPending
					? null
					: errorMessage,
				isCommitReviewPending: isCommitReviewPending,
				commitReviewData: isCommitReviewPending
					? this.provider.pendingCommitReviewData
					: undefined,
				statusMessageOverride:
					success && errorMessage === "No changes staged to commit."
						? errorMessage
						: undefined,
				operationId: operationId!,
			});
			this.provider.isGeneratingUserRequest = false;

			if (isCancellation) {
				this.provider.postMessageToWebview({ type: "reenableInput" });
			}

			this.provider.clearActiveOperationState();
			this.provider.chatHistoryManager.restoreChatHistoryToWebview();
		}
	}

	/**
	 * Validates and sanitizes a commit message for security and best practices.
	 * - Normalizes control characters and smart quotes
	 * - Removes leading list markers that AIs often add
	 * - Detects shell-like injection and git-exploit patterns
	 * - Enforces subject line length constraints (throws with actionable message)
	 * @param message The raw commit message.
	 * @returns The sanitized commit message.
	 * @throws An error if the message is invalid or potentially malicious.
	 */
	private _validateAndSanitizeCommitMessage(message: string): string {
		if (message === null || message === undefined) {
			throw new Error("Empty commit message returned from AI.");
		}

		// 1) Remove ASCII control chars (except newline and tab)
		let sanitized = message.replace(
			/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g,
			""
		);

		// 2) Normalize newlines to \n
		sanitized = sanitized.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

		// 3) Replace smart quotes and backticks with nothing (we disallow quotes)
		//    Replace types of quotes/backticks intentionally to avoid CLI quoting problems.
		sanitized = sanitized.replace(/[`"'“”‘’]/g, "");

		// 4) Remove backslashes (avoid escape sequences)
		sanitized = sanitized.replace(/\\+/g, "");

		// 5) Trim trailing spaces on each line and collapse excessive blank lines to at most one blank line
		sanitized = sanitized
			.split("\n")
			.map((l) => l.replace(/[ \t]+$/g, "")) // rtrim
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();

		// If the model emitted a bullet list (common), remove a single leading bullet marker from the first non-empty line.
		// This makes messages like "- Fix foo" become "Fix foo" automatically.
		sanitized = sanitized.replace(/^\s*[-*]\s+/, "");

		// 6) Heuristic security checks: shell-like constructs
		// If any of these are present, fail fast and loudly.
		const injectionPatterns = /\$\(|`|&&|\|\||;/;
		if (injectionPatterns.test(sanitized)) {
			throw new Error(
				"Commit message contains characters or patterns that resemble shell commands (e.g. $(), &&, ||, `, ;). For security, please edit the message without these constructs."
			);
		}

		// 7) Heuristic to detect attempts to manipulate Git config / hooks etc.
		const gitExploitPatterns = /\[(?:core|hooks|alias)\].*=/i;
		if (gitExploitPatterns.test(sanitized)) {
			throw new Error(
				"Commit message appears to include Git configuration-style content, which is not allowed."
			);
		}

		// 8) Prevent messages that start with a hyphen/dash or other single-character flags.
		//    After earlier bullet-stripping, still reject if it begins with '-' or other symbol.
		const firstNonWhitespaceChar = sanitized.trim().charAt(0);
		if (firstNonWhitespaceChar === "-" || firstNonWhitespaceChar === "*") {
			throw new Error(
				"Commit subject cannot start with '-' or '*' (these can be misinterpreted as CLI flags). Please edit the message to begin with an imperative subject (e.g., 'Add tests for X')."
			);
		}

		// 9) Enforce subject length rule: first line is the subject
		const firstLine = sanitized.split("\n", 1)[0].trim();
		if (!firstLine || firstLine.length === 0) {
			throw new Error(
				"Commit message subject is empty. Provide a concise subject line."
			);
		}
		const SUBJECT_SOFT_LIMIT = 50;
		const SUBJECT_HARD_LIMIT = 72; // enforce conventional hard limit
		if (firstLine.length > SUBJECT_HARD_LIMIT) {
			throw new Error(
				`Commit subject is too long (${firstLine.length} chars). Please shorten the first line to ${SUBJECT_HARD_LIMIT} characters or fewer (recommended ${SUBJECT_SOFT_LIMIT}).`
			);
		}

		// 10) Final safety: ensure message doesn't contain unprintable unicode sequences (very rare)
		if (/[^\u0000-\u007F\u00A0-\uFFFF\n]/.test(sanitized)) {
			// allow basic unicode but block high-control characters
			// If you need other unicode ranges in the future, adjust this check.
			console.warn(
				"[CommitService] Commit message contains unusual unicode characters; proceeding after sanitization."
			);
		}

		// 11) Return sanitized message
		return sanitized;
	}

	/**
	 * Gets a shared terminal for Git operations or creates one if it doesn't exist.
	 * @returns The vscode.Terminal instance.
	 */
	private _getOrCreateTerminal(): vscode.Terminal {
		if (
			this.minovativeMindTerminal &&
			!this.minovativeMindTerminal.exitStatus
		) {
			return this.minovativeMindTerminal;
		}

		this.minovativeMindTerminal = vscode.window.terminals.find(
			(t) => t.name === "Minovative Mind Git"
		);

		if (!this.minovativeMindTerminal) {
			this.minovativeMindTerminal = vscode.window.createTerminal({
				name: "Minovative Mind Git",
				cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
			});
		}

		this.minovativeMindTerminal.show(true);
		return this.minovativeMindTerminal;
	}

	/**
	 * Confirms and executes the commit with the provided message using a robust, secure method.
	 * @param editedMessage The commit message, potentially edited by the user.
	 */
	public async confirmCommit(editedMessage: string): Promise<void> {
		if (!this.provider.pendingCommitReviewData) {
			vscode.window.showErrorMessage("No pending commit to confirm.");
			return;
		}

		const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!rootPath) {
			vscode.window.showErrorMessage("No workspace folder for git commit.");
			return;
		}

		// Use a new token source for this specific, short-lived operation.
		const cancellationTokenSource = new vscode.CancellationTokenSource();
		const token = cancellationTokenSource.token;

		// The provider should manage the list of active child processes.
		if (!this.provider.activeChildProcesses) {
			this.provider.activeChildProcesses = [];
		}

		const terminal = this._getOrCreateTerminal();

		try {
			// ENHANCEMENT: Re-validate the message in case the user edited it to be malicious.
			const finalCommitMessage =
				this._validateAndSanitizeCommitMessage(editedMessage);

			// Echo the intended command to the terminal for transparency.
			terminal.sendText(`> git commit -m "${finalCommitMessage}"\n`);

			// ENHANCEMENT: Use the robust `executeCommand` utility for secure and observable execution.
			const result = await executeCommand(
				"git",
				["commit", "-m", finalCommitMessage],
				rootPath,
				token,
				this.provider.activeChildProcesses, // Pass active process tracker
				terminal // Pipe output to our terminal
			);

			if (result.exitCode === 0) {
				this.provider.pendingCommitReviewData = null;
				this.provider.chatHistoryManager.addHistoryEntry(
					"model",
					"Git Staging: Changes staged successfully."
				);
				this.provider.chatHistoryManager.addHistoryEntry(
					"model",
					`Commit confirmed and executed successfully:\n---\n${finalCommitMessage}\n---`
				);
				await this.provider.endUserOperation("success");
			} else {
				const errorMessage = `Git commit failed with exit code ${result.exitCode}.\n\nSTDERR:\n${result.stderr}`;
				vscode.window.showErrorMessage(
					"Git commit failed. See terminal for details."
				);
				this.provider.chatHistoryManager.addHistoryEntry(
					"model",
					`ERROR: ${errorMessage}`
				);
				await this.provider.endUserOperation("failed");
			}
		} catch (error: any) {
			const errorMessage = `An unexpected error occurred during commit: ${error.message}`;
			vscode.window.showErrorMessage(errorMessage);
			this.provider.chatHistoryManager.addHistoryEntry(
				"model",
				`ERROR: ${errorMessage}`
			);
			await this.provider.endUserOperation("failed");
		} finally {
			cancellationTokenSource.dispose();
		}
	}

	/**
	 * Cancels the pending commit review and re-enables UI.
	 */
	public async cancelCommit(): Promise<void> {
		await this.provider.triggerUniversalCancellation();
	}
}

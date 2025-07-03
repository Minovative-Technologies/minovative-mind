import * as vscode from "vscode";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import {
	constructGitCommitCommand,
	getGitStagedDiff,
	getGitStagedFiles,
	getGitFileContentFromIndex,
	getGitFileContentFromHead,
	stageAllChanges,
} from "../sidebar/services/gitService";
import { ERROR_OPERATION_CANCELLED } from "../ai/gemini";
import { ChildProcess } from "child_process";
import { generateFileChangeSummary } from "../utils/diffingUtils";

export class CommitService {
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
		const modelName = settingsManager.getSelectedModelName();

		try {
			if (token.isCancellationRequested) {
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			this.provider.postMessageToWebview({
				type: "aiResponseStart",
				value: { modelName },
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

			// Stage all changes (git add .)
			await stageAllChanges(
				rootPath,
				token, // Pass the cancellation token to git service
				onProcessCallback,
				onOutputCallback
			);
			if (token.isCancellationRequested) {
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			// Get the overall staged diff and the list of staged files
			const diff = await getGitStagedDiff(rootPath);
			const stagedFiles = await getGitStagedFiles(rootPath);

			if (!diff || diff.trim() === "") {
				this.provider.chatHistoryManager.addHistoryEntry(
					"model",
					"No changes staged to commit."
				);
				this.provider.postMessageToWebview({ type: "aiResponseEnd" });
				return;
			}

			const fileSummaries: string[] = [];
			for (const filePath of stagedFiles) {
				// Check for cancellation before processing each file summary
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

			const commitMessagePrompt = `You are an AI expert in Git. Your task is to generate a short, concise, but highly accurate commit message based on the provided staged changes. Prioritize the detailed file-by-file summaries for content, and use the overall diff for additional context if needed. Make the commit messages in past tense. Provide the commit message without any markdown formatting. There needs to be 0 markdown formatting. Make sure the commit message follow the commit message best practices with no markdown formatting.

			${detailedSummaries}Overall Staged Diff:
			\`\`\`diff
			${diff}
			\`\`\`

			Commit Message:`;

			// Generate commit message using AI
			let commitMessage =
				await this.provider.aiRequestService.generateWithRetry(
					commitMessagePrompt,
					modelName,
					undefined,
					"commit message generation",
					undefined,
					undefined,
					token // Pass the cancellation token to AI request service
				);

			if (token.isCancellationRequested) {
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			const trimmedCommitMessage = commitMessage.trim();
			// Check for AI-reported errors or an empty/whitespace message
			if (
				trimmedCommitMessage.toLowerCase().startsWith("error:") ||
				trimmedCommitMessage === ""
			) {
				// Log the full AI response for detailed debugging in the extension host
				console.error(
					`[CommitService] AI generated an invalid or error-prefixed commit message: "${commitMessage}"`
				);

				// Throw a more user-friendly error message that explains the issue
				const userFacingError = `AI failed to generate a valid commit message. Received: "${trimmedCommitMessage.substring(
					0,
					150
				)}${
					trimmedCommitMessage.length > 150 ? "..." : ""
				}". Please try again or provide more context.`;
				throw new Error(userFacingError);
			}

			this.provider.chatHistoryManager.addHistoryEntry("model", commitMessage);

			const { displayMessage } = constructGitCommitCommand(commitMessage);

			this.provider.pendingCommitReviewData = {
				commitMessage: displayMessage,
				stagedFiles, // This uses the stagedFiles array obtained earlier
			};

			this.provider.postMessageToWebview({
				type: "commitReview",
				value: this.provider.pendingCommitReviewData,
			});
		} catch (error: any) {
			const isCancellation = error.message === ERROR_OPERATION_CANCELLED;
			this.provider.postMessageToWebview({
				type: "aiResponseEnd",
				success: false, // Indicate failure
				error: isCancellation
					? "Commit operation cancelled."
					: `Commit failed: ${error.message}`,
			});
			// 3. In the `catch` block of the `handleCommitCommand` method, add a call to `this.provider.clearActiveOperationState();`
			this.provider.clearActiveOperationState();
		}
		// Comment has been removed as per instruction.
	}

	/**
	 * Confirms and executes the commit with the provided message.
	 * @param editedMessage The commit message, potentially edited by the user.
	 */
	public async confirmCommit(editedMessage: string): Promise<void> {
		if (!this.provider.pendingCommitReviewData) {
			vscode.window.showErrorMessage("No pending commit to confirm.");
			return;
		}

		const commitMessage = editedMessage;
		const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!rootPath) {
			vscode.window.showErrorMessage("No workspace folder for git commit.");
			return;
		}

		const { command } = constructGitCommitCommand(commitMessage);
		const terminal = vscode.window.createTerminal({
			name: "Minovative Mind Git Commit",
			cwd: rootPath,
		});
		terminal.show();
		terminal.sendText(command);
		// Add the staging success message here, after git command sent and before final confirmation message.
		this.provider.chatHistoryManager.addHistoryEntry(
			"model",
			"Git Staging: Changes staged successfully."
		);

		this.provider.chatHistoryManager.addHistoryEntry(
			"model",
			`Commit confirmed and executed:\n---\n${commitMessage}\n---\nCheck TERMINAL for result.`
		);
		this.provider.chatHistoryManager.restoreChatHistoryToWebview();
		// Replace previous state cleanup and UI signaling with central endUserOperation
		await this.provider.endUserOperation("success"); // Mark operation as successful and re-enable UI
	}

	/**
	 * Cancels the pending commit review and re-enables UI.
	 */
	public async cancelCommit(): Promise<void> {
		// Modified signature
		this.provider.chatHistoryManager.restoreChatHistoryToWebview();
		// 2. In the `cancelCommit` method, remove `this.provider.pendingCommitReviewData = null;`
		// this.provider.pendingCommitReviewData = null; // Removed
		this.provider.chatHistoryManager.addHistoryEntry(
			"model",
			"Commit review cancelled by user."
		);
		await this.provider.endUserOperation("cancelled"); // New line added
	}
}

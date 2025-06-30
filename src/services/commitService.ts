import * as vscode from "vscode";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import {
	constructGitCommitCommand,
	getGitStagedDiff,
	getGitStagedFiles,
	getGitFileContentFromIndex, // Added import
	getGitFileContentFromHead, // Added import
	stageAllChanges,
} from "../sidebar/services/gitService";
import { ERROR_OPERATION_CANCELLED } from "../ai/gemini";
import { ChildProcess } from "child_process";
import { generateFileChangeSummary } from "../utils/diffingUtils"; // Added import

export class CommitService {
	constructor(private provider: SidebarProvider) {}

	public async handleCommitCommand(): Promise<void> {
		const { settingsManager } = this.provider;
		const modelName = settingsManager.getSelectedModelName();

		this.provider.activeOperationCancellationTokenSource =
			new vscode.CancellationTokenSource();
		const token = this.provider.activeOperationCancellationTokenSource.token;

		try {
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
				if (type === "status") {
					this.provider.chatHistoryManager.addHistoryEntry(
						"model",
						`Git Staging: ${data}`
					);
				} else if (type === "stderr" || isError) {
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
				// Check for cancellation before processing each file
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

			const commitMessagePrompt = `You are an AI expert in Git. Your task is to generate a short, concise, but highly accurate commit message based on the provided staged changes. Prioritize the detailed file-by-file summaries for content, and use the overall diff for additional context if needed. Provide the commit message with markdown formatting.

			${detailedSummaries}Overall Staged Diff:
			\`\`\`diff
			${diff}
			\`\`\`

			Commit Message:`;

			let commitMessage =
				await this.provider.aiRequestService.generateWithRetry(
					commitMessagePrompt,
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
			if (commitMessage.toLowerCase().startsWith("error:")) {
				throw new Error(
					`AI failed to generate commit message: ${commitMessage}`
				);
			}

			this.provider.chatHistoryManager.addHistoryEntry("model", commitMessage);

			// The stagedFiles variable is now available earlier and used for summary generation
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
				error: isCancellation
					? "Commit operation cancelled."
					: `Commit failed: ${error.message}`,
			});
		} finally {
			this.provider.activeOperationCancellationTokenSource?.dispose();
			this.provider.activeOperationCancellationTokenSource = undefined;
		}
	}

	public async confirmCommit(): Promise<void> {
		if (!this.provider.pendingCommitReviewData) {
			vscode.window.showErrorMessage("No pending commit to confirm.");
			return;
		}

		const { commitMessage } = this.provider.pendingCommitReviewData;
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

		this.provider.chatHistoryManager.addHistoryEntry(
			"model",
			`Commit confirmed and executed:\n---\n${commitMessage}\n---\nCheck TERMINAL for result.`
		);
		this.provider.chatHistoryManager.restoreChatHistoryToWebview();
		this.provider.pendingCommitReviewData = null;
		this.provider.postMessageToWebview({ type: "aiResponseEnd" });
	}

	public cancelCommit(): void {
		this.provider.chatHistoryManager.restoreChatHistoryToWebview();
		this.provider.pendingCommitReviewData = null;
		this.provider.chatHistoryManager.addHistoryEntry(
			"model",
			"Commit review cancelled by user."
		);
		this.provider.postMessageToWebview({
			type: "aiResponseEnd",
			error: "Commit cancelled.",
		});
	}
}

import * as vscode from "vscode";
import { hasMergeConflicts } from "../utils/mergeUtils";

/**
 * Service to handle Git conflict resolution related VS Code commands.
 * This service provides functionality to programmatically unmark a file
 * as having Git merge conflicts after an automated or manual resolution.
 */
export class GitConflictResolutionService {
	/**
	 * Constructs a new GitConflictResolutionService instance.
	 * @param context The VS Code extension context.
	 */
	constructor(private context: vscode.ExtensionContext) {
		// The context object is typically used for subscriptions, accessing global state, etc.
		// For this service, its primary use might be for future logging or accessing workspace state,
		// though not strictly required for the current `unmarkFileAsResolved` implementation directly.
		// It's included to adhere to common VS Code extension service patterns.
	}

	/**
	 * Checks if the given file (by URI) no longer contains Git merge conflict markers.
	 * If no conflicts are detected, it signals VS Code's Git extension to unmark the file
	 * as conflicted. This typically removes the "resolve in merge editor" button and updates
	 * the Git status in the SCM view.
	 *
	 * @param fileUri The URI of the file to check and potentially unmark.
	 * @returns A promise that resolves to true if conflicts were successfully cleared (or already absent), false otherwise.
	 */
	public async unmarkFileAsResolved(fileUri: vscode.Uri): Promise<boolean> {
		// Get the relative path for user-friendly messages and logging.
		const relativePath = vscode.workspace.asRelativePath(fileUri);
		console.log(
			`[GitConflictResolutionService] Attempting to unmark file as resolved: ${relativePath}`
		);

		try {
			// 1. Open the document via vscode.workspace.openTextDocument.
			// This ensures we get the latest content that might have been modified by the AI.
			const document = await vscode.workspace.openTextDocument(fileUri);
			// 2. Get the full content using document.getText().
			const fileContent = document.getText();

			// 3. Use hasMergeConflicts from ../utils/mergeUtils to check for conflict markers.
			if (!hasMergeConflicts(fileContent)) {
				console.log(
					`[GitConflictResolutionService] File ${relativePath} content is clean. Proceeding to unmark as conflict.`
				);
				// 4. If no conflicts are found, execute the VS Code internal command
				// 'git.unmarkFileAsConflict' with the fileUri.
				// This command is an internal API used by the Git extension to manage conflict state.
				await vscode.commands.executeCommand(
					"git.unmarkFileAsConflict",
					fileUri
				);

				// 5. Show an information message upon successful unmarking.
				vscode.window.showInformationMessage(
					`Minovative Mind: Merge conflicts successfully cleared for '${relativePath}'.`
				);
				console.log(
					`[GitConflictResolutionService] Successfully unmarked '${relativePath}' as resolved.`
				);
				return true;
			} else {
				console.warn(
					`[GitConflictResolutionService] File ${relativePath} still contains merge conflict markers after AI modification. Cannot unmark.`
				);
				// 5. Show a warning message using vscode.window.showWarningMessage if conflicts persist.
				vscode.window.showWarningMessage(
					`Minovative Mind: Conflicts may still exist in '${relativePath}'. Please review manually.`
				);
				return false;
			}
		} catch (error: any) {
			// 5. Show an error message if an exception occurs.
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(
				`[GitConflictResolutionService] Error unmarking file ${relativePath} as resolved:`,
				error
			);
			vscode.window.showErrorMessage(
				`Minovative Mind: Failed to update Git conflict state for '${relativePath}': ${errorMessage}`
			);
			return false;
		}
	}
}

// src/extension.ts
import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar/SidebarProvider";
import { generateContent } from "./ai/gemini"; // Import generateContent
import { scanWorkspace } from "./context/workspaceScanner"; // Import context functions
import { buildContextString } from "./context/contextBuilder"; // Import context functions

export function activate(context: vscode.ExtensionContext) {
	console.log(
		'Congratulations, your extension "minovative-mind-vscode" is now active!'
	);

	// --- Sidebar Setup ---
	const sidebarProvider = new SidebarProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SidebarProvider.viewType,
			sidebarProvider
		)
	);

	// --- Register Modify Selection Command ---
	let modifySelectionDisposable = vscode.commands.registerCommand(
		"minovative-mind.modifySelection",
		async () => {
			// --- Command Logic ---
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage("No active editor found.");
				return;
			}

			const selection = editor.selection;
			if (selection.isEmpty) {
				vscode.window.showWarningMessage("No text selected.");
				return;
			}

			const selectedText = editor.document.getText(selection);
			const fullText = editor.document.getText(); // Get full document text
			const languageId = editor.document.languageId; // Get language for context

			// Get API Key from Sidebar Provider
			const activeApiKey = sidebarProvider.getActiveApiKey(); // Use the public method

			if (!activeApiKey) {
				vscode.window.showErrorMessage(
					"Minovative Mind: No active API Key set. Please configure it in the sidebar."
				);
				return;
			}

			// Get user instructions
			const instructions = await vscode.window.showInputBox({
				prompt: "Enter modification instructions for the selected code:",
				placeHolder: "e.g., add error handling, refactor to use async/await",
				title: "Minovative Mind: Modify Code",
			});

			if (!instructions) {
				vscode.window.showInformationMessage("Modification cancelled.");
				return;
			}

			// Show progress notification
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Minovative Mind: Modifying code...",
					cancellable: false, // Making this cancellable requires more complex API call management
				},
				async (progress) => {
					progress.report({ increment: 10, message: "Building context..." });

					// 1. Build Project Context (Optional but recommended)
					let projectContext = "[Context building skipped or failed]"; // Default
					try {
						const workspaceFolders = vscode.workspace.workspaceFolders;
						if (workspaceFolders && workspaceFolders.length > 0) {
							const rootFolder = workspaceFolders[0];
							const relevantFiles = await scanWorkspace({
								respectGitIgnore: true,
							});
							projectContext = await buildContextString(
								relevantFiles,
								rootFolder.uri
							);
							console.log(
								`Context built for modification (${projectContext.length} chars).`
							);
						} else {
							projectContext = "[No workspace open]";
						}
					} catch (err) {
						console.error("Failed to build context for modification:", err);
						// Proceed without context, but log the error
					}

					progress.report({ increment: 30, message: "Generating code..." });

					// 2. Construct Prompt
					const modificationPrompt = `
					You are an expert AI programmer assisting within VS Code. Your task is to modify a specific code selection based on user instructions.
					Provide ONLY the modified code block, without any explanations, commentary, or surrounding text like backticks. Also to add comments to the changed code to show the user why it was changed.
					Ensure the output is valid ${languageId} code.

					*** Project Context (Reference Only) ***
					${projectContext}
					*** End Project Context ***

					--- Full File Content (${editor.document.fileName}) ---
					\`\`\`${languageId}
					${fullText}
					\`\`\`
					--- End Full File Content ---

					--- Code Selection to Modify ---
					\`\`\`${languageId}
					${selectedText}
					\`\`\`
					--- End Code Selection to Modify ---

					--- User Instruction ---
					${instructions}
					--- End User Instruction ---

					Modified Code Block (only the modified selection):
					`;

					// --- DIAGNOSTIC LOG ---
					console.log("--- Sending Modification Prompt to Gemini ---");
					console.log(
						modificationPrompt.length > 1000
							? modificationPrompt.substring(0, 1000) +
									"... (prompt truncated in log)"
							: modificationPrompt
					);
					console.log("--- End Modification Prompt ---");

					// 3. Call Gemini API
					let modifiedCode = "";
					try {
						modifiedCode = await generateContent(
							activeApiKey,
							modificationPrompt
						);

						// Basic validation: check if response is empty or looks like an error message
						if (
							!modifiedCode ||
							modifiedCode.toLowerCase().startsWith("error:")
						) {
							throw new Error(modifiedCode || "Empty response from AI.");
						}

						// Attempt to remove potential markdown fences if the AI included them accidentally
						modifiedCode = modifiedCode
							.replace(/^```[a-z]*\n?/, "")
							.replace(/\n?```$/, "")
							.trim();
					} catch (error) {
						console.error("Error calling Gemini for modification:", error);
						vscode.window.showErrorMessage(
							`Minovative Mind: Failed to get modification - ${
								error instanceof Error ? error.message : String(error)
							}`
						);
						return; // Stop execution
					}

					progress.report({ increment: 50, message: "Applying changes..." });

					// 4. Apply Changes
					const edit = new vscode.WorkspaceEdit();
					edit.replace(editor.document.uri, selection, modifiedCode); // Replace the original selection
					const success = await vscode.workspace.applyEdit(edit);

					if (success) {
						vscode.window.showInformationMessage(
							"Minovative Mind: Code modified successfully."
						);
						// Optional: Format the document after applying changes
						vscode.commands.executeCommand("editor.action.formatDocument");
					} else {
						vscode.window.showErrorMessage(
							"Minovative Mind: Failed to apply modifications."
						);
					}

					progress.report({ increment: 100, message: "Done." });
				} // End progress task
			); // End withProgress
		} // End command async function
	); // End registerCommand

	context.subscriptions.push(modifySelectionDisposable); // Add to subscriptions
}

// This method is called when your extension is deactivated
export function deactivate() {}

// src/extension.ts
import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar/SidebarProvider";
import {
	generateContent,
	ERROR_QUOTA_EXCEEDED,
	resetClient,
} from "./ai/gemini"; // Import necessary items
// Removed: scanWorkspace - not directly used here
// Removed: buildContextString - not directly used here

// Helper function type definition for AI action results (kept for potential future use)
type ActionResult =
	| { success: true; content: string }
	| { success: false; error: string };

// --- Helper Function for Predefined Actions (Explain Action Only) ---
// This is now ONLY used for the 'explain' command directly.
async function executeExplainAction(
	sidebarProvider: SidebarProvider // Pass the provider instance
): Promise<ActionResult> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return { success: false, error: "No active editor found." };
	}
	const selection = editor.selection;
	if (selection.isEmpty) {
		return { success: false, error: "No text selected." };
	}

	const selectedText = editor.document.getText(selection);
	const fullText = editor.document.getText();
	const languageId = editor.document.languageId;
	const fileName = editor.document.fileName;

	const activeApiKey = sidebarProvider.getActiveApiKey();
	const selectedModel = sidebarProvider.getSelectedModelName();

	if (!activeApiKey) {
		return {
			success: false,
			error: "No active API Key set. Please configure it in the sidebar.",
		};
	}
	if (!selectedModel) {
		return {
			success: false,
			error: "No AI model selected. Please check the sidebar.",
		};
	}

	const userInstruction =
		"Explain the following code selection concisely. Focus on its purpose, functionality, and key components. Provide the explanation without using Markdown formatting at ALL.";
	const systemPrompt = `You are an expert AI programmer assisting within VS Code using the ${selectedModel} model. Analyze the provided code selection within the context of the full file. Language: ${languageId}. File: ${fileName}.`;

	const prompt = `
	${systemPrompt}

	--- Full File Content (${fileName}) ---
	\`\`\`${languageId}
	${fullText}
	\`\`\`
	--- End Full File Content ---

	--- Code Selection to Analyze ---
	\`\`\`${languageId}
	${selectedText}
	\`\`\`
	--- End Code Selection to Analyze ---

	--- User Instruction ---
	${userInstruction}
	--- End User Instruction ---

	Assistant Response:
`;

	console.log(
		`--- Sending explain Action Prompt (Model: ${selectedModel}) ---`
	);
	console.log(`--- End explain Action Prompt ---`);

	try {
		// Use the retry wrapper from the provider for consistency
		// MODIFICATION: Ensure arguments match the _generateWithRetry signature.
		// Pass undefined for history (4th arg) and cancellationToken (5th arg).
		// Pass "explain selection" for requestType (6th arg).
		const result = await sidebarProvider._generateWithRetry(
			prompt, // 1st arg: prompt
			activeApiKey, // 2nd arg: apiKey
			selectedModel, // 3rd arg: modelName
			undefined, // 4th arg: history (not needed for explain)
			undefined, // 5th arg: cancellationToken (not needed here)
			"explain selection" // 6th arg: requestType
		);

		if (
			!result ||
			result.toLowerCase().startsWith("error:") ||
			result === ERROR_QUOTA_EXCEEDED
		) {
			throw new Error(result || `Empty response from AI (${selectedModel}).`);
		}
		// Clean potential markdown code blocks from the explanation
		const cleanedResult = result
			.replace(/^```.*\n?/, "")
			.replace(/\n?```$/, "")
			.trim();
		return { success: true, content: cleanedResult };
	} catch (error) {
		console.error(`Error during explain action (${selectedModel}):`, error);
		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			error: `Failed to explain code: ${message}`,
		};
	}
}
// --- End Helper Function ---

// --- Activate Function ---
export async function activate(context: vscode.ExtensionContext) {
	console.log(
		'Congratulations, your extension "minovative-mind-vscode" is now active!'
	);

	// --- Sidebar Setup ---
	const sidebarProvider = new SidebarProvider(context.extensionUri, context);

	// --- Initialize Provider (Await Key & Settings Loading) ---
	await sidebarProvider.initialize(); // Ensure keys and settings are loaded before registering commands

	// Register the WebviewViewProvider AFTER initialization
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SidebarProvider.viewType,
			sidebarProvider
		)
	);

	// Modify Selection Command
	const modifySelectionDisposable = vscode.commands.registerCommand(
		"minovative-mind.modifySelection",
		async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage("No active editor found.");
				return;
			}

			// --- Capture Selection Range ---
			const selectionRange = editor.selection; // Get the full Range object
			if (selectionRange.isEmpty) {
				vscode.window.showWarningMessage("No text selected.");
				return;
			}
			// --- End Capture Selection Range ---

			const selectedText = editor.document.getText(selectionRange); // Use the range
			const fullText = editor.document.getText();
			const languageId = editor.document.languageId;
			const documentUri = editor.document.uri;

			const activeApiKey = sidebarProvider.getActiveApiKey();
			const selectedModel = sidebarProvider.getSelectedModelName();

			if (!activeApiKey) {
				vscode.window.showErrorMessage(
					"Minovative Mind: No active API Key set. Please add one via the sidebar."
				);
				return;
			}
			if (!selectedModel) {
				vscode.window.showErrorMessage(
					"Minovative Mind: No AI model selected. Please check the sidebar."
				);
				return;
			}

			const instructionsInput = await vscode.window.showInputBox({
				prompt: "Enter modification instructions, or use /fix or /docs:",
				placeHolder: "Type /fix, /docs or custom prompt",
				title: "Minovative Mind: Modify Code",
			});

			if (!instructionsInput) {
				vscode.window.showInformationMessage("Modification cancelled.");
				return;
			}

			const instruction = instructionsInput.trim();
			const instructionLower = instruction.toLowerCase();

			// --- BRANCHING LOGIC ---
			if (instructionLower === "/docs") {
				// --- Handle /docs directly (NO CHANGE HERE) ---
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: `Minovative Mind: Generating documentation (${selectedModel})...`,
						cancellable: false,
					},
					async (progress) => {
						progress.report({
							increment: 30,
							message: "Building docs prompt...",
						});
						const modificationPrompt = `
							You are an expert AI programmer tasked with generating documentation using the ${selectedModel} model.
							Language: ${languageId}
							File Context: ${editor.document.fileName}
							--- Full File Content (for context) ---
							\`\`\`${languageId}
							${fullText}
							\`\`\`
							--- End Full File Content ---
							--- Code Selection to Document ---
							\`\`\`${languageId}
							${selectedText}
							\`\`\`
							--- End Code Selection ---
							Instructions:
							1. Generate appropriate documentation (e.g., JSDoc, Python docstrings, comments based on language ${languageId}) for the provided code selection.
							2. Provide ONLY the documentation block followed immediately by the original code selection block on the next lines.
							3. Do not add any extra explanations, comments about the code, or markdown formatting around the result. The output should be suitable for directly replacing the original selection.

							Documentation Block + Original Code:
							`;

						progress.report({
							increment: 40,
							message: "Generating documentation...",
						});
						console.log(
							`--- Sending /docs Prompt (Model: ${selectedModel}) ---`
						);
						console.log("--- End Prompt ---");

						let responseContent = "";
						try {
							// Call _generateWithRetry for /docs
							responseContent = await sidebarProvider._generateWithRetry(
								modificationPrompt,
								activeApiKey,
								selectedModel,
								undefined, // No history needed
								undefined, // No cancellation token needed
								"/docs generation" // Request type
							);

							if (
								!responseContent ||
								responseContent.toLowerCase().startsWith("error:") ||
								responseContent === ERROR_QUOTA_EXCEEDED
							) {
								throw new Error(
									responseContent ||
										`Empty response from AI (${selectedModel}).`
								);
							}
							// Clean potential markdown
							responseContent = responseContent
								.replace(/^```[a-z]*\n?/, "")
								.replace(/\n?```$/, "")
								.trim();

							// Append original code if AI only returned docs
							const originalStart = selectedText
								.substring(0, Math.min(selectedText.length, 30))
								.trim();
							if (originalStart && !responseContent.includes(originalStart)) {
								console.warn(
									"AI might have only returned docs for /docs. Appending original code."
								);
								if (!responseContent.endsWith("\n")) {
									responseContent += "\n";
								}
								responseContent += selectedText;
							}
						} catch (error) {
							console.error(`Error during /docs (${selectedModel}):`, error);
							vscode.window.showErrorMessage(
								`Minovative Mind: Failed to get documentation - ${
									error instanceof Error ? error.message : String(error)
								}`
							);
							progress.report({ increment: 100, message: "Error occurred." });
							return;
						}

						progress.report({ increment: 90, message: "Applying changes..." });
						const edit = new vscode.WorkspaceEdit();
						// Use selectionRange here as well for consistency
						edit.replace(documentUri, selectionRange, responseContent);
						const success = await vscode.workspace.applyEdit(edit);

						if (success) {
							vscode.window.showInformationMessage(
								`Minovative Mind: Code documented successfully.`
							);
						} else {
							vscode.window.showErrorMessage(
								`Minovative Mind: Failed to apply documentation.`
							);
						}
						progress.report({ increment: 100, message: "Done." });
					}
				);
				// --- End /docs direct handling ---
			} else {
				// --- Handle /fix and custom instructions via Sidebar ---
				try {
					// Focus view
					await vscode.commands.executeCommand(
						"minovative-mind.activitybar.focus"
					);
					await new Promise((resolve) => setTimeout(resolve, 100)); // Short delay
					await vscode.commands.executeCommand(
						"minovativeMindSidebarView.focus"
					);

					vscode.window.setStatusBarMessage(
						`Minovative Mind: Processing '${instruction}' in sidebar...`,
						4000
					);

					// --- Call provider with the selection range ---
					await sidebarProvider.initiatePlanFromEditorAction(
						instruction,
						selectedText,
						fullText,
						languageId,
						documentUri,
						selectionRange // Pass the range
					);
					// --- End updated call ---
				} catch (error) {
					console.error("Error redirecting modification to sidebar:", error);
					vscode.window.showErrorMessage(
						"Minovative Mind: Could not process modification via sidebar. " +
							(error instanceof Error ? error.message : String(error))
					);
				}
				// --- End /fix and custom handling ---
			}
		}
	);
	context.subscriptions.push(modifySelectionDisposable);

	// Explain Selection Command (NO CHANGE HERE, logic moved to helper)
	const explainDisposable = vscode.commands.registerCommand(
		"minovative-mind.explainSelection",
		async () => {
			const selectedModel = sidebarProvider.getSelectedModelName();
			if (!selectedModel) {
				vscode.window.showErrorMessage(
					"Minovative Mind: No AI model selected. Please check the sidebar."
				);
				return;
			}

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Minovative Mind: Explaining (${selectedModel})...`,
					cancellable: false,
				},
				async (progress) => {
					progress.report({ increment: 20, message: "Preparing..." });
					// Use the dedicated helper function
					const result = await executeExplainAction(sidebarProvider);
					progress.report({
						increment: 80,
						message: result.success
							? "Processing result..."
							: "Handling error...",
					});

					if (result.success) {
						vscode.window.showInformationMessage(
							"Minovative Mind: Code Explanation",
							{
								modal: true, // Show in a modal dialog
								detail: result.content, // Use 'detail' for longer content
							}
						);
					} else {
						vscode.window.showErrorMessage(`Minovative Mind: ${result.error}`);
					}
					progress.report({ increment: 100, message: "Done." });
				}
			);
		}
	);
	context.subscriptions.push(explainDisposable);

	// Command to focus the activity bar container (NO CHANGE HERE)
	context.subscriptions.push(
		vscode.commands.registerCommand("minovative-mind.activitybar.focus", () => {
			vscode.commands.executeCommand(
				"workbench.view.extension.minovative-mind"
			);
		})
	);
} // End activate function

// --- Deactivate Function ---
export function deactivate() {
	/* // Commenting out welcomePanel disposal as the panel variable and creation logic are removed
	if (welcomePanel) {
		welcomePanel.dispose();
	}
	*/
	resetClient(); // Ensure client is reset on deactivation
	console.log("Minovative Mind extension deactivated.");
}

// Helper function (ensure it's defined if not imported)
/* // Commenting out getNonce as it was used for the welcome page webview CSP and is no longer needed
function getNonce() {
	let text = "";
	const possible =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
*/

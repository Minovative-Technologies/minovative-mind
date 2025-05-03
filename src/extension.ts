// src/extension.ts
import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar/SidebarProvider";
import { generateContent } from "./ai/gemini";
import { scanWorkspace } from "./context/workspaceScanner"; // Assuming you might use these later if modifying context building
import { buildContextString } from "./context/contextBuilder"; // Assuming you might use these later

// Helper function type definition for AI action results
type ActionResult =
	| { success: true; content: string }
	| { success: false; error: string };

// --- Helper Function for Predefined Actions ---
async function executePredefinedAction(
	actionType: "explain" | "generateDocs" | "findBugs",
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
	if (!activeApiKey) {
		return {
			success: false,
			error: "No active API Key set. Please configure it in the sidebar.",
		};
	}

	let userInstruction = "";
	let systemPrompt = `You are an expert AI programmer assisting within VS Code. Analyze the provided code selection within the context of the full file. Language: ${languageId}. File: ${fileName}.`;

	switch (actionType) {
		case "explain":
			userInstruction =
				"Explain the following code selection concisely. Focus on its purpose, functionality, and key components. Explain it in a concise way. Provide the explanation without using Markdown formatting at ALL";
			break;
	}

	// Construct the prompt for the AI
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

	console.log(`--- Sending ${actionType} Action Prompt ---`);
	// Consider logging a truncated prompt if it's very long
	// console.log(prompt.length > 1000 ? prompt.substring(0, 1000) + '...' : prompt);
	console.log(`--- End ${actionType} Action Prompt ---`);

	try {
		// Call the Gemini API
		const result = await generateContent(activeApiKey, prompt);

		// Validate and clean the result
		if (!result || result.toLowerCase().startsWith("error:")) {
			throw new Error(result || "Empty response from AI.");
		}
		const cleanedResult = result
			.replace(/^```.*\n?/, "")
			.replace(/\n?```$/, "")
			.trim();
		return { success: true, content: cleanedResult };
	} catch (error) {
		console.error(`Error during ${actionType} action:`, error);
		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			error: `Failed to ${actionType} code: ${message}`,
		};
	}
}
// --- End Helper Function ---

// --- Activate Function ---
export async function activate(context: vscode.ExtensionContext) {
	// <--- Make activate async
	console.log(
		'Congratulations, your extension "minovative-mind-vscode" is now active!'
	);

	// --- Sidebar Setup ---
	const sidebarProvider = new SidebarProvider(context.extensionUri, context);

	// --- Initialize Provider (Await Key Loading) ---
	await sidebarProvider.initialize(); // <--- Await the initialization

	// Register the WebviewViewProvider AFTER initialization (still good practice)
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SidebarProvider.viewType,
			sidebarProvider
		)
	);

	// --- Register Commands AFTER initialization ---

	// Modify Selection Command
	let modifySelectionDisposable = vscode.commands.registerCommand(
		"minovative-mind.modifySelection",
		async () => {
			// ... (Keep the existing implementation of the command handler)
			// It should now reliably get the key via sidebarProvider.getActiveApiKey()
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
			const fullText = editor.document.getText();
			const languageId = editor.document.languageId;
			const documentUri = editor.document.uri;

			const activeApiKey = sidebarProvider.getActiveApiKey();
			if (!activeApiKey) {
				// This message should now only appear if keys were truly not loaded or none exist
				vscode.window.showErrorMessage(
					"Minovative Mind: No active API Key set. Please add one via the sidebar."
				);
				return;
			}
			// ... rest of the command logic ...
			// Get user instructions OR shortcut
			const instructionsInput = await vscode.window.showInputBox({
				prompt: "Enter modification instructions, or use /fix or /docs:",
				placeHolder: "Type /fix, /docs or custom prompt",
				title: "Minovative Mind: Modify Code",
			});

			if (!instructionsInput) {
				vscode.window.showInformationMessage("Modification cancelled.");
				return;
			}

			const instruction = instructionsInput.trim(); // Use trimmed instruction

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Minovative Mind: Processing selection...", // Generic title
					cancellable: false,
				},
				async (progress) => {
					let modificationPrompt = "";
					let actionTitle = "Modifying code"; // Default progress title part

					// --- Check for Shortcuts ---
					if (instruction.toLowerCase() === "/fix") {
						// ... /fix logic ...
						actionTitle = "Attempting to fix code";
						progress.report({
							increment: 10,
							message: "Getting diagnostics...",
						});

						const diagnostics = vscode.languages.getDiagnostics(documentUri);
						const relevantDiagnostics = diagnostics.filter(
							(diag) =>
								!selection.isEmpty &&
								selection.intersection(diag.range) &&
								(diag.severity === vscode.DiagnosticSeverity.Error ||
									diag.severity === vscode.DiagnosticSeverity.Warning)
						);

						if (relevantDiagnostics.length === 0) {
							vscode.window.showInformationMessage(
								"Minovative Mind: No errors or warnings found in the selection to fix."
							);
							progress.report({ increment: 100, message: "No issues found." });
							return;
						}

						const diagnosticMessages = relevantDiagnostics
							.map(
								(d) =>
									`- ${vscode.DiagnosticSeverity[d.severity]} at line ${
										d.range.start.line + 1
									}: ${d.message} (Selected text: "${editor.document.getText(
										d.range
									)}")` // Added selected text for context
							)
							.join("\n");

						progress.report({
							increment: 20,
							message: "Building fix prompt...",
						});

						// ***** MODIFIED PROMPT for /fix *****
						modificationPrompt = `
						You are an expert AI programmer specializing in fixing code errors based on diagnostics. Your task is to rewrite the ENTIRE file content, correcting the issues reported within the original selection area.

						Language: ${languageId}
						File Context: ${editor.document.fileName}

						--- Original File Content ---
						\`\`\`${languageId}
						${fullText}
						\`\`\`
						--- End Original File Content ---

						--- Original User Selection with Issues ---
						\`\`\`${languageId}
						${selectedText}
						\`\`\`
						--- End Original User Selection ---

						--- Reported Diagnostics in Selection Area ---
						${diagnosticMessages}
						--- End Reported Diagnostics ---

						Instructions:
						1. Analyze the **entire original file content** and the specific diagnostics reported within the selection area.
						2. Identify the root causes (e.g., missing imports, typos, logic errors, undeclared variables).
						3. **Rewrite and provide the ENTIRE corrected file content.** Ensure fixes like imports are placed correctly (e.g., at the top).
						4. **Provide ONLY the raw, complete, corrected file content.** Do not include explanations, apologies, comments about the changes, or markdown formatting like \`\`\` around the code. The output must be the final, complete file content.
						5. Maintain the overall structure and logic of the original file, only making necessary corrections to address the diagnostics and ensure code validity.

						Complete Corrected File Content:
						`;
						// ***** END MODIFIED PROMPT for /fix *****
					} else if (instruction.toLowerCase() === "/docs") {
						// ... /docs logic ...
						actionTitle = "Generating documentation";
						progress.report({
							increment: 30,
							message: "Building docs prompt...",
						});
						modificationPrompt = `
						You are an expert AI programmer tasked with generating documentation.
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
					} else {
						// ... custom modification logic ...
						actionTitle = "Applying custom modification";
						progress.report({ increment: 10, message: "Building context..." });
						let projectContext = "[Context building skipped or failed]";
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
							} else {
								projectContext = "[No workspace open]";
							}
						} catch (err) {
							console.error("Failed to build context for modification:", err);
						}
						progress.report({
							increment: 20,
							message: "Building modification prompt...",
						});
						modificationPrompt = `
						You are an expert AI programmer assisting within VS Code. Your task is to modify a specific code selection based on user instructions.
						Provide ONLY the modified code block, without any explanations, commentary, or surrounding text like backticks. If appropriate, add comments to the changed code sections briefly explaining the 'why'.
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
						${instruction}
						--- End User Instruction ---
						Modified Code Block (only the modified selection):
						`;
					}

					// --- Execute AI Call and Apply Edit (Common Logic - WITH MODIFICATION FOR /fix) ---
					progress.report({ increment: 40, message: `${actionTitle}...` });
					console.log(`--- Sending ${actionTitle} Prompt ---`);
					// console.log(modificationPrompt.substring(0, 1000) + "...");
					console.log("--- End Prompt ---");

					let responseContent = ""; // Use a different name to avoid confusion
					try {
						responseContent = await generateContent(
							activeApiKey,
							modificationPrompt
						);

						if (
							!responseContent ||
							responseContent.toLowerCase().startsWith("error:")
						) {
							throw new Error(responseContent || "Empty response from AI.");
						}

						// Clean potential markdown fences from the response
						responseContent = responseContent
							.replace(/^```[a-z]*\n?/, "")
							.replace(/\n?```$/, "")
							.trim();

						// Special handling for /docs (keep existing)
						if (
							instruction.toLowerCase() === "/docs" &&
							!responseContent.includes(
								selectedText.substring(0, Math.min(selectedText.length, 30))
							)
						) {
							console.warn(
								"AI might have only returned docs for /docs. Appending original code."
							);
							if (!responseContent.endsWith("\n")) {
								responseContent += "\n";
							}
							responseContent += selectedText;
						}
					} catch (error) {
						console.error(`Error during ${actionTitle}:`, error);
						vscode.window.showErrorMessage(
							`Minovative Mind: Failed to get modification - ${
								error instanceof Error ? error.message : String(error)
							}`
						);
						progress.report({ increment: 100, message: "Error occurred." });
						return; // Stop execution
					}

					progress.report({ increment: 90, message: "Applying changes..." });

					const edit = new vscode.WorkspaceEdit();

					// ***** MODIFIED EDIT LOGIC *****
					if (instruction.toLowerCase() === "/fix") {
						// For /fix, replace the ENTIRE document content
						const wholeDocumentRange = new vscode.Range(
							editor.document.positionAt(0),
							editor.document.positionAt(fullText.length)
						);
						edit.replace(documentUri, wholeDocumentRange, responseContent);
						console.log("Applying full document replacement for /fix.");
					} else {
						// For /docs and custom modifications, replace only the selection
						edit.replace(documentUri, selection, responseContent);
						console.log(
							"Applying selection replacement for /docs or custom instruction."
						);
					}
					// ***** END MODIFIED EDIT LOGIC *****

					const success = await vscode.workspace.applyEdit(edit);

					if (success) {
						vscode.window.showInformationMessage(
							`Minovative Mind: Code ${
								instruction === "/fix"
									? "fixed"
									: instruction === "/docs"
									? "documented"
									: "modified"
							} successfully.`
						);
						// Optional: Format the document after applying the full change for /fix
						if (instruction.toLowerCase() === "/fix") {
							// Attempt to format, handle potential errors gracefully
							try {
								await vscode.commands.executeCommand(
									"editor.action.formatDocument"
								);
							} catch (formatError) {
								console.warn(
									"Could not format document after fix:",
									formatError
								);
							}
						}
					} else {
						vscode.window.showErrorMessage(
							`Minovative Mind: Failed to apply ${
								instruction === "/fix"
									? "fix"
									: instruction === "/docs"
									? "documentation"
									: "modifications"
							}.`
						);
					}

					progress.report({ increment: 100, message: "Done." });
				} // End progress task
			); // End withProgress
		}
	);
	context.subscriptions.push(modifySelectionDisposable);

	// Explain Selection Command
	const explainDisposable = vscode.commands.registerCommand(
		"minovative-mind.explainSelection",
		async () => {
			// ... (Keep the existing implementation)
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Minovative Mind: Explaining code...",
					cancellable: false,
				},
				async (progress) => {
					progress.report({ increment: 20, message: "Preparing..." });
					// Call the helper which now requests Markdown
					const result = await executePredefinedAction(
						"explain",
						sidebarProvider // Pass the provider instance
					);
					progress.report({
						increment: 80,
						message: result.success
							? "Processing result..."
							: "Handling error...",
					});

					if (result.success) {
						// Display the Markdown-formatted result in the detail section of a modal popup
						vscode.window.showInformationMessage(
							"Minovative Mind: Code Explanation", // Main title
							{
								modal: true,
								detail: result.content, // The AI's Markdown response goes here
							}
						);
					} else {
						vscode.window.showErrorMessage(`Minovative Mind: ${result.error}`);
					}
				}
			);
		}
	);
	context.subscriptions.push(explainDisposable);
} // End activate function

// --- Deactivate Function ---
export function deactivate() {
	// Potential cleanup tasks if needed in the future
	console.log("Minovative Mind extension deactivated.");
}

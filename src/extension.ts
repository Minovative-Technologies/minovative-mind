// src/extension.ts
import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar/SidebarProvider";
import { generateContent } from "./ai/gemini";
import { scanWorkspace } from "./context/workspaceScanner";
import { buildContextString } from "./context/contextBuilder";

// Helper function type definition for AI action results
type ActionResult =
	| { success: true; content: string }
	| { success: false; error: string };

// --- Helper Function for Predefined Actions ---
async function executePredefinedAction(
	actionType: "explain", // Currently only 'explain' uses this specific helper format
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

	// --- Get Active Key and Selected Model ---
	const activeApiKey = sidebarProvider.getActiveApiKey();
	const selectedModel = sidebarProvider.getSelectedModelName(); // Get selected model

	if (!activeApiKey) {
		return {
			success: false,
			error: "No active API Key set. Please configure it in the sidebar.",
		};
	}
	if (!selectedModel) {
		// This case should technically not happen if initialization is correct
		return {
			success: false,
			error: "No AI model selected. Please check the sidebar.",
		};
	}

	let userInstruction = "";
	let systemPrompt = `You are an expert AI programmer assisting within VS Code using the ${selectedModel} model. Analyze the provided code selection within the context of the full file. Language: ${languageId}. File: ${fileName}.`;

	switch (actionType) {
		case "explain":
			userInstruction =
				"Explain the following code selection concisely. Focus on its purpose, functionality, and key components. Provide the explanation without using Markdown formatting at ALL.";
			break;
		// Add cases for other predefined actions if needed (e.g., generateDocs, findBugs)
		// Ensure they also use `selectedModel` when constructing prompts or calling AI.
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

	console.log(
		`--- Sending ${actionType} Action Prompt (Model: ${selectedModel}) ---`
	);
	// console.log(prompt.length > 1000 ? prompt.substring(0, 1000) + '...' : prompt);
	console.log(`--- End ${actionType} Action Prompt ---`);

	try {
		// Call the Gemini API with the selected model
		const result = await generateContent(activeApiKey, selectedModel, prompt); // <-- Pass selectedModel

		// Validate and clean the result
		if (!result || result.toLowerCase().startsWith("error:")) {
			throw new Error(result || `Empty response from AI (${selectedModel}).`);
		}
		// Basic cleaning (remove potential markdown fences if AI adds them despite instructions)
		const cleanedResult = result
			.replace(/^```.*\n?/, "")
			.replace(/\n?```$/, "")
			.trim();
		return { success: true, content: cleanedResult };
	} catch (error) {
		console.error(
			`Error during ${actionType} action (${selectedModel}):`,
			error
		);
		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			error: `Failed to ${actionType} code: ${message}`,
		};
	}
}
// --- End Helper Function ---

// --- Simple Markdown to HTML Converter ---
// Basic conversion, consider a library like 'markdown-it' for more complex needs
// --- Enhanced Markdown to HTML Converter ---
function markdownToHtml(md: string): string {
	let html = md;

	// Block elements first (order matters)

	// Code blocks (```lang\n...\n```) - Escape HTML inside
	html = html.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
		const escapedCode = code
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
		return `<pre><code class="language-${
			lang || "plaintext"
		}">${escapedCode.trim()}</code></pre>`;
	});

	// Blockquotes (>)
	html = html.replace(/^> (.*$)/gim, "<blockquote>$1</blockquote>");
	// Collapse consecutive blockquotes
	html = html.replace(
		/<\/blockquote>\s*<blockquote>/g,
		"<br>" // Or just "" if you want them merged tightly
	);

	// Headings (H1-H3)
	html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
	html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
	html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

	// Horizontal Rules (---, ***, ___)
	html = html.replace(/^\s*(?:---|\*\*\*|___)\s*$/gm, "<hr>");

	// Lists (Unordered and Ordered)
	// Unordered list items (*, -, +)
	html = html.replace(/^[ \t]*[\*\-\+] +(.*$)/gim, "<li>$1</li>");
	// Ordered list items (1., 2.)
	html = html.replace(/^[ \t]*\d+\. +(.*$)/gim, "<li>$1</li>"); // Use <li> for both, wrap later

	// Wrap consecutive <li> elements in <ul> or <ol> - This is tricky with regex, doing a simpler wrap
	// Find blocks of <li> tags possibly separated by whitespace/newlines
	html = html.replace(/(?:<li>.*<\/li>\s*)+/g, (match) => {
		// Basic check: if the *first* list item in the match started with a number, assume <ol>
		// This isn't perfect but works for simple lists.
		if (/^\s*<li.*?>\d+\./.test(match.replace(/<.*?>/g, ""))) {
			// Simple check on original text structure if possible, otherwise default to ul
			// A better parser would track the original line format.
			// For controlled welcome.md, might be okay, but fragile. Let's default to <ul> for simplicity here.
			// return `<ol>${match.replace(/^\s+/, '').replace(/\s+$/, '')}</ol>`; // More robust would need lookbehind/state
			return `<ul>${match.trim()}</ul>`; // Defaulting to UL for simplicity/safety with regex
		} else {
			return `<ul>${match.trim()}</ul>`;
		}
	});
	// A more robust approach might involve splitting lines and processing statefully.

	// Inline elements

	// Links ([text](url))
	html = html.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		'<a href="$2" title="$1">$1</a>'
	);

	// Images (![alt](url)) - Basic, no resizing etc.
	// Ensure CSP allows images if used: `img-src ${webview.cspSource} https: data:;`
	// html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

	// Bold (**text**)
	html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
	// Italic (*text* or _text_)
	html = html.replace(
		/([^*]|^)\*(?!\s)(.*?)(?<!\s)\*([^*]|$)/g,
		"$1<em>$2</em>$3"
	); // Avoid ** and spaces
	html = html.replace(
		/(^|[^_])_(?!\s)(.*?)(?<!\s)_([^_]|$)/g,
		"$1<em>$2</em>$3"
	); // Avoid __ and spaces

	// Inline code (`text`) - Escape HTML inside
	html = html.replace(/`([^`]+)`/g, (match, code) => {
		const escapedCode = code
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
		return `<code>${escapedCode}</code>`;
	});

	// Paragraphs (handle line breaks - needs refinement for true paragraphs)
	// Wrap remaining lines (not part of other blocks) in <p> tags
	// This is complex with regex alone. A simple approach: wrap blocks separated by double newlines.
	// Remove leading/trailing whitespace from the whole string first
	html = html.trim();
	// Split into paragraphs based on double newlines, then wrap non-block elements
	html = html
		.split(/\n\s*\n/) // Split by one or more empty lines
		.map((paragraph) => {
			// Trim each paragraph
			const trimmedParagraph = paragraph.trim();
			// Check if it's already a block element (heuristic)
			if (
				trimmedParagraph.startsWith("<h") ||
				trimmedParagraph.startsWith("<ul") ||
				trimmedParagraph.startsWith("<ol") ||
				trimmedParagraph.startsWith("<li") || // Should be wrapped already, but check
				trimmedParagraph.startsWith("<block") ||
				trimmedParagraph.startsWith("<p") || // Avoid double wrapping
				trimmedParagraph.startsWith("<hr") ||
				trimmedParagraph.startsWith("<pre")
			) {
				return trimmedParagraph; // Return as is
			} else if (trimmedParagraph) {
				// If it's not empty and not a known block, wrap in <p> and handle single newlines as <br>
				return `<p>${trimmedParagraph.replace(/\n/g, "<br>")}</p>`;
			}
			return ""; // Remove empty paragraphs
		})
		.join("\n\n"); // Re-join paragraphs (browser collapses whitespace)

	// Final cleanup: Remove potentially introduced <br> inside <p> tags right before block elements if list wrapping was imperfect
	html = html.replace(/<br>\s*(<\/?(ul|ol|li|h\d|blockquote|hr|pre))/gi, "$1");
	// Remove <br> at the very end of a <p> tag
	html = html.replace(/<br>\s*<\/p>/gi, "</p>");

	return html;
}

// Reference to the welcome panel to prevent duplicates (optional)
let welcomePanel: vscode.WebviewPanel | undefined = undefined;

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

	// --- Register Commands AFTER initialization ---

	// --- Welcome Page Command ---
	const showWelcomeDisposable = vscode.commands.registerCommand(
		"minovative-mind.showWelcomePage",
		async () => {
			const columnToShowIn = vscode.window.activeTextEditor
				? vscode.window.activeTextEditor.viewColumn
				: undefined;

			if (welcomePanel) {
				welcomePanel.reveal(columnToShowIn);
				return;
			}

			welcomePanel = vscode.window.createWebviewPanel(
				"minovativeMindWelcome",
				"Welcome to Minovative Mind",
				columnToShowIn || vscode.ViewColumn.One,
				{
					enableScripts: false,
					localResourceRoots: [
						vscode.Uri.joinPath(context.extensionUri, "resources"),
						vscode.Uri.joinPath(context.extensionUri, "media"),
					],
				}
			);

			welcomePanel.onDidDispose(
				() => {
					welcomePanel = undefined;
				},
				null,
				context.subscriptions
			);

			const welcomeFilePath = vscode.Uri.joinPath(
				context.extensionUri,
				"src",
				"resources",
				"welcome.md"
			);

			let htmlContent = "<p>Error loading welcome content.</p>";
			try {
				const markdownContent = await vscode.workspace.fs.readFile(
					welcomeFilePath
				);
				const mdString = Buffer.from(markdownContent).toString("utf-8");
				const bodyHtml = markdownToHtml(mdString); // Use the enhanced function
				const stylesUri = welcomePanel.webview.asWebviewUri(
					vscode.Uri.joinPath(context.extensionUri, "resources", "welcome.css")
				);
				const logoUri = welcomePanel.webview.asWebviewUri(
					vscode.Uri.joinPath(
						context.extensionUri,
						"media",
						"minovative-logo-192x192.png"
					)
				);

				htmlContent = `<!DOCTYPE html>
							<html lang="en">
							<head>
									<meta charset="UTF-8">
									<meta name="viewport" content="width=device-width, initial-scale=1.0">
									<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${welcomePanel.webview.cspSource}; img-src ${welcomePanel.webview.cspSource} https: data:;">
									<link rel="stylesheet" type="text/css" href="${stylesUri}">
									<title>Welcome to Minovative Mind</title>
							</head>
							<body>
									<img src="${logoUri}" alt="Minovative Mind Logo" width="64" style="float: right; margin: 10px;">
									${bodyHtml}
							</body>
							</html>`;
			} catch (err) {
				console.error("Error reading or processing welcome file:", err);
				vscode.window.showErrorMessage(
					"Minovative Mind: Could not load welcome guide."
				);
			}

			welcomePanel.webview.html = htmlContent;
		}
	);
	context.subscriptions.push(showWelcomeDisposable);
	// --- END: Welcome Page Command ---

	// Modify Selection Command
	let modifySelectionDisposable = vscode.commands.registerCommand(
		"minovative-mind.modifySelection",
		async () => {
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

			// --- Get Active Key and Selected Model ---
			const activeApiKey = sidebarProvider.getActiveApiKey();
			const selectedModel = sidebarProvider.getSelectedModelName(); // Get selected model

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

			const instruction = instructionsInput.trim();

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Minovative Mind: Processing (${selectedModel})...`, // Show model in title
					cancellable: false,
				},
				async (progress) => {
					let modificationPrompt = "";
					let actionTitle = "Modifying code";

					// --- Check for Shortcuts ---
					if (instruction.toLowerCase() === "/fix") {
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
									)}")`
							)
							.join("\n");

						progress.report({
							increment: 20,
							message: "Building fix prompt...",
						});

						// ***** MODIFIED PROMPT for /fix *****
						modificationPrompt = `
						You are an expert AI programmer specializing in fixing code errors based on diagnostics using the ${selectedModel} model. Your task is to rewrite the ENTIRE file content, correcting the issues reported within the original selection area.

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
						actionTitle = "Generating documentation";
						progress.report({
							increment: 30,
							message: "Building docs prompt...",
						});
						// ***** MODIFIED PROMPT for /docs *****
						modificationPrompt = `
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
						// ***** END MODIFIED PROMPT for /docs *****
					} else {
						actionTitle = "Applying custom modification";
						progress.report({ increment: 10, message: "Building context..." });
						let projectContext = "[Context building skipped or failed]";
						try {
							const workspaceFolders = vscode.workspace.workspaceFolders;
							if (workspaceFolders && workspaceFolders.length > 0) {
								const rootFolder = workspaceFolders[0];
								// Pass options if needed, e.g., respectGitIgnore: true
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
							// Don't block modification, just proceed without context
							projectContext = "[Error building context]";
						}

						progress.report({
							increment: 20,
							message: "Building modification prompt...",
						});
						// ***** MODIFIED PROMPT for custom modification *****
						modificationPrompt = `
						You are an expert AI programmer assisting within VS Code using the ${selectedModel} model. Your task is to modify a specific code selection based on user instructions.
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
						// ***** END MODIFIED PROMPT for custom modification *****
					}

					// --- Execute AI Call and Apply Edit (Common Logic - WITH MODIFICATION FOR /fix) ---
					progress.report({ increment: 40, message: `${actionTitle}...` });
					console.log(
						`--- Sending ${actionTitle} Prompt (Model: ${selectedModel}) ---`
					);
					// console.log(modificationPrompt.substring(0, 1000) + "..."); // Optional: Log truncated prompt
					console.log("--- End Prompt ---");

					let responseContent = ""; // Use a different name to avoid confusion
					try {
						// Call generateContent with the selected model
						responseContent = await generateContent(
							activeApiKey,
							selectedModel, // <-- Pass selectedModel
							modificationPrompt
						);

						if (
							!responseContent ||
							responseContent.toLowerCase().startsWith("error:")
						) {
							throw new Error(
								responseContent || `Empty response from AI (${selectedModel}).`
							);
						}

						// Clean potential markdown fences from the response
						responseContent = responseContent
							.replace(/^```[a-z]*\n?/, "")
							.replace(/\n?```$/, "")
							.trim();

						// Special handling for /docs (append original code if AI only returned docs)
						if (instruction.toLowerCase() === "/docs") {
							// Heuristic: check if the original code start is missing from the response
							const originalStart = selectedText
								.substring(0, Math.min(selectedText.length, 30))
								.trim();
							if (originalStart && !responseContent.includes(originalStart)) {
								console.warn(
									"AI might have only returned docs for /docs. Appending original code."
								);
								if (!responseContent.endsWith("\n")) {
									responseContent += "\n"; // Ensure newline separation
								}
								responseContent += selectedText; // Append original selection
							}
						}
					} catch (error) {
						console.error(
							`Error during ${actionTitle} (${selectedModel}):`,
							error
						);
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
						const document = await vscode.workspace.openTextDocument(
							documentUri
						); // Ensure we have the latest doc state
						const wholeDocumentRange = new vscode.Range(
							document.positionAt(0),
							document.positionAt(document.getText().length)
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
							try {
								await vscode.commands.executeCommand(
									"editor.action.formatDocument"
								);
							} catch (formatError) {
								console.warn(
									"Could not auto-format document after fix:",
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
			// --- Get Selected Model ---
			const selectedModel = sidebarProvider.getSelectedModelName();
			if (!selectedModel) {
				vscode.window.showErrorMessage(
					"Minovative Mind: No AI model selected. Please check the sidebar."
				);
				return;
			}
			// --- End Get Selected Model ---

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Minovative Mind: Explaining (${selectedModel})...`, // Show model
					cancellable: false,
				},
				async (progress) => {
					progress.report({ increment: 20, message: "Preparing..." });
					// Call the helper, which now uses the selected model internally
					const result = await executePredefinedAction(
						"explain",
						sidebarProvider // Pass provider instance
					);
					progress.report({
						increment: 80,
						message: result.success
							? "Processing result..."
							: "Handling error...",
					});

					if (result.success) {
						// Display the result (without assuming Markdown, as per the prompt)
						vscode.window.showInformationMessage(
							"Minovative Mind: Code Explanation",
							{
								modal: true,
								detail: result.content, // Display the plain text explanation
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
} // End activate function

// --- Deactivate Function ---
export function deactivate() {
	// Potential cleanup tasks if needed in the future
	console.log("Minovative Mind extension deactivated.");
}

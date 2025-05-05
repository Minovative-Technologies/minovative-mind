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
		// Use the retry wrapper from the provider for consistency, though less likely needed here
		const result = await sidebarProvider._generateWithRetry(
			prompt, // Direct prompt, no history needed for explain
			activeApiKey,
			selectedModel,
			undefined, // No history context needed for explain
			"explain selection"
		);

		if (
			!result ||
			result.toLowerCase().startsWith("error:") ||
			result === ERROR_QUOTA_EXCEEDED
		) {
			throw new Error(result || `Empty response from AI (${selectedModel}).`);
		}
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

// --- Simple Markdown to HTML Converter ---
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

	// Wrap consecutive <li> elements in <ul> or <ol> - Simple wrap
	html = html.replace(/(?:<li>.*<\/li>\s*)+/g, (match) => {
		return `<ul>${match.trim()}</ul>`;
	});

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

	// Paragraphs (handle line breaks)
	html = html.trim();
	html = html
		.split(/\n\s*\n/)
		.map((paragraph) => {
			const trimmedParagraph = paragraph.trim();
			if (
				trimmedParagraph.startsWith("<h") ||
				trimmedParagraph.startsWith("<ul") ||
				trimmedParagraph.startsWith("<ol") ||
				trimmedParagraph.startsWith("<li") ||
				trimmedParagraph.startsWith("<block") ||
				trimmedParagraph.startsWith("<p") ||
				trimmedParagraph.startsWith("<hr") ||
				trimmedParagraph.startsWith("<pre")
			) {
				return trimmedParagraph;
			} else if (trimmedParagraph) {
				return `<p>${trimmedParagraph.replace(/\n/g, "<br>")}</p>`;
			}
			return "";
		})
		.join("\n\n");

	// Final cleanup
	html = html.replace(/<br>\s*(<\/?(ul|ol|li|h\d|blockquote|hr|pre))/gi, "$1");
	html = html.replace(/<br>\s*<\/p>/gi, "</p>");

	return html;
}

// Reference to the welcome panel
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
					enableScripts: false, // Keep scripts disabled for welcome page
					localResourceRoots: [
						vscode.Uri.joinPath(context.extensionUri, "src", "resources"),
						vscode.Uri.joinPath(context.extensionUri, "media"), // Allow media folder
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
			const stylesUri = welcomePanel.webview.asWebviewUri(
				vscode.Uri.joinPath(
					context.extensionUri,
					"src",
					"resources",
					"welcome.css"
				)
			);
			const nonce = getNonce(); // Use nonce if needed for inline styles/scripts later

			let htmlContent = "<p>Error loading welcome content.</p>";
			try {
				const markdownContent = await vscode.workspace.fs.readFile(
					welcomeFilePath
				);
				const mdString = Buffer.from(markdownContent).toString("utf-8");
				const bodyHtml = markdownToHtml(mdString); // Use the enhanced function

				htmlContent = `<!DOCTYPE html>
						<html lang="en">
						<head>
								<meta charset="UTF-8">
								<meta name="viewport" content="width=device-width, initial-scale=1.0">
								<meta http-equiv="Content-Security-Policy" content="
										default-src 'none';
										style-src ${welcomePanel.webview.cspSource};
										img-src ${welcomePanel.webview.cspSource} https: data:;
										font-src ${welcomePanel.webview.cspSource};
								">
								<link rel="stylesheet" type="text/css" href="${stylesUri}">
								<title>Welcome to Minovative Mind</title>
						</head>
						<body>
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
							responseContent = await sidebarProvider._generateWithRetry(
								modificationPrompt,
								activeApiKey,
								selectedModel,
								undefined,
								"/docs generation"
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
					await new Promise((resolve) => setTimeout(resolve, 100));
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

	// Explain Selection Command (NO CHANGE HERE)
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
					const result = await executeExplainAction(sidebarProvider); // Use the dedicated helper
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
								modal: true,
								detail: result.content,
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
	if (welcomePanel) {
		welcomePanel.dispose();
	}
	resetClient(); // Ensure client is reset on deactivation
	console.log("Minovative Mind extension deactivated.");
}

// Helper function (ensure it's defined if not imported)
function getNonce() {
	let text = "";
	const possible =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

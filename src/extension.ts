// src/extension.ts
import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar/SidebarProvider";
import { ERROR_QUOTA_EXCEEDED, resetClient } from "./ai/gemini"; // Import necessary items
import { cleanCodeOutput } from "./utils/codeUtils";
import * as sidebarTypes from "./sidebar/common/sidebarTypes";
import { hasMergeConflicts, getMergeConflictRanges } from "./utils/mergeUtils"; // Added import for mergeUtils
import { CodeSelectionService } from "./services/codeSelectionService";
import { getSymbolsInDocument } from "./services/symbolService";
// Import FormatDiagnosticsOptions type here
import {
	DiagnosticService,
	FormatDiagnosticsOptions,
} from "./utils/diagnosticUtils";
import { DEFAULT_FLASH_LITE_MODEL } from "./sidebar/common/sidebarConstants";

// Helper function type definition for AI action results (kept for potential future use)
type ActionResult =
	| { success: true; content: string }
	| { success: false; error: string };

// Add a small helper function for delays
async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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

	const activeApiKey = sidebarProvider.apiKeyManager.getActiveApiKey(); // Still needed for initial check
	const selectedModel = DEFAULT_FLASH_LITE_MODEL; // Use default model for explain action

	if (!activeApiKey) {
		// Keep this check as it's user-facing before the call
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
		"Explain the following code selection concisely and in detail as possible. Focus on its purpose, functionality, and key components. Provide the explanation in plain text.";
	const systemPrompt = `You are the expert software engineer for me, analyzing the provided code selection within the context of the full file. Language: ${languageId}. File: ${fileName}.`;

	const prompt = `
	-- System Prompt --
	${systemPrompt}
	-- End System Prompt --

	--- Full File Content (${fileName}) ---
	\`\`\`${languageId}
	${fullText}
	\`\`\`
	--- End Full File Content ---

	--- Code Selection to Analyze ---
	\`\`\`${languageId}
	${selectedText}
	\`\`\`
	--- End Code Selection ---

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
		// Removed activeApiKey (second argument) from the call
		// Signature: _generateWithRetry(prompt, modelName, history, requestType)
		const result = await sidebarProvider.aiRequestService.generateWithRetry(
			[{ text: prompt }], // 1st arg: prompt
			// activeApiKey, // Removed 2nd arg: apiKey
			selectedModel, // Now 2nd arg: modelName (was 3rd)
			undefined, // Now 3rd arg: history (not needed for explain) (was 4th)
			"explain selection" // Now 4th arg: requestType (was 5th)
		);

		if (
			!result ||
			result.toLowerCase().startsWith("error:") ||
			result === ERROR_QUOTA_EXCEEDED
		) {
			throw new Error(result || `Empty response from AI (${selectedModel}).`);
		}
		// Clean potential markdown code blocks from the explanation
		const cleanedResult = cleanCodeOutput(result);
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

// --- Helper Function for Diagnostics Formatting ---
// --- End Helper Function ---

// --- Activate Function ---
export async function activate(context: vscode.ExtensionContext) {
	console.log(
		'Congratulations, your extension "minovative-mind-vscode" is now active!'
	);

	// --- Sidebar Setup ---
	let workspaceRootUri: vscode.Uri | undefined;
	if (
		vscode.workspace.workspaceFolders &&
		vscode.workspace.workspaceFolders.length > 0
	) {
		workspaceRootUri = vscode.workspace.workspaceFolders[0].uri;
	} else {
		// Handle case with no open folder, though /merge implies a Git repo.
		// For robustness, provide a fallback.
		workspaceRootUri = undefined;
	}
	const sidebarProvider = new SidebarProvider(
		context.extensionUri,
		context,
		workspaceRootUri
	);

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

			// 1. Initialize Context Variables:
			const originalSelection: vscode.Selection = editor.selection;
			const fullText = editor.document.getText();
			const languageId = editor.document.languageId;
			const documentUri = editor.document.uri;
			const fileName = editor.document.fileName;
			const cursorPosition = editor.selection.active;

			const allDiagnostics =
				DiagnosticService.getDiagnosticsForUri(documentUri);
			const symbols = await getSymbolsInDocument(documentUri);

			let selectedText: string = "";
			let effectiveRange: vscode.Range = originalSelection;
			let diagnosticsString: string | undefined = undefined;
			let mergeConflictString: string | undefined = undefined;
			let userProvidedMessage: string | undefined = undefined;
			let instruction: string | undefined;
			let composedMessage: string;

			// Determine display file name relative to workspace root
			let displayFileName: string = fileName;
			if (
				vscode.workspace.workspaceFolders &&
				vscode.workspace.workspaceFolders.length > 0
			) {
				const relativePath = vscode.workspace.asRelativePath(fileName);
				if (relativePath !== fileName) {
					displayFileName = relativePath;
				}
			}

			// 2. Implement Action Selection:
			const quickPickItems: vscode.QuickPickItem[] = [
				{
					label: "/fix",
					description: "Fix bugs",
				},
				{
					label: "/merge",
					description: "Resolve merge conflicts",
				},
				{
					label: "chat",
					description: "General conversations",
				},
				{
					label: "custom prompt",
					description:
						"Custom instructions (e.g., refactor, optimize, fix, etc.)",
				},
			];

			const selectedCommand = await vscode.window.showQuickPick(
				quickPickItems,
				{
					placeHolder: "Select a command or type a custom prompt...",
					title: "Minovative Mind: Modify Code",
				}
			);

			if (!selectedCommand) {
				return; // User cancelled QuickPick
			}

			instruction = selectedCommand.label.trim();

			// 3. Implement User Input Gathering:
			if (instruction === "custom prompt" || instruction === "chat") {
				const promptMessage =
					instruction === "custom prompt"
						? "Enter your custom instruction:"
						: "Enter your message for the AI:";
				const placeHolderMessage =
					instruction === "custom prompt"
						? "e.g., refactor this function to be more concise"
						: "e.g., Explain this function, or refactor it for performance";

				const input = await vscode.window.showInputBox({
					prompt: promptMessage,
					placeHolder: placeHolderMessage,
					title: `Minovative Mind: ${
						instruction === "custom prompt" ? "Custom Prompt" : "Chat with Code"
					}`,
				});

				if (input === undefined) {
					return; // User cancelled input box
				}
				userProvidedMessage = input.trim();
				if (userProvidedMessage.length === 0) {
					vscode.window.showInformationMessage(
						"Modification cancelled. No instruction/message provided."
					);
					return;
				}
			}

			// 4. Implement Contextual Code Selection:
			if (!originalSelection.isEmpty) {
				// User made an explicit selection: Use it as-is.
				selectedText = editor.document.getText(originalSelection);
				effectiveRange = originalSelection;
			} else {
				// originalSelection.isEmpty: Apply auto-selection logic
				console.log(
					"[Minovative Mind] No explicit user selection. Attempting automatic selection cascade."
				);

				if (instruction === "chat" || instruction === "custom prompt") {
					console.log(
						"[Minovative Mind] No selection detected for chat/custom prompt. Will use file path reference."
					);
				} else if (instruction === "/fix") {
					const errorDiagnostics = allDiagnostics.filter(
						(d) => d.severity === vscode.DiagnosticSeverity.Error
					);

					if (errorDiagnostics.length > 0) {
						let minStartLine = Infinity;
						let minStartChar = Infinity;
						let maxEndLine = -Infinity;
						let maxEndChar = -Infinity;

						for (const diagnostic of errorDiagnostics) {
							const start = diagnostic.range.start;
							const end = diagnostic.range.end;

							if (
								start.line < minStartLine ||
								(start.line === minStartLine && start.character < minStartChar)
							) {
								minStartLine = start.line;
								minStartChar = start.character;
							}
							if (
								end.line > maxEndLine ||
								(end.line === maxEndLine && end.character > maxEndChar)
							) {
								maxEndLine = end.line;
								maxEndChar = end.character;
							}
						}

						if (isFinite(minStartLine) && isFinite(maxEndLine)) {
							const allErrorsRange = new vscode.Range(
								new vscode.Position(minStartLine, minStartChar),
								new vscode.Position(maxEndLine, maxEndChar)
							);
							selectedText = editor.document.getText(allErrorsRange);
							effectiveRange = allErrorsRange;
						} else {
							console.warn(
								"[Minovative Mind] Could not determine valid range for all errors. Falling back to intelligent /fix logic."
							);
							const relevantSymbol =
								await CodeSelectionService.findRelevantSymbolForFix(
									editor.document,
									cursorPosition,
									allDiagnostics,
									symbols
								);
							if (relevantSymbol) {
								selectedText = editor.document.getText(relevantSymbol.range);
								effectiveRange = relevantSymbol.range;
								vscode.window.showInformationMessage(
									"Minovative Mind: Automatically selected relevant code block for /fix."
								);
							} else {
								console.log(
									`[Minovative Mind] Intelligent selection for '/fix' failed. Falling back to full file selection.`
								);
								selectedText = fullText;
								effectiveRange = new vscode.Range(
									editor.document.positionAt(0),
									editor.document.positionAt(fullText.length)
								);
								vscode.window.showInformationMessage(
									"Minovative Mind: Falling back to full file selection for /fix as no specific code unit was found."
								);
							}
						}
					} else {
						// No error diagnostics found at all
						const relevantSymbol =
							await CodeSelectionService.findRelevantSymbolForFix(
								editor.document,
								cursorPosition,
								allDiagnostics,
								symbols
							);
						if (relevantSymbol) {
							selectedText = editor.document.getText(relevantSymbol.range);
							effectiveRange = relevantSymbol.range;
						} else {
							console.log(
								`[Minovative Mind] Intelligent selection for '/fix' failed. Falling back to full file selection.`
							);
							selectedText = fullText;
							effectiveRange = new vscode.Range(
								editor.document.positionAt(0),
								editor.document.positionAt(fullText.length)
							);
						}
					}
				} else if (instruction === "/merge") {
					if (!hasMergeConflicts(fullText)) {
						vscode.window.showInformationMessage(
							`No active merge conflicts detected in '${displayFileName}'.`
						);
						return; // Exit command if no conflicts
					}
					selectedText = fullText;
					effectiveRange = new vscode.Range(
						editor.document.positionAt(0),
						editor.document.positionAt(fullText.length)
					);
					mergeConflictString = "Merge conflicts detected in this file.";
					vscode.window.showInformationMessage(
						"Minovative Mind: Selected full file for merge operation due to conflicts."
					);
				}
			}
			// Apply visual update for auto-selected ranges
			if (!effectiveRange.isEqual(originalSelection)) {
				const newSelection = new vscode.Selection(
					effectiveRange.start,
					effectiveRange.end
				);
				editor.selection = newSelection;
				editor.revealRange(
					effectiveRange,
					vscode.TextEditorRevealType.InCenterIfOutsideViewport
				);
			}

			// 5. Implement Context Gathering and Formatting:
			if (instruction === "/fix") {
				// Read the active editor's file content
				const fileContentBytes = await vscode.workspace.fs.readFile(
					documentUri
				);
				const fileContent = Buffer.from(fileContentBytes).toString("utf-8");

				// Retrieve optimization settings
				const optimizationSettings =
					sidebarProvider.settingsManager.getOptimizationSettings();
				const enableEnhancedDiagnosticContext =
					optimizationSettings.enableEnhancedDiagnosticContext;

				// Construct FormatDiagnosticsOptions object
				// Annotate with FormatDiagnosticsOptions type
				const formatOptions: FormatDiagnosticsOptions = {
					fileContent: fileContent,
					enableEnhancedDiagnosticContext: enableEnhancedDiagnosticContext,
					includeSeverities: [vscode.DiagnosticSeverity.Error],
					// Set requestType to a valid literal type, e.g., "full"
					requestType: "full",
					// Set optional properties to undefined if not used
					token: undefined,
					selection: undefined,
					maxTotalChars: undefined,
					maxPerSeverity: undefined,
					snippetContextLines: undefined,
				};

				// The call to DiagnosticService.formatContextualDiagnostics expects three arguments:
				// documentUri, workspaceRootUri, and formatOptions.
				diagnosticsString = await DiagnosticService.formatContextualDiagnostics(
					documentUri,
					sidebarProvider.workspaceRootUri!,
					formatOptions
				);
			}
			// For /merge, mergeConflictString is already set above if conflicts exist.

			// 6. Compose Message:
			let contextDescription: string;
			let contextForMessage: string;

			if (
				effectiveRange.isEqual(
					new vscode.Range(
						editor.document.positionAt(0),
						editor.document.positionAt(fullText.length)
					)
				)
			) {
				contextDescription = `the entire file`;
				contextForMessage = fullText;
			} else {
				contextDescription = `the following code snippet`;
				contextForMessage = selectedText;
			}

			if (instruction === "/fix") {
				composedMessage = `/plan ONLY fix the following code errors in ${displayFileName}:\n\n${
					diagnosticsString || "No errors found."
				}\n\n---\n\nHighlevel thinking first. No coding yet.`;
			} else if (instruction === "/merge") {
				composedMessage = `/plan My message: Please resolve the merge conflicts in ${displayFileName}. \n\nInstruction: Provide the implementation solution before code. Here's the full file content with conflicts:\n\n\`\`\`${languageId}\n${fullText}\n\`\`\`\n. Highlevel thinking first. No coding yet.`;
			} else if (instruction === "chat") {
				if (originalSelection.isEmpty) {
					composedMessage = `My message: ${userProvidedMessage} \n\nInstruction: In this project, focus on the conversation within the context of file \`${displayFileName}\`. \n\nDo not code yet.`;
				} else {
					composedMessage =
						`Message: ${userProvidedMessage}\n\n` +
						`Instruction: In this project, From this file \`${displayFileName}\`, focus on the conversation. I've provided ${contextDescription}.\n\n` +
						`(Language: ${languageId}):\n\n\`\`\`${languageId}\n${contextForMessage}\n\`\`\`\ Do not code yet.`;
				}
			} else if (instruction === "custom prompt") {
				if (originalSelection.isEmpty) {
					composedMessage = `/plan My message: ${userProvidedMessage}\n\nInstruction: In this project, Provide the implementation solution within the context of file \`${displayFileName}\`. Highlevel thinking first. No coding yet.`;
				} else {
					composedMessage =
						`/plan My message: ${userProvidedMessage}\n\n` +
						`Instruction: In this project, From this file \`${displayFileName}\`. I've provided ${contextDescription}:\n\n` +
						`(Language: ${languageId}):\n\n\`\`\`${languageId}\n${contextForMessage}\n\`\`\`\n\nHighlevel thinking first. No coding yet.`;
				}
			} else {
				vscode.window.showErrorMessage("Unknown instruction received.");
				return;
			}

			// 7. Prefill Chat Input:
			await vscode.commands.executeCommand("minovative-mind.activitybar.focus"); // Ensure sidebar is open
			sidebarProvider.postMessageToWebview({
				type: "PrefillChatInput",
				payload: { text: composedMessage },
			});

			// 8. Exit Command:
			return;
		}
	);
	context.subscriptions.push(modifySelectionDisposable);

	// Explain Selection Command (NO CHANGE HERE, logic moved to helper)
	const explainDisposable = vscode.commands.registerCommand(
		"minovative-mind.explainSelection",
		async () => {
			const selectedModel = DEFAULT_FLASH_LITE_MODEL; // Use default model for explain action
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
					progress.report({
						increment: 20,
						message: "Minovative Mind: Preparing explanation...",
					});
					// Use the dedicated helper function
					const result = await executeExplainAction(sidebarProvider);
					progress.report({
						increment: 80,
						message: result.success
							? "Minovative Mind: Processing AI response..."
							: "Minovative Mind: Handling error...",
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
	resetClient(); // Ensure client is reset on deactivation
	console.log("Minovative Mind extension deactivated.");
}

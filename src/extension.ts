import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar/SidebarProvider";
import { ERROR_QUOTA_EXCEEDED, resetClient } from "./ai/gemini"; // Import necessary items
import { cleanCodeOutput } from "./utils/codeUtils";
import * as sidebarTypes from "./sidebar/common/sidebarTypes";
import { hasMergeConflicts, getMergeConflictRanges } from "./utils/mergeUtils"; // Added import for mergeUtils
import { CodeSelectionService } from "./services/codeSelectionService";
import { getSymbolsInDocument } from "./services/symbolService";
import { DiagnosticService } from "./utils/diagnosticUtils";

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

	const activeApiKey = sidebarProvider.apiKeyManager.getActiveApiKey(); // Still needed for initial check
	const selectedModel = sidebarProvider.settingsManager.getSelectedModelName();

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
		"Explain the following code selection concisely and simply. Focus on its purpose, functionality, and key components. Provide the explanation without using Markdown formatting at ALL.";
	const systemPrompt = `You are an expert senior software engineer analyzing the provided code selection within the context of the full file. Language: ${languageId}. File: ${fileName}.`;

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
		// Removed activeApiKey (second argument) from the call
		// Signature: _generateWithRetry(prompt, modelName, history, requestType)
		const result = await sidebarProvider.aiRequestService.generateWithRetry(
			prompt, // 1st arg: prompt
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

// --- Helper Function for Documentation Generation ---
async function executeDocsAction(
	sidebarProvider: SidebarProvider,
	selectedText: string,
	fullText: string,
	languageId: string,
	fileName: string,
	effectiveRange: vscode.Range // Renamed from selectionRange
): Promise<ActionResult> {
	const activeApiKey = sidebarProvider.apiKeyManager.getActiveApiKey();
	const selectedModel = sidebarProvider.settingsManager.getSelectedModelName();

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

	const userInstruction = `Generate comprehensive documentation for the selected code block. The documentation should explain its purpose, functionality, parameters (if any), return values (if any), and any significant side effects or dependencies. Structure the documentation clearly using the native comment syntax for ${languageId} (e.g., JSDoc for TypeScript/JavaScript, Python docstrings for Python). Provide ONLY the raw documentation block. ABSOLUTELY DO NOT include any markdown language fences (e.g., \`\`\`javascript), code examples within fences, conversational text, or explanations. Provide only the raw documentation comments ready for direct insertion into the code.`;
	const systemPrompt = `You are an expert AI programmer and technical writer assisting within VS Code using the ${selectedModel} model. Generate documentation for the provided code selection within the context of the full file. Language: ${languageId}. File: ${fileName}.`;

	const prompt = `
	${systemPrompt}

	--- Full File Content (${fileName}) ---
	\`\`\`${languageId}
	${fullText}
	\`\`\`
	--- End Full File Content ---

	--- Code Selection to Document ---
	\`\`\`${languageId}
	${selectedText}
	\`\`\`
	--- End Code Selection to Document ---

	--- User Instruction ---
	${userInstruction}
	--- End User Instruction ---

	Assistant Response:
`;

	console.log(
		`--- Sending generate documentation Action Prompt (Model: ${selectedModel}) ---`
	);
	console.log(`--- End generate documentation Action Prompt ---`);

	try {
		const result = await sidebarProvider.aiRequestService.generateWithRetry(
			prompt,
			selectedModel,
			undefined, // No history needed for single documentation generation
			"generate documentation"
		);

		if (
			!result ||
			result.toLowerCase().startsWith("error:") ||
			result === ERROR_QUOTA_EXCEEDED
		) {
			throw new Error(result || `Empty response from AI (${selectedModel}).`);
		}

		// Documentation can contain markdown, so no aggressive cleaning like explain.
		// However, we might trim whitespace for consistency.
		const cleanedResult = cleanCodeOutput(result);
		return { success: true, content: cleanedResult };
	} catch (error) {
		console.error(
			`Error during generate documentation action (${selectedModel}):`,
			error
		);
		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			error: `Failed to generate documentation: ${message}`,
		};
	}
}

// --- Helper Function for Diagnostics Formatting ---
async function _getFormattedDiagnostics(
	documentUri: vscode.Uri
): Promise<string> {
	const diagnostics = vscode.languages.getDiagnostics(documentUri);
	if (diagnostics.length > 0) {
		return diagnostics
			.map((d) => {
				const line = d.range.start.line + 1; // VS Code lines are 0-indexed
				const char = d.range.start.character + 1; // VS Code chars are 0-indexed
				const severity = vscode.DiagnosticSeverity[d.severity]; // Convert enum to string (e.g., "Error", "Warning")
				return `[${line}:${char}] ${severity}: ${d.message}`;
			})
			.join("\n");
	} else {
		return "No diagnostics found in the document.";
	}
}
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

			// Refactor variable declarations as per instructions
			const originalSelection: vscode.Selection = editor.selection;

			const fullText = editor.document.getText();
			const languageId = editor.document.languageId;
			const documentUri = editor.document.uri;
			const fileName = editor.document.fileName;

			// Fetch contextual information for intelligent selection
			const allDiagnostics =
				DiagnosticService.getDiagnosticsForUri(documentUri);
			const symbols = await getSymbolsInDocument(documentUri);

			// Initialize variables for intelligent selection
			let selectedText: string;
			let effectiveRange: vscode.Range;
			let diagnosticsString: string | undefined; // Will be set contextually

			// Replace showInputBox with showQuickPick
			const quickPickItems: vscode.QuickPickItem[] = [
				{
					label: "/fix",
					description:
						"Apply AI suggestions to fix code issues (whole file if no selection)",
				},
				{
					label: "/docs",
					description: "Generate documentation for the selected code",
				},
				{
					label: "/merge",
					description:
						"Use AI to help resolve merge conflicts in the current file",
				},
				{
					label: "custom prompt",
					description: "Enter a custom instruction for Minovative Mind",
				},
			];

			const selectedCommand = await vscode.window.showQuickPick(
				quickPickItems,
				{
					placeHolder: "Select a command or type a custom prompt...",
					title: "Minovative Mind: Modify Code",
				}
			);

			let instruction: string | undefined;

			if (!selectedCommand) {
				vscode.window.showInformationMessage("Modification cancelled.");
				return; // User cancelled QuickPick
			}

			if (selectedCommand.label === "custom prompt") {
				const customPromptInput = await vscode.window.showInputBox({
					prompt: "Enter your custom instruction:",
					placeHolder: "e.g., refactor this function to be more concise",
					title: "Minovative Mind: Custom Prompt",
				});
				if (!customPromptInput) {
					vscode.window.showInformationMessage("Modification cancelled.");
					return; // User cancelled custom prompt input
				}
				instruction = customPromptInput.trim();
			} else {
				instruction = selectedCommand.label.trim();
			}

			if (!instruction) {
				// This could happen if Custom Prompt... was chosen but then an empty string was entered.
				vscode.window.showInformationMessage(
					"Modification cancelled. No instruction provided."
				);
				return;
			}

			// New confirmation dialog for custom prompts
			if (selectedCommand.label === "custom prompt" && instruction) {
				// Changed from "Custom Prompt..."
				const confirmation = await vscode.window.showInformationMessage(
					`You entered: "${instruction}". Do you want to proceed with this custom command?`,
					{ modal: true },
					"Yes",
					"No"
				);
				if (confirmation !== "Yes") {
					vscode.window.showInformationMessage(
						"Custom command execution cancelled."
					);
					return; // Stop execution if not confirmed
				}
			}

			// Check if user has an active selection
			if (!originalSelection.isEmpty) {
				// User made a selection: Use it as-is.
				selectedText = editor.document.getText(originalSelection);
				effectiveRange = originalSelection;
				// Format diagnostics only relevant to the user's explicit selection
				diagnosticsString = await DiagnosticService.formatContextualDiagnostics(
					documentUri,
					sidebarProvider.workspaceRootUri!,
					effectiveRange
				);
			} else {
				// No user selection: Apply intelligent auto-selection based on command type
				const cursorPosition = editor.selection.active; // Current cursor position

				if (instruction === "/fix") {
					// Find the smallest logical block containing diagnostics
					const symbolWithDiagnostics =
						await CodeSelectionService.findSymbolWithDiagnostics(
							editor.document,
							allDiagnostics,
							symbols
						);
					if (symbolWithDiagnostics) {
						selectedText = editor.document.getText(symbolWithDiagnostics.range);
						effectiveRange = symbolWithDiagnostics.range;
						// Format diagnostics specifically for the auto-selected block
						diagnosticsString =
							await DiagnosticService.formatContextualDiagnostics(
								documentUri,
								sidebarProvider.workspaceRootUri!,
								effectiveRange
							);
					} else {
						// Fallback: No relevant block with diagnostics, use entire file
						selectedText = fullText;
						effectiveRange = new vscode.Range(
							editor.document.positionAt(0),
							editor.document.positionAt(fullText.length)
						);
						// Format all diagnostics in the file for full file context
						diagnosticsString =
							await DiagnosticService.formatContextualDiagnostics(
								documentUri,
								sidebarProvider.workspaceRootUri!,
								effectiveRange
							);
					}
					// Suppress "No text selected" warning for /fix
					// No explicit warning needed here as auto-selection is attempted.
				} else if (instruction === "custom prompt") {
					// Find the logical block at the cursor position
					const enclosingSymbol =
						await CodeSelectionService.findEnclosingSymbol(
							editor.document,
							cursorPosition,
							symbols
						);
					if (enclosingSymbol) {
						selectedText = editor.document.getText(enclosingSymbol.range);
						effectiveRange = enclosingSymbol.range;
						// Format diagnostics specifically for the auto-selected block
						diagnosticsString =
							await DiagnosticService.formatContextualDiagnostics(
								documentUri,
								sidebarProvider.workspaceRootUri!,
								effectiveRange
							);
					} else {
						// Fallback: No clear logical block, use entire file
						selectedText = fullText;
						effectiveRange = new vscode.Range(
							editor.document.positionAt(0),
							editor.document.positionAt(fullText.length)
						);
						// Format all diagnostics in the file for full file context
						diagnosticsString =
							await DiagnosticService.formatContextualDiagnostics(
								documentUri,
								sidebarProvider.workspaceRootUri!,
								effectiveRange
							);
					}
					// Suppress "No text selected" warning for custom prompt
					// No explicit warning needed here as auto-selection is attempted.
				} else if (instruction === "/merge") {
					// For /merge, always send the entire file content, but internally AI will use conflict markers.
					// First, check if conflicts exist, use existing `hasMergeConflicts` from `mergeUtils.ts`.
					if (!hasMergeConflicts(fullText)) {
						vscode.window.showInformationMessage(
							`No active merge conflicts detected in '${fileName}'.`
						);
						return; // Exit if no conflicts
					}
					selectedText = fullText;
					effectiveRange = new vscode.Range(
						editor.document.positionAt(0),
						editor.document.positionAt(fullText.length)
					);
					diagnosticsString = undefined; // Diagnostics are less relevant for pure merge resolution by the AI.
					// Suppress "No text selected" warning for /merge
					// No explicit warning needed here as auto-selection is attempted.
				} else if (instruction === "/docs") {
					// As per chat history, /docs still requires an explicit selection or shows warning.
					// This means the previous user request to auto-select for /docs was superseded by this current, broader request.
					// So, keep the existing behavior for /docs when no selection.
					vscode.window.showWarningMessage("No text selected.");
					return;
				} else {
					// Fallback for any other unexpected instruction without selection, though the quick pick limits this.
					// Treat like a custom prompt with no clear block, default to full file.
					selectedText = fullText;
					effectiveRange = new vscode.Range(
						editor.document.positionAt(0),
						editor.document.positionAt(fullText.length)
					);
					diagnosticsString =
						await DiagnosticService.formatContextualDiagnostics(
							documentUri,
							sidebarProvider.workspaceRootUri!,
							effectiveRange
						);
				}
			}

			// New /docs instruction handling
			if (instruction === "/docs") {
				const selectedModel =
					sidebarProvider.settingsManager.getSelectedModelName();
				if (!selectedModel) {
					vscode.window.showErrorMessage(
						"Minovative Mind: No AI model selected. Please check the sidebar."
					);
					return;
				}

				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: `Minovative Mind: Generating documentation (${selectedModel})...`,
						cancellable: false, // Documentation generation is not cancellable by user
					},
					async (progress) => {
						progress.report({
							increment: 20,
							message: "Minovative Mind: Preparing request...",
						});
						const result = await executeDocsAction(
							sidebarProvider,
							selectedText, // Now correctly set from the conditional logic above
							fullText,
							languageId,
							fileName,
							effectiveRange // Use effectiveRange
						);
						progress.report({
							increment: 80,
							message: result.success
								? "Minovative Mind: Processing AI response..."
								: "Minovative Mind: Handling error...",
						});

						if (result.success) {
							await editor.edit((editBuilder) => {
								// Insert at the start of the effective range, followed by a newline
								editBuilder.insert(effectiveRange.start, result.content + "\n");
							});
							vscode.window.showInformationMessage(
								"Minovative Mind: Documentation successfully added at the start of your selection."
							);
						} else {
							vscode.window.showErrorMessage(
								`Minovative Mind: ${result.error}`
							);
						}
						progress.report({ increment: 100, message: "Done." });
					}
				);
				return; // Crucially return here to prevent falling through to planning logic
			}

			// Original actionTypeForGating logic, adjusted for /docs being handled separately
			let actionTypeForGating: string;
			if (instruction === "/fix") {
				actionTypeForGating = "plan_from_editor_fix";
			} else if (instruction === "/merge") {
				// Set actionTypeForGating for /merge
				actionTypeForGating = "plan_from_editor_merge";
			} else {
				// Any other instruction, including custom prompts, will use plan_from_editor_custom
				actionTypeForGating = "plan_from_editor_custom";
			}

			let result: sidebarTypes.PlanGenerationResult = {
				success: false,
				error: "Textual plan generation was cancelled or did not complete.",
			}; // Declare and initialize result before withProgress

			// Call the gated method on sidebarProvider
			// Progress and CancellationToken are handled by withProgress
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Minovative Mind: Processing '${instruction}'...`, // Generic title
					cancellable: true, // Allow cancellation
				},
				async (progress, token) => {
					// The existing logic in your OCR shows SidebarProvider handles progress updates
					// and token linking internally for initiatePlanFromEditorAction.
					result =
						await sidebarProvider.planService.initiatePlanFromEditorAction(
							instruction,
							selectedText, // Use the potentially modified selectedText
							fullText,
							languageId,
							documentUri,
							effectiveRange, // Use the potentially modified effectiveRange
							progress, // Pass progress
							token, // Pass cancellation token
							diagnosticsString, // Pass the diagnosticsString
							instruction === "/merge" // Append true if it's a merge operation
						);
				}
			);
			// After 'initiatePlanFromEditorAction' returns, the 'withProgress' callback completes,
			// and the notification will automatically disappear here.

			// Now, handle the subsequent UI for plan review or errors
			if (result.success && result.context) {
				// The pendingPlanGenerationContext is already set inside initiatePlanFromEditorAction
				// Now trigger the UI to display the plan for review
				await sidebarProvider.planService.triggerPostTextualPlanUI(
					result.context
				);
			} else {
				// Handle cases where the initial textual plan generation failed or was cancelled
				vscode.window.showErrorMessage(
					`Minovative Mind: ${
						result.error ||
						"An unknown error occurred during textual plan generation."
					}`
				);
				sidebarProvider.postMessageToWebview({ type: "reenableInput" }); // Ensure input is re-enabled if an error occurred
			}
		}
	);
	context.subscriptions.push(modifySelectionDisposable);

	// Explain Selection Command (NO CHANGE HERE, logic moved to helper)
	const explainDisposable = vscode.commands.registerCommand(
		"minovative-mind.explainSelection",
		async () => {
			const selectedModel =
				sidebarProvider.settingsManager.getSelectedModelName();
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

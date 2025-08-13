// src/extension.ts
import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar/SidebarProvider";
import { ERROR_QUOTA_EXCEEDED, resetClient } from "./ai/gemini"; // Import necessary items
import { cleanCodeOutput } from "./utils/codeUtils";
import * as sidebarTypes from "./sidebar/common/sidebarTypes";
import { hasMergeConflicts } from "./utils/mergeUtils"; // Added import for mergeUtils
import { CodeSelectionService } from "./services/codeSelectionService";
import { getSymbolsInDocument } from "./services/symbolService";
import { DiagnosticService } from "./utils/diagnosticUtils";
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
	const selectedModel = DEFAULT_FLASH_LITE_MODEL; // Use default model for documentation generation

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

	const userInstruction = `Generate comprehensive documentation for the selected code block. The documentation should explain its purpose, functionality, parameters (if any), return values (if any), and any significant side effects or dependencies. Structure the documentation clearly using the native comment syntax for ${languageId} (e.g., JSDoc for TypeScript/JavaScript, Python doc strings for Python, and other docs for other languages). Provide ONLY the raw documentation block. ABSOLUTELY DO NOT include any markdown language fences (e.g., \`\`\`language), code examples within fences, conversational text, or explanations. Provide only the raw documentation comments ready for direct insertion into the code.`;
	const systemPrompt = `You are an expert AI programmer and technical writer assisting within VS Code. Generate documentation for the provided code selection within the context of the full file. Language: ${languageId}. File: ${fileName}.`;

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
			[{ text: prompt }],
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
			let selectedText: string = ""; // FIX: Initialize to empty string
			let effectiveRange: vscode.Range = originalSelection;
			let selectionMethodUsed: string = "initial";
			let diagnosticsString: string | undefined = undefined; // Will be set contextually

			// Replace showInputBox with showQuickPick
			const quickPickItems: vscode.QuickPickItem[] = [
				{
					label: "/fix",
					description: "Fix bugs",
				},
				{
					label: "/docs",
					description: "Generate documentations",
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
						"Custom instructions (e.g. refactor, optimize, fix, etc...)",
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
				return; // User cancelled QuickPick
			}

			if (selectedCommand.label === "custom prompt") {
				const customPromptInput = await vscode.window.showInputBox({
					prompt: "Enter your custom instruction:",
					placeHolder: "e.g., refactor this function to be more concise",
					title: "Minovative Mind: Custom Prompt",
				});

				if (!customPromptInput) {
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

			// Confirmation dialog for custom prompts
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

			if (instruction === "/docs") {
				if (originalSelection.isEmpty) {
					vscode.window.showWarningMessage(
						"Please select the code you want to document."
					);
					return;
				}
				selectedText = editor.document.getText(originalSelection);
				effectiveRange = originalSelection;
			} else if (instruction === "chat") {
				let codeContentForAI: string;
				let codeContextDescription: string;
				const codeContextLanguageId = languageId; // Language ID is always from the document.

				if (originalSelection.isEmpty) {
					codeContentForAI = fullText;
					codeContextDescription = "the entire file";
					vscode.window.showInformationMessage(
						"Minovative Mind: No code selected. Sending the full file to chat."
					);
				} else {
					codeContentForAI = editor.document.getText(originalSelection);
					codeContextDescription = "the following code snippet";
				}

				const selectedModel = DEFAULT_FLASH_LITE_MODEL; // Use default model for chat
				if (!selectedModel) {
					vscode.window.showErrorMessage(
						"Minovative Mind: No AI model selected. Please check the sidebar."
					);
					return;
				}

				// Insert custom prompt input and related logic here
				const customChatPromptInput = await vscode.window.showInputBox({
					prompt: `Enter your message for the AI (${codeContextDescription} will be included):`,
					placeHolder:
						"e.g., Explain this function, or refactor it for performance",
					title: "Minovative Mind: Chat with Code",
				});

				if (customChatPromptInput === undefined) {
					vscode.window.showInformationMessage("Chat operation cancelled.");
					return;
				}

				let finalUserMessageContent: string;
				const trimmedInput = customChatPromptInput.trim();
				if (trimmedInput.length > 0) {
					finalUserMessageContent = trimmedInput;
				} else {
					finalUserMessageContent = "Lets chat about my code.";
				}

				// Construct Prompt: Create userChatPrompt using a template string
				const userChatPrompt =
					`

					You are **Mino**, an AI coding assistant in Visual Studio Code, developed by Minovative Technologies. Your role is to deliver clear, concise, step-by-step plans focused solely on how to add or fix my problems according to the context you have and my query, or to provide explanations directly tailored to my query.

					Make sure for coding plans, stay organized and modular with files, if necessary, avoiding cramming everything into a single file—modularize where possible to maintain clean, scalable code structure. Always prioritize clarity, structure, and relevance. Give a Goal, Problem Analysis, and a Fix section on a problem, but what if I want to add a feature or enhancements? Give a Goal and Implementation section for a new feature and enhancement. Mainly, what if I don't have a problem to solve or features and enhancements to add? Then just respond with a concise, relevant answer to my question or request.

					\n\n` +
					`${finalUserMessageContent}\n\n` +
					`From this file \`${fileName}\`, I've provided ${codeContextDescription}. Lets chat about my code.\n\n` +
					`(Language: ${codeContextLanguageId}):\n\n\`\`\`${codeContextLanguageId}\n${codeContentForAI}\n\`\`\``;

				// Show Progress: Wrap the core logic in vscode.window.withProgress
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: `Minovative Mind: Sending code to chat (${selectedModel})...`,
						cancellable: true,
					},
					async (progress, token) => {
						// Inside Progress Callback:
						progress.report({
							increment: 20,
							message: "Minovative Mind: Preparing chat...",
						});
						await vscode.commands.executeCommand(
							"minovative-mind.activitybar.focus"
						);
						sidebarProvider.postMessageToWebview({
							type: "updateLoadingState",
							value: true,
						});

						try {
							await sidebarProvider.chatService.handleRegularChat(
								[{ text: userChatPrompt }] // Changed from string to HistoryEntryPart array
							);
							vscode.window.showInformationMessage(
								"Code sent to chat. Check Minovative Mind sidebar for response."
							);
						} catch (error: any) {
							const errorMessage = error.message || String(error);
							if (errorMessage.includes("Operation cancelled by user.")) {
								vscode.window.showInformationMessage(
									"Minovative Mind: Chat generation cancelled."
								);
							} else {
								vscode.window.showErrorMessage(
									`Minovative Mind: Failed to send code to chat: ${errorMessage}`
								);
							}
						} finally {
							progress.report({ increment: 100, message: "Done." });
							// The chatService already handles `aiResponseEnd` and input re-enabling.
						}
					}
				);
				// Critical Return: Add return; after the vscode.window.withProgress block for the 'Chat' command
				return;
			}

			// Re-structure General Selection Logic:
			if (!originalSelection.isEmpty) {
				// User made an explicit selection for /fix, /merge, or custom: Use it as-is.
				selectedText = editor.document.getText(originalSelection);
				effectiveRange = originalSelection;
				selectionMethodUsed = "explicit-user-selection";
			} else {
				// originalSelection.isEmpty
				console.log(
					"[Minovative Mind] No explicit user selection. Attempting automatic selection cascade."
				);

				let selectionSuccessfullyDetermined = false; // Local flag to track if a selection was made by auto-logic
				const cursorPosition = editor.selection.active;

				if (instruction === "/fix") {
					// PHASE 1: Implement automatic selection of all errors for /fix command.
					const errorDiagnostics = allDiagnostics.filter(
						(d) => d.severity === vscode.DiagnosticSeverity.Error
					);

					if (errorDiagnostics.length > 0) {
						let minStartLine = Infinity;
						let minStartChar = Infinity;
						let maxEndLine = -Infinity;
						let maxEndChar = -Infinity;

						// Calculate the aggregate range encompassing all errors.
						for (const diagnostic of errorDiagnostics) {
							const start = diagnostic.range.start;
							const end = diagnostic.range.end;

							// Update minimum start position
							if (
								start.line < minStartLine ||
								(start.line === minStartLine && start.character < minStartChar)
							) {
								minStartLine = start.line;
								minStartChar = start.character;
							}
							// Update maximum end position
							if (
								end.line > maxEndLine ||
								(end.line === maxEndLine && end.character > maxEndChar)
							) {
								maxEndLine = end.line;
								maxEndChar = end.character;
							}
						}

						// If a valid range was found, apply it.
						if (isFinite(minStartLine) && isFinite(maxEndLine)) {
							const allErrorsRange = new vscode.Range(
								new vscode.Position(minStartLine, minStartChar),
								new vscode.Position(maxEndLine, maxEndChar)
							);
							selectedText = editor.document.getText(allErrorsRange);
							effectiveRange = allErrorsRange;
							selectionMethodUsed = "auto-all-errors-selection";
							selectionSuccessfullyDetermined = true;
							console.log(
								"[Minovative Mind] Auto-selected all error ranges for /fix."
							);
						} else {
							console.warn(
								"[Minovative Mind] Could not determine valid range for all errors. Falling back to original /fix logic."
							);
							// If range calculation failed, fall through to original fallback logic.
						}
					}

					// Fallback logic: If automatic selection of all errors didn't occur (either no errors, or calculation failed),
					// use the original intelligent selection logic for /fix.
					if (!selectionSuccessfullyDetermined) {
						console.log(
							"Falling back to original intelligent selection logic for /fix."
						);
						// --- Start of original fallback logic for /fix from the extension.ts file ---
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
							selectionMethodUsed = "intelligent-fix-selection";
							selectionSuccessfullyDetermined = true;
							vscode.window.showInformationMessage(
								"Minovative Mind: Automatically selected relevant code block for /fix."
							);
							console.log(
								"[Minovative Mind] Auto-selected using intelligent-fix-selection."
							);
						} else {
							console.log(
								"[Minovative Mind] intelligent-fix-selection did not find a relevant symbol."
							);
							// Further fallback to selecting the full file if no specific symbol is found for /fix.
							console.log(
								`[Minovative Mind] Intelligent selection for '/fix' failed. Falling back to full file selection.`
							);
							selectedText = fullText;
							effectiveRange = new vscode.Range(
								editor.document.positionAt(0),
								editor.document.positionAt(fullText.length)
							);
							selectionMethodUsed = "full-file-fallback";
							vscode.window.showInformationMessage(
								"Minovative Mind: Falling back to full file selection as no specific code unit was found."
							);
						}
						// --- End of original fallback logic for /fix ---
					}

					// NEW: Calculate diagnosticsString for /fix immediately after selection logic
					// This targets all ERROR diagnostics in the file.
					diagnosticsString =
						await DiagnosticService.formatContextualDiagnostics(
							documentUri,
							sidebarProvider.workspaceRootUri!,
							undefined, // Get diagnostics for the entire file (undefined selection)
							undefined, // Use default maxTotalChars
							undefined, // Use default maxPerSeverity
							undefined, // No cancellation token available here from a central operation
							[vscode.DiagnosticSeverity.Error] // Only errors
						);
				} else if (instruction === "/merge") {
					// --- Original /merge logic from the extension.ts file ---
					if (!hasMergeConflicts(fullText)) {
						// Assuming hasMergeConflicts is imported and available
						vscode.window.showInformationMessage(
							`No active merge conflicts detected in '${fileName}'.`
						);
						return; // Exit command if no conflicts
					}
					selectedText = fullText;
					effectiveRange = new vscode.Range(
						editor.document.positionAt(0),
						editor.document.positionAt(fullText.length)
					);
					selectionMethodUsed = "full-file-for-merge";
					vscode.window.showInformationMessage(
						"Minovative Mind: Selected full file for merge operation."
					);
					// --- End of original /merge logic ---
				}
				// --- Original fallback for custom prompt and any other unhandled instructions ---
				else {
					console.log(
						`Attempting intelligent selection for custom prompt or fallback.`
					);
					let logicalUnitSymbol;
					if (instruction === "custom prompt") {
						// Ensure editor.document, editor.selection.active, symbols, and CodeSelectionService are available in scope
						logicalUnitSymbol =
							await CodeSelectionService.findLogicalCodeUnitForPrompt(
								editor.document,
								cursorPosition,
								symbols
							);
					}

					// Use selected logical unit or fall back to full file selection.
					if (logicalUnitSymbol) {
						selectedText = editor.document.getText(logicalUnitSymbol.range);
						effectiveRange = logicalUnitSymbol.range;
						selectionMethodUsed = "intelligent-custom-prompt-selection";
						selectionSuccessfullyDetermined = true;

						console.log(
							"[Minovative Mind] Auto-selected using intelligent-custom-prompt-selection."
						);
					} else {
						console.log(
							"[Minovative Mind] Intelligent selection did not find a logical unit for prompt/fallback. Falling back to full file."
						);
						selectedText = fullText;
						effectiveRange = new vscode.Range(
							editor.document.positionAt(0),
							editor.document.positionAt(fullText.length)
						);
						selectionMethodUsed = "full-file-fallback";
						vscode.window.showInformationMessage(
							"Minovative Mind: Falling back to full file selection."
						);
					}
				}
				// --- End of original fallback for custom prompt and any other unhandled instructions ---

				// Apply visual update for auto-selected ranges that were successfully determined,
				// specifically for /fix (new logic) and custom prompt commands.
				if (
					selectionSuccessfullyDetermined &&
					(instruction === "/fix" || instruction === "custom prompt")
				) {
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
			} // End of the replaced else block (when originalSelection.isEmpty)

			// NEW: Calculate displayFileName logic
			let displayFileName: string = fileName; // Default to full path

			if (
				vscode.workspace.workspaceFolders &&
				vscode.workspace.workspaceFolders.length > 0
			) {
				const relativePath = vscode.workspace.asRelativePath(fileName);
				if (relativePath !== fileName) {
					displayFileName = relativePath;
				} else {
					console.warn(
						`[Minovative Mind] Could not determine relative path for ${fileName}. Falling back to full path.`
					);
				}
			} else {
				console.warn(
					"[Minovative Mind] No workspace folders found. Using full file path."
				);
			}
			// END NEW LOGIC

			// The original diagnosticsString calculation block that was here is now moved into the withProgress block.

			// /docs instruction handling (now using the upfront logic, this block still handles execution)
			if (instruction === "/docs") {
				const selectedModel = DEFAULT_FLASH_LITE_MODEL; // Use default model for documentation generation
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

			// Handle /fix instruction: Prefill chat input and return
			if (instruction === "/fix") {
				// The preceding logic ensures `selectedText` is assigned. The faulty check is removed.
				const formattedDiagnostics = diagnosticsString || "No errors found.";
				const composedMessage = `/plan Please fix the following code errors in ${displayFileName}:\n\n${formattedDiagnostics}\n\n---`;

				// Post message to webview to prefill chat input
				sidebarProvider.postMessageToWebview({
					type: "PrefillChatInput",
					payload: { text: composedMessage },
				});

				// Terminate the command execution for the /fix scenario
				return;
			}

			let result: sidebarTypes.PlanGenerationResult = {
				success: false,
				error: "Textual plan generation was cancelled or did not complete.",
			}; // Declare and initialize result before withProgress

			// Immediately disable sidebar and ensure persistence for editor commands
			// Set isGeneratingUserRequest to true for persistence like /plan
			sidebarProvider.isGeneratingUserRequest = true;
			await sidebarProvider.workspaceState.update(
				"minovativeMind.isGeneratingUserRequest",
				true
			);

			// Immediately disable the chat UI to prevent new inputs during processing
			sidebarProvider.postMessageToWebview({
				type: "updateLoadingState",
				value: true,
			});

			// Send aiResponseStart immediately to show streaming state
			const modelName = DEFAULT_FLASH_LITE_MODEL; // Use default model for /fix, /merge, or custom prompt
			sidebarProvider.postMessageToWebview({
				type: "aiResponseStart",
				value: { modelName, relevantFiles: [] }, // Empty relevantFiles initially, will be updated later
			});

			// Call the gated method on sidebarProvider
			// Progress and CancellationToken are handled by withProgress
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Minovative Mind: Processing '${instruction}'...`, // Generic title
					cancellable: true, // Allow cancellation
				},
				async (progress, token) => {
					// Centralize Diagnostics String Calculation:
					// For /fix, diagnosticsString is already calculated above.
					// For other commands (/docs, /merge, custom prompt), use the determined effectiveRange.
					if (instruction !== "/fix") {
						// Only calculate if not /fix
						diagnosticsString =
							await DiagnosticService.formatContextualDiagnostics(
								documentUri,
								sidebarProvider.workspaceRootUri!,
								effectiveRange // Use the effectiveRange determined by selection logic.
							);
					}

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
				sidebarProvider.postMessageToWebview({ type: "reenableInput" }); // Ensure input is re-enabled if anC error occurred
			}
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

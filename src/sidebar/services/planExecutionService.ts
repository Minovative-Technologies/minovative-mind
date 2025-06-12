// src/sidebar/services/planExecutionService.ts
import * as vscode from "vscode";
import * as path from "path";

// New imports for AI interaction and code utilities
import { _performModification } from "./aiInteractionService"; // Assuming this path based on "aiInteractionService.ts"
import { applyAITextEdits } from "../../utils/codeUtils";
import { ProjectChangeLogger } from "../../workflow/ProjectChangeLogger";
import { generateFileChangeSummary } from "../../utils/diffingUtils";
import { FileChangeEntry } from "../../types/workflow";

// Define enums and interfaces for plan execution
export enum PlanStepAction {
	ModifyFile = "modifyFile",
	CreateFile = "createFile",
	DeleteFile = "deleteFile",
	ViewFile = "viewFile",
	TypeContent = "typeContent",
	ExecuteCommand = "executeCommand",
	ShowMessage = "showMessage",
}

export interface PlanStep {
	action: PlanStepAction;
	file?: string; // Path to the file for file-related actions
	content?: string; // Content for actions like CreateFile, TypeContent
	modificationPrompt?: string; // Prompt for ModifyFile action
	description: string; // User-friendly description of the step
	// other properties as needed for different actions
	command?: string; // For executeCommand
	args?: string[]; // For executeCommand
	message?: string; // For showMessage
}

export async function typeContentIntoEditor(
	editor: vscode.TextEditor,
	content: string,
	token: vscode.CancellationToken,
	progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<void> {
	const chunkSize = 5; // Characters per chunk
	const delayMs = 0; // Delay between chunks

	for (let i = 0; i < content.length; i += chunkSize) {
		if (token.isCancellationRequested) {
			console.log("Typing animation cancelled.");
			throw new Error("Operation cancelled by user."); // Standard cancellation error
		}
		const chunk = content.substring(i, Math.min(i + chunkSize, content.length));

		await editor.edit((editBuilder) => {
			// Insert at the current end of the document to simulate typing
			const endPosition = editor.document.positionAt(
				editor.document.getText().length
			);
			editBuilder.insert(endPosition, chunk);
		});

		// Reveal the last line to keep it in view
		const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
		editor.revealRange(lastLine.range, vscode.TextEditorRevealType.Default);

		if (progress) {
			progress.report({
				message: `Typing content into ${path.basename(
					editor.document.fileName
				)}...`,
				// Increment could be based on i / content.length if desired, but message update is often enough
			});
		}
		// a small delay only if not cancelled
		if (!token.isCancellationRequested) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
}

export async function executePlanStep(
	step: PlanStep,
	token: vscode.CancellationToken,
	progress: vscode.Progress<{ message?: string; increment?: number }>,
	changeLogger: ProjectChangeLogger,
	postChatUpdate: (message: {
		type: string;
		value: { text: string; isError?: boolean };
		diffContent?: string;
	}) => void
): Promise<void> {
	progress.report({ message: step.description });

	if (token.isCancellationRequested) {
		throw new Error("Operation cancelled by user.");
	}

	switch (step.action) {
		case PlanStepAction.ModifyFile:
			if (!step.file || !step.modificationPrompt) {
				throw new Error(
					"Missing file path or modification prompt for ModifyFile action."
				);
			}
			// Construct absolute file path, assuming step.file is relative to the workspace root
			const filePath = path.join(vscode.workspace.rootPath || "", step.file);

			progress.report({
				message: `Opening file: ${path.basename(filePath)}...`,
			});
			let document: vscode.TextDocument;
			try {
				document = await vscode.workspace.openTextDocument(
					vscode.Uri.file(filePath)
				);
			} catch (error) {
				throw new Error(
					`Failed to open document ${filePath}: ${(error as Error).message}`
				);
			}

			progress.report({
				message: `Showing document: ${path.basename(filePath)}...`,
			});
			const editor = await vscode.window.showTextDocument(document);

			progress.report({
				message: `Analyzing and modifying ${path.basename(
					filePath
				)} with AI...`,
			});

			const originalContent = editor.document.getText();

			// Retrieve the Gemini API key
			const geminiApiKey: string | undefined = vscode.workspace
				.getConfiguration("minovativeMind")
				.get("geminiApiKey");

			// Check for Gemini API key configuration
			if (geminiApiKey === undefined) {
				throw new Error(
					"Gemini API key is not configured. Please set 'minovativeMind.geminiApiKey' in your VS Code settings."
				);
			}

			// Call the AI function to get modified content
			const aiModifiedContent = await _performModification(
				originalContent,
				step.modificationPrompt,
				editor.document.languageId,
				editor.document.uri.fsPath,
				"default-model-name",
				geminiApiKey,
				token
			);

			if (token.isCancellationRequested) {
				throw new Error("Operation cancelled by user.");
			}

			// Apply the AI-generated changes to the editor
			await applyAITextEdits(
				editor,
				aiModifiedContent,
				"AI modification",
				token
			);

			const newContent = editor.document.getText();
			const {
				summary,
				addedLines,
				removedLines,
				formattedDiff,
			} = // Modified: added formattedDiff
				await generateFileChangeSummary(
					originalContent,
					newContent,
					step.file!
				);

			const newChangeEntry: FileChangeEntry = {
				changeType: "modified",
				filePath: step.file!,
				summary: summary,
				addedLines: addedLines,
				removedLines: removedLines,
				timestamp: Date.now(),
				diffContent: formattedDiff, // Added diffContent
			};
			changeLogger.logChange(newChangeEntry);

			// Log diff content before posting
			console.log(
				`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file!}:\n---\n${formattedDiff}\n---`
			);
			// Added: postChatUpdate call
			postChatUpdate({
				type: "appendRealtimeModelMessage",
				value: {
					text: `Successfully applied modifications to \`${path.basename(
						filePath
					)}\`.`,
					isError: false,
				},
				diffContent: formattedDiff,
			});

			progress.report({
				message: `Successfully applied modifications to ${path.basename(
					filePath
				)}.`,
			});
			break;

		case PlanStepAction.TypeContent:
			if (!step.file || !step.content) {
				throw new Error("Missing file path or content for TypeContent action.");
			}
			const docToType = await vscode.workspace.openTextDocument(
				vscode.Uri.file(step.file)
			);
			const editorToType = await vscode.window.showTextDocument(docToType);
			await typeContentIntoEditor(editorToType, step.content, token, progress);
			break;

		case PlanStepAction.CreateFile:
			if (!step.file || !step.content) {
				throw new Error("Missing file path or content for CreateFile action.");
			}
			const targetFilePath = path.join(
				vscode.workspace.rootPath || "",
				step.file
			);
			const targetFileUri = vscode.Uri.file(targetFilePath);

			try {
				await vscode.workspace.fs.stat(targetFileUri); // Attempt to stat the file

				// If stat succeeds, the file exists
				const existingContentBuffer = await vscode.workspace.fs.readFile(
					targetFileUri
				);
				const existingContent = existingContentBuffer.toString();

				if (existingContent === step.content) {
					progress.report({
						message: `File ${path.basename(
							targetFilePath
						)} already has the target content. Skipping update.`,
					});
					return; // File exists and content is identical, do nothing.
				} else {
					// File exists but content differs, update it.
					progress.report({
						message: `Updating content of ${path.basename(targetFilePath)}...`,
					});

					let documentToUpdate: vscode.TextDocument;
					try {
						documentToUpdate = await vscode.workspace.openTextDocument(
							targetFileUri
						);
					} catch (error) {
						throw new Error(
							`Failed to open document ${targetFilePath} for update: ${
								(error as Error).message
							}`
						);
					}

					const editorToUpdate = await vscode.window.showTextDocument(
						documentToUpdate
					);

					await applyAITextEdits(
						editorToUpdate,
						step.content,
						"Update existing file content",
						token
					);

					const newContent = editorToUpdate.document.getText();
					const {
						summary,
						addedLines,
						removedLines,
						formattedDiff,
					} = // Modified: added formattedDiff
						await generateFileChangeSummary(
							existingContent,
							newContent,
							step.file!
						);

					const updateChangeEntry: FileChangeEntry = {
						changeType: "modified",
						filePath: step.file!,
						summary: summary,
						addedLines: addedLines,
						removedLines: removedLines,
						timestamp: Date.now(),
						diffContent: formattedDiff, // Added diffContent
					};
					changeLogger.logChange(updateChangeEntry);

					// Log diff content before posting
					console.log(
						`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file!}:\n---\n${formattedDiff}\n---`
					);
					// Added: postChatUpdate call
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: {
							text: `Successfully updated file \`${path.basename(
								targetFilePath
							)}\`.`,
							isError: false,
						},
						diffContent: formattedDiff,
					});

					progress.report({
						message: `Successfully updated file ${path.basename(
							targetFilePath
						)}.`,
					});
				}
			} catch (error) {
				// Check for specific file not found errors
				if (
					error instanceof vscode.FileSystemError &&
					(error.code === "FileNotFound" || error.code === "EntryNotFound")
				) {
					// File does not exist, proceed with creation
					progress.report({
						message: `Creating new file: ${path.basename(targetFilePath)}...`,
					});
					await vscode.workspace.fs.writeFile(
						targetFileUri,
						Buffer.from(step.content)
					);

					const newFileContent = step.content;

					const {
						summary: createSummary,
						addedLines: createAddedLines,
						formattedDiff: createFormattedDiff,
					} = await generateFileChangeSummary("", newFileContent, step.file!); // Modified: added formattedDiff

					const createChangeEntry: FileChangeEntry = {
						changeType: "created",
						filePath: step.file!,
						summary: createSummary,
						addedLines: createAddedLines,
						removedLines: [], // Explicitly set to [] for creation
						timestamp: Date.now(),
						diffContent: createFormattedDiff, // Added diffContent
					};

					changeLogger.logChange(createChangeEntry);

					// Log diff content before posting
					console.log(
						`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file!}:\n---\n${createFormattedDiff}\n---`
					);
					// Added: postChatUpdate call
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: {
							text: `Successfully created file \`${path.basename(
								targetFilePath
							)}\`.`,
							isError: false,
						},
						diffContent: createFormattedDiff,
					});

					progress.report({
						message: `Successfully created file ${path.basename(
							targetFilePath
						)}.`,
					});
				} else {
					// Re-throw other errors encountered during stat or file system operations
					throw new Error(
						`Error accessing or creating file ${targetFilePath}: ${
							(error as Error).message
						}`
					);
				}
			}
			break;

		default:
			// For any action not explicitly implemented, throw an error.
			throw new Error(
				`Plan step action '${step.action}' is not yet implemented.`
			);
	}
}

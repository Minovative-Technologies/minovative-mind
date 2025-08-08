import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { EnhancedCodeGenerator } from "../../ai/enhancedCodeGeneration";

import { _performModification } from "./aiInteractionService";
import { AIRequestService } from "../../services/aiRequestService";
import { applyAITextEdits, cleanCodeOutput } from "../../utils/codeUtils";
import { ProjectChangeLogger } from "../../workflow/ProjectChangeLogger";
import { generateFileChangeSummary } from "../../utils/diffingUtils";
import { FileChangeEntry } from "../../types/workflow";
import { ExtensionToWebviewMessages } from "../../sidebar/common/sidebarTypes";
import { DEFAULT_FLASH_MODEL } from "../common/sidebarConstants";
import { getLanguageId } from "../../utils/codeAnalysisUtils";
import {
	EnhancedGenerationContext,
	EditorContext,
} from "../../types/codeGenerationTypes";
import { formatSuccessfulChangesForPrompt } from "../../workflow/changeHistoryFormatter";

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
	generate_prompt?: string; // ADDED: Prompt for AI-driven content generation for CreateFile
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
	}) => void,
	aiRequestService: AIRequestService,
	enhancedCodeGenerator: EnhancedCodeGenerator,
	postMessageToWebview: (message: ExtensionToWebviewMessages) => void
): Promise<void> {
	progress.report({ message: step.description });

	if (token.isCancellationRequested) {
		throw new Error("Operation cancelled by user.");
	}

	// Ensure a workspace folder is open to establish a reliable base URI
	const workspaceRootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!workspaceRootUri) {
		throw new Error(
			"No workspace folder open. Cannot perform file operations."
		);
	}

	// Retrieve the model name from VS Code settings
	const modelName: string = vscode.workspace
		.getConfiguration("minovativeMind")
		.get("modelName", DEFAULT_FLASH_MODEL);

	switch (step.action) {
		case PlanStepAction.ModifyFile:
			if (!step.file || !step.modificationPrompt) {
				throw new Error(
					"Missing file path or modification prompt for ModifyFile action."
				);
			}
			// Construct absolute file path, assuming step.file is relative to the workspace root
			const targetFileUri = vscode.Uri.joinPath(workspaceRootUri, step.file!);

			let document: vscode.TextDocument;
			let editor: vscode.TextEditor;
			let originalContent: string;

			try {
				progress.report({
					message: `Opening file: ${path.basename(targetFileUri.fsPath)}...`,
				});
				document = await vscode.workspace.openTextDocument(targetFileUri);

				progress.report({
					message: `Showing document: ${path.basename(
						targetFileUri.fsPath
					)}...`,
				});
				editor = await vscode.window.showTextDocument(document);

				originalContent = editor.document.getText();
			} catch (error: any) {
				if (
					error instanceof vscode.FileSystemError &&
					(error.code === "FileNotFound" || error.code === "EntryNotFound")
				) {
					progress.report({
						message: `File ${path.basename(
							targetFileUri.fsPath
						)} not found. Attempting to generate initial content and create it...`,
					});

					let aiGeneratedInitialContent: string;
					try {
						aiGeneratedInitialContent = await _performModification(
							"", // originalContent is empty as we're generating new content
							step.modificationPrompt,
							path.extname(targetFileUri.fsPath).substring(1), // Get language ID (e.g., 'ts' from 'file.ts')
							targetFileUri.fsPath,
							modelName,
							aiRequestService,
							enhancedCodeGenerator,
							token,
							postMessageToWebview, // Pass the new parameter
							false // isMergeOperation: false
						);
					} catch (aiError: any) {
						const errorMessage = `Failed to generate initial content for ${path.basename(
							targetFileUri.fsPath
						)}: ${aiError.message}`;
						console.error("[PlanExecutionService] " + errorMessage, aiError);
						postChatUpdate({
							type: "appendRealtimeModelMessage",
							value: { text: errorMessage, isError: true },
						});
						throw aiError; // Re-throw to stop plan execution
					}

					const createStep: PlanStep = {
						action: PlanStepAction.CreateFile,
						file: step.file,
						content: aiGeneratedInitialContent,
						description: `Creating missing file ${path.basename(
							targetFileUri.fsPath
						)} from modification prompt.`,
					};

					// Delegate to the createFile action
					await executePlanStep(
						createStep,
						token,
						progress,
						changeLogger,
						postChatUpdate,
						aiRequestService, // Pass the AIRequestService instance
						enhancedCodeGenerator,
						postMessageToWebview
					);
					return; // Exit to prevent further execution of modify logic that expects an existing file
				} else {
					// Re-throw other errors not related to file not found
					throw new Error(
						`Failed to access or open document ${targetFileUri.fsPath}: ${
							(error as Error).message
						}`
					);
				}
			}

			progress.report({
				message: `Analyzing and modifying ${path.basename(
					targetFileUri.fsPath
				)} with AI...`,
			});

			let aiModifiedContent: string;
			try {
				// Call the AI function to get modified content
				aiModifiedContent = await _performModification(
					originalContent,
					step.modificationPrompt,
					editor.document.languageId,
					editor.document.uri.fsPath,
					modelName, // Pass correct modelName
					aiRequestService, // Pass AIRequestService instance
					enhancedCodeGenerator, // Pass enhancedCodeGenerator instance
					token,
					postMessageToWebview, // Pass the new parameter
					false // isMergeOperation: false
				);
			} catch (aiError: any) {
				const errorMessage = `Failed to modify file ${path.basename(
					targetFileUri.fsPath
				)}: ${aiError.message}`;
				console.error("[PlanExecutionService] " + errorMessage, aiError);
				postChatUpdate({
					type: "appendRealtimeModelMessage",
					value: { text: errorMessage, isError: true },
				});
				throw aiError; // Re-throw to stop plan execution
			}

			if (token.isCancellationRequested) {
				throw new Error("Operation cancelled by user.");
			}

			// Apply the AI-generated changes to the editor
			await applyAITextEdits(editor, originalContent, aiModifiedContent, token);

			const newContent = editor.document.getText();
			const { summary, addedLines, removedLines, formattedDiff } =
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
				diffContent: formattedDiff,
				originalContent: originalContent, // Added
				newContent: newContent, // Added
			};
			changeLogger.logChange(newChangeEntry);

			// Log diff content before posting
			console.log(
				`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file!}:\n---\n${formattedDiff}\n---`
			);

			// Post appropriate message
			postChatUpdate({
				type: "appendRealtimeModelMessage",
				value: {
					text: `Successfully applied modifications to \`${path.basename(
						targetFileUri.fsPath
					)}\`.`,
					isError: false,
				},
				diffContent: formattedDiff,
			});

			progress.report({
				message: `Successfully applied modifications to ${path.basename(
					targetFileUri.fsPath
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

		case PlanStepAction.CreateFile: {
			let targetFileUri: vscode.Uri;
			if (!step.file) {
				// Ensure file path is always present
				throw new Error("Missing file path for CreateFile action.");
			}
			targetFileUri = vscode.Uri.joinPath(workspaceRootUri, step.file!);

			let contentToProcess: string | undefined = step.content; // Introduce local mutable variable for content

			// 1. Add a conditional check at the beginning of the case: `if (step.generate_prompt && !step.content)`.
			// This block will handle AI-driven content generation.
			if (step.generate_prompt && !step.content) {
				progress.report({
					message: `Generating content for new file: ${path.basename(
						targetFileUri.fsPath
					)}...`,
				});

				// a. Generate a unique `streamId` using `crypto.randomUUID()`.
				const streamId = crypto.randomUUID();

				// b. Define an `onCodeChunkCallback` function
				const onCodeChunkCallback = (chunk: string) => {
					postMessageToWebview({
						type: "codeFileStreamChunk",
						value: {
							streamId,
							filePath: step.file!,
							chunk,
						},
					});
				};

				// c. Construct an `EnhancedGenerationContext` object.
				const editorContext: EditorContext = {
					filePath: step.file!,
					documentUri: targetFileUri,
					fullText: "",
					selection: new vscode.Range(0, 0, 0, 0),
					selectedText: "",
					instruction: step.generate_prompt ?? "", // Added as per instructions
					languageId: getLanguageId(path.extname(step.file!)), // Added as per instructions
				};

				const generationContext: EnhancedGenerationContext = {
					editorContext: editorContext, // Constructed for the file being created.
					successfulChangeHistory: formatSuccessfulChangesForPrompt(
						changeLogger.getCompletedPlanChangeSets()
					), // Formatted from changeLogger.
					projectContext: "", // Default empty object if not readily available.
					activeSymbolInfo: undefined, // Default undefined if not readily available.
					relevantSnippets: "", // Default empty as it's not directly needed for new file creation context
					// Other properties like relevantSnippets, fileStructureAnalysis will be handled by EnhancedCodeGenerator internally if needed.
				};

				try {
					// d. Before calling the AI, send a `codeFileStreamStart` message
					const languageId = getLanguageId(path.extname(step.file!));
					postMessageToWebview({
						type: "codeFileStreamStart",
						value: { streamId, filePath: step.file!, languageId },
					});

					// e. Call `enhancedCodeGenerator.generateFileContent`
					const generatedContentResult =
						await enhancedCodeGenerator.generateFileContent(
							step.file!, // filePath
							step.generate_prompt!, // generatePrompt
							generationContext, // EnhancedGenerationContext
							modelName, // modelName
							token, // token
							undefined, // feedbackCallback (can be undefined if not needed here, or passed from main plan orchestrator)
							onCodeChunkCallback // onCodeChunkCallback
						);

					// f. Capture the `content` from the result
					let generatedContent = generatedContentResult.content;

					// g. Clean this AI-generated content
					contentToProcess = cleanCodeOutput(generatedContent);

					// End the stream after successful generation and cleaning
					postMessageToWebview({
						type: "codeFileStreamEnd",
						value: { streamId, filePath: step.file!, success: true },
					});
				} catch (aiError: any) {
					// Ensure stream ends even on error
					postMessageToWebview({
						type: "codeFileStreamEnd",
						value: {
							streamId,
							filePath: step.file!,
							success: false,
							error:
								aiError instanceof Error ? aiError.message : String(aiError),
						},
					});
					const errorMessage = `Failed to generate content for ${path.basename(
						targetFileUri.fsPath
					)}: ${aiError.message}`;
					console.error("[PlanExecutionService] " + errorMessage, aiError);
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: { text: errorMessage, isError: true },
					});
					throw aiError; // Re-throw to stop plan execution
				}
			} else if (!step.content) {
				// If generate_prompt was false/undefined AND content is also missing
				throw new Error(
					"Missing content for CreateFile action. Either 'content' or 'generate_prompt' must be provided."
				);
			} else {
				// This branch handles cases where step.content is explicitly provided.
				// As per existing logic and instructions, clean it.
				contentToProcess = cleanCodeOutput(step.content);
			}

			// Ensure contentToProcess is a string before proceeding with file operations.
			if (contentToProcess === undefined) {
				throw new Error(
					"Content to process is undefined after AI generation or content check."
				);
			}

			try {
				await vscode.workspace.fs.stat(targetFileUri); // Attempt to stat the file

				// If stat succeeds, the file exists
				const existingContentBuffer = await vscode.workspace.fs.readFile(
					targetFileUri
				);
				const existingContent = existingContentBuffer.toString();

				if (existingContent === contentToProcess) {
					progress.report({
						message: `File ${path.basename(
							targetFileUri.fsPath
						)} already has the target content. Skipping update.`,
					});
					return; // File exists and content is identical, do nothing.
				} else {
					// File exists but content differs, update it.
					progress.report({
						message: `Updating content of ${path.basename(
							targetFileUri.fsPath
						)}...`,
					});

					let documentToUpdate: vscode.TextDocument;
					try {
						documentToUpdate = await vscode.workspace.openTextDocument(
							targetFileUri
						);
					} catch (error) {
						throw new Error(
							`Failed to open document ${targetFileUri.fsPath} for update: ${
								(error as Error).message
							}`
						);
					}

					const editorToUpdate = await vscode.window.showTextDocument(
						documentToUpdate
					);

					await applyAITextEdits(
						editorToUpdate,
						existingContent,
						contentToProcess,
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
						originalContent: existingContent, // Added
						newContent: newContent, // Added
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
								targetFileUri.fsPath
							)}\`.`,
							isError: false,
						},
						diffContent: formattedDiff,
					});

					progress.report({
						message: `Successfully updated file ${path.basename(
							targetFileUri.fsPath
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
						message: `Creating new file: ${path.basename(
							targetFileUri.fsPath
						)}...`,
					});
					await vscode.workspace.fs.writeFile(
						targetFileUri,
						Buffer.from(contentToProcess) // Use cleaned content
					);

					const newFileContent = contentToProcess; // Use cleaned content

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
						originalContent: "", // Added
						newContent: newFileContent, // Added
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
								targetFileUri.fsPath
							)}\`.`,
							isError: false,
						},
						diffContent: createFormattedDiff,
					});

					progress.report({
						message: `Successfully created file ${path.basename(
							targetFileUri.fsPath
						)}.`,
					});
				} else {
					// Re-throw other errors encountered during stat or file system operations
					throw new Error(
						`Error accessing or creating file ${targetFileUri.fsPath}: ${
							(error as Error).message
						}`
					);
				}
			}
			break;
		} // End of CreateFile case block

		case PlanStepAction.DeleteFile: {
			// 1. Validate that step.file is provided; throw an error if it's not.
			if (!step.file) {
				throw new Error("Missing file path for DeleteFile action.");
			}

			// 2. Construct the targetFileUri
			const targetFileUri = vscode.Uri.joinPath(workspaceRootUri, step.file);
			const fileName = path.basename(targetFileUri.fsPath);

			let fileContentBeforeDelete: string = "";

			// 3. Read the original content of the file before deletion
			try {
				progress.report({
					message: `Reading content of ${fileName} before deletion...`,
				});
				const contentBuffer = await vscode.workspace.fs.readFile(targetFileUri);
				fileContentBeforeDelete = contentBuffer.toString();
			} catch (error: any) {
				if (
					error instanceof vscode.FileSystemError &&
					(error.code === "FileNotFound" || error.code === "EntryNotFound")
				) {
					// File not found, log a warning but proceed as if it was an empty file for diffing purposes.
					// The deletion step will handle the actual "not found" scenario for deletion itself.
					console.warn(
						`[PlanExecutionService] File ${fileName} not found for reading before deletion. Assuming empty content for logging.`
					);
					fileContentBeforeDelete = ""; // Set to empty string as per instruction
				} else {
					// Re-throw any other read errors
					throw new Error(
						`Failed to read file ${fileName} before deletion: ${
							(error as Error).message
						}`
					);
				}
			}

			// 4. Perform the file deletion
			try {
				progress.report({ message: `Deleting file: ${fileName}...` });
				// Include error handling for the deletion itself, allowing execution to proceed if 'FileNotFound' or 'EntryNotFound' errors occur.
				await vscode.workspace.fs.delete(targetFileUri, { useTrash: true });
				console.log(
					`[PlanExecutionService] Successfully deleted file: ${fileName}`
				);
			} catch (error: any) {
				if (
					error instanceof vscode.FileSystemError &&
					(error.code === "FileNotFound" || error.code === "EntryNotFound")
				) {
					// File already doesn't exist, consider it a successful "deletion" from plan perspective.
					console.warn(
						`[PlanExecutionService] File ${fileName} already not found. No deletion needed.`
					);
				} else {
					// Re-throw other deletion errors
					throw new Error(
						`Failed to delete file ${fileName}: ${(error as Error).message}`
					);
				}
			}

			// 6. Use await generateFileChangeSummary and populate removedLines
			// Summary and formattedDiff are based on originalContent (removed) and empty newContent
			const { summary, removedLines, formattedDiff } =
				await generateFileChangeSummary(
					fileContentBeforeDelete,
					"", // newContent is empty for a deletion
					step.file!
				);

			// 5. Prepare a FileChangeEntry for logging
			const deleteChangeEntry: FileChangeEntry = {
				filePath: step.file!,
				changeType: "deleted",
				originalContent: fileContentBeforeDelete,
				newContent: "", // New content is empty after deletion
				summary: summary,
				removedLines: removedLines,
				addedLines: [], // No lines added for deletion
				timestamp: Date.now(),
				diffContent: formattedDiff,
			};

			// 7. Use changeLogger.logChange()
			changeLogger.logChange(deleteChangeEntry);

			// Log diff content before posting
			console.log(
				`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file!}:\n---\n${formattedDiff}\n---`
			);

			// 8. Inform the user via postChatUpdate
			postChatUpdate({
				type: "appendRealtimeModelMessage",
				value: {
					text: `Successfully deleted \`${fileName}\`.`,
					isError: false,
				},
				diffContent: formattedDiff,
			});

			// 9. Report progress for this step
			progress.report({
				message: `Successfully deleted ${fileName}.`,
			});
			break;
		}

		default:
			// For any action not explicitly implemented, throw an error.
			throw new Error(
				`Plan step action '${step.action}' is not yet implemented.`
			);
	}
}

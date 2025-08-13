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
import { formatUserFacingErrorMessage } from "../../utils/errorFormatter";
import { ERROR_OPERATION_CANCELLED } from "../../ai/gemini";

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

/**
 * Represents the outcome of executing a single plan step,
 * signaling success/failure and the type of error for retry/skip decisions.
 */
export interface PlanStepExecutionResult {
	success: boolean;
	errorType?: "cancellation" | "transient" | "non-transient";
	errorMessage?: string;
	diffContent?: string;
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
): Promise<PlanStepExecutionResult> {
	progress.report({ message: step.description });

	if (token.isCancellationRequested) {
		return {
			success: false,
			errorType: "cancellation",
			errorMessage: "Operation cancelled by user.",
		};
	}

	const workspaceRootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!workspaceRootUri) {
		const errMsg = "No workspace folder open. Cannot perform file operations.";
		postChatUpdate({
			type: "appendRealtimeModelMessage",
			value: { text: errMsg, isError: true },
		});
		return { success: false, errorType: "non-transient", errorMessage: errMsg };
	}

	const modelName: string = vscode.workspace
		.getConfiguration("minovativeMind")
		.get("modelName", DEFAULT_FLASH_MODEL);

	let result: PlanStepExecutionResult = { success: false };

	try {
		switch (step.action) {
			case PlanStepAction.ModifyFile: {
				if (!step.file || !step.modificationPrompt) {
					const errMsg =
						"Missing file path or modification prompt for ModifyFile action.";
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: { text: errMsg, isError: true },
					});
					result = {
						success: false,
						errorType: "non-transient",
						errorMessage: errMsg,
					};
					break;
				}
				const targetFileUri = vscode.Uri.joinPath(workspaceRootUri, step.file!);
				let document: vscode.TextDocument;
				let editor: vscode.TextEditor;
				let originalContent: string;
				let aiModifiedContent: string;
				let cleanedAIContent: string; // To capture the cleaned AI output explicitly

				try {
					if (token.isCancellationRequested) {
						result = {
							success: false,
							errorType: "cancellation",
							errorMessage: "Operation cancelled by user.",
						};
						break;
					}
					progress.report({
						message: `Opening file: ${path.basename(targetFileUri.fsPath)}...`,
					});
					document = await vscode.workspace.openTextDocument(targetFileUri);
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
							if (token.isCancellationRequested) {
								result = {
									success: false,
									errorType: "cancellation",
									errorMessage: "Operation cancelled by user.",
								};
								break;
							}
							aiGeneratedInitialContent = await _performModification(
								"",
								step.modificationPrompt,
								path.extname(targetFileUri.fsPath).substring(1),
								targetFileUri.fsPath,
								modelName,
								aiRequestService,
								enhancedCodeGenerator,
								token,
								postMessageToWebview,
								false
							);
						} catch (aiError: any) {
							const errorMessage = formatUserFacingErrorMessage(
								aiError,
								`Failed to generate initial content for ${path.basename(
									targetFileUri.fsPath
								)}.`,
								"[PlanExecutionService] ",
								workspaceRootUri
							);
							postChatUpdate({
								type: "appendRealtimeModelMessage",
								value: { text: errorMessage, isError: true },
							});
							result = {
								success: false,
								errorType: aiError.message?.includes(ERROR_OPERATION_CANCELLED)
									? "cancellation"
									: aiError.message?.includes("quota exceeded") ||
									  aiError.message?.includes("rate limit exceeded") ||
									  aiError.message?.includes("network issue") ||
									  aiError.message?.includes("AI service unavailable") ||
									  aiError.message?.includes("timeout")
									? "transient"
									: "non-transient",
								errorMessage: errorMessage,
							};
							break;
						}

						const createStep: PlanStep = {
							action: PlanStepAction.CreateFile,
							file: step.file,
							content: aiGeneratedInitialContent,
							description: `Creating missing file ${path.basename(
								targetFileUri.fsPath
							)} from modification prompt.`,
						};

						const createResult = await executePlanStep(
							createStep,
							token,
							progress,
							changeLogger,
							postChatUpdate,
							aiRequestService,
							enhancedCodeGenerator,
							postMessageToWebview
						);
						// Delegate result of creation directly
						result = createResult;
						break;
					} else {
						const errorMessage = formatUserFacingErrorMessage(
							error,
							`Failed to access or open document ${targetFileUri.fsPath}.`,
							"[PlanExecutionService] ",
							workspaceRootUri
						);
						postChatUpdate({
							type: "appendRealtimeModelMessage",
							value: { text: errorMessage, isError: true },
						});
						result = {
							success: false,
							errorType: error.message?.includes(ERROR_OPERATION_CANCELLED)
								? "cancellation"
								: "non-transient",
							errorMessage: errorMessage,
						};
						break;
					}
				}
				if (!result.success && result.errorType) {
					// If a prior error in the try/catch block set the result, propagate it
					break;
				}

				if (token.isCancellationRequested) {
					result = {
						success: false,
						errorType: "cancellation",
						errorMessage: "Operation cancelled by user.",
					};
					break;
				}
				progress.report({
					message: `Analyzing and modifying ${path.basename(
						targetFileUri.fsPath
					)} with AI...`,
				});

				try {
					aiModifiedContent = await _performModification(
						originalContent,
						step.modificationPrompt,
						editor.document.languageId,
						editor.document.uri.fsPath,
						modelName,
						aiRequestService,
						enhancedCodeGenerator,
						token,
						postMessageToWebview,
						false
					);
					cleanedAIContent = aiModifiedContent; // Capture the cleaned AI output
				} catch (aiError: any) {
					const errorMessage = formatUserFacingErrorMessage(
						aiError,
						`Failed to modify file ${path.basename(targetFileUri.fsPath)}.`,
						"[PlanExecutionService] ",
						workspaceRootUri
					);
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: { text: errorMessage, isError: true },
					});
					result = {
						success: false,
						errorType: aiError.message?.includes(ERROR_OPERATION_CANCELLED)
							? "cancellation"
							: aiError.message?.includes("quota exceeded") ||
							  aiError.message?.includes("rate limit exceeded") ||
							  aiError.message?.includes("network issue") ||
							  aiError.message?.includes("AI service unavailable") ||
							  aiError.message?.includes("timeout")
							? "transient"
							: "non-transient",
						errorMessage: errorMessage,
					};
					break;
				}

				if (token.isCancellationRequested) {
					result = {
						success: false,
						errorType: "cancellation",
						errorMessage: "Operation cancelled by user.",
					};
					break;
				}

				try {
					await applyAITextEdits(
						editor,
						originalContent,
						cleanedAIContent,
						token
					);
				} catch (editError: any) {
					const errorMessage = formatUserFacingErrorMessage(
						editError,
						`Failed to apply AI text edits to ${path.basename(
							targetFileUri.fsPath
						)}.`,
						"[PlanExecutionService] ",
						workspaceRootUri
					);
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: { text: errorMessage, isError: true },
					});
					result = {
						success: false,
						errorType: editError.message?.includes(ERROR_OPERATION_CANCELLED)
							? "cancellation"
							: "non-transient",
						errorMessage: errorMessage,
					};
					break;
				}

				const { summary, addedLines, removedLines, formattedDiff } =
					await generateFileChangeSummary(
						originalContent,
						cleanedAIContent,
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
					originalContent: originalContent,
					newContent: cleanedAIContent, // Use the captured cleaned AI output
				};
				changeLogger.logChange(newChangeEntry);

				console.log(
					`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file!}:\n---\n${formattedDiff}\n---`
				);

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
				result = { success: true, diffContent: formattedDiff };
				break;
			}

			case PlanStepAction.TypeContent: {
				if (!step.file || !step.content) {
					const errMsg = "Missing file path or content for TypeContent action.";
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: { text: errMsg, isError: true },
					});
					result = {
						success: false,
						errorType: "non-transient",
						errorMessage: errMsg,
					};
					break;
				}
				const docToTypeUri = vscode.Uri.file(step.file);
				try {
					if (token.isCancellationRequested) {
						result = {
							success: false,
							errorType: "cancellation",
							errorMessage: "Operation cancelled by user.",
						};
						break;
					}
					const docToType = await vscode.workspace.openTextDocument(
						docToTypeUri
					);
					const editorToType = await vscode.window.showTextDocument(docToType);
					await typeContentIntoEditor(
						editorToType,
						step.content,
						token,
						progress
					);
					result = { success: true };
				} catch (error: any) {
					const errorMessage = formatUserFacingErrorMessage(
						error,
						`Failed to type content into editor for ${path.basename(
							docToTypeUri.fsPath
						)}.`,
						"[PlanExecutionService] ",
						workspaceRootUri
					);
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: { text: errorMessage, isError: true },
					});
					result = {
						success: false,
						errorType: error.message?.includes(ERROR_OPERATION_CANCELLED)
							? "cancellation"
							: "non-transient",
						errorMessage: errorMessage,
					};
					break;
				}
				break;
			}

			case PlanStepAction.CreateFile: {
				let targetFileUri: vscode.Uri;
				if (!step.file) {
					const errMsg = "Missing file path for CreateFile action.";
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: { text: errMsg, isError: true },
					});
					result = {
						success: false,
						errorType: "non-transient",
						errorMessage: errMsg,
					};
					break;
				}
				targetFileUri = vscode.Uri.joinPath(workspaceRootUri, step.file!);

				let contentToProcess: string | undefined = step.content;

				if (token.isCancellationRequested) {
					result = {
						success: false,
						errorType: "cancellation",
						errorMessage: "Operation cancelled by user.",
					};
					break;
				}

				if (step.generate_prompt && !step.content) {
					progress.report({
						message: `Generating content for new file: ${path.basename(
							targetFileUri.fsPath
						)}...`,
					});

					const streamId = crypto.randomUUID();
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

					const editorContext: EditorContext = {
						filePath: step.file!,
						documentUri: targetFileUri,
						fullText: "",
						selection: new vscode.Range(0, 0, 0, 0),
						selectedText: "",
						instruction: step.generate_prompt ?? "",
						languageId: getLanguageId(path.extname(step.file!)),
					};

					const generationContext: EnhancedGenerationContext = {
						editorContext: editorContext,
						successfulChangeHistory: formatSuccessfulChangesForPrompt(
							changeLogger.getCompletedPlanChangeSets()
						),
						projectContext: "",
						activeSymbolInfo: undefined,
						relevantSnippets: "",
					};

					try {
						const languageId = getLanguageId(path.extname(step.file!));
						postMessageToWebview({
							type: "codeFileStreamStart",
							value: { streamId, filePath: step.file!, languageId },
						});

						const generatedContentResult =
							await enhancedCodeGenerator.generateFileContent(
								step.file!,
								step.generate_prompt!,
								generationContext,
								modelName,
								token
							);

						contentToProcess = cleanCodeOutput(generatedContentResult.content);

						postMessageToWebview({
							type: "codeFileStreamEnd",
							value: { streamId, filePath: step.file!, success: true },
						});
					} catch (aiError: any) {
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
						const errorMessage = formatUserFacingErrorMessage(
							aiError,
							`Failed to generate content for ${path.basename(
								targetFileUri.fsPath
							)}.`,
							"[PlanExecutionService] ",
							workspaceRootUri
						);
						postChatUpdate({
							type: "appendRealtimeModelMessage",
							value: { text: errorMessage, isError: true },
						});
						result = {
							success: false,
							errorType: aiError.message?.includes(ERROR_OPERATION_CANCELLED)
								? "cancellation"
								: aiError.message?.includes("quota exceeded") ||
								  aiError.message?.includes("rate limit exceeded") ||
								  aiError.message?.includes("network issue") ||
								  aiError.message?.includes("AI service unavailable") ||
								  aiError.message?.includes("timeout")
								? "transient"
								: "non-transient",
							errorMessage: errorMessage,
						};
						break;
					}
				} else if (!step.content) {
					const errMsg =
						"Missing content for CreateFile action. Either 'content' or 'generate_prompt' must be provided.";
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: { text: errMsg, isError: true },
					});
					result = {
						success: false,
						errorType: "non-transient",
						errorMessage: errMsg,
					};
					break;
				} else {
					contentToProcess = cleanCodeOutput(step.content);
				}

				if (!result.success && result.errorType) {
					break; // Propagate error from AI generation
				}

				if (contentToProcess === undefined) {
					const errMsg =
						"Content to process is undefined after AI generation or content check.";
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: { text: errMsg, isError: true },
					});
					result = {
						success: false,
						errorType: "non-transient",
						errorMessage: errMsg,
					};
					break;
				}

				try {
					if (token.isCancellationRequested) {
						result = {
							success: false,
							errorType: "cancellation",
							errorMessage: "Operation cancelled by user.",
						};
						break;
					}
					await vscode.workspace.fs.stat(targetFileUri);

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
						result = { success: true };
					} else {
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
						} catch (error: any) {
							const errorMessage = formatUserFacingErrorMessage(
								error,
								`Failed to open document ${targetFileUri.fsPath} for update.`,
								"[PlanExecutionService] ",
								workspaceRootUri
							);
							postChatUpdate({
								type: "appendRealtimeModelMessage",
								value: { text: errorMessage, isError: true },
							});
							result = {
								success: false,
								errorType: error.message?.includes(ERROR_OPERATION_CANCELLED)
									? "cancellation"
									: "non-transient",
								errorMessage: errorMessage,
							};
							break;
						}

						const editorToUpdate = await vscode.window.showTextDocument(
							documentToUpdate
						);

						try {
							await applyAITextEdits(
								editorToUpdate,
								existingContent,
								contentToProcess,
								token
							);
						} catch (editError: any) {
							const errorMessage = formatUserFacingErrorMessage(
								editError,
								`Failed to apply AI text edits to ${path.basename(
									targetFileUri.fsPath
								)}.`,
								"[PlanExecutionService] ",
								workspaceRootUri
							);
							postChatUpdate({
								type: "appendRealtimeModelMessage",
								value: { text: errorMessage, isError: true },
							});
							result = {
								success: false,
								errorType: editError.message?.includes(
									ERROR_OPERATION_CANCELLED
								)
									? "cancellation"
									: "non-transient",
								errorMessage: errorMessage,
							};
							break;
						}
						if (!result.success && result.errorType) {
							break;
						}

						const newContentAfterEdit = editorToUpdate.document.getText(); // Actual content after edits
						const { summary, addedLines, removedLines, formattedDiff } =
							await generateFileChangeSummary(
								existingContent,
								contentToProcess, // Diff against the *intended* new content (AI's output)
								step.file!
							);

						const updateChangeEntry: FileChangeEntry = {
							changeType: "modified",
							filePath: step.file!,
							summary: summary,
							addedLines: addedLines,
							removedLines: removedLines,
							timestamp: Date.now(),
							diffContent: formattedDiff,
							originalContent: existingContent,
							newContent: contentToProcess, // Use captured cleaned AI output
						};
						changeLogger.logChange(updateChangeEntry);

						console.log(
							`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file!}:\n---\n${formattedDiff}\n---`
						);
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
						result = { success: true, diffContent: formattedDiff };
					}
				} catch (error: any) {
					if (
						error instanceof vscode.FileSystemError &&
						(error.code === "FileNotFound" || error.code === "EntryNotFound")
					) {
						progress.report({
							message: `Creating new file: ${path.basename(
								targetFileUri.fsPath
							)}...`,
						});
						try {
							if (token.isCancellationRequested) {
								result = {
									success: false,
									errorType: "cancellation",
									errorMessage: "Operation cancelled by user.",
								};
								break;
							}
							await vscode.workspace.fs.writeFile(
								targetFileUri,
								Buffer.from(contentToProcess)
							);
						} catch (writeError: any) {
							const errorMessage = formatUserFacingErrorMessage(
								writeError,
								`Failed to write content to new file ${targetFileUri.fsPath}.`,
								"[PlanExecutionService] ",
								workspaceRootUri
							);
							postChatUpdate({
								type: "appendRealtimeModelMessage",
								value: { text: errorMessage, isError: true },
							});
							result = {
								success: false,
								errorType: writeError.message?.includes(
									ERROR_OPERATION_CANCELLED
								)
									? "cancellation"
									: "non-transient",
								errorMessage: errorMessage,
							};
							break;
						}
						if (!result.success && result.errorType) {
							break;
						}

						const {
							summary: createSummary,
							addedLines: createAddedLines,
							formattedDiff: createFormattedDiff,
						} = await generateFileChangeSummary(
							"",
							contentToProcess,
							step.file!
						); // Diff against the intended new content

						const createChangeEntry: FileChangeEntry = {
							changeType: "created",
							filePath: step.file!,
							summary: createSummary,
							addedLines: createAddedLines,
							removedLines: [],
							timestamp: Date.now(),
							diffContent: createFormattedDiff,
							originalContent: "",
							newContent: contentToProcess, // Use captured cleaned AI output
						};

						changeLogger.logChange(createChangeEntry);

						console.log(
							`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file!}:\n---\n${createFormattedDiff}\n---`
						);
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
						result = { success: true, diffContent: createFormattedDiff };
					} else {
						const errorMessage = formatUserFacingErrorMessage(
							error,
							`Error accessing or creating file ${targetFileUri.fsPath}.`,
							"[PlanExecutionService] ",
							workspaceRootUri
						);
						postChatUpdate({
							type: "appendRealtimeModelMessage",
							value: { text: errorMessage, isError: true },
						});
						result = {
							success: false,
							errorType: error.message?.includes(ERROR_OPERATION_CANCELLED)
								? "cancellation"
								: "non-transient",
							errorMessage: errorMessage,
						};
					}
				}
				break;
			}

			case PlanStepAction.DeleteFile: {
				if (!step.file) {
					const errMsg = "Missing file path for DeleteFile action.";
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: { text: errMsg, isError: true },
					});
					result = {
						success: false,
						errorType: "non-transient",
						errorMessage: errMsg,
					};
					break;
				}
				const targetFileUri = vscode.Uri.joinPath(workspaceRootUri, step.file);
				const fileName = path.basename(targetFileUri.fsPath);

				let fileContentBeforeDelete: string = "";

				try {
					if (token.isCancellationRequested) {
						result = {
							success: false,
							errorType: "cancellation",
							errorMessage: "Operation cancelled by user.",
						};
						break;
					}
					progress.report({
						message: `Reading content of ${fileName} before deletion...`,
					});
					const contentBuffer = await vscode.workspace.fs.readFile(
						targetFileUri
					);
					fileContentBeforeDelete = contentBuffer.toString();
				} catch (error: any) {
					if (
						error instanceof vscode.FileSystemError &&
						(error.code === "FileNotFound" || error.code === "EntryNotFound")
					) {
						console.warn(
							`[PlanExecutionService] File ${fileName} not found for reading before deletion. Assuming empty content for logging.`
						);
						fileContentBeforeDelete = "";
					} else {
						const errorMessage = formatUserFacingErrorMessage(
							error,
							`Failed to read file ${fileName} before deletion.`,
							"[PlanExecutionService] ",
							workspaceRootUri
						);
						postChatUpdate({
							type: "appendRealtimeModelMessage",
							value: { text: errorMessage, isError: true },
						});
						result = {
							success: false,
							errorType: error.message?.includes(ERROR_OPERATION_CANCELLED)
								? "cancellation"
								: "non-transient",
							errorMessage: errorMessage,
						};
						break;
					}
				}
				if (!result.success && result.errorType) {
					break;
				}

				try {
					if (token.isCancellationRequested) {
						result = {
							success: false,
							errorType: "cancellation",
							errorMessage: "Operation cancelled by user.",
						};
						break;
					}
					progress.report({ message: `Deleting file: ${fileName}...` });
					await vscode.workspace.fs.delete(targetFileUri, { useTrash: true });
					console.log(
						`[PlanExecutionService] Successfully deleted file: ${fileName}`
					);
				} catch (error: any) {
					if (
						error instanceof vscode.FileSystemError &&
						(error.code === "FileNotFound" || error.code === "EntryNotFound")
					) {
						console.warn(
							`[PlanExecutionService] File ${fileName} already not found. No deletion needed.`
						);
					} else {
						const errorMessage = formatUserFacingErrorMessage(
							error,
							`Failed to delete file ${fileName}.`,
							"[PlanExecutionService] ",
							workspaceRootUri
						);
						postChatUpdate({
							type: "appendRealtimeModelMessage",
							value: { text: errorMessage, isError: true },
						});
						result = {
							success: false,
							errorType: error.message?.includes(ERROR_OPERATION_CANCELLED)
								? "cancellation"
								: "non-transient",
							errorMessage: errorMessage,
						};
						break;
					}
				}
				if (!result.success && result.errorType) {
					break;
				}

				const { summary, removedLines, formattedDiff } =
					await generateFileChangeSummary(
						fileContentBeforeDelete,
						"",
						step.file!
					);

				const deleteChangeEntry: FileChangeEntry = {
					filePath: step.file!,
					changeType: "deleted",
					originalContent: fileContentBeforeDelete,
					newContent: "",
					summary: summary,
					removedLines: removedLines,
					addedLines: [],
					timestamp: Date.now(),
					diffContent: formattedDiff,
				};

				changeLogger.logChange(deleteChangeEntry);

				console.log(
					`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file!}:\n---\n${formattedDiff}\n---`
				);

				postChatUpdate({
					type: "appendRealtimeModelMessage",
					value: {
						text: `Successfully deleted \`${fileName}\`.`,
						isError: false,
					},
					diffContent: formattedDiff,
				});

				progress.report({
					message: `Successfully deleted ${fileName}.`,
				});
				result = { success: true, diffContent: formattedDiff };
				break;
			}

			default: {
				const errMsg = `Plan step action '${step.action}' is not yet implemented.`;
				postChatUpdate({
					type: "appendRealtimeModelMessage",
					value: { text: errMsg, isError: true },
				});
				result = {
					success: false,
					errorType: "non-transient",
					errorMessage: errMsg,
				};
				break;
			}
		}
	} catch (globalError: any) {
		// This catch block will primarily catch errors not caught by more specific try/catch blocks within the switch,
		// or re-thrown cancellation errors.
		const errorMessage = formatUserFacingErrorMessage(
			globalError,
			`An unexpected error occurred during plan step execution.`,
			"[PlanExecutionService] ",
			workspaceRootUri
		);
		let errorType: PlanStepExecutionResult["errorType"] = "non-transient";
		if (errorMessage.includes(ERROR_OPERATION_CANCELLED)) {
			errorType = "cancellation";
		} else if (
			errorMessage.includes("quota exceeded") ||
			errorMessage.includes("rate limit exceeded") ||
			errorMessage.includes("network issue") ||
			errorMessage.includes("AI service unavailable") ||
			errorMessage.includes("timeout")
		) {
			errorType = "transient";
		}
		postChatUpdate({
			type: "appendRealtimeModelMessage",
			value: { text: errorMessage, isError: true },
		});
		result = {
			success: false,
			errorType: errorType,
			errorMessage: errorMessage,
		};
	}

	return result;
}

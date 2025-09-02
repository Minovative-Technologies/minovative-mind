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

async function _handleTypeContentAction(
	step: PlanStep,
	token: vscode.CancellationToken,
	progress: vscode.Progress<{ message?: string; increment?: number }>,
	reportErrorAndReturnResult: (
		error: any,
		defaultMessage: string,
		filePath: string | undefined,
		actionType: PlanStepAction
	) => PlanStepExecutionResult,
	postChatUpdate: (message: {
		type: string;
		value: { text: string; isError?: boolean };
		diffContent?: string;
	}) => void,
	workspaceRootUri: vscode.Uri
): Promise<PlanStepExecutionResult> {
	if (token.isCancellationRequested) {
		throw new Error(ERROR_OPERATION_CANCELLED);
	}
	if (!step.file || !step.content) {
		const errMsg = "Missing file path or content for TypeContent action.";
		return reportErrorAndReturnResult(
			new Error(errMsg),
			errMsg,
			step.file,
			PlanStepAction.TypeContent
		);
	}
	const docToTypeUri = vscode.Uri.file(step.file);
	try {
		const docToType = await vscode.workspace.openTextDocument(docToTypeUri);
		const editorToType = await vscode.window.showTextDocument(docToType);
		await typeContentIntoEditor(editorToType, step.content, token, progress);
		return { success: true };
	} catch (error: any) {
		return reportErrorAndReturnResult(
			error,
			`Failed to type content into editor for ${path.basename(
				docToTypeUri.fsPath
			)}.`,
			step.file,
			PlanStepAction.TypeContent
		);
	}
}

async function _handleDeleteFileAction(
	step: PlanStep,
	token: vscode.CancellationToken,
	progress: vscode.Progress<{ message?: string; increment?: number }>,
	changeLogger: ProjectChangeLogger,
	postChatUpdate: (message: {
		type: string;
		value: { text: string; isError?: boolean };
		diffContent?: string;
	}) => void,
	workspaceRootUri: vscode.Uri,
	reportErrorAndReturnResult: (
		error: any,
		defaultMessage: string,
		filePath: string | undefined,
		actionType: PlanStepAction
	) => PlanStepExecutionResult
): Promise<PlanStepExecutionResult> {
	if (token.isCancellationRequested) {
		throw new Error(ERROR_OPERATION_CANCELLED);
	}
	if (!step.file) {
		const errMsg = "Missing file path for DeleteFile action.";
		return reportErrorAndReturnResult(
			new Error(errMsg),
			errMsg,
			step.file,
			PlanStepAction.DeleteFile
		);
	}
	const targetFileUri = vscode.Uri.joinPath(workspaceRootUri, step.file);
	const fileName = path.basename(targetFileUri.fsPath);

	let fileContentBeforeDelete: string = "";

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
			console.warn(
				`[PlanExecutionService] File ${fileName} not found for reading before deletion. Assuming empty content for logging.`
			);
			fileContentBeforeDelete = "";
		} else {
			return reportErrorAndReturnResult(
				error,
				`Failed to read file ${fileName} before deletion.`,
				step.file,
				PlanStepAction.DeleteFile
			);
		}
	}

	try {
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
			return reportErrorAndReturnResult(
				error,
				`Failed to delete file ${fileName}.`,
				step.file,
				PlanStepAction.DeleteFile
			);
		}
	}

	const { summary, removedLines, formattedDiff } =
		await generateFileChangeSummary(fileContentBeforeDelete, "", step.file);

	const deleteChangeEntry: FileChangeEntry = {
		filePath: step.file,
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
		`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file}:\n---\n${formattedDiff}\n---`
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
	return { success: true, diffContent: formattedDiff };
}

async function _handleCreateFileAction(
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
	postMessageToWebview: (message: ExtensionToWebviewMessages) => void,
	workspaceRootUri: vscode.Uri,
	modelName: string,
	reportErrorAndReturnResult: (
		error: any,
		defaultMessage: string,
		filePath: string | undefined,
		actionType: PlanStepAction
	) => PlanStepExecutionResult
): Promise<PlanStepExecutionResult> {
	if (token.isCancellationRequested) {
		throw new Error(ERROR_OPERATION_CANCELLED);
	}
	if (!step.file) {
		const errMsg = "Missing file path for CreateFile action.";
		return reportErrorAndReturnResult(
			new Error(errMsg),
			errMsg,
			step.file,
			PlanStepAction.CreateFile
		);
	}
	const targetFileUri = vscode.Uri.joinPath(workspaceRootUri, step.file);

	let contentToProcess: string | undefined = step.content;

	if (step.generate_prompt && !step.content) {
		progress.report({
			message: `Generating content for new file: ${path.basename(
				targetFileUri.fsPath
			)}...`,
		});

		const streamId = crypto.randomUUID();

		const editorContext: EditorContext = {
			filePath: step.file,
			documentUri: targetFileUri,
			fullText: "",
			selection: new vscode.Range(0, 0, 0, 0),
			selectedText: "",
			instruction: step.generate_prompt ?? "",
			languageId: getLanguageId(path.extname(step.file)),
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
			const languageId = getLanguageId(path.extname(step.file));
			postMessageToWebview({
				type: "codeFileStreamStart",
				value: { streamId, filePath: step.file, languageId },
			});

			const generatedContentResult =
				await enhancedCodeGenerator.generateFileContent(
					step.file,
					step.generate_prompt,
					generationContext,
					modelName,
					token
				);

			contentToProcess = cleanCodeOutput(generatedContentResult.content);

			postMessageToWebview({
				type: "codeFileStreamEnd",
				value: { streamId, filePath: step.file, success: true },
			});
		} catch (aiError: any) {
			postMessageToWebview({
				type: "codeFileStreamEnd",
				value: {
					streamId,
					filePath: step.file,
					success: false,
					error: aiError instanceof Error ? aiError.message : String(aiError),
				},
			});
			return reportErrorAndReturnResult(
				aiError,
				`Failed to generate content for ${path.basename(
					targetFileUri.fsPath
				)}.`,
				step.file,
				PlanStepAction.CreateFile
			);
		}
	} else if (!step.content) {
		const errMsg =
			"Missing content for CreateFile action. Either 'content' or 'generate_prompt' must be provided.";
		return reportErrorAndReturnResult(
			new Error(errMsg),
			errMsg,
			step.file,
			PlanStepAction.CreateFile
		);
	} else {
		contentToProcess = cleanCodeOutput(step.content);
	}

	if (contentToProcess === undefined) {
		const errMsg =
			"Content to process is undefined after AI generation or content check.";
		return reportErrorAndReturnResult(
			new Error(errMsg),
			errMsg,
			step.file,
			PlanStepAction.CreateFile
		);
	}

	try {
		await vscode.workspace.fs.stat(targetFileUri); // Check if file exists

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
			return { success: true };
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
				return reportErrorAndReturnResult(
					error,
					`Failed to open document ${targetFileUri.fsPath} for update.`,
					step.file,
					PlanStepAction.CreateFile
				);
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
				return reportErrorAndReturnResult(
					editError,
					`Failed to apply AI text edits to ${path.basename(
						targetFileUri.fsPath
					)}.`,
					step.file,
					PlanStepAction.CreateFile
				);
			}

			const { summary, addedLines, removedLines, formattedDiff } =
				await generateFileChangeSummary(
					existingContent,
					contentToProcess,
					step.file
				);

			const updateChangeEntry: FileChangeEntry = {
				changeType: "modified",
				filePath: step.file,
				summary: summary,
				addedLines: addedLines,
				removedLines: removedLines,
				timestamp: Date.now(),
				diffContent: formattedDiff,
				originalContent: existingContent,
				newContent: contentToProcess,
			};
			changeLogger.logChange(updateChangeEntry);

			console.log(
				`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file}:\n---\n${formattedDiff}\n---`
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
			return { success: true, diffContent: formattedDiff };
		}
	} catch (error: any) {
		if (
			error instanceof vscode.FileSystemError &&
			(error.code === "FileNotFound" || error.code === "EntryNotFound")
		) {
			progress.report({
				message: `Creating new file: ${path.basename(targetFileUri.fsPath)}...`,
			});
			try {
				await vscode.workspace.fs.writeFile(
					targetFileUri,
					Buffer.from(contentToProcess)
				);
			} catch (writeError: any) {
				return reportErrorAndReturnResult(
					writeError,
					`Failed to write content to new file ${targetFileUri.fsPath}.`,
					step.file,
					PlanStepAction.CreateFile
				);
			}

			const {
				summary: createSummary,
				addedLines: createAddedLines,
				formattedDiff: createFormattedDiff,
			} = await generateFileChangeSummary("", contentToProcess, step.file);

			const createChangeEntry: FileChangeEntry = {
				changeType: "created",
				filePath: step.file,
				summary: createSummary,
				addedLines: createAddedLines,
				removedLines: [],
				timestamp: Date.now(),
				diffContent: createFormattedDiff,
				originalContent: "",
				newContent: contentToProcess,
			};

			changeLogger.logChange(createChangeEntry);

			console.log(
				`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file}:\n---\n${createFormattedDiff}\n---`
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
			return { success: true, diffContent: createFormattedDiff };
		} else {
			return reportErrorAndReturnResult(
				error,
				`Error accessing or creating file ${targetFileUri.fsPath}.`,
				step.file,
				PlanStepAction.CreateFile
			);
		}
	}
}

async function _handleModifyFileAction(
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
	postMessageToWebview: (message: ExtensionToWebviewMessages) => void,
	workspaceRootUri: vscode.Uri,
	modelName: string,
	reportErrorAndReturnResult: (
		error: any,
		defaultMessage: string,
		filePath: string | undefined,
		actionType: PlanStepAction
	) => PlanStepExecutionResult,
	_handleCreateFileAction: (
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
		postMessageToWebview: (message: ExtensionToWebviewMessages) => void,
		workspaceRootUri: vscode.Uri,
		modelName: string,
		reportErrorAndReturnResult: (
			error: any,
			defaultMessage: string,
			filePath: string | undefined,
			actionType: PlanStepAction
		) => PlanStepExecutionResult
	) => Promise<PlanStepExecutionResult>
): Promise<PlanStepExecutionResult> {
	if (token.isCancellationRequested) {
		throw new Error(ERROR_OPERATION_CANCELLED);
	}
	if (!step.file || !step.modificationPrompt) {
		const errMsg =
			"Missing file path or modification prompt for ModifyFile action.";
		return reportErrorAndReturnResult(
			new Error(errMsg),
			errMsg,
			step.file,
			PlanStepAction.ModifyFile
		);
	}
	const targetFileUri = vscode.Uri.joinPath(workspaceRootUri, step.file);
	let document: vscode.TextDocument;
	let editor: vscode.TextEditor;
	let originalContent: string;
	let aiModifiedContent: string;
	let cleanedAIContent: string;

	try {
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

			const createStep: PlanStep = {
				action: PlanStepAction.CreateFile,
				file: step.file,
				generate_prompt: step.modificationPrompt, // Use modification prompt for content generation
				description: `Creating missing file ${path.basename(
					targetFileUri.fsPath
				)} from modification prompt.`,
			};

			// Delegate to _handleCreateFileAction for creation
			return await _handleCreateFileAction(
				createStep,
				token,
				progress,
				changeLogger,
				postChatUpdate,
				aiRequestService,
				enhancedCodeGenerator,
				postMessageToWebview,
				workspaceRootUri,
				modelName,
				reportErrorAndReturnResult
			);
		} else {
			return reportErrorAndReturnResult(
				error,
				`Failed to access or open document ${targetFileUri.fsPath}.`,
				step.file,
				PlanStepAction.ModifyFile
			);
		}
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
		cleanedAIContent = aiModifiedContent;
	} catch (aiError: any) {
		return reportErrorAndReturnResult(
			aiError,
			`Failed to modify file ${path.basename(targetFileUri.fsPath)}.`,
			step.file,
			PlanStepAction.ModifyFile
		);
	}

	try {
		await applyAITextEdits(editor, originalContent, cleanedAIContent, token);
	} catch (editError: any) {
		return reportErrorAndReturnResult(
			editError,
			`Failed to apply AI text edits to ${path.basename(
				targetFileUri.fsPath
			)}.`,
			step.file,
			PlanStepAction.ModifyFile
		);
	}

	const { summary, addedLines, removedLines, formattedDiff } =
		await generateFileChangeSummary(
			originalContent,
			cleanedAIContent,
			step.file
		);

	const newChangeEntry: FileChangeEntry = {
		changeType: "modified",
		filePath: step.file,
		summary: summary,
		addedLines: addedLines,
		removedLines: removedLines,
		timestamp: Date.now(),
		diffContent: formattedDiff,
		originalContent: originalContent,
		newContent: cleanedAIContent,
	};
	changeLogger.logChange(newChangeEntry);

	console.log(
		`[MinovativeMind:PlanExecutionService] Posting message with diffContent for ${step.file}:\n---\n${formattedDiff}\n---`
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
	return { success: true, diffContent: formattedDiff };
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

	// Define reportErrorAndReturnResult local helper function
	const reportErrorAndReturnResult = (
		error: any,
		defaultMessage: string,
		filePath: string | undefined,
		actionType: PlanStepAction
	): PlanStepExecutionResult => {
		let errorType: PlanStepExecutionResult["errorType"] = "non-transient";
		const errorMessage = formatUserFacingErrorMessage(
			error,
			defaultMessage,
			`[PlanExecutionService:${actionType}] `,
			workspaceRootUri
		);

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
			value: {
				text: filePath
					? `Error processing file \`${path.basename(
							filePath
					  )}\`: ${errorMessage}`
					: `Error: ${errorMessage}`,
				isError: true,
			},
		});

		return {
			success: false,
			errorType: errorType,
			errorMessage: errorMessage,
		};
	};

	try {
		switch (step.action) {
			case PlanStepAction.ModifyFile: {
				return await _handleModifyFileAction(
					step,
					token,
					progress,
					changeLogger,
					postChatUpdate,
					aiRequestService,
					enhancedCodeGenerator,
					postMessageToWebview,
					workspaceRootUri,
					modelName,
					reportErrorAndReturnResult,
					_handleCreateFileAction // Pass the create file handler
				);
			}

			case PlanStepAction.TypeContent: {
				return await _handleTypeContentAction(
					step,
					token,
					progress,
					reportErrorAndReturnResult,
					postChatUpdate,
					workspaceRootUri
				);
			}

			case PlanStepAction.CreateFile: {
				return await _handleCreateFileAction(
					step,
					token,
					progress,
					changeLogger,
					postChatUpdate,
					aiRequestService,
					enhancedCodeGenerator,
					postMessageToWebview,
					workspaceRootUri,
					modelName,
					reportErrorAndReturnResult
				);
			}

			case PlanStepAction.DeleteFile: {
				return await _handleDeleteFileAction(
					step,
					token,
					progress,
					changeLogger,
					postChatUpdate,
					workspaceRootUri,
					reportErrorAndReturnResult
				);
			}

			case PlanStepAction.ViewFile: {
				if (!step.file) {
					const errMsg = "Missing file path for ViewFile action.";
					return reportErrorAndReturnResult(
						new Error(errMsg),
						errMsg,
						step.file,
						PlanStepAction.ViewFile
					);
				}
				const fileUri = vscode.Uri.joinPath(workspaceRootUri, step.file);
				try {
					await vscode.window.showTextDocument(fileUri, { preview: true });
					progress.report({
						message: `Viewing file: ${path.basename(fileUri.fsPath)}`,
					});
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: {
							text: `Opened file \`${path.basename(fileUri.fsPath)}\`.`,
							isError: false,
						},
					});
					return { success: true };
				} catch (error: any) {
					return reportErrorAndReturnResult(
						error,
						`Failed to open file ${path.basename(fileUri.fsPath)} for viewing.`,
						step.file,
						PlanStepAction.ViewFile
					);
				}
			}

			case PlanStepAction.ExecuteCommand: {
				if (!step.command) {
					const errMsg = "Missing command for ExecuteCommand action.";
					return reportErrorAndReturnResult(
						new Error(errMsg),
						errMsg,
						undefined,
						PlanStepAction.ExecuteCommand
					);
				}
				try {
					progress.report({
						message: `Executing command: ${step.command} ${
							step.args ? step.args.join(" ") : ""
						}`,
					});
					// Note: vscode.commands.executeCommand is for VS Code commands, not shell commands.
					// If shell commands are intended, a different execution mechanism would be needed.
					// For now, assume VS Code commands.
					await vscode.commands.executeCommand(
						step.command,
						...(step.args || [])
					);
					postChatUpdate({
						type: "appendRealtimeModelMessage",
						value: {
							text: `Successfully executed command \`${step.command}\`.`,
							isError: false,
						},
					});
					return { success: true };
				} catch (error: any) {
					return reportErrorAndReturnResult(
						error,
						`Failed to execute command ${step.command}.`,
						undefined,
						PlanStepAction.ExecuteCommand
					);
				}
			}

			case PlanStepAction.ShowMessage: {
				if (!step.message) {
					const errMsg = "Missing message for ShowMessage action.";
					return reportErrorAndReturnResult(
						new Error(errMsg),
						errMsg,
						undefined,
						PlanStepAction.ShowMessage
					);
				}
				vscode.window.showInformationMessage(step.message);
				postChatUpdate({
					type: "appendRealtimeModelMessage",
					value: { text: `Message: ${step.message}`, isError: false },
				});
				return { success: true };
			}

			default: {
				const errMsg = `Plan step action '${step.action}' is not yet implemented.`;
				return reportErrorAndReturnResult(
					new Error(errMsg),
					errMsg,
					undefined,
					step.action
				);
			}
		}
	} catch (globalError: any) {
		if (globalError.message === ERROR_OPERATION_CANCELLED) {
			throw globalError; // Re-throw cancellation error to be handled by the outer loop
		}
		// This catch block will primarily catch errors not caught by more specific try/catch blocks within the switch,
		// or re-thrown cancellation errors if not caught earlier.
		return reportErrorAndReturnResult(
			globalError,
			`An unexpected error occurred during plan step execution.`,
			step.file,
			step.action
		);
	}
}

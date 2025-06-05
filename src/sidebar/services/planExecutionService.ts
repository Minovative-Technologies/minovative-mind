// src/sidebar/services/planExecutionService.ts
import * as vscode from "vscode";
import * as path from "path";

// New imports for AI interaction and code utilities
import { _performModification } from "./aiInteractionService"; // Assuming this path based on "aiInteractionService.ts"
import { applyAITextEdits } from "../../utils/codeUtils";

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
	// Add other properties as needed for different actions
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
		// Add a small delay only if not cancelled
		if (!token.isCancellationRequested) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
}

export async function executePlanStep(
	step: PlanStep,
	token: vscode.CancellationToken,
	progress: vscode.Progress<{ message?: string; increment?: number }>
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

			const currentContent = editor.document.getText();

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
				currentContent,
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

		// Add other cases here as they are implemented in the future
		// case PlanStepAction.CreateFile:
		// case PlanStepAction.DeleteFile:
		// case PlanStepAction.ViewFile:
		// case PlanStepAction.ExecuteCommand:
		// case PlanStepAction.ShowMessage:

		default:
			// For any action not explicitly implemented, throw an error.
			throw new Error(
				`Plan step action '${step.action}' is not yet implemented.`
			);
	}
}

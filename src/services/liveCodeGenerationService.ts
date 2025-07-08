import * as vscode from "vscode";
import { AIRequestService } from "./aiRequestService";
import { EnhancedCodeGenerator } from "../ai/enhancedCodeGeneration";
import { ActiveSymbolDetailedInfo } from "./contextService";

/**
 * Interface for live code generation feedback
 */
interface LiveGenerationFeedback {
	stage: string;
	message: string;
	progress: number;
	currentContent: string;
	chunksGenerated: number;
	totalChunks: number;
}

/**
 * Configuration for live code generation
 */
interface LiveGenerationConfig {
	chunkSize: number; // Characters per chunk
	delayMs: number; // Delay between chunks
	showTypingAnimation: boolean;
	enableRealTimeValidation: boolean;
	maxValidationIterations: number;
}

/**
 * Service for live code generation that shows AI typing code directly in the editor
 */
export class LiveCodeGenerationService {
	private enhancedGenerator: EnhancedCodeGenerator;

	constructor(
		private aiRequestService: AIRequestService,
		private workspaceRoot: vscode.Uri,
		private config: LiveGenerationConfig = {
			chunkSize: 3, // Small chunks for realistic typing effect
			delayMs: 50, // 50ms delay between chunks
			showTypingAnimation: true,
			enableRealTimeValidation: true,
			maxValidationIterations: 3,
		}
	) {
		this.enhancedGenerator = new EnhancedCodeGenerator(
			aiRequestService,
			workspaceRoot,
			{
				enableInlineEdits: true,
				enableRealTimeFeedback: true,
				maxFeedbackIterations: config.maxValidationIterations,
			}
		);
	}

	/**
	 * Generate code live in the editor, showing the AI typing in real-time
	 */
	public async generateCodeLive(
		editor: vscode.TextEditor,
		generatePrompt: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
		},
		modelName: string,
		token: vscode.CancellationToken,
		feedbackCallback?: (feedback: LiveGenerationFeedback) => void
	): Promise<{ content: string; validation: any }> {
		const filePath = editor.document.uri.fsPath;
		let currentContent = "";
		let chunksGenerated = 0;
		let totalChunks = 0;

		// Send initial feedback
		this._sendFeedback(feedbackCallback, {
			stage: "initialization",
			message: "Starting live code generation...",
			progress: 0,
			currentContent: "",
			chunksGenerated: 0,
			totalChunks: 0,
		});

		try {
			// Step 1: Generate the complete content first (but don't show it yet)
			this._sendFeedback(feedbackCallback, {
				stage: "preparation",
				message: "Preparing code structure...",
				progress: 10,
				currentContent: "",
				chunksGenerated: 0,
				totalChunks: 0,
			});

			const generationResult = await this.enhancedGenerator.generateFileContent(
				filePath,
				generatePrompt,
				context,
				modelName,
				token,
				(feedback) => {
					// Convert enhanced generator feedback to live feedback
					this._sendFeedback(feedbackCallback, {
						stage: `preparation_${feedback.stage}`,
						message: feedback.message,
						progress: 10 + feedback.progress * 0.3, // Preparation takes 30% of total time
						currentContent: "",
						chunksGenerated: 0,
						totalChunks: 0,
					});
				}
			);

			const finalContent = generationResult.content;
			totalChunks = Math.ceil(finalContent.length / this.config.chunkSize);

			this._sendFeedback(feedbackCallback, {
				stage: "typing_start",
				message: "Starting live code typing...",
				progress: 40,
				currentContent: "",
				chunksGenerated: 0,
				totalChunks,
			});

			// Step 2: Type the content into the editor chunk by chunk
			await this._typeContentLive(
				editor,
				finalContent,
				token,
				feedbackCallback,
				chunksGenerated,
				totalChunks
			);

			// Step 3: Real-time validation and correction if enabled
			if (this.config.enableRealTimeValidation) {
				await this._performLiveValidation(
					editor,
					filePath,
					context,
					modelName,
					token,
					feedbackCallback
				);
			}

			this._sendFeedback(feedbackCallback, {
				stage: "completion",
				message: "Live code generation completed!",
				progress: 100,
				currentContent: editor.document.getText(),
				chunksGenerated: totalChunks,
				totalChunks,
			});

			return {
				content: editor.document.getText(),
				validation: generationResult.validation,
			};
		} catch (error) {
			this._sendFeedback(feedbackCallback, {
				stage: "error",
				message: `Live generation failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
				progress: 100,
				currentContent: editor.document.getText(),
				chunksGenerated,
				totalChunks,
			});
			throw error;
		}
	}

	/**
	 * Modify existing code live in the editor
	 */
	public async modifyCodeLive(
		editor: vscode.TextEditor,
		modificationPrompt: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
		},
		modelName: string,
		token: vscode.CancellationToken,
		feedbackCallback?: (feedback: LiveGenerationFeedback) => void
	): Promise<{ content: string; validation: any }> {
		const filePath = editor.document.uri.fsPath;
		const originalContent = editor.document.getText();

		this._sendFeedback(feedbackCallback, {
			stage: "modification_start",
			message: "Starting live code modification...",
			progress: 0,
			currentContent: originalContent,
			chunksGenerated: 0,
			totalChunks: 0,
		});

		try {
			// Step 1: Generate the modified content
			const modificationResult = await this.enhancedGenerator.modifyFileContent(
				filePath,
				modificationPrompt,
				originalContent,
				context,
				modelName,
				token
			);

			const modifiedContent = modificationResult.content;
			const totalChunks = Math.ceil(
				modifiedContent.length / this.config.chunkSize
			);

			this._sendFeedback(feedbackCallback, {
				stage: "typing_start",
				message: "Applying modifications live...",
				progress: 30,
				currentContent: originalContent,
				chunksGenerated: 0,
				totalChunks,
			});

			// Step 2: Clear the editor and type the new content
			await editor.edit((editBuilder) => {
				const fullRange = new vscode.Range(
					editor.document.positionAt(0),
					editor.document.positionAt(originalContent.length)
				);
				editBuilder.replace(fullRange, "");
			});

			// Step 3: Type the modified content live
			await this._typeContentLive(
				editor,
				modifiedContent,
				token,
				feedbackCallback,
				0,
				totalChunks
			);

			this._sendFeedback(feedbackCallback, {
				stage: "completion",
				message: "Live code modification completed!",
				progress: 100,
				currentContent: editor.document.getText(),
				chunksGenerated: totalChunks,
				totalChunks,
			});

			return {
				content: editor.document.getText(),
				validation: modificationResult.validation,
			};
		} catch (error) {
			this._sendFeedback(feedbackCallback, {
				stage: "error",
				message: `Live modification failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
				progress: 100,
				currentContent: editor.document.getText(),
				chunksGenerated: 0,
				totalChunks: 0,
			});
			throw error;
		}
	}

	/**
	 * Type content into editor with live animation
	 */
	private async _typeContentLive(
		editor: vscode.TextEditor,
		content: string,
		token: vscode.CancellationToken,
		feedbackCallback?: (feedback: LiveGenerationFeedback) => void,
		startChunks = 0,
		totalChunks = 0
	): Promise<void> {
		let chunksGenerated = startChunks;

		for (let i = 0; i < content.length; i += this.config.chunkSize) {
			if (token.isCancellationRequested) {
				throw new Error("Live generation cancelled by user.");
			}

			const chunk = content.substring(
				i,
				Math.min(i + this.config.chunkSize, content.length)
			);
			chunksGenerated++;

			// Apply the chunk to the editor
			await editor.edit((editBuilder) => {
				const endPosition = editor.document.positionAt(
					editor.document.getText().length
				);
				editBuilder.insert(endPosition, chunk);
			});

			// Reveal the last line to keep it in view
			const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
			editor.revealRange(lastLine.range, vscode.TextEditorRevealType.Default);

			// Send progress feedback
			this._sendFeedback(feedbackCallback, {
				stage: "typing",
				message: `Typing code... (${chunksGenerated}/${totalChunks} chunks)`,
				progress: 40 + (chunksGenerated / totalChunks) * 40, // 40-80% for typing
				currentContent: editor.document.getText(),
				chunksGenerated,
				totalChunks,
			});

			// Add delay for realistic typing effect
			if (!token.isCancellationRequested && this.config.delayMs > 0) {
				await new Promise((resolve) =>
					setTimeout(resolve, this.config.delayMs)
				);
			}
		}
	}

	/**
	 * Perform live validation and correction
	 */
	private async _performLiveValidation(
		editor: vscode.TextEditor,
		filePath: string,
		context: any,
		modelName: string,
		token: vscode.CancellationToken,
		feedbackCallback?: (feedback: LiveGenerationFeedback) => void
	): Promise<void> {
		this._sendFeedback(feedbackCallback, {
			stage: "validation_start",
			message: "Validating generated code...",
			progress: 80,
			currentContent: editor.document.getText(),
			chunksGenerated: 0,
			totalChunks: 0,
		});

		// Get current content from editor
		const currentContent = editor.document.getText();

		// Validate the content
		const validation = await this.enhancedGenerator["_validateCode"](
			filePath,
			currentContent
		);

		if (validation.issues.length > 0) {
			this._sendFeedback(feedbackCallback, {
				stage: "correction_start",
				message: `Found ${validation.issues.length} issues, applying corrections...`,
				progress: 85,
				currentContent,
				chunksGenerated: 0,
				totalChunks: 0,
			});

			// Apply corrections live
			const correctedContent = await this.enhancedGenerator[
				"_applyRealTimeCorrections"
			](filePath, currentContent, validation.issues, context, modelName, token);

			// Type the corrections live
			if (correctedContent !== currentContent) {
				await this._typeCorrectionsLive(
					editor,
					currentContent,
					correctedContent,
					token,
					feedbackCallback
				);
			}
		}

		this._sendFeedback(feedbackCallback, {
			stage: "validation_complete",
			message: "Code validation completed!",
			progress: 95,
			currentContent: editor.document.getText(),
			chunksGenerated: 0,
			totalChunks: 0,
		});
	}

	/**
	 * Type corrections live in the editor
	 */
	private async _typeCorrectionsLive(
		editor: vscode.TextEditor,
		originalContent: string,
		correctedContent: string,
		token: vscode.CancellationToken,
		feedbackCallback?: (feedback: LiveGenerationFeedback) => void
	): Promise<void> {
		// Clear the editor
		await editor.edit((editBuilder) => {
			const fullRange = new vscode.Range(
				editor.document.positionAt(0),
				editor.document.positionAt(originalContent.length)
			);
			editBuilder.replace(fullRange, "");
		});

		// Type the corrected content
		const totalChunks = Math.ceil(
			correctedContent.length / this.config.chunkSize
		);
		await this._typeContentLive(
			editor,
			correctedContent,
			token,
			feedbackCallback,
			0,
			totalChunks
		);
	}

	/**
	 * Send feedback to callback if provided
	 */
	private _sendFeedback(
		callback?: (feedback: LiveGenerationFeedback) => void,
		feedback?: LiveGenerationFeedback
	): void {
		if (callback && feedback) {
			try {
				callback(feedback);
			} catch (error) {
				console.warn("Error in feedback callback:", error);
			}
		}
	}

	/**
	 * Update configuration
	 */
	public updateConfig(newConfig: Partial<LiveGenerationConfig>): void {
		this.config = { ...this.config, ...newConfig };
	}
}

import * as vscode from "vscode";
import { AIRequestService } from "./aiRequestService";
import {
	EnhancedCodeGenerator,
	InlineEditInstruction,
} from "../ai/enhancedCodeGeneration";
import { ActiveSymbolDetailedInfo } from "./contextService";
import {
	applyInlineEditInstructions,
	validateInlineEditInstructions,
} from "../utils/codeUtils";

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
	 * Modify existing code live in the editor using precise inline edit instructions
	 */
	public async modifyCodeLive(
		editor: vscode.TextEditor,
		instructions: InlineEditInstruction[],
		token: vscode.CancellationToken,
		feedbackCallback?: (feedback: LiveGenerationFeedback) => void
	): Promise<{ content: string; validation: any }> {
		const filePath = editor.document.uri.fsPath;
		const originalContent = editor.document.getText();

		this._sendFeedback(feedbackCallback, {
			stage: "modification_start",
			message: "Starting live code modification with precise edits...",
			progress: 0,
			currentContent: originalContent,
			chunksGenerated: 0,
			totalChunks: 0,
		});

		try {
			// Validate instructions before applying
			if (instructions.length === 0) {
				this._sendFeedback(feedbackCallback, {
					stage: "no_changes",
					message: "No changes to apply.",
					progress: 100,
					currentContent: originalContent,
					chunksGenerated: 0,
					totalChunks: 0,
				});
				return {
					content: originalContent,
					validation: { isValid: true, issues: [], suggestions: [] },
				};
			}

			// Analyze and validate edit instructions
			const analysis = this._analyzeEditInstructions(instructions);
			const validation = this._validateAndRefineInstructions(
				instructions,
				editor.document
			);

			if (!validation.isValid) {
				const errorMessage = `Invalid edit instructions: ${validation.issues.join(
					", "
				)}`;
				this._sendFeedback(feedbackCallback, {
					stage: "validation_error",
					message: errorMessage,
					progress: 100,
					currentContent: originalContent,
					chunksGenerated: 0,
					totalChunks: 0,
				});
				throw new Error(errorMessage);
			}

			// Use refined instructions if available
			const finalInstructions =
				validation.refinedInstructions.length > 0
					? validation.refinedInstructions
					: instructions;

			this._sendFeedback(feedbackCallback, {
				stage: "applying_edits",
				message: `Applying ${analysis.summary}...`,
				progress: 50,
				currentContent: originalContent,
				chunksGenerated: 0,
				totalChunks: finalInstructions.length,
			});

			// Apply the inline edit instructions
			await applyInlineEditInstructions(editor, finalInstructions, token);

			const newContent = editor.document.getText();

			this._sendFeedback(feedbackCallback, {
				stage: "completion",
				message: "Live code modification completed successfully!",
				progress: 100,
				currentContent: newContent,
				chunksGenerated: instructions.length,
				totalChunks: instructions.length,
			});

			return {
				content: newContent,
				validation: { isValid: true, issues: [], suggestions: [] },
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
	 * Generate and apply inline edit instructions for live code modification
	 * This is a convenience method that combines AI generation with live application
	 */
	public async generateAndApplyInlineEdits(
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
			stage: "generation_start",
			message: "Generating precise edit instructions...",
			progress: 0,
			currentContent: originalContent,
			chunksGenerated: 0,
			totalChunks: 0,
		});

		try {
			// Generate inline edit instructions using the enhanced generator
			const inlineResult =
				await this.enhancedGenerator.generateInlineEditInstructions(
					filePath,
					modificationPrompt,
					originalContent,
					context,
					modelName,
					token
				);

			if (!inlineResult.validation.isValid) {
				throw new Error(
					`Invalid edit instructions: ${inlineResult.validation.issues?.join(
						", "
					)}`
				);
			}

			this._sendFeedback(feedbackCallback, {
				stage: "instructions_generated",
				message: `Generated ${inlineResult.editInstructions.length} edit instruction(s)...`,
				progress: 30,
				currentContent: originalContent,
				chunksGenerated: 0,
				totalChunks: inlineResult.editInstructions.length,
			});

			// Apply the generated instructions using the refactored modifyCodeLive method
			return await this.modifyCodeLive(
				editor,
				inlineResult.editInstructions,
				token,
				feedbackCallback
			);
		} catch (error) {
			// Use sophisticated fallback mechanism
			return await this._handleFallbackScenario(
				editor,
				modificationPrompt,
				context,
				modelName,
				token,
				error instanceof Error ? error : new Error(String(error)),
				feedbackCallback
			);
		}
	}

	/**
	 * Handle sophisticated fallback scenarios when inline edit generation fails
	 */
	private async _handleFallbackScenario(
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
		originalError: Error,
		feedbackCallback?: (feedback: LiveGenerationFeedback) => void
	): Promise<{ content: string; validation: any }> {
		const filePath = editor.document.uri.fsPath;
		const originalContent = editor.document.getText();

		// Strategy 1: Try with more specific prompt
		this._sendFeedback(feedbackCallback, {
			stage: "fallback_strategy_1",
			message:
				"Trying fallback strategy: Enhanced prompt with specific instructions...",
			progress: 25,
			currentContent: originalContent,
			chunksGenerated: 0,
			totalChunks: 0,
		});

		try {
			const enhancedPrompt = `${modificationPrompt}

IMPORTANT INSTRUCTIONS:
- Generate ONLY the minimal changes needed
- Do NOT rewrite the entire file
- Focus on surgical, precise edits
- Target specific lines or functions only
- Preserve existing code structure`;

			const enhancedContext = {
				...context,
				projectContext: `${context.projectContext}\n\nFALLBACK MODE: Generate minimal, precise changes only.`,
				relevantSnippets: `${context.relevantSnippets}\n\nCurrent file for reference:\n${originalContent}`,
			};

			const fallbackResult =
				await this.enhancedGenerator.generateInlineEditInstructions(
					filePath,
					enhancedPrompt,
					originalContent,
					enhancedContext,
					modelName,
					token
				);

			if (
				fallbackResult.validation.isValid &&
				fallbackResult.editInstructions.length > 0
			) {
				return await this.modifyCodeLive(
					editor,
					fallbackResult.editInstructions,
					token,
					feedbackCallback
				);
			}
		} catch (fallbackError) {
			console.warn("Fallback strategy 1 failed:", fallbackError);
		}

		// Strategy 2: Try with incremental approach
		this._sendFeedback(feedbackCallback, {
			stage: "fallback_strategy_2",
			message: "Trying fallback strategy: Incremental change approach...",
			progress: 50,
			currentContent: originalContent,
			chunksGenerated: 0,
			totalChunks: 0,
		});

		try {
			const incrementalPrompt = `${modificationPrompt}

INCREMENTAL APPROACH:
- Make the smallest possible change
- Focus on one specific modification
- Avoid large-scale changes
- Preserve all existing functionality`;

			const incrementalResult =
				await this.enhancedGenerator.generateInlineEditInstructions(
					filePath,
					incrementalPrompt,
					originalContent,
					context,
					modelName,
					token
				);

			if (
				incrementalResult.validation.isValid &&
				incrementalResult.editInstructions.length > 0
			) {
				return await this.modifyCodeLive(
					editor,
					incrementalResult.editInstructions,
					token,
					feedbackCallback
				);
			}
		} catch (incrementalError) {
			console.warn("Fallback strategy 2 failed:", incrementalError);
		}

		// Strategy 3: Try with line-specific targeting
		this._sendFeedback(feedbackCallback, {
			stage: "fallback_strategy_3",
			message: "Trying fallback strategy: Line-specific targeting...",
			progress: 75,
			currentContent: originalContent,
			chunksGenerated: 0,
			totalChunks: 0,
		});

		try {
			const lineSpecificPrompt = `${modificationPrompt}

LINE-SPECIFIC TARGETING:
- Target specific line numbers only
- Make minimal changes to existing lines
- Do not add new functions or large blocks
- Focus on modifying existing code`;

			const lineSpecificResult =
				await this.enhancedGenerator.generateInlineEditInstructions(
					filePath,
					lineSpecificPrompt,
					originalContent,
					context,
					modelName,
					token
				);

			if (
				lineSpecificResult.validation.isValid &&
				lineSpecificResult.editInstructions.length > 0
			) {
				return await this.modifyCodeLive(
					editor,
					lineSpecificResult.editInstructions,
					token,
					feedbackCallback
				);
			}
		} catch (lineSpecificError) {
			console.warn("Fallback strategy 3 failed:", lineSpecificError);
		}

		// All fallback strategies failed
		this._sendFeedback(feedbackCallback, {
			stage: "fallback_failed",
			message:
				"All fallback strategies failed. Unable to generate precise edits.",
			progress: 100,
			currentContent: originalContent,
			chunksGenerated: 0,
			totalChunks: 0,
		});

		throw new Error(
			`Failed to generate inline edit instructions after multiple fallback attempts. Original error: ${originalError.message}`
		);
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
	 * Analyze edit instructions and provide detailed feedback
	 */
	private _analyzeEditInstructions(instructions: InlineEditInstruction[]): {
		totalEdits: number;
		insertions: number;
		deletions: number;
		replacements: number;
		affectedLines: number[];
		summary: string;
	} {
		const affectedLines = new Set<number>();
		let insertions = 0;
		let deletions = 0;
		let replacements = 0;

		for (const instruction of instructions) {
			// Track affected lines
			for (
				let line = instruction.startLine;
				line <= instruction.endLine;
				line++
			) {
				affectedLines.add(line);
			}

			// Categorize edit type
			if (
				instruction.startLine === instruction.endLine &&
				!instruction.newText.trim()
			) {
				// Single line deletion
				deletions++;
			} else if (
				instruction.startLine === instruction.endLine &&
				instruction.newText.trim()
			) {
				// Single line replacement
				replacements++;
			} else if (instruction.startLine < instruction.endLine) {
				// Multi-line replacement
				replacements++;
			} else if (instruction.newText.trim()) {
				// Insertion
				insertions++;
			}
		}

		const sortedLines = Array.from(affectedLines).sort((a, b) => a - b);
		const summary = `${instructions.length} edit(s): ${insertions} insertion(s), ${deletions} deletion(s), ${replacements} replacement(s) affecting ${sortedLines.length} line(s)`;

		return {
			totalEdits: instructions.length,
			insertions,
			deletions,
			replacements,
			affectedLines: sortedLines,
			summary,
		};
	}

	/**
	 * Validate and refine edit instructions for better precision
	 */
	private _validateAndRefineInstructions(
		instructions: InlineEditInstruction[],
		document: vscode.TextDocument
	): {
		isValid: boolean;
		refinedInstructions: InlineEditInstruction[];
		issues: string[];
	} {
		const issues: string[] = [];
		const refinedInstructions: InlineEditInstruction[] = [];

		for (const instruction of instructions) {
			// Basic validation
			if (instruction.startLine < 1 || instruction.endLine < 1) {
				issues.push(
					`Invalid line numbers: ${instruction.startLine}-${instruction.endLine}`
				);
				continue;
			}

			if (instruction.startLine > instruction.endLine) {
				issues.push(
					`Invalid range: start (${instruction.startLine}) > end (${instruction.endLine})`
				);
				continue;
			}

			if (instruction.endLine > document.lineCount) {
				issues.push(
					`End line ${instruction.endLine} exceeds document length (${document.lineCount})`
				);
				continue;
			}

			// Refine the instruction
			const refinedInstruction: InlineEditInstruction = {
				startLine: Math.max(1, instruction.startLine),
				endLine: Math.min(document.lineCount, instruction.endLine),
				newText: instruction.newText || "",
				description: instruction.description || "Code modification",
			};

			refinedInstructions.push(refinedInstruction);
		}

		return {
			isValid: issues.length === 0,
			refinedInstructions,
			issues,
		};
	}

	/**
	 * Get detailed progress information for edit application
	 */
	private _getEditProgressInfo(
		currentEdit: number,
		totalEdits: number,
		instruction: InlineEditInstruction
	): { message: string; progress: number } {
		const progress = 50 + (currentEdit / totalEdits) * 40; // 50-90% for edit application
		const message = `Applying edit ${currentEdit}/${totalEdits}: ${instruction.description} (lines ${instruction.startLine}-${instruction.endLine})`;

		return { message, progress };
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

	/**
	 * Test method to validate the precision of inline edit instructions
	 * This can be used for testing and debugging purposes
	 */
	public async validateEditPrecision(
		instructions: InlineEditInstruction[],
		originalContent: string
	): Promise<{
		isPrecise: boolean;
		precisionScore: number;
		issues: string[];
		recommendations: string[];
	}> {
		const issues: string[] = [];
		const recommendations: string[] = [];
		let precisionScore = 100;

		// Analyze the instructions
		const analysis = this._analyzeEditInstructions(instructions);
		const totalLines = originalContent.split("\n").length;
		const affectedLineRatio = analysis.affectedLines.length / totalLines;

		// Check precision metrics
		if (affectedLineRatio > 0.5) {
			issues.push(
				`High affected line ratio: ${(affectedLineRatio * 100).toFixed(
					1
				)}% of file affected`
			);
			precisionScore -= 30;
			recommendations.push(
				"Consider more targeted edits to reduce affected lines"
			);
		}

		if (analysis.replacements > analysis.insertions + analysis.deletions) {
			issues.push(
				"High number of replacements compared to insertions/deletions"
			);
			precisionScore -= 20;
			recommendations.push(
				"Consider using insertions/deletions instead of large replacements"
			);
		}

		// Check for overlapping edits
		const sortedInstructions = [...instructions].sort(
			(a, b) => a.startLine - b.startLine
		);
		for (let i = 0; i < sortedInstructions.length - 1; i++) {
			const current = sortedInstructions[i];
			const next = sortedInstructions[i + 1];
			if (current.endLine >= next.startLine) {
				issues.push(
					`Overlapping edits detected: lines ${current.startLine}-${current.endLine} and ${next.startLine}-${next.endLine}`
				);
				precisionScore -= 50;
				recommendations.push("Fix overlapping edit ranges");
			}
		}

		// Check for empty or invalid instructions
		for (const instruction of instructions) {
			if (!instruction.description || instruction.description.trim() === "") {
				issues.push("Missing description for edit instruction");
				precisionScore -= 10;
				recommendations.push("Add descriptive text for each edit instruction");
			}

			if (instruction.startLine < 1 || instruction.endLine < 1) {
				issues.push(
					`Invalid line numbers: ${instruction.startLine}-${instruction.endLine}`
				);
				precisionScore -= 25;
				recommendations.push("Ensure line numbers are valid (1-based)");
			}
		}

		return {
			isPrecise: precisionScore >= 70,
			precisionScore: Math.max(0, precisionScore),
			issues,
			recommendations,
		};
	}

	/**
	 * Generate a detailed report of the edit operation
	 */
	public generateEditReport(
		instructions: InlineEditInstruction[],
		originalContent: string,
		finalContent: string
	): {
		summary: string;
		statistics: {
			totalEdits: number;
			affectedLines: number;
			contentChangeRatio: number;
			precisionMetrics: any;
		};
		details: {
			beforeLength: number;
			afterLength: number;
			changeSize: number;
			editTypes: any;
		};
	} {
		const analysis = this._analyzeEditInstructions(instructions);
		const beforeLength = originalContent.length;
		const afterLength = finalContent.length;
		const changeSize = Math.abs(afterLength - beforeLength);
		const contentChangeRatio = changeSize / beforeLength;

		const precisionMetrics = {
			affectedLineRatio:
				analysis.affectedLines.length / originalContent.split("\n").length,
			editEfficiency:
				instructions.length > 0 ? changeSize / instructions.length : 0,
			precisionScore:
				contentChangeRatio < 0.1
					? "High"
					: contentChangeRatio < 0.3
					? "Medium"
					: "Low",
		};

		const editTypes = {
			insertions: analysis.insertions,
			deletions: analysis.deletions,
			replacements: analysis.replacements,
		};

		const summary = `Applied ${analysis.totalEdits} edit(s) affecting ${
			analysis.affectedLines.length
		} line(s). Content changed by ${(contentChangeRatio * 100).toFixed(1)}%.`;

		return {
			summary,
			statistics: {
				totalEdits: analysis.totalEdits,
				affectedLines: analysis.affectedLines.length,
				contentChangeRatio,
				precisionMetrics,
			},
			details: {
				beforeLength,
				afterLength,
				changeSize,
				editTypes,
			},
		};
	}

	/**
	 * Compare the precision of inline edits vs full file replacement
	 */
	public compareEditApproaches(
		inlineInstructions: InlineEditInstruction[],
		fullReplacementContent: string,
		originalContent: string
	): {
		inlinePrecision: number;
		fullReplacementPrecision: number;
		recommendation: string;
		analysis: {
			inlineMetrics: any;
			fullReplacementMetrics: any;
		};
	} {
		// Analyze inline edit approach
		const inlineAnalysis = this._analyzeEditInstructions(inlineInstructions);
		const inlineChangeRatio =
			Math.abs(fullReplacementContent.length - originalContent.length) /
			originalContent.length;
		const inlinePrecision = Math.max(0, 100 - inlineChangeRatio * 100);

		// Analyze full replacement approach
		const fullReplacementChangeRatio =
			Math.abs(fullReplacementContent.length - originalContent.length) /
			originalContent.length;
		const fullReplacementPrecision = Math.max(
			0,
			100 - fullReplacementChangeRatio * 100
		);

		const recommendation =
			inlinePrecision > fullReplacementPrecision
				? "Inline edits provide better precision"
				: "Full replacement might be more appropriate for this change";

		return {
			inlinePrecision,
			fullReplacementPrecision,
			recommendation,
			analysis: {
				inlineMetrics: {
					affectedLines: inlineAnalysis.affectedLines.length,
					totalEdits: inlineAnalysis.totalEdits,
					changeRatio: inlineChangeRatio,
				},
				fullReplacementMetrics: {
					affectedLines: fullReplacementContent.split("\n").length,
					totalEdits: 1,
					changeRatio: fullReplacementChangeRatio,
				},
			},
		};
	}
}

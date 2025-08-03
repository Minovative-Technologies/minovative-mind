// src/ai/enhancedCodeGeneration.ts
import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { AIRequestService } from "../services/aiRequestService";
import {
	CodeIssue,
	CodeValidationResult,
	EnhancedGenerationContext,
	RealTimeFeedback,
	FileAnalysis, // Added for re-export
	FileStructureAnalysis, // Added for re-export
	CorrectionAttemptOutcome, // Added for re-export
} from "../types/codeGenerationTypes";
import { cleanCodeOutput } from "../utils/codeUtils";
import { areIssuesSimilar } from "../utils/aiUtils";
import { ExtensionToWebviewMessages } from "../sidebar/common/sidebarTypes";
import { ProjectChangeLogger } from "../workflow/ProjectChangeLogger";
import { CodeValidationService } from "../services/codeValidationService";
import { ContextRefresherService } from "../services/contextRefresherService";
import {
	analyzeFileStructure,
	getLanguageId,
	isRewriteIntentDetected,
} from "../utils/codeAnalysisUtils";
import { formatSuccessfulChangesForPrompt } from "../workflow/changeHistoryFormatter";
import { analyzeDiff } from "../utils/diffingUtils";
import { DiagnosticService } from "../utils/diagnosticUtils";
import {
	createEnhancedGenerationPrompt,
	createEnhancedModificationPrompt,
	createRefineModificationPrompt,
	createAlternativeCorrectionPrompt,
	createSyntaxCorrectionPrompt,
	createImportCorrectionPrompt,
	createPracticeCorrectionPrompt,
	createSecurityCorrectionPrompt,
	createPureCodeFormatCorrectionPrompt,
} from "./prompts/enhancedCodeGenerationPrompts";

// Re-export these types to make them accessible to other modules that import from this file.
export type {
	CodeIssue,
	FileAnalysis,
	FileStructureAnalysis,
	CorrectionAttemptOutcome,
	EnhancedGenerationContext,
};

/**
 * Orchestrates the AI-driven code generation and modification process,
 * leveraging a real-time feedback loop and specialized services for accuracy and quality.
 */
export class EnhancedCodeGenerator {
	private readonly MAX_OSCILLATION_HISTORY_SIZE = 3;

	constructor(
		private aiRequestService: AIRequestService,
		private postMessageToWebview: (message: ExtensionToWebviewMessages) => void,
		private changeLogger: ProjectChangeLogger,
		private codeValidationService: CodeValidationService,
		private contextRefresherService: ContextRefresherService,
		private config: {
			enableRealTimeFeedback?: boolean;
			maxFeedbackIterations?: number;
		} = {}
	) {
		this.config.enableRealTimeFeedback =
			this.config.enableRealTimeFeedback ?? true;
		this.config.maxFeedbackIterations = this.config.maxFeedbackIterations ?? 5;
	}

	/**
	 * Enhanced file content generation with real-time feedback loop.
	 */
	public async generateFileContent(
		filePath: string,
		generatePrompt: string,
		context: EnhancedGenerationContext,
		modelName: string,
		token?: vscode.CancellationToken,
		feedbackCallback?: (feedback: RealTimeFeedback) => void,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		const languageId = getLanguageId(path.extname(filePath));
		const streamId = crypto.randomUUID();

		this.postMessageToWebview({
			type: "codeFileStreamStart",
			value: { streamId, filePath, languageId },
		});

		try {
			const isRewriteOp = isRewriteIntentDetected(generatePrompt, filePath);
			const generationContext: EnhancedGenerationContext = {
				...context,
				isRewriteOperation: isRewriteOp,
			};

			if (this.config.enableRealTimeFeedback) {
				const result = await this._generateWithRealTimeFeedback(
					filePath,
					generatePrompt,
					generationContext,
					modelName,
					streamId,
					token,
					feedbackCallback,
					onCodeChunkCallback
				);
				this.postMessageToWebview({
					type: "codeFileStreamEnd",
					value: { streamId, filePath, success: true },
				});
				return result;
			} else {
				// Fallback for non-real-time generation
				const initialResult = await this._generateInitialContent(
					filePath,
					generatePrompt,
					generationContext,
					modelName,
					streamId,
					token,
					onCodeChunkCallback
				);
				if (!initialResult.isValid) {
					return {
						content: initialResult.finalContent,
						validation: initialResult,
					};
				}
				const validation = await this.codeValidationService.validateCode(
					filePath,
					initialResult.finalContent
				);
				const result = { content: validation.finalContent, validation };
				this.postMessageToWebview({
					type: "codeFileStreamEnd",
					value: { streamId, filePath, success: true },
				});
				return result;
			}
		} catch (error: any) {
			// Check if the error message indicates cancellation (case-insensitive)
			if (
				error instanceof Error &&
				error.message.toLowerCase().includes("cancelled")
			) {
				// If it's a cancellation error, re-throw it immediately.
				// This prevents sending a redundant codeFileStreamEnd message from this layer.
				throw error;
			} else {
				// For any other type of error, post the codeFileStreamEnd message
				// to indicate failure for this specific operation, and then re-throw.
				this.postMessageToWebview({
					type: "codeFileStreamEnd",
					value: {
						streamId,
						filePath,
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
				});
				throw error; // Re-throw the error for higher-level handling
			}
		}
	}

	/**
	 * Enhanced file modification with intelligent diff analysis and real-time feedback.
	 */
	public async modifyFileContent(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		context: EnhancedGenerationContext,
		modelName: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		const languageId = getLanguageId(path.extname(filePath));
		const streamId = crypto.randomUUID();

		this.postMessageToWebview({
			type: "codeFileStreamStart",
			value: { streamId, filePath, languageId },
		});

		try {
			const isRewriteOp = isRewriteIntentDetected(modificationPrompt, filePath);
			const modificationContext: EnhancedGenerationContext = {
				...context,
				isRewriteOperation: isRewriteOp,
			};

			const result = await this._modifyFileContentFull(
				filePath,
				modificationPrompt,
				currentContent,
				modificationContext,
				modelName,
				streamId,
				token,
				onCodeChunkCallback
			);
			this.postMessageToWebview({
				type: "codeFileStreamEnd",
				value: { streamId, filePath, success: true },
			});
			return result;
		} catch (error: any) {
			// Check if the error message indicates cancellation (case-insensitive)
			if (
				error instanceof Error &&
				error.message.toLowerCase().includes("cancelled")
			) {
				// If it's a cancellation error, re-throw it immediately.
				// This prevents sending a redundant codeFileStreamEnd message from this layer.
				throw error;
			} else {
				// For any other type of error, post the codeFileStreamEnd message
				// to indicate failure for this specific operation, and then re-throw.
				this.postMessageToWebview({
					type: "codeFileStreamEnd",
					value: {
						streamId,
						filePath,
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
				});
				throw error; // Re-throw the error for higher-level handling
			}
		}
	}

	/**
	 * Checks raw AI output for common non-code patterns that indicate a deviation from instructions.
	 * @param rawContent The raw string response from the AI.
	 * @returns A `CodeValidationResult` object if an issue is found, otherwise `null`.
	 */
	private _checkForNonCodeResponse(
		rawContent: string
	): CodeValidationResult | null {
		const unwantedCodeGenerationPatterns = [
			/<execute_bash>/i, // Custom tags that shouldn't be in code
			/\bthought\b/i, // Explicit "thought" process leakage
			/you are the expert software engineer for me/i, // AI repeating its persona/instructions
			/here's the code:/i, // Conversational lead-in
			/i can help you by/i, // Conversational lead-in
		];

		for (const pattern of unwantedCodeGenerationPatterns) {
			if (pattern.test(rawContent)) {
				const message = `AI response contained unexpected conversational/instructional content and was not valid code. (Detected pattern: ${pattern.source})`;
				console.error(`[EnhancedCodeGenerator] ${message}`);
				console.error("Raw AI Response:\n", rawContent);
				return {
					isValid: false,
					finalContent: "", // No valid content was generated
					issues: [
						{
							type: "format_error",
							message: message,
							line: 1,
							severity: "error",
							source: "EnhancedCodeGenerator",
						},
					],
					suggestions: [
						"Refine your prompt for code generation.",
						"Ensure the AI only outputs code.",
					],
				};
			}
		}
		return null; // No issues found
	}

	/**
	 * Generates the initial version of the code.
	 */
	private async _generateInitialContent(
		filePath: string,
		generatePrompt: string,
		context: EnhancedGenerationContext,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<CodeValidationResult> {
		const enhancedPrompt = createEnhancedGenerationPrompt(
			filePath,
			generatePrompt,
			context
		);
		try {
			const rawContent = await this.aiRequestService.generateWithRetry(
				[{ text: enhancedPrompt }],
				modelName,
				undefined,
				"enhanced file generation",
				undefined,
				{
					onChunk: async (chunk) =>
						this._streamChunk(streamId, filePath, chunk, onCodeChunkCallback),
				},
				token
			);

			// --- Pre-cleaning check for non-code AI output ---
			const validationError = this._checkForNonCodeResponse(rawContent);
			if (validationError) {
				return validationError;
			}
			// --- End Pre-cleaning check ---

			return this.codeValidationService.checkPureCodeFormat(
				cleanCodeOutput(rawContent)
			);
		} catch (error: any) {
			return {
				isValid: false,
				finalContent: "",
				issues: [
					{
						type: "other",
						message: `AI generation failed: ${error.message}`,
						line: 1,
						severity: "error",
					},
				],
				suggestions: ["Check AI service status."],
			};
		}
	}

	/**
	 * Orchestrates the full modification process including generation, validation, and refinement.
	 */
	private async _modifyFileContentFull(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		context: EnhancedGenerationContext,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		const fileAnalysis = await analyzeFileStructure(filePath, currentContent);
		const contextWithAnalysis: EnhancedGenerationContext = {
			...context,
			fileStructureAnalysis: fileAnalysis,
			successfulChangeHistory: formatSuccessfulChangesForPrompt(
				this.changeLogger.getCompletedPlanChangeSets()
			),
		};

		// --- Inlined logic from _generateModification ---
		const enhancedPrompt = createEnhancedModificationPrompt(
			filePath,
			modificationPrompt,
			currentContent,
			contextWithAnalysis
		);
		const rawContent = await this.aiRequestService.generateWithRetry(
			[{ text: enhancedPrompt }],
			modelName,
			undefined,
			"enhanced file modification",
			undefined,
			{
				onChunk: async (chunk) =>
					this._streamChunk(streamId, filePath, chunk, onCodeChunkCallback),
			},
			token
		);

		// --- New: Pre-cleaning check for non-code AI output ---
		const validationError = this._checkForNonCodeResponse(rawContent);
		if (validationError) {
			return { content: "", validation: validationError };
		}
		// --- End New Pre-cleaning check ---

		const modifiedContent = cleanCodeOutput(rawContent);
		// --- End inlined logic ---

		const validation = await this._validateAndRefineModification(
			filePath,
			currentContent,
			modifiedContent,
			contextWithAnalysis,
			modelName,
			streamId,
			token,
			onCodeChunkCallback
		);

		return { content: validation.finalContent, validation };
	}

	/**
	 * Validates and refines a generated modification.
	 */
	private async _validateAndRefineModification(
		filePath: string,
		originalContent: string,
		modifiedContent: string,
		context: EnhancedGenerationContext,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<CodeValidationResult> {
		const diffAnalysis = analyzeDiff(originalContent, modifiedContent);
		if (!diffAnalysis.isReasonable) {
			const refinePrompt = createRefineModificationPrompt(
				filePath,
				originalContent,
				modifiedContent,
				diffAnalysis.issues,
				context
			);
			const rawRefinedContent = await this.aiRequestService.generateWithRetry(
				[{ text: refinePrompt }],
				modelName,
				undefined,
				"refine modification",
				undefined,
				{
					onChunk: async (chunk) =>
						this._streamChunk(streamId, filePath, chunk, onCodeChunkCallback),
				},
				token
			);

			// --- Pre-cleaning check for non-code AI output ---
			const validationError = this._checkForNonCodeResponse(rawRefinedContent);
			if (validationError) {
				return validationError;
			}
			// --- End Pre-cleaning check ---

			const refinedContent = cleanCodeOutput(rawRefinedContent);
			return this.codeValidationService.validateCode(filePath, refinedContent);
		}
		return this.codeValidationService.validateCode(filePath, modifiedContent);
	}

	/**
	 * Detects if the AI is stuck in an oscillation pattern.
	 */
	private async _detectOscillation(
		context: EnhancedGenerationContext
	): Promise<boolean> {
		const recentOutcomes = context.recentCorrectionAttemptOutcomes;
		if (!recentOutcomes || recentOutcomes.length < 2) {
			return false;
		}

		const lastOutcome = recentOutcomes[recentOutcomes.length - 1];
		const secondLastOutcome = recentOutcomes[recentOutcomes.length - 2];

		return (
			!lastOutcome.success &&
			!secondLastOutcome.success &&
			areIssuesSimilar(
				lastOutcome.issuesRemaining,
				secondLastOutcome.issuesRemaining
			)
		);
	}

	/**
	 * The core feedback loop for generating and iteratively correcting code.
	 */
	private async _generateWithRealTimeFeedback(
		filePath: string,
		generatePrompt: string,
		context: EnhancedGenerationContext,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		feedbackCallback?: (feedback: RealTimeFeedback) => void,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<{ content: string; validation: CodeValidationResult }> {
		let currentContent = "";
		let iteration = 0;
		let validationResult: CodeValidationResult;

		let currentContext: EnhancedGenerationContext = {
			...context,
			successfulChangeHistory: formatSuccessfulChangesForPrompt(
				this.changeLogger.getCompletedPlanChangeSets()
			),
			recentCorrectionAttemptOutcomes: [],
			isOscillating: false,
		};

		this._sendFeedback(feedbackCallback, {
			stage: "initialization",
			message: "Starting...",
			issues: [],
			suggestions: [],
			progress: 0,
		});

		currentContext.fileStructureAnalysis = await analyzeFileStructure(
			filePath,
			""
		);
		validationResult = await this._generateInitialContent(
			filePath,
			generatePrompt,
			currentContext,
			modelName,
			streamId,
			token,
			onCodeChunkCallback
		);
		currentContent = validationResult.finalContent;

		await DiagnosticService.waitForDiagnosticsToStabilize(
			vscode.Uri.file(filePath),
			token,
			5000,
			100
		);

		while (iteration < this.config.maxFeedbackIterations!) {
			if (token?.isCancellationRequested) {
				throw new Error("Operation cancelled");
			}
			iteration++;
			this._sendFeedback(feedbackCallback, {
				stage: "validation",
				message: `Validating (iteration ${iteration})...`,
				issues: [],
				suggestions: [],
				progress: 20 + iteration * 15,
			});

			const diagnosticValidation =
				await this.codeValidationService.validateCode(filePath, currentContent);
			const combinedIssues = [
				...diagnosticValidation.issues,
				...validationResult.issues.filter((i) => i.type === "format_error"),
			];

			if (combinedIssues.length === 0) {
				this._sendFeedback(feedbackCallback, {
					stage: "completion",
					message: "Success!",
					issues: [],
					suggestions: [],
					progress: 100,
				});
				return {
					content: currentContent,
					validation: {
						...diagnosticValidation,
						finalContent: currentContent,
						iterations: iteration,
					},
				};
			}

			const issuesBeforeAttempt = combinedIssues;
			currentContext.fileStructureAnalysis = await analyzeFileStructure(
				filePath,
				currentContent
			);
			currentContext =
				await this.contextRefresherService.refreshErrorFocusedContext(
					filePath,
					currentContent,
					issuesBeforeAttempt,
					currentContext,
					token
				);

			const correctionResult = await this._applyRealTimeCorrections(
				filePath,
				currentContent,
				issuesBeforeAttempt,
				currentContext,
				modelName,
				streamId,
				token,
				onCodeChunkCallback
			);
			currentContent = correctionResult.finalContent;

			await DiagnosticService.waitForDiagnosticsToStabilize(
				vscode.Uri.file(filePath),
				token,
				5000,
				100
			);
			const finalValidation = await this.codeValidationService.validateCode(
				filePath,
				currentContent
			);
			const issuesAfterAttempt = [
				...finalValidation.issues,
				...correctionResult.issues.filter((i) => i.type === "format_error"),
			];

			const wasImprovement =
				issuesAfterAttempt.length < issuesBeforeAttempt.length;

			if (wasImprovement) {
				validationResult = { ...finalValidation, issues: issuesAfterAttempt };
				currentContext.recentCorrectionAttemptOutcomes = [];
				currentContext.isOscillating = false;
				this._sendFeedback(feedbackCallback, {
					stage: "improvement",
					message: `Resolved ${
						issuesBeforeAttempt.length - issuesAfterAttempt.length
					} issues.`,
					issues: issuesAfterAttempt,
					suggestions: [],
					progress: 20 + iteration * 15,
				});
			} else {
				// No improvement, try alternative approach
				this._sendFeedback(feedbackCallback, {
					stage: "alternative",
					message: "Correction failed, trying alternative.",
					issues: issuesAfterAttempt,
					suggestions: [],
					progress: 20 + iteration * 15,
				});

				// Oscillation detection and failure analysis would go here...
				currentContext.isOscillating = await this._detectOscillation(
					currentContext
				);

				const altPrompt = createAlternativeCorrectionPrompt(
					filePath,
					currentContent,
					issuesAfterAttempt,
					currentContext
				);
				const rawAltContent = await this.aiRequestService.generateWithRetry(
					[{ text: altPrompt }],
					modelName,
					undefined,
					"alternative correction",
					undefined,
					{
						onChunk: async (chunk) =>
							this._streamChunk(streamId, filePath, chunk, onCodeChunkCallback),
					},
					token
				);

				// --- Pre-cleaning check for non-code AI output ---
				const validationError = this._checkForNonCodeResponse(rawAltContent);
				if (validationError) {
					validationResult = validationError; // Capture the error and break
					break;
				}
				// --- End Pre-cleaning check ---

				currentContent = cleanCodeOutput(rawAltContent);

				const altValidation = await this.codeValidationService.validateCode(
					filePath,
					currentContent
				);
				if (altValidation.issues.length >= issuesAfterAttempt.length) {
					break; // Alternative also failed, exit loop
				}
				validationResult = altValidation;
			}
		}

		this._sendFeedback(feedbackCallback, {
			stage: "final",
			message: `Completed with ${validationResult.issues.length} issues.`,
			issues: validationResult.issues,
			suggestions: [],
			progress: 100,
		});
		return {
			content: currentContent,
			validation: { ...validationResult, iterations: iteration },
		};
	}

	/**
	 * Applies corrections based on issue type.
	 */
	private async _applyRealTimeCorrections(
		filePath: string,
		content: string,
		issues: CodeIssue[],
		context: EnhancedGenerationContext,
		modelName: string,
		streamId: string,
		token?: vscode.CancellationToken,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	): Promise<CodeValidationResult> {
		const issueTypeMap = {
			format_error: createPureCodeFormatCorrectionPrompt,
			syntax: createSyntaxCorrectionPrompt,
			unused_import: createImportCorrectionPrompt,
			best_practice: createPracticeCorrectionPrompt,
			security: createSecurityCorrectionPrompt,
			other: createPracticeCorrectionPrompt, // Default to practice correction
		};

		let currentCorrectedContent = content;

		for (const type of Object.keys(
			issueTypeMap
		) as (keyof typeof issueTypeMap)[]) {
			if (token?.isCancellationRequested) {
				break;
			}
			const relevantIssues = issues.filter((i) => i.type === type);
			if (relevantIssues.length > 0) {
				let correctionPrompt: string;

				if (type === "format_error") {
					correctionPrompt = createPureCodeFormatCorrectionPrompt(
						filePath,
						currentCorrectedContent,
						context
					);
				} else {
					// For other types, dynamically get the prompt function and call it with relevantIssues.
					// A type assertion is used here because 'format_error' case is handled separately,
					// ensuring that for other 'type' values, the promptFn will indeed accept 'relevantIssues'.
					const promptFn = issueTypeMap[type] as (
						filePath: string,
						content: string,
						issues: CodeIssue[],
						context: EnhancedGenerationContext
					) => string;
					correctionPrompt = promptFn(
						filePath,
						currentCorrectedContent,
						relevantIssues,
						context
					);
				}

				const rawCorrection = await this.aiRequestService.generateWithRetry(
					[{ text: correctionPrompt }],
					modelName,
					undefined,
					`${type} correction`,
					undefined,
					{
						onChunk: async (chunk) =>
							this._streamChunk(streamId, filePath, chunk, onCodeChunkCallback),
					},
					token
				);

				// --- Pre-cleaning check for non-code AI output ---
				const validationError = this._checkForNonCodeResponse(rawCorrection);
				if (validationError) {
					return validationError; // Exit correction loop on severe malformation
				}
				// --- End Pre-cleaning check ---

				const formatValidation = this.codeValidationService.checkPureCodeFormat(
					cleanCodeOutput(rawCorrection)
				);
				if (!formatValidation.isValid) {
					// If the format is still wrong, exit the correction loop
					// as further corrections are unlikely to succeed.
					return formatValidation;
				}
				currentCorrectedContent = formatValidation.finalContent;
			}
		}

		return this.codeValidationService.validateCode(
			filePath,
			currentCorrectedContent
		);
	}

	/**
	 * Helper for handling streaming chunks.
	 */
	private async _streamChunk(
		streamId: string,
		filePath: string,
		chunk: string,
		onCodeChunkCallback?: (chunk: string) => Promise<void> | void
	) {
		this.postMessageToWebview({
			type: "codeFileStreamChunk",
			value: { streamId, filePath, chunk },
		});
		if (onCodeChunkCallback) {
			await onCodeChunkCallback(chunk);
		}
	}

	/**
	 * Sends feedback to the UI callback.
	 */
	private _sendFeedback(
		callback?: (feedback: RealTimeFeedback) => void,
		feedback?: RealTimeFeedback
	): void {
		if (callback && feedback) {
			try {
				callback(feedback);
			} catch (error) {
				console.warn("Error in feedback callback:", error);
			}
		}
	}
}

import * as vscode from "vscode";
import { AIRequestService } from "./aiRequestService";
import { EnhancedCodeGenerator } from "../ai/enhancedCodeGeneration";
import { EnhancedContextBuilder } from "../context/enhancedContextBuilder";
import { EnhancedPromptBuilder } from "../ai/enhancedPromptBuilder";
import { ActiveSymbolDetailedInfo } from "./contextService";
import { TEMPERATURE } from "../sidebar/common/sidebarConstants";

/**
 * Real-time feedback interface for enhanced AI service
 */
interface EnhancedAIFeedback {
	stage: string;
	message: string;
	progress: number;
	details?: any;
}

/**
 * Enhanced AI service that provides more accurate code generation
 * by integrating multiple improvements:
 * 1. Better context analysis with caching
 * 2. Enhanced prompts
 * 3. Code validation and refinement
 * 4. Framework-specific optimizations
 * 5. Error prevention and correction
 * 6. Real-time feedback loop
 */
export class EnhancedAIService {
	private enhancedCodeGenerator: EnhancedCodeGenerator;
	private enhancedContextBuilder: EnhancedContextBuilder;

	constructor(
		private aiRequestService: AIRequestService,
		private workspaceRoot: vscode.Uri,
		private postMessageToWebview: (message: any) => void
	) {
		this.enhancedCodeGenerator = new EnhancedCodeGenerator(
			aiRequestService,
			workspaceRoot,
			{
				enableRealTimeFeedback: true,
				maxFeedbackIterations: 5,
			}
		);
		this.enhancedContextBuilder = new EnhancedContextBuilder();
	}

	/**
	 * Enhanced plan generation with better accuracy and caching
	 */
	public async generateEnhancedPlan(
		userRequest: string | undefined,
		relevantFiles: vscode.Uri[],
		options: {
			editorContext?: any;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
			recentChanges?: any[];
			dependencyGraph?: Map<string, string[]>;
			documentSymbols?: Map<string, vscode.DocumentSymbol[] | undefined>;
			diagnostics?: vscode.Diagnostic[];
			chatHistory?: any[];
			textualPlanExplanation?: string;
		},
		modelName: string,
		token?: vscode.CancellationToken,
		feedbackCallback?: (feedback: EnhancedAIFeedback) => void
	): Promise<{ plan: any; context: string; accuracy: PlanAccuracyMetrics }> {
		// Step 1: Build enhanced context with caching
		this._sendFeedback(feedbackCallback, {
			stage: "context_building",
			message: "Building enhanced context with caching...",
			progress: 10,
		});

		const enhancedContext =
			await this.enhancedContextBuilder.buildEnhancedContext(
				relevantFiles,
				this.workspaceRoot,
				{
					userRequest,
					activeSymbolInfo: options.activeSymbolInfo,
					recentChanges: options.recentChanges,
					dependencyGraph: options.dependencyGraph,
					documentSymbols: options.documentSymbols,
					diagnostics: options.diagnostics,
					chatHistory: options.chatHistory,
				}
			);

		// Log cache statistics
		const cacheStats = this.enhancedContextBuilder.getCacheStats();
		console.log(`[EnhancedAIService] Context cache stats:`, cacheStats);

		// Step 2: Create enhanced planning prompt
		this._sendFeedback(feedbackCallback, {
			stage: "prompt_creation",
			message: "Creating enhanced planning prompt...",
			progress: 30,
		});

		const enhancedPrompt = EnhancedPromptBuilder.createEnhancedPlanningPrompt(
			userRequest,
			enhancedContext,
			options.editorContext,
			options.diagnostics
				? this._formatDiagnostics(options.diagnostics)
				: undefined,
			options.chatHistory,
			options.textualPlanExplanation,
			options.recentChanges
				? this._formatRecentChanges(options.recentChanges)
				: undefined
		);

		// Step 3: Generate plan with enhanced accuracy
		this._sendFeedback(feedbackCallback, {
			stage: "plan_generation",
			message: "Generating enhanced execution plan...",
			progress: 50,
		});

		const planResponse = await this.aiRequestService.generateWithRetry(
			enhancedPrompt,
			modelName,
			undefined,
			"enhanced plan generation",
			{
				responseMimeType: "application/json",
				temperature: TEMPERATURE, // Lower temperature for more consistent results
			},
			undefined,
			token
		);

		// Step 4: Validate and analyze plan accuracy
		this._sendFeedback(feedbackCallback, {
			stage: "plan_validation",
			message: "Validating and analyzing plan accuracy...",
			progress: 80,
		});

		const plan = this._parseAndValidatePlan(planResponse);
		const accuracyMetrics = this._analyzePlanAccuracy(
			plan,
			userRequest,
			options
		);

		this._sendFeedback(feedbackCallback, {
			stage: "completion",
			message: "Enhanced plan generation completed!",
			progress: 100,
			details: {
				planSteps: plan.steps?.length || 0,
				accuracyScore: accuracyMetrics.overall,
				cacheStats,
			},
		});

		return {
			plan,
			context: enhancedContext,
			accuracy: accuracyMetrics,
		};
	}

	/**
	 * Enhanced file content generation with real-time feedback
	 */
	public async generateEnhancedFileContent(
		filePath: string,
		generatePrompt: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
		},
		modelName: string,
		token?: vscode.CancellationToken,
		feedbackCallback?: (feedback: EnhancedAIFeedback) => void
	): Promise<{
		content: string;
		validation: any;
		accuracy: CodeAccuracyMetrics;
	}> {
		// Convert feedback callback for code generator
		const codeFeedbackCallback = feedbackCallback
			? (feedback: any) => {
					feedbackCallback({
						stage: `code_generation_${feedback.stage}`,
						message: feedback.message,
						progress: feedback.progress,
						details: {
							issues: feedback.issues,
							suggestions: feedback.suggestions,
							iterations: feedback.iterations,
						},
					});
			  }
			: undefined;

		// Step 1: Generate content with enhanced generator and real-time feedback
		this._sendFeedback(feedbackCallback, {
			stage: "code_generation_start",
			message: `Generating enhanced content for ${filePath}...`,
			progress: 0,
		});

		const result = await this.enhancedCodeGenerator.generateFileContent(
			filePath,
			generatePrompt,
			context,
			modelName,
			token,
			codeFeedbackCallback
		);

		// Step 2: Analyze code accuracy
		this._sendFeedback(feedbackCallback, {
			stage: "accuracy_analysis",
			message: "Analyzing code accuracy...",
			progress: 90,
		});

		const accuracyMetrics = this._analyzeCodeAccuracy(
			result.content,
			filePath,
			context
		);

		this._sendFeedback(feedbackCallback, {
			stage: "code_generation_complete",
			message: "Code generation completed successfully!",
			progress: 100,
			details: {
				filePath,
				validationIssues: result.validation.issues.length,
				accuracyScore: accuracyMetrics.overall,
				iterations: result.validation.iterations,
			},
		});

		return {
			content: result.content,
			validation: result.validation,
			accuracy: accuracyMetrics,
		};
	}

	/**
	 * Enhanced file modification with real-time feedback
	 */
	public async modifyEnhancedFileContent(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
		},
		modelName: string,
		token?: vscode.CancellationToken,
		feedbackCallback?: (feedback: EnhancedAIFeedback) => void
	): Promise<{
		content: string;
		validation: any;
		accuracy: CodeAccuracyMetrics;
	}> {
		// Convert feedback callback for code generator
		const codeFeedbackCallback = feedbackCallback
			? (feedback: any) => {
					feedbackCallback({
						stage: `code_modification_${feedback.stage}`,
						message: feedback.message,
						progress: feedback.progress,
						details: {
							issues: feedback.issues,
							suggestions: feedback.suggestions,
						},
					});
			  }
			: undefined;

		// Step 1: Modify content with enhanced generator
		this._sendFeedback(feedbackCallback, {
			stage: "code_modification_start",
			message: `Modifying ${filePath} with enhanced accuracy...`,
			progress: 0,
		});

		const result = await this.enhancedCodeGenerator.modifyFileContent(
			filePath,
			modificationPrompt,
			currentContent,
			context,
			modelName,
			token
		);

		// Step 2: Analyze modification accuracy
		this._sendFeedback(feedbackCallback, {
			stage: "modification_analysis",
			message: "Analyzing modification accuracy...",
			progress: 90,
		});

		const accuracyMetrics = this._analyzeModificationAccuracy(
			currentContent,
			result.content,
			filePath,
			context
		);

		this._sendFeedback(feedbackCallback, {
			stage: "code_modification_complete",
			message: "File modification completed successfully!",
			progress: 100,
			details: {
				filePath,
				validationIssues: result.validation.issues.length,
				accuracyScore: accuracyMetrics.overall,
			},
		});

		return {
			content: result.content,
			validation: result.validation,
			accuracy: accuracyMetrics,
		};
	}

	/**
	 * Enhanced error correction with intelligent analysis
	 */
	public async correctEnhancedErrors(
		filePath: string,
		currentContent: string,
		errors: vscode.Diagnostic[],
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
		},
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<{
		content: string;
		validation: any;
		accuracy: CodeAccuracyMetrics;
	}> {
		// Step 1: Create enhanced error correction prompt
		const errorCorrectionPrompt = this._createErrorCorrectionPrompt(
			filePath,
			errors,
			context
		);

		// Step 2: Generate corrected content
		this.postMessageToWebview({
			type: "statusUpdate",
			value: `Correcting errors in ${filePath} with enhanced accuracy...`,
		});

		const result = await this.enhancedCodeGenerator.modifyFileContent(
			filePath,
			errorCorrectionPrompt,
			currentContent,
			context,
			modelName,
			token
		);

		// Step 3: Analyze correction accuracy
		const accuracyMetrics = this._analyzeCorrectionAccuracy(
			currentContent,
			result.content,
			errors,
			filePath,
			context
		);

		return {
			content: result.content,
			validation: result.validation,
			accuracy: accuracyMetrics,
		};
	}

	/**
	 * Preload context for frequently accessed files
	 */
	public async preloadContext(
		relevantFiles: vscode.Uri[],
		options: any = {}
	): Promise<void> {
		try {
			await this.enhancedContextBuilder.preloadContext(
				relevantFiles,
				this.workspaceRoot,
				options
			);
		} catch (error) {
			console.warn(`[EnhancedAIService] Failed to preload context:`, error);
		}
	}

	/**
	 * Get context cache statistics
	 */
	public getContextCacheStats(): {
		hits: number;
		misses: number;
		size: number;
	} {
		return this.enhancedContextBuilder.getCacheStats();
	}

	/**
	 * Clear context cache
	 */
	public clearContextCache(): void {
		this.enhancedContextBuilder.clearCache();
	}

	/**
	 * Send feedback to callback if provided
	 */
	private _sendFeedback(
		callback?: (feedback: EnhancedAIFeedback) => void,
		feedback?: EnhancedAIFeedback
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
	 * Parse and validate plan with enhanced error handling
	 */
	private _parseAndValidatePlan(planResponse: string): any {
		try {
			// Clean up the response
			let cleanedResponse = planResponse.trim();
			if (cleanedResponse.startsWith("```json")) {
				cleanedResponse = cleanedResponse.substring(7);
				if (cleanedResponse.endsWith("```")) {
					cleanedResponse = cleanedResponse.substring(
						0,
						cleanedResponse.length - 3
					);
				}
			}
			cleanedResponse = cleanedResponse
				.replace(/^```json\s*/, "")
				.replace(/\s*```$/, "");

			const plan = JSON.parse(cleanedResponse);

			// Basic validation
			if (!plan || typeof plan !== "object") {
				throw new Error("Invalid plan structure");
			}

			if (!plan.steps || !Array.isArray(plan.steps)) {
				throw new Error("Plan must contain steps array");
			}

			if (!plan.planDescription || typeof plan.planDescription !== "string") {
				throw new Error("Plan must have a description");
			}

			return plan;
		} catch (error) {
			console.error("Failed to parse plan:", error);
			throw new Error(
				`Plan parsing failed: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	/**
	 * Analyze plan accuracy
	 */
	private _analyzePlanAccuracy(
		plan: any,
		userRequest?: string,
		options?: any
	): PlanAccuracyMetrics {
		const metrics: PlanAccuracyMetrics = {
			completeness: 0,
			specificity: 0,
			feasibility: 0,
			safety: 0,
			overall: 0,
			issues: [],
			suggestions: [],
		};

		// Analyze completeness
		if (plan.steps && plan.steps.length > 0) {
			metrics.completeness = Math.min(100, plan.steps.length * 10); // Basic heuristic
		}

		// Analyze specificity
		let specificSteps = 0;
		for (const step of plan.steps || []) {
			if (step.description && step.description.length > 20) {
				specificSteps++;
			}
		}
		metrics.specificity = plan.steps
			? (specificSteps / plan.steps.length) * 100
			: 0;

		// Analyze feasibility
		let feasibleSteps = 0;
		for (const step of plan.steps || []) {
			if (this._isStepFeasible(step)) {
				feasibleSteps++;
			}
		}
		metrics.feasibility = plan.steps
			? (feasibleSteps / plan.steps.length) * 100
			: 0;

		// Analyze safety
		let safeSteps = 0;
		for (const step of plan.steps || []) {
			if (this._isStepSafe(step)) {
				safeSteps++;
			}
		}
		metrics.safety = plan.steps ? (safeSteps / plan.steps.length) * 100 : 0;

		// Calculate overall accuracy
		metrics.overall =
			(metrics.completeness +
				metrics.specificity +
				metrics.feasibility +
				metrics.safety) /
			4;

		// Generate suggestions
		if (metrics.overall < 80) {
			metrics.suggestions.push(
				"Consider adding more specific step descriptions"
			);
		}
		if (metrics.safety < 90) {
			metrics.suggestions.push("Review steps for potential safety issues");
		}

		return metrics;
	}

	/**
	 * Analyze code accuracy
	 */
	private _analyzeCodeAccuracy(
		content: string,
		filePath: string,
		context: any
	): CodeAccuracyMetrics {
		const metrics: CodeAccuracyMetrics = {
			syntax: 0,
			imports: 0,
			types: 0,
			logic: 0,
			style: 0,
			overall: 0,
			issues: [],
			suggestions: [],
		};

		// Basic syntax check
		try {
			// This is a simplified check - in practice, you'd use a proper parser
			if (content.includes("import ") || content.includes("export ")) {
				metrics.syntax = 90; // Assume good syntax if imports/exports are present
			} else {
				metrics.syntax = 70;
			}
		} catch {
			metrics.syntax = 50;
			metrics.issues.push("Potential syntax issues detected");
		}

		// Import analysis
		const importLines = content
			.split("\n")
			.filter((line) => line.trim().startsWith("import"));
		if (importLines.length > 0) {
			metrics.imports = 85; // Assume reasonable imports
		} else {
			metrics.imports = 60;
			metrics.suggestions.push("Consider adding necessary imports");
		}

		// Type analysis (for TypeScript)
		if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
			if (
				content.includes("interface ") ||
				content.includes("type ") ||
				content.includes(": ")
			) {
				metrics.types = 90;
			} else {
				metrics.types = 60;
				metrics.suggestions.push("Consider adding type annotations");
			}
		} else {
			metrics.types = 80; // Not applicable for non-TypeScript
		}

		// Logic analysis (basic)
		if (
			content.includes("function ") ||
			content.includes("=>") ||
			content.includes("class ")
		) {
			metrics.logic = 85;
		} else {
			metrics.logic = 70;
		}

		// Style analysis
		if (content.includes("//") || content.includes("/*")) {
			metrics.style = 90; // Has comments
		} else {
			metrics.style = 75;
			metrics.suggestions.push("Consider adding comments for complex logic");
		}

		// Calculate overall accuracy
		metrics.overall =
			(metrics.syntax +
				metrics.imports +
				metrics.types +
				metrics.logic +
				metrics.style) /
			5;

		return metrics;
	}

	/**
	 * Analyze modification accuracy
	 */
	private _analyzeModificationAccuracy(
		originalContent: string,
		modifiedContent: string,
		filePath: string,
		context: any
	): CodeAccuracyMetrics {
		const metrics = this._analyzeCodeAccuracy(
			modifiedContent,
			filePath,
			context
		);

		// Additional modification-specific analysis
		const originalLines = originalContent.split("\n").length;
		const modifiedLines = modifiedContent.split("\n").length;
		const changeRatio = Math.abs(modifiedLines - originalLines) / originalLines;

		if (changeRatio > 0.5) {
			metrics.issues.push(
				"Significant changes detected - verify modifications are correct"
			);
		}

		if (!modifiedContent.includes(originalContent.substring(0, 100))) {
			metrics.issues.push("Original content structure may have been lost");
		}

		return metrics;
	}

	/**
	 * Analyze correction accuracy
	 */
	private _analyzeCorrectionAccuracy(
		originalContent: string,
		correctedContent: string,
		errors: vscode.Diagnostic[],
		filePath: string,
		context: any
	): CodeAccuracyMetrics {
		const metrics = this._analyzeCodeAccuracy(
			correctedContent,
			filePath,
			context
		);

		// Check if errors were addressed
		let addressedErrors = 0;
		for (const error of errors) {
			// This is a simplified check - in practice, you'd use more sophisticated analysis
			if (!correctedContent.includes(error.message)) {
				addressedErrors++;
			}
		}

		const errorResolutionRate =
			errors.length > 0 ? (addressedErrors / errors.length) * 100 : 100;
		metrics.overall = (metrics.overall + errorResolutionRate) / 2;

		if (errorResolutionRate < 100) {
			metrics.issues.push(
				`Only ${Math.round(errorResolutionRate)}% of errors were addressed`
			);
		}

		return metrics;
	}

	/**
	 * Check if a step is feasible
	 */
	private _isStepFeasible(step: any): boolean {
		if (!step || !step.action) {
			return false;
		}

		switch (step.action) {
			case "create_directory":
				return step.path && typeof step.path === "string";
			case "create_file":
				return step.path && (step.content || step.generate_prompt);
			case "modify_file":
				return step.path && step.modification_prompt;
			case "run_command":
				return step.command && typeof step.command === "string";
			default:
				return false;
		}
	}

	/**
	 * Check if a step is safe
	 */
	private _isStepSafe(step: any): boolean {
		if (!step || !step.path) {
			return true;
		}

		const path = step.path;

		// Check for dangerous patterns
		if (path.includes("..") || path.includes("~") || path.startsWith("/")) {
			return false;
		}

		// Check for dangerous commands
		if (step.command) {
			const dangerousCommands = ["rm -rf", "del /s", "format", "shutdown"];
			for (const cmd of dangerousCommands) {
				if (step.command.includes(cmd)) {
					return false;
				}
			}
		}

		return true;
	}

	/**
	 * Create enhanced error correction prompt
	 */
	private _createErrorCorrectionPrompt(
		filePath: string,
		errors: vscode.Diagnostic[],
		context: any
	): string {
		const errorDescriptions = errors
			.map((error) => `- Line ${error.range.start.line + 1}: ${error.message}`)
			.join("\n");

		return `Fix the following errors in the file while maintaining existing functionality:

**Errors to Fix:**
${errorDescriptions}

**Correction Requirements:**
- Fix all identified errors
- Maintain existing functionality
- Preserve code structure and style
- Add necessary imports if missing
- Ensure type safety (for TypeScript)
- Follow project conventions

**Important:**
- Make minimal changes to fix the errors
- Preserve the original logic and structure
- Ensure the corrected code compiles and runs correctly`;
	}

	/**
	 * Format diagnostics for prompt
	 */
	private _formatDiagnostics(diagnostics: vscode.Diagnostic[]): string {
		return diagnostics
			.map(
				(diagnostic) =>
					`${diagnostic.message} (Line ${diagnostic.range.start.line + 1})`
			)
			.join("\n");
	}

	/**
	 * Format recent changes for prompt
	 */
	private _formatRecentChanges(recentChanges: any[]): string {
		return recentChanges
			.map(
				(change) =>
					`${change.changeType}: ${change.filePath} - ${change.summary}`
			)
			.join("\n");
	}
}

/**
 * Interfaces for enhanced AI service
 */
export interface PlanAccuracyMetrics {
	completeness: number;
	specificity: number;
	feasibility: number;
	safety: number;
	overall: number;
	issues: string[];
	suggestions: string[];
}

export interface CodeAccuracyMetrics {
	syntax: number;
	imports: number;
	types: number;
	logic: number;
	style: number;
	overall: number;
	issues: string[];
	suggestions: string[];
}

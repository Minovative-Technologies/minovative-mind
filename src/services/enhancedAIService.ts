import * as vscode from "vscode";
import { AIRequestService } from "./aiRequestService";
import { EnhancedCodeGenerator } from "../ai/enhancedCodeGeneration";
import { EnhancedContextBuilder } from "../context/enhancedContextBuilder";
import { EnhancedPromptBuilder } from "../ai/enhancedPromptBuilder";
import { ActiveSymbolDetailedInfo } from "./contextService";

/**
 * Enhanced AI service that provides more accurate code generation
 * by integrating multiple improvements:
 * 1. Better context analysis
 * 2. Enhanced prompts
 * 3. Code validation and refinement
 * 4. Framework-specific optimizations
 * 5. Error prevention and correction
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
			workspaceRoot
		);
		this.enhancedContextBuilder = new EnhancedContextBuilder();
	}

	/**
	 * Enhanced plan generation with better accuracy
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
		token?: vscode.CancellationToken
	): Promise<{ plan: any; context: string; accuracy: PlanAccuracyMetrics }> {
		// Step 1: Build enhanced context
		this.postMessageToWebview({
			type: "statusUpdate",
			value: "Building enhanced context for better accuracy...",
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

		// Step 2: Create enhanced planning prompt
		this.postMessageToWebview({
			type: "statusUpdate",
			value: "Creating enhanced planning prompt...",
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
		this.postMessageToWebview({
			type: "statusUpdate",
			value: "Generating enhanced execution plan...",
		});

		const planResponse = await this.aiRequestService.generateWithRetry(
			enhancedPrompt,
			modelName,
			undefined,
			"enhanced plan generation",
			{
				responseMimeType: "application/json",
				temperature: 0.1, // Lower temperature for more consistent results
			},
			undefined,
			token
		);

		// Step 4: Validate and analyze plan accuracy
		const plan = this._parseAndValidatePlan(planResponse);
		const accuracyMetrics = this._analyzePlanAccuracy(
			plan,
			userRequest,
			options
		);

		return {
			plan,
			context: enhancedContext,
			accuracy: accuracyMetrics,
		};
	}

	/**
	 * Enhanced file content generation with validation
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
		token?: vscode.CancellationToken
	): Promise<{
		content: string;
		validation: any;
		accuracy: CodeAccuracyMetrics;
	}> {
		// Step 1: Generate content with enhanced generator
		this.postMessageToWebview({
			type: "statusUpdate",
			value: `Generating enhanced content for ${filePath}...`,
		});

		const result = await this.enhancedCodeGenerator.generateFileContent(
			filePath,
			generatePrompt,
			context,
			modelName,
			token
		);

		// Step 2: Analyze code accuracy
		const accuracyMetrics = this._analyzeCodeAccuracy(
			result.content,
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
	 * Enhanced file modification with intelligent analysis
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
		token?: vscode.CancellationToken
	): Promise<{
		content: string;
		validation: any;
		accuracy: CodeAccuracyMetrics;
	}> {
		// Step 1: Modify content with enhanced generator
		this.postMessageToWebview({
			type: "statusUpdate",
			value: `Modifying ${filePath} with enhanced accuracy...`,
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
		const accuracyMetrics = this._analyzeModificationAccuracy(
			currentContent,
			result.content,
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

import * as vscode from "vscode";
import { AIRequestService } from "./aiRequestService";
import { EnhancedCodeGenerator } from "../ai/enhancedCodeGeneration";
import {
	IncrementalCodeUpdater,
	CodeChange,
} from "../utils/incrementalCodeUpdater";
import {
	ParallelProcessor,
	ParallelTask,
	ParallelTaskResult,
} from "../utils/parallelProcessor";
import { ContextService } from "./contextService";

export interface WorkflowTask {
	id: string;
	type: "generate" | "modify" | "analyze" | "refactor";
	filePath: string;
	prompt: string;
	priority: number;
	dependencies?: string[];
	context?: {
		projectContext: string;
		relevantSnippets: string;
		editorContext?: any;
	};
}

export interface WorkflowResult {
	taskId: string;
	success: boolean;
	content?: string;
	changes?: CodeChange[];
	validation?: any;
	error?: string;
	duration: number;
}

export interface EnhancedWorkflowConfig {
	maxConcurrency: number;
	enableIncrementalUpdates: boolean;
	enableParallelProcessing: boolean;
	enableValidation: boolean;
	timeout: number;
	retries: number;
}

export class EnhancedWorkflowService {
	private static readonly DEFAULT_CONFIG: EnhancedWorkflowConfig = {
		maxConcurrency: 3,
		enableIncrementalUpdates: true,
		enableParallelProcessing: true,
		enableValidation: true,
		timeout: 60000,
		retries: 2,
	};

	constructor(
		private aiRequestService: AIRequestService,
		private codeGenerator: EnhancedCodeGenerator,
		private contextService: ContextService,
		private workspaceRoot: vscode.Uri
	) {}

	/**
	 * Execute a workflow of multiple tasks with parallel processing and incremental updates
	 */
	public async executeWorkflow(
		tasks: WorkflowTask[],
		config: Partial<EnhancedWorkflowConfig> = {}
	): Promise<Map<string, WorkflowResult>> {
		const finalConfig = {
			...EnhancedWorkflowService.DEFAULT_CONFIG,
			...config,
		};
		const results = new Map<string, WorkflowResult>();

		if (finalConfig.enableParallelProcessing) {
			// Execute tasks in parallel with dependency management
			const parallelTasks: ParallelTask<WorkflowResult>[] = tasks.map(
				(task) => ({
					id: task.id,
					task: () => this.executeSingleTask(task, finalConfig),
					priority: task.priority,
					dependencies: task.dependencies,
					timeout: finalConfig.timeout,
					retries: finalConfig.retries,
				})
			);

			const parallelResults = await ParallelProcessor.executeParallel(
				parallelTasks,
				{
					maxConcurrency: finalConfig.maxConcurrency,
					defaultTimeout: finalConfig.timeout,
					defaultRetries: finalConfig.retries,
					enableRetries: true,
					enableTimeout: true,
				}
			);

			// Convert parallel results to workflow results
			for (const [taskId, result] of parallelResults) {
				results.set(taskId, result.result);
			}
		} else {
			// Execute tasks sequentially
			for (const task of tasks) {
				const result = await this.executeSingleTask(task, finalConfig);
				results.set(task.id, result);
			}
		}

		return results;
	}

	/**
	 * Execute a single workflow task
	 */
	private async executeSingleTask(
		task: WorkflowTask,
		config: EnhancedWorkflowConfig
	): Promise<WorkflowResult> {
		const startTime = Date.now();

		try {
			// Get context for the task
			const context = await this.getTaskContext(task);

			switch (task.type) {
				case "generate":
					return await this.executeGenerateTask(task, context, config);
				case "modify":
					return await this.executeModifyTask(task, context, config);
				case "analyze":
					return await this.executeAnalyzeTask(task, context, config);
				case "refactor":
					return await this.executeRefactorTask(task, context, config);
				default:
					throw new Error(`Unknown task type: ${task.type}`);
			}
		} catch (error) {
			const duration = Date.now() - startTime;
			return {
				taskId: task.id,
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration,
			};
		}
	}

	/**
	 * Execute a file generation task
	 */
	private async executeGenerateTask(
		task: WorkflowTask,
		context: any,
		config: EnhancedWorkflowConfig
	): Promise<WorkflowResult> {
		const startTime = Date.now();

		const result = await this.codeGenerator.generateFileContent(
			task.filePath,
			task.prompt,
			context,
			"gemini-pro",
			undefined
		);

		const duration = Date.now() - startTime;
		return {
			taskId: task.id,
			success: result.validation.isValid,
			content: result.content,
			validation: result.validation,
			duration,
		};
	}

	/**
	 * Execute a file modification task with incremental updates
	 */
	private async executeModifyTask(
		task: WorkflowTask,
		context: any,
		config: EnhancedWorkflowConfig
	): Promise<WorkflowResult> {
		const startTime = Date.now();

		// Read current file content
		const fileUri = vscode.Uri.joinPath(this.workspaceRoot, task.filePath);
		const document = await vscode.workspace.openTextDocument(fileUri);
		const currentContent = document.getText();

		if (config.enableIncrementalUpdates) {
			// Try incremental updates first
			try {
				const incrementalChanges =
					await IncrementalCodeUpdater.generateMinimalChanges(
						currentContent,
						task.prompt,
						{
							projectContext: context.projectContext,
							relevantSnippets: context.relevantSnippets,
							filePath: task.filePath,
						},
						this.aiRequestService,
						"gemini-pro"
					);

				if (incrementalChanges.length > 0) {
					const duration = Date.now() - startTime;
					return {
						taskId: task.id,
						success: true,
						changes: incrementalChanges,
						duration,
					};
				}
			} catch (error) {
				console.warn(`Incremental update failed for task ${task.id}:`, error);
			}
		}

		// Fallback to full file modification
		const result = await this.codeGenerator.modifyFileContent(
			task.filePath,
			task.prompt,
			currentContent,
			context,
			"gemini-pro"
		);

		const duration = Date.now() - startTime;
		return {
			taskId: task.id,
			success: result.validation.isValid,
			content: result.content,
			validation: result.validation,
			duration,
		};
	}

	/**
	 * Execute a file analysis task
	 */
	private async executeAnalyzeTask(
		task: WorkflowTask,
		context: any,
		config: EnhancedWorkflowConfig
	): Promise<WorkflowResult> {
		const startTime = Date.now();

		// Create analysis prompt
		const analysisPrompt = `Analyze the following file and provide insights:

**FILE PATH:** ${task.filePath}

**ANALYSIS REQUEST:** ${task.prompt}

**PROJECT CONTEXT:** ${context.projectContext}

**RELEVANT SNIPPETS:** ${context.relevantSnippets}

Please provide a comprehensive analysis including:
1. Code quality assessment
2. Potential improvements
3. Security considerations
4. Performance optimizations
5. Best practices recommendations

Provide your analysis in a structured format:`;

		const analysis = await this.aiRequestService.generateWithRetry(
			analysisPrompt,
			"gemini-pro",
			undefined,
			`analysis-${task.id}`,
			undefined,
			undefined,
			undefined,
			false
		);

		const duration = Date.now() - startTime;
		return {
			taskId: task.id,
			success: true,
			content: analysis,
			duration,
		};
	}

	/**
	 * Execute a refactoring task
	 */
	private async executeRefactorTask(
		task: WorkflowTask,
		context: any,
		config: EnhancedWorkflowConfig
	): Promise<WorkflowResult> {
		const startTime = Date.now();

		// Read current file content
		const fileUri = vscode.Uri.joinPath(this.workspaceRoot, task.filePath);
		const document = await vscode.workspace.openTextDocument(fileUri);
		const currentContent = document.getText();

		// Create refactoring prompt
		const refactorPrompt = `Refactor the following code according to the requirements:

**REFACTORING REQUEST:** ${task.prompt}

**CURRENT CODE:**
\`\`\`
${currentContent}
\`\`\`

**PROJECT CONTEXT:** ${context.projectContext}

**RELEVANT SNIPPETS:** ${context.relevantSnippets}

Please refactor the code to:
1. Improve code quality and maintainability
2. Follow best practices
3. Optimize performance where possible
4. Maintain existing functionality
5. Ensure proper error handling

Provide the refactored code:`;

		const refactoredContent = await this.aiRequestService.generateWithRetry(
			refactorPrompt,
			"gemini-pro",
			undefined,
			`refactor-${task.id}`,
			undefined,
			undefined,
			undefined,
			false
		);

		// Generate incremental changes for the refactoring
		const changes = await IncrementalCodeUpdater.generateIncrementalChanges(
			currentContent,
			refactoredContent,
			task.filePath,
			document
		);

		const duration = Date.now() - startTime;
		return {
			taskId: task.id,
			success: changes.changes.length > 0,
			content: refactoredContent,
			changes: changes.changes,
			duration,
		};
	}

	/**
	 * Get context for a task
	 */
	private async getTaskContext(task: WorkflowTask): Promise<any> {
		if (task.context) {
			return task.context;
		}

		// Generate context using the context service
		const fileUri = vscode.Uri.joinPath(this.workspaceRoot, task.filePath);
		const document = await vscode.workspace.openTextDocument(fileUri);
		const fullText = document.getText();

		const contextResult = await this.contextService.buildProjectContext(
			undefined, // cancellationToken
			task.prompt, // userRequest
			{
				documentUri: fileUri,
				instruction: task.prompt,
				selectedText: "",
				fullText: fullText,
				languageId: document.languageId,
				filePath: task.filePath,
				selection: new vscode.Range(0, 0, 0, 0),
			}, // editorContext
			undefined, // initialDiagnosticsString
			{
				enablePerformanceMonitoring: false,
				maxConcurrency: 5,
			} // options
		);

		return {
			projectContext: contextResult.contextString || "",
			relevantSnippets: contextResult.relevantFiles.join("\n") || "",
			editorContext: undefined,
			activeSymbolInfo: undefined,
		};
	}

	/**
	 * Create a workflow for batch file processing
	 */
	public createBatchProcessingWorkflow(
		files: vscode.Uri[],
		operation: "analyze" | "refactor" | "optimize",
		prompt: string
	): WorkflowTask[] {
		return files.map((file, index) => ({
			id: `${operation}-${file.fsPath}`,
			type: operation === "analyze" ? "analyze" : "refactor",
			filePath: vscode.workspace.asRelativePath(file),
			prompt: `${prompt} for file: ${file.fsPath}`,
			priority: files.length - index, // Process files in order
			dependencies: [],
		}));
	}

	/**
	 * Create a workflow for incremental code improvements
	 */
	public createIncrementalImprovementWorkflow(
		files: vscode.Uri[],
		improvements: string[]
	): WorkflowTask[] {
		const tasks: WorkflowTask[] = [];

		for (const file of files) {
			for (const improvement of improvements) {
				tasks.push({
					id: `improve-${file.fsPath}-${improvement.replace(/\s+/g, "-")}`,
					type: "modify",
					filePath: vscode.workspace.asRelativePath(file),
					prompt: `Apply the following improvement: ${improvement}`,
					priority: 5,
					dependencies: [],
				});
			}
		}

		return tasks;
	}

	/**
	 * Get workflow execution statistics
	 */
	public getWorkflowStats(results: Map<string, WorkflowResult>): {
		totalTasks: number;
		successfulTasks: number;
		failedTasks: number;
		averageDuration: number;
		totalDuration: number;
		successRate: number;
		taskTypeBreakdown: Record<string, number>;
	} {
		const totalTasks = results.size;
		const successfulTasks = Array.from(results.values()).filter(
			(r) => r.success
		).length;
		const failedTasks = totalTasks - successfulTasks;
		const totalDuration = Array.from(results.values()).reduce(
			(sum, r) => sum + r.duration,
			0
		);
		const averageDuration = totalTasks > 0 ? totalDuration / totalTasks : 0;
		const successRate =
			totalTasks > 0 ? (successfulTasks / totalTasks) * 100 : 0;

		// Task type breakdown
		const taskTypeBreakdown: Record<string, number> = {};
		for (const result of results.values()) {
			const taskType = result.taskId.split("-")[0];
			taskTypeBreakdown[taskType] = (taskTypeBreakdown[taskType] || 0) + 1;
		}

		return {
			totalTasks,
			successfulTasks,
			failedTasks,
			averageDuration,
			totalDuration,
			successRate,
			taskTypeBreakdown,
		};
	}
}

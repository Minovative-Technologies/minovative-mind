import * as vscode from "vscode";
import { AIRequestService } from "./aiRequestService";
import { intelligentlySummarizeFileContent } from "../context/fileContentProcessor";
import { ActiveSymbolDetailedInfo } from "./contextService";
import { DEFAULT_MODEL, TEMPERATURE } from "../sidebar/common/sidebarConstants";
import { HistoryEntryPart } from "../sidebar/common/sidebarTypes";

export interface FileSummary {
	filePath: string;
	relativePath: string;
	summary: string;
	keyInsights: string[];
	fileType: string;
	estimatedComplexity: "low" | "medium" | "high";
	mainPurpose: string;
	dependencies?: string[];
	lastModified?: Date;
}

export interface SequentialProcessingOptions {
	maxFilesPerBatch?: number;
	summaryLength?: number;
	enableDetailedAnalysis?: boolean;
	includeDependencies?: boolean;
	complexityThreshold?: "low" | "medium" | "high";
	modelName?: string;
	onProgress?: (
		currentFile: string,
		totalFiles: number,
		progress: number
	) => void;
	onFileProcessed?: (summary: FileSummary) => void;
}

export interface ProcessingContext {
	processedFiles: FileSummary[];
	currentContext: string;
	totalFiles: number;
	processedCount: number;
	userRequest?: string;
	workspaceRoot: vscode.Uri;
}

export class SequentialFileProcessor {
	private aiRequestService: AIRequestService;
	private workspaceRoot: vscode.Uri;
	private postMessageToWebview: (message: any) => void;

	constructor(
		aiRequestService: AIRequestService,
		workspaceRoot: vscode.Uri,
		postMessageToWebview: (message: any) => void
	) {
		this.aiRequestService = aiRequestService;
		this.workspaceRoot = workspaceRoot;
		this.postMessageToWebview = postMessageToWebview;
	}

	/**
	 * Process files sequentially, building context incrementally
	 */
	public async processFilesSequentially(
		files: vscode.Uri[],
		userRequest: string,
		options: SequentialProcessingOptions = {}
	): Promise<{
		summaries: FileSummary[];
		finalContext: string;
		processingMetrics: {
			totalFiles: number;
			processedFiles: number;
			totalTime: number;
			averageTimePerFile: number;
		};
	}> {
		const startTime = Date.now();
		const {
			maxFilesPerBatch = 20,
			summaryLength = 3000,
			enableDetailedAnalysis = true,
			includeDependencies = true,
			complexityThreshold = "high",
			modelName = DEFAULT_MODEL,
			onProgress,
			onFileProcessed,
		} = options;

		const processingContext: ProcessingContext = {
			processedFiles: [],
			currentContext: "",
			totalFiles: files.length,
			processedCount: 0,
			userRequest,
			workspaceRoot: this.workspaceRoot,
		};

		this.postMessageToWebview({
			type: "statusUpdate",
			value: `Starting sequential file processing for ${files.length} files...`,
		});

		// Process files in batches to maintain manageable context
		for (let i = 0; i < files.length; i += maxFilesPerBatch) {
			const batch = files.slice(i, i + maxFilesPerBatch);
			const batchStartTime = Date.now();

			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Processing batch ${
					Math.floor(i / maxFilesPerBatch) + 1
				}/${Math.ceil(files.length / maxFilesPerBatch)} (${
					batch.length
				} files)...`,
			});

			// Process each file in the current batch
			for (const fileUri of batch) {
				const fileStartTime = Date.now();
				const relativePath = vscode.workspace.asRelativePath(fileUri);

				this.postMessageToWebview({
					type: "statusUpdate",
					value: `Analyzing: ${relativePath}`,
				});

				try {
					const summary = await this.processSingleFile(
						fileUri,
						processingContext,
						{
							summaryLength,
							enableDetailedAnalysis,
							includeDependencies,
							complexityThreshold,
							modelName,
						}
					);

					processingContext.processedFiles.push(summary);
					processingContext.processedCount++;

					// Update progress
					const progress =
						(processingContext.processedCount / processingContext.totalFiles) *
						100;
					onProgress?.(relativePath, processingContext.totalFiles, progress);

					// Call file processed callback
					onFileProcessed?.(summary);

					const fileTime = Date.now() - fileStartTime;
					console.log(`Processed ${relativePath} in ${fileTime}ms`);
				} catch (error) {
					console.error(`Error processing file ${relativePath}:`, error);
					// Continue with next file instead of failing completely
				}
			}

			// Update context after each batch
			processingContext.currentContext =
				this.buildIncrementalContext(processingContext);

			const batchTime = Date.now() - batchStartTime;
			console.log(`Batch processed in ${batchTime}ms`);
		}

		const totalTime = Date.now() - startTime;
		const averageTimePerFile = totalTime / processingContext.processedCount;

		this.postMessageToWebview({
			type: "statusUpdate",
			value: `Sequential processing complete. Processed ${processingContext.processedCount} files in ${totalTime}ms`,
		});

		return {
			summaries: processingContext.processedFiles,
			finalContext: processingContext.currentContext,
			processingMetrics: {
				totalFiles: files.length,
				processedFiles: processingContext.processedCount,
				totalTime,
				averageTimePerFile,
			},
		};
	}

	/**
	 * Process a single file and generate a comprehensive summary
	 */
	public async processSingleFile(
		fileUri: vscode.Uri,
		context: ProcessingContext,
		options: {
			summaryLength: number;
			enableDetailedAnalysis: boolean;
			includeDependencies: boolean;
			complexityThreshold: "low" | "medium" | "high";
			modelName: string;
		}
	): Promise<FileSummary> {
		const relativePath = vscode.workspace.asRelativePath(fileUri);
		const fileExtension =
			relativePath.split(".").pop()?.toLowerCase() || "unknown";

		// Read file content
		const contentBytes = await vscode.workspace.fs.readFile(fileUri);
		const fileContent = Buffer.from(contentBytes).toString("utf-8");

		// Get file stats
		const fileStat = await vscode.workspace.fs.stat(fileUri);
		const lastModified = new Date(fileStat.mtime);

		// Get document symbols for better analysis
		const document = await vscode.workspace.openTextDocument(fileUri);
		const symbols = await vscode.commands.executeCommand<
			vscode.DocumentSymbol[]
		>("vscode.executeDocumentSymbolProvider", fileUri);

		// Generate initial summary using existing intelligent summarization
		const initialSummary = intelligentlySummarizeFileContent(
			fileContent,
			symbols,
			undefined, // No active symbol info for batch processing
			options.summaryLength
		);

		// Generate AI-powered detailed analysis if enabled
		let detailedAnalysis = "";
		let keyInsights: string[] = [];
		let estimatedComplexity: "low" | "medium" | "high" = "medium";
		let mainPurpose = "Unknown";

		if (options.enableDetailedAnalysis) {
			const analysisPrompt = this.createFileAnalysisPrompt(
				relativePath,
				fileContent,
				initialSummary,
				context,
				options
			);

			try {
				detailedAnalysis = await this.aiRequestService.generateWithRetry(
					[{ text: analysisPrompt }],
					options.modelName,
					undefined,
					`file-analysis-${relativePath}`,
					{
						temperature: TEMPERATURE,
						maxOutputTokens: 5000,
					}
				);

				// Parse the AI response to extract structured information
				const parsedAnalysis = this.parseFileAnalysis(detailedAnalysis);
				keyInsights = parsedAnalysis.keyInsights;
				estimatedComplexity = parsedAnalysis.complexity;
				mainPurpose = parsedAnalysis.mainPurpose;
			} catch (error) {
				console.warn(
					`Failed to get detailed analysis for ${relativePath}:`,
					error
				);
				// Fallback to basic analysis
				keyInsights = this.generateBasicInsights(fileContent, fileExtension);
				estimatedComplexity = this.estimateComplexity(fileContent, symbols);
				mainPurpose = this.determineMainPurpose(fileExtension, relativePath);
			}
		} else {
			// Use basic analysis
			keyInsights = this.generateBasicInsights(fileContent, fileExtension);
			estimatedComplexity = this.estimateComplexity(fileContent, symbols);
			mainPurpose = this.determineMainPurpose(fileExtension, relativePath);
		}

		// Extract dependencies if enabled
		let dependencies: string[] = [];
		if (options.includeDependencies) {
			dependencies = this.extractDependencies(fileContent, fileExtension);
		}

		return {
			filePath: fileUri.fsPath,
			relativePath,
			summary: initialSummary,
			keyInsights,
			fileType: fileExtension,
			estimatedComplexity,
			mainPurpose,
			dependencies,
			lastModified,
		};
	}

	/**
	 * Create a prompt for AI-powered file analysis
	 */
	private createFileAnalysisPrompt(
		relativePath: string,
		fileContent: string,
		initialSummary: string,
		context: ProcessingContext,
		options: any
	): string {
		const contextInfo =
			context.processedFiles.length > 0
				? `\nPreviously processed files: ${context.processedFiles.length}`
				: "\nThis is the first file being processed.";

		return `Analyze this file and provide structured insights. Respond in JSON format:

File: ${relativePath}
File Type: ${relativePath.split(".").pop()?.toLowerCase() || "unknown"}
Content Length: ${fileContent.length} characters
${contextInfo}

Initial Summary:
${initialSummary}

Please analyze this file and provide:
1. Key insights about the file's purpose and functionality
2. Estimated complexity (low/medium/high)
3. Main purpose of the file
4. Important patterns or architectural decisions

Respond in this JSON format:
{
  "keyInsights": ["insight1", "insight2", "insight3"],
  "complexity": "low|medium|high",
  "mainPurpose": "brief description of main purpose"
}`;
	}

	/**
	 * Parse AI analysis response
	 */
	private parseFileAnalysis(analysis: string): {
		keyInsights: string[];
		complexity: "low" | "medium" | "high";
		mainPurpose: string;
	} {
		try {
			// Try to extract JSON from the response
			const jsonMatch = analysis.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);
				return {
					keyInsights: parsed.keyInsights || [],
					complexity: parsed.complexity || "medium",
					mainPurpose: parsed.mainPurpose || "Unknown",
				};
			}
		} catch (error) {
			console.warn("Failed to parse AI analysis response:", error);
		}

		// Fallback parsing
		return {
			keyInsights: [],
			complexity: "medium",
			mainPurpose: "Unknown",
		};
	}

	/**
	 * Generate basic insights without AI
	 */
	private generateBasicInsights(
		fileContent: string,
		fileExtension: string
	): string[] {
		const insights: string[] = [];

		// Basic analysis based on file content
		if (fileContent.includes("import") || fileContent.includes("require")) {
			insights.push("Contains imports/dependencies");
		}

		if (fileContent.includes("class") || fileContent.includes("function")) {
			insights.push("Contains classes or functions");
		}

		if (fileContent.includes("export")) {
			insights.push("Exports functionality");
		}

		if (fileContent.includes("interface") || fileContent.includes("type")) {
			insights.push("Contains type definitions");
		}

		return insights.length > 0 ? insights : ["Standard code file"];
	}

	/**
	 * Estimate file complexity
	 */
	private estimateComplexity(
		fileContent: string,
		symbols?: vscode.DocumentSymbol[]
	): "low" | "medium" | "high" {
		const lines = fileContent.split("\n").length;
		const symbolCount = symbols?.length || 0;

		if (lines > 500 || symbolCount > 20) {
			return "high";
		}
		if (lines > 200 || symbolCount > 10) {
			return "medium";
		}
		return "low";
	}

	/**
	 * Determine main purpose based on file extension and path
	 */
	private determineMainPurpose(
		fileExtension: string,
		relativePath: string
	): string {
		const path = relativePath.toLowerCase();

		if (path.includes("test") || path.includes("spec")) {
			return "Testing";
		}
		if (path.includes("config") || path.includes("setup")) {
			return "Configuration";
		}
		if (path.includes("util") || path.includes("helper")) {
			return "Utility";
		}
		if (path.includes("service") || path.includes("api")) {
			return "Service/API";
		}
		if (path.includes("component") || path.includes("ui")) {
			return "UI Component";
		}
		if (path.includes("model") || path.includes("type")) {
			return "Data Model";
		}
		if (path.includes("index") || path.includes("main")) {
			return "Entry Point";
		}

		switch (fileExtension) {
			case "json":
				return "Configuration/Data";
			case "md":
				return "Documentation";
			case "ts":
			case "js":
				return "Source Code";
			case "css":
			case "scss":
				return "Styling";
			case "html":
				return "Markup";
			default:
				return "Source Code";
		}
	}

	/**
	 * Extract dependencies from file content
	 */
	private extractDependencies(
		fileContent: string,
		fileExtension: string
	): string[] {
		const dependencies: string[] = [];

		if (fileExtension === "ts" || fileExtension === "js") {
			// Extract import statements
			const importMatches = fileContent.match(
				/import\s+.*?from\s+['"]([^'"]+)['"]/g
			);
			if (importMatches) {
				importMatches.forEach((match) => {
					const moduleMatch = match.match(/from\s+['"]([^'"]+)['"]/);
					if (moduleMatch) {
						dependencies.push(moduleMatch[1]);
					}
				});
			}

			// Extract require statements
			const requireMatches = fileContent.match(
				/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
			);
			if (requireMatches) {
				requireMatches.forEach((match) => {
					const moduleMatch = match.match(/['"]([^'"]+)['"]/);
					if (moduleMatch) {
						dependencies.push(moduleMatch[1]);
					}
				});
			}
		}

		return dependencies;
	}

	/**
	 * Build incremental context from processed files
	 */
	private buildIncrementalContext(context: ProcessingContext): string {
		if (context.processedFiles.length === 0) {
			return "No files processed yet.";
		}

		let contextString = `Sequential File Analysis Summary:\n`;
		contextString += `Total files processed: ${context.processedCount}/${context.totalFiles}\n\n`;

		// Group files by complexity and purpose
		const byComplexity = {
			high: context.processedFiles.filter(
				(f) => f.estimatedComplexity === "high"
			),
			medium: context.processedFiles.filter(
				(f) => f.estimatedComplexity === "medium"
			),
			low: context.processedFiles.filter(
				(f) => f.estimatedComplexity === "low"
			),
		};

		const byPurpose = new Map<string, FileSummary[]>();
		context.processedFiles.forEach((file) => {
			const purpose = file.mainPurpose;
			if (!byPurpose.has(purpose)) {
				byPurpose.set(purpose, []);
			}
			byPurpose.get(purpose)!.push(file);
		});

		// Add complexity breakdown
		contextString += `Complexity Breakdown:\n`;
		contextString += `- High complexity: ${byComplexity.high.length} files\n`;
		contextString += `- Medium complexity: ${byComplexity.medium.length} files\n`;
		contextString += `- Low complexity: ${byComplexity.low.length} files\n\n`;

		// Add purpose breakdown
		contextString += `Purpose Breakdown:\n`;
		for (const [purpose, files] of byPurpose) {
			contextString += `- ${purpose}: ${files.length} files\n`;
		}
		contextString += `\n`;

		// Add recent file summaries (last 5 files)
		const recentFiles = context.processedFiles.slice(-5);
		contextString += `Recent File Summaries:\n`;
		for (const file of recentFiles) {
			contextString += `\n--- ${file.relativePath} ---\n`;
			contextString += `Purpose: ${file.mainPurpose}\n`;
			contextString += `Complexity: ${file.estimatedComplexity}\n`;
			if (file.keyInsights.length > 0) {
				contextString += `Key Insights: ${file.keyInsights.join(", ")}\n`;
			}
			contextString += `Summary: ${file.summary.substring(0, 300)}${
				file.summary.length > 300 ? "..." : ""
			}\n`;
		}

		return contextString;
	}

	/**
	 * Get a specific file's detailed context for AI processing
	 */
	public async getFileContextForAI(
		fileUri: vscode.Uri,
		previousSummaries: FileSummary[],
		userRequest: string
	): Promise<string> {
		const relativePath = vscode.workspace.asRelativePath(fileUri);

		let context = `Processing file: ${relativePath}\n`;
		context += `User request: ${userRequest}\n\n`;

		if (previousSummaries.length > 0) {
			context += `Context from previously analyzed files:\n`;
			context += `Total files analyzed: ${previousSummaries.length}\n\n`;

			// Add relevant previous file summaries
			const relevantFiles = this.findRelevantPreviousFiles(
				previousSummaries,
				relativePath,
				userRequest
			);
			for (const file of relevantFiles.slice(-3)) {
				// Last 3 relevant files
				context += `--- ${file.relativePath} ---\n`;
				context += `Purpose: ${file.mainPurpose}\n`;
				context += `Key insights: ${file.keyInsights.join(", ")}\n`;
				context += `Summary: ${file.summary.substring(0, 200)}${
					file.summary.length > 200 ? "..." : ""
				}\n\n`;
			}
		}

		return context;
	}

	/**
	 * Find relevant previous files based on dependencies and user request
	 */
	private findRelevantPreviousFiles(
		previousSummaries: FileSummary[],
		currentFilePath: string,
		userRequest: string
	): FileSummary[] {
		const relevant: FileSummary[] = [];

		// Find files that current file depends on
		for (const file of previousSummaries) {
			if (
				file.dependencies &&
				file.dependencies.some((dep) =>
					currentFilePath.includes(dep.replace(/['"]/g, ""))
				)
			) {
				relevant.push(file);
			}
		}

		// Find files with similar purposes if user request mentions specific functionality
		const requestLower = userRequest.toLowerCase();
		for (const file of previousSummaries) {
			if (
				file.mainPurpose.toLowerCase().includes(requestLower) ||
				file.keyInsights.some((insight) =>
					insight.toLowerCase().includes(requestLower)
				)
			) {
				relevant.push(file);
			}
		}

		return relevant;
	}
}

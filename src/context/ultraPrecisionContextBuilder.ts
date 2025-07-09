import * as vscode from "vscode";
import * as path from "path";
import { PrecisionSearchSystem } from "./precisionSearchSystem";
import { ActiveSymbolDetailedInfo } from "../services/contextService";
import { PlanGenerationContext } from "../sidebar/common/sidebarTypes";

// Ultra-precision context configuration
interface UltraPrecisionContextConfig {
	// Context optimization
	maxContextLength: number; // Maximum context length in characters
	maxFileLength: number; // Maximum file content length
	maxSymbolChars: number; // Maximum symbol information length
	enableProgressiveLoading: boolean; // Load context progressively
	enableSmartTruncation: boolean; // Smart truncation of content

	// Accuracy settings
	enableAccuracyValidation: boolean; // Validate context accuracy
	enableRelevanceScoring: boolean; // Score context relevance
	enableContextOptimization: boolean; // Optimize context for AI

	// Performance settings
	enableIntelligentCaching: boolean; // Smart caching system
	cachePrecisionThreshold: number; // Cache only high-precision results
	maxProcessingTime: number; // Maximum processing time

	// Quality assurance
	enableContextValidation: boolean; // Validate context quality
	enableFeedbackIntegration: boolean; // Integrate user feedback
	enableContinuousImprovement: boolean; // Continuously improve
}

// Context quality metrics
interface ContextQualityMetrics {
	relevanceScore: number; // 0.0-1.0 relevance score
	completenessScore: number; // 0.0-1.0 completeness score
	accuracyScore: number; // 0.0-1.0 accuracy score
	confidenceScore: number; // 0.0-1.0 confidence score
	processingTime: number; // Processing time in milliseconds
	contextSize: number; // Context size in characters
	fileCount: number; // Number of files included
}

// Ultra-precision context result
interface UltraPrecisionContextResult {
	contextString: string;
	relevantFiles: vscode.Uri[];
	qualityMetrics: ContextQualityMetrics;
	searchResult: any; // Precision search result
	processingTime: number; // Total processing time
	cacheHit: boolean; // Whether result came from cache
}

// Cache entry for ultra-precision context
interface UltraPrecisionContextCache {
	timestamp: number;
	result: UltraPrecisionContextResult;
	userRequest: string;
	activeFile?: string;
	workspaceHash: string;
}

export class UltraPrecisionContextBuilder {
	private static readonly DEFAULT_CONFIG: UltraPrecisionContextConfig = {
		maxContextLength: 80000, // Reduced for better performance
		maxFileLength: 12000, // Reduced for better performance
		maxSymbolChars: 6000, // Reduced for better performance
		enableProgressiveLoading: true,
		enableSmartTruncation: true,
		enableAccuracyValidation: true,
		enableRelevanceScoring: true,
		enableContextOptimization: true,
		enableIntelligentCaching: true,
		cachePrecisionThreshold: 0.85, // Higher threshold for ultra-precision
		maxProcessingTime: 15000, // 15 seconds
		enableContextValidation: true,
		enableFeedbackIntegration: true,
		enableContinuousImprovement: true,
	};

	private config: UltraPrecisionContextConfig;
	private precisionSearch: PrecisionSearchSystem;
	private contextCache = new Map<string, UltraPrecisionContextCache>();
	private qualityHistory: Array<{
		request: string;
		metrics: ContextQualityMetrics;
		timestamp: number;
	}> = [];

	constructor(config?: Partial<UltraPrecisionContextConfig>) {
		this.config = { ...UltraPrecisionContextBuilder.DEFAULT_CONFIG, ...config };
		this.precisionSearch = new PrecisionSearchSystem({
			minRelevanceScore: 0.4, // Higher threshold for ultra-precision
			maxContextFiles: 30, // Reduced for better performance
			enableSemanticSearch: true,
			enableDependencyAnalysis: true,
			enableSymbolAnalysis: true,
			enableSmartCaching: true,
			cachePrecisionThreshold: 0.9, // Very high threshold
			maxSearchTime: 8000, // 8 seconds
			enableDynamicSizing: true,
			enableProgressiveLoading: true,
			enableRelevanceRanking: true,
			enableAccuracyValidation: true,
			enableFeedbackLoop: true,
		});
	}

	/**
	 * Build ultra-precision context
	 */
	public async buildUltraPrecisionContext(
		userRequest: string,
		allScannedFiles: ReadonlyArray<vscode.Uri>,
		projectRoot: vscode.Uri,
		options: {
			activeEditorContext?: PlanGenerationContext["editorContext"];
			fileDependencies?: Map<string, string[]>;
			reverseFileDependencies?: Map<string, string[]>;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
			diagnostics?: vscode.Diagnostic[];
			chatHistory?: any[];
		} = {}
	): Promise<UltraPrecisionContextResult> {
		const startTime = Date.now();
		const cacheKey = this._generateCacheKey(
			userRequest,
			allScannedFiles,
			options
		);

		// Check cache first
		if (this.config.enableIntelligentCaching) {
			const cached = this.contextCache.get(cacheKey);
			if (cached && this._isCacheValid(cached, allScannedFiles)) {
				console.log(
					`[UltraPrecisionContext] Cache hit for request: ${userRequest.substring(
						0,
						50
					)}...`
				);
				return {
					...cached.result,
					processingTime: Date.now() - startTime,
					cacheHit: true,
				};
			}
		}

		// Perform ultra-precision search
		const searchResult = await this.precisionSearch.searchRelevantFiles(
			userRequest,
			allScannedFiles,
			projectRoot,
			options
		);

		// Build optimized context
		const contextString = await this._buildOptimizedContext(
			searchResult.files,
			projectRoot,
			options,
			searchResult.relevanceScores
		);

		// Calculate quality metrics
		const qualityMetrics = this._calculateQualityMetrics(
			contextString,
			searchResult,
			userRequest,
			Date.now() - startTime
		);

		// Validate context quality
		if (this.config.enableContextValidation) {
			this._validateContextQuality(qualityMetrics, userRequest);
		}

		const result: UltraPrecisionContextResult = {
			contextString,
			relevantFiles: searchResult.files,
			qualityMetrics,
			searchResult,
			processingTime: Date.now() - startTime,
			cacheHit: false,
		};

		// Cache high-quality results
		if (
			this.config.enableIntelligentCaching &&
			qualityMetrics.confidenceScore >= this.config.cachePrecisionThreshold
		) {
			this._cacheResult(
				cacheKey,
				result,
				userRequest,
				options,
				allScannedFiles
			);
		}

		// Update quality history
		if (this.config.enableFeedbackIntegration) {
			this._updateQualityHistory(userRequest, qualityMetrics);
		}

		return result;
	}

	/**
	 * Build optimized context string
	 */
	private async _buildOptimizedContext(
		relevantFiles: vscode.Uri[],
		projectRoot: vscode.Uri,
		options: any,
		relevanceScores: Map<string, number>
	): Promise<string> {
		let context = `Ultra-Precision Project Context (${path.basename(
			projectRoot.fsPath
		)}):\n`;
		context += `Relevant files: ${relevantFiles.length}\n\n`;

		let currentLength = context.length;
		const maxLength = this.config.maxContextLength;

		// 1. Active symbol information (highest priority)
		if (options.activeSymbolInfo && currentLength < maxLength) {
			const symbolContext = this._buildActiveSymbolContext(
				options.activeSymbolInfo
			);
			if (currentLength + symbolContext.length <= maxLength) {
				context += symbolContext;
				currentLength += symbolContext.length;
			}
		}

		// 2. File contents with smart truncation
		const sortedFiles = this._sortFilesByRelevance(
			relevantFiles,
			relevanceScores
		);

		for (const file of sortedFiles) {
			if (currentLength >= maxLength) {
				break;
			}

			const fileContext = await this._buildFileContext(
				file,
				projectRoot,
				relevanceScores.get(file.fsPath) || 0,
				maxLength - currentLength
			);

			if (fileContext && currentLength + fileContext.length <= maxLength) {
				context += fileContext;
				currentLength += fileContext.length;
			}
		}

		// 3. Diagnostics (if space allows)
		if (options.diagnostics && currentLength < maxLength) {
			const diagnosticsContext = this._buildDiagnosticsContext(
				options.diagnostics
			);
			if (currentLength + diagnosticsContext.length <= maxLength) {
				context += diagnosticsContext;
			}
		}

		return context;
	}

	/**
	 * Build active symbol context
	 */
	private _buildActiveSymbolContext(
		activeSymbolInfo: ActiveSymbolDetailedInfo
	): string {
		let context = `\n=== ACTIVE SYMBOL ANALYSIS ===\n`;
		context += `Symbol: ${activeSymbolInfo.name || "Unknown"}\n`;
		context += `Type: ${activeSymbolInfo.kind || "Unknown"}\n`;
		context += `File: ${activeSymbolInfo.filePath || "Unknown"}\n`;

		if (activeSymbolInfo.detail) {
			context += `Detail: ${activeSymbolInfo.detail}\n`;
		}

		// Note: documentation property doesn't exist in ActiveSymbolDetailedInfo
		// Removed documentation section

		// Include call hierarchy information
		if (
			activeSymbolInfo.incomingCalls &&
			activeSymbolInfo.incomingCalls.length > 0
		) {
			context += `\nIncoming Calls (${activeSymbolInfo.incomingCalls.length}):\n`;
			activeSymbolInfo.incomingCalls.slice(0, 5).forEach((call, index) => {
				context += `${index + 1}. ${call.from.name} in ${path.basename(
					call.from.uri.fsPath
				)}\n`;
			});
		}

		if (
			activeSymbolInfo.outgoingCalls &&
			activeSymbolInfo.outgoingCalls.length > 0
		) {
			context += `\nOutgoing Calls (${activeSymbolInfo.outgoingCalls.length}):\n`;
			activeSymbolInfo.outgoingCalls.slice(0, 5).forEach((call, index) => {
				context += `${index + 1}. ${call.to.name} in ${path.basename(
					call.to.uri.fsPath
				)}\n`;
			});
		}

		return context;
	}

	/**
	 * Build file context with smart truncation
	 */
	private async _buildFileContext(
		file: vscode.Uri,
		projectRoot: vscode.Uri,
		relevanceScore: number,
		maxLength: number
	): Promise<string> {
		try {
			const relativePath = path.relative(projectRoot.fsPath, file.fsPath);
			const content = await vscode.workspace.fs.readFile(file);
			const text = Buffer.from(content).toString("utf-8");

			let context = `\n=== FILE: ${relativePath} (Relevance: ${(
				relevanceScore * 100
			).toFixed(1)}%) ===\n`;

			// Smart truncation based on relevance score
			const maxFileLength = Math.floor(
				this.config.maxFileLength * relevanceScore
			);
			const truncatedText = this._smartTruncateFileContent(text, maxFileLength);

			context += truncatedText;

			return context;
		} catch (error) {
			console.warn(`Failed to read file ${file.fsPath}:`, error);
			return `\n=== FILE: ${path.relative(
				projectRoot.fsPath,
				file.fsPath
			)} (Error reading file) ===\n`;
		}
	}

	/**
	 * Smart truncation of file content
	 */
	private _smartTruncateFileContent(
		content: string,
		maxLength: number
	): string {
		if (content.length <= maxLength) {
			return content;
		}

		// Try to keep important parts (imports, exports, function definitions)
		const lines = content.split("\n");
		const importantLines: string[] = [];
		const regularLines: string[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (
				trimmed.startsWith("import ") ||
				trimmed.startsWith("export ") ||
				trimmed.startsWith("function ") ||
				trimmed.startsWith("class ") ||
				trimmed.startsWith("interface ") ||
				trimmed.startsWith("type ") ||
				trimmed.startsWith("const ") ||
				trimmed.startsWith("let ") ||
				trimmed.startsWith("var ")
			) {
				importantLines.push(line);
			} else {
				regularLines.push(line);
			}
		}

		// Prioritize important lines
		let result = importantLines.join("\n");
		const remainingLength = maxLength - result.length;

		if (remainingLength > 0) {
			result +=
				"\n" +
				regularLines.slice(0, Math.floor(remainingLength / 50)).join("\n");
		}

		if (result.length > maxLength) {
			result = result.substring(0, maxLength - 3) + "...";
		}

		return result;
	}

	/**
	 * Build diagnostics context
	 */
	private _buildDiagnosticsContext(diagnostics: vscode.Diagnostic[]): string {
		if (diagnostics.length === 0) {
			return "";
		}

		let context = `\n=== DIAGNOSTICS (${diagnostics.length} issues) ===\n`;

		// Group by severity
		const errors = diagnostics.filter(
			(d) => d.severity === vscode.DiagnosticSeverity.Error
		);
		const warnings = diagnostics.filter(
			(d) => d.severity === vscode.DiagnosticSeverity.Warning
		);
		const infos = diagnostics.filter(
			(d) => d.severity === vscode.DiagnosticSeverity.Information
		);

		if (errors.length > 0) {
			context += `\nErrors (${errors.length}):\n`;
			errors.slice(0, 5).forEach((d, i) => {
				context += `${i + 1}. ${d.message}\n`;
			});
		}

		if (warnings.length > 0) {
			context += `\nWarnings (${warnings.length}):\n`;
			warnings.slice(0, 3).forEach((d, i) => {
				context += `${i + 1}. ${d.message}\n`;
			});
		}

		return context;
	}

	/**
	 * Sort files by relevance score
	 */
	private _sortFilesByRelevance(
		files: vscode.Uri[],
		scores: Map<string, number>
	): vscode.Uri[] {
		return files.sort((a, b) => {
			const scoreA = scores.get(a.fsPath) || 0;
			const scoreB = scores.get(b.fsPath) || 0;
			return scoreB - scoreA; // Descending order
		});
	}

	/**
	 * Calculate quality metrics
	 */
	private _calculateQualityMetrics(
		contextString: string,
		searchResult: any,
		userRequest: string,
		processingTime: number
	): ContextQualityMetrics {
		const relevanceScore = searchResult.accuracyMetrics.confidence;
		const completenessScore = Math.min(
			1.0,
			contextString.length / this.config.maxContextLength
		);
		const accuracyScore = searchResult.accuracyMetrics.precision;
		const confidenceScore =
			(relevanceScore + completenessScore + accuracyScore) / 3;

		return {
			relevanceScore,
			completenessScore,
			accuracyScore,
			confidenceScore,
			processingTime,
			contextSize: contextString.length,
			fileCount: searchResult.files.length,
		};
	}

	/**
	 * Validate context quality
	 */
	private _validateContextQuality(
		metrics: ContextQualityMetrics,
		userRequest: string
	): void {
		if (metrics.confidenceScore < 0.6) {
			console.warn(
				`[UltraPrecisionContext] Low confidence context (${(
					metrics.confidenceScore * 100
				).toFixed(1)}%) for request: ${userRequest.substring(0, 50)}...`
			);
		}

		if (metrics.contextSize < 1000) {
			console.warn(
				`[UltraPrecisionContext] Very small context (${
					metrics.contextSize
				} chars) for request: ${userRequest.substring(0, 50)}...`
			);
		}

		if (metrics.fileCount === 0) {
			console.warn(
				`[UltraPrecisionContext] No files selected for request: ${userRequest.substring(
					0,
					50
				)}...`
			);
		}
	}

	/**
	 * Generate cache key
	 */
	private _generateCacheKey(
		userRequest: string,
		allScannedFiles: ReadonlyArray<vscode.Uri>,
		options: any
	): string {
		const components = [
			userRequest.substring(0, 100),
			options.activeEditorContext?.filePath || "",
			allScannedFiles.length.toString(),
			options.activeSymbolInfo?.name || "",
			options.diagnostics?.length?.toString() || "0",
		];

		return components.join("|");
	}

	/**
	 * Generate a hash based on workspace state
	 */
	private _generateWorkspaceHash(
		allScannedFiles: ReadonlyArray<vscode.Uri>
	): string {
		const filePaths = allScannedFiles
			.map((uri) => uri.fsPath)
			.sort()
			.join("|");

		// Simple hash - could be enhanced with file modification times
		return Buffer.from(filePaths).toString("base64").substring(0, 16);
	}

	/**
	 * Check if cache is valid
	 */
	private _isCacheValid(
		cache: UltraPrecisionContextCache,
		allScannedFiles: ReadonlyArray<vscode.Uri>
	): boolean {
		const now = Date.now();
		const maxAge = 3 * 60 * 1000; // 3 minutes (shorter for ultra-precision)
		const currentHash = this._generateWorkspaceHash(allScannedFiles);
		return (
			cache.workspaceHash === currentHash && now - cache.timestamp < maxAge
		);
	}

	/**
	 * Cache context result
	 */
	private _cacheResult(
		key: string,
		result: UltraPrecisionContextResult,
		userRequest: string,
		options: any,
		allScannedFiles: ReadonlyArray<vscode.Uri>
	): void {
		// Limit cache size
		if (this.contextCache.size >= 50) {
			const oldestKey = this.contextCache.keys().next().value;
			if (oldestKey !== undefined) {
				this.contextCache.delete(oldestKey);
			}
		}

		const cacheEntry: UltraPrecisionContextCache = {
			timestamp: Date.now(),
			result,
			userRequest,
			workspaceHash: this._generateWorkspaceHash(allScannedFiles),
		};

		// Only set activeFile if it exists
		if (options.activeEditorContext?.filePath) {
			cacheEntry.activeFile = options.activeEditorContext.filePath;
		}

		this.contextCache.set(key, cacheEntry);
	}

	/**
	 * Update quality history
	 */
	private _updateQualityHistory(
		userRequest: string,
		metrics: ContextQualityMetrics
	): void {
		this.qualityHistory.push({
			request: userRequest.substring(0, 100),
			metrics,
			timestamp: Date.now(),
		});

		// Keep only recent history
		if (this.qualityHistory.length > 500) {
			this.qualityHistory = this.qualityHistory.slice(-250);
		}
	}

	/**
	 * Get context statistics
	 */
	public getContextStats(): {
		cacheSize: number;
		qualityHistory: Array<{
			metrics: ContextQualityMetrics;
			timestamp: number;
		}>;
		config: UltraPrecisionContextConfig;
		searchStats: any;
	} {
		return {
			cacheSize: this.contextCache.size,
			qualityHistory: this.qualityHistory.map((h) => ({
				metrics: h.metrics,
				timestamp: h.timestamp,
			})),
			config: this.config,
			searchStats: this.precisionSearch.getSearchStats(),
		};
	}

	/**
	 * Clear cache
	 */
	public clearCache(): void {
		this.contextCache.clear();
		this.precisionSearch.clearCache();
	}

	/**
	 * Update configuration
	 */
	public updateConfig(updates: Partial<UltraPrecisionContextConfig>): void {
		this.config = { ...this.config, ...updates };
	}
}

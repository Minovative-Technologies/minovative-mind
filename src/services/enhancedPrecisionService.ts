import * as vscode from "vscode";
import { PrecisionSearchSystem } from "../context/precisionSearchSystem";
import { UltraPrecisionContextBuilder } from "../context/ultraPrecisionContextBuilder";
import { ContextService } from "./contextService";
import { SettingsManager } from "../sidebar/managers/settingsManager";
import { ChatHistoryManager } from "../sidebar/managers/chatHistoryManager";
import { ProjectChangeLogger } from "../workflow/ProjectChangeLogger";
import { AIRequestService } from "./aiRequestService";
import { PlanGenerationContext } from "../sidebar/common/sidebarTypes";
import { scanWorkspace } from "../context/workspaceScanner";
import {
	buildDependencyGraph,
	buildReverseDependencyGraph,
} from "../context/dependencyGraphBuilder";
import { getHeuristicRelevantFiles } from "../context/heuristicContextSelector";
import { ActiveSymbolDetailedInfo } from "./contextService";

// Enhanced precision service configuration
interface EnhancedPrecisionConfig {
	// Enable ultra-precision features
	enableUltraPrecision: boolean;
	enablePrecisionSearch: boolean;
	enableSmartCaching: boolean;

	// Accuracy thresholds
	minRelevanceScore: number;
	maxContextFiles: number;
	cachePrecisionThreshold: number;

	// Performance settings
	maxSearchTime: number;
	maxProcessingTime: number;
	enableProgressiveLoading: boolean;

	// Quality assurance
	enableAccuracyValidation: boolean;
	enableFeedbackLoop: boolean;
	enableContinuousImprovement: boolean;
}

// Enhanced precision result
interface EnhancedPrecisionResult {
	contextString: string;
	relevantFiles: vscode.Uri[];
	precisionMetrics: {
		relevanceScore: number;
		accuracyScore: number;
		confidenceScore: number;
		processingTime: number;
		searchTime: number;
		contextSize: number;
		fileCount: number;
		cacheHit: boolean;
	};
	searchStats: any;
	contextStats: any;
}

export class EnhancedPrecisionService {
	private static readonly DEFAULT_CONFIG: EnhancedPrecisionConfig = {
		enableUltraPrecision: true,
		enablePrecisionSearch: true,
		enableSmartCaching: true,
		minRelevanceScore: 0.35,
		maxContextFiles: 40,
		cachePrecisionThreshold: 0.8,
		maxSearchTime: 12000, // 12 seconds
		maxProcessingTime: 18000, // 18 seconds
		enableProgressiveLoading: true,
		enableAccuracyValidation: true,
		enableFeedbackLoop: true,
		enableContinuousImprovement: true,
	};

	private config: EnhancedPrecisionConfig;
	private precisionSearch: PrecisionSearchSystem;
	private ultraPrecisionContext: UltraPrecisionContextBuilder;
	private postMessageToWebview: (message: any) => void;

	constructor(
		settingsManager: SettingsManager,
		chatHistoryManager: ChatHistoryManager,
		changeLogger: ProjectChangeLogger,
		aiRequestService: AIRequestService,
		postMessageToWebview: (message: any) => void,
		config?: Partial<EnhancedPrecisionConfig>
	) {
		this.config = { ...EnhancedPrecisionService.DEFAULT_CONFIG, ...config };
		this.postMessageToWebview = postMessageToWebview;

		// Initialize precision search system
		this.precisionSearch = new PrecisionSearchSystem({
			minRelevanceScore: this.config.minRelevanceScore,
			maxContextFiles: this.config.maxContextFiles,
			enableSemanticSearch: true,
			enableDependencyAnalysis: true,
			enableSymbolAnalysis: true,
			enableSmartCaching: this.config.enableSmartCaching,
			cachePrecisionThreshold: this.config.cachePrecisionThreshold,
			maxSearchTime: this.config.maxSearchTime,
			enableDynamicSizing: true,
			enableProgressiveLoading: this.config.enableProgressiveLoading,
			enableRelevanceRanking: true,
			enableAccuracyValidation: this.config.enableAccuracyValidation,
			enableFeedbackLoop: this.config.enableFeedbackLoop,
		});

		// Initialize ultra-precision context builder
		this.ultraPrecisionContext = new UltraPrecisionContextBuilder({
			maxContextLength: 75000, // Optimized for performance
			maxFileLength: 10000, // Optimized for performance
			maxSymbolChars: 5000, // Optimized for performance
			enableProgressiveLoading: this.config.enableProgressiveLoading,
			enableSmartTruncation: true,
			enableAccuracyValidation: this.config.enableAccuracyValidation,
			enableRelevanceScoring: true,
			enableContextOptimization: true,
			enableIntelligentCaching: this.config.enableSmartCaching,
			cachePrecisionThreshold: this.config.cachePrecisionThreshold,
			maxProcessingTime: this.config.maxProcessingTime,
			enableContextValidation: true,
			enableFeedbackIntegration: this.config.enableFeedbackLoop,
			enableContinuousImprovement: this.config.enableContinuousImprovement,
		});
	}

	/**
	 * Build enhanced precision context
	 */
	public async buildEnhancedPrecisionContext(
		userRequest: string,
		options: {
			activeEditorContext?: PlanGenerationContext["editorContext"];
			diagnostics?: vscode.Diagnostic[];
			chatHistory?: any[];
			cancellationToken?: vscode.CancellationToken;
		} = {}
	): Promise<EnhancedPrecisionResult> {
		const startTime = Date.now();

		this.postMessageToWebview({
			type: "statusUpdate",
			value: "Minovative Mind is performing ultra-precision search...",
		});

		try {
			// Get workspace root
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return this._createErrorResult("No workspace folder open");
			}
			const rootFolder = workspaceFolders[0];

			// Scan workspace with optimized settings
			const scanStartTime = Date.now();
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Scanning workspace for relevant files...",
			});

			const allScannedFiles = await scanWorkspace({
				useCache: true,
				maxConcurrentReads: 20, // Increased for better performance
				maxFileSize: 1024 * 1024, // 1MB
				cacheTimeout: 5 * 60 * 1000, // 5 minutes
			});

			const scanTime = Date.now() - scanStartTime;
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Found ${allScannedFiles.length} files in ${scanTime}ms.`,
			});

			if (allScannedFiles.length === 0) {
				return this._createErrorResult("No relevant files found in workspace");
			}

			// Build dependency graph
			const dependencyStartTime = Date.now();
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Analyzing file dependencies...",
			});

			const fileDependencies = await buildDependencyGraph(
				allScannedFiles,
				rootFolder.uri,
				{
					useCache: true,
					maxConcurrency: 20,
					skipLargeFiles: true,
					maxFileSizeForParsing: 500 * 1024, // 500KB
					retryFailedFiles: true,
					maxRetries: 2,
				}
			);

			const reverseFileDependencies = buildReverseDependencyGraph(
				fileDependencies,
				rootFolder.uri
			);
			const dependencyTime = Date.now() - dependencyStartTime;

			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Analyzed ${fileDependencies.size} dependencies in ${dependencyTime}ms.`,
			});

			// Get active symbol information if available
			let activeSymbolInfo: ActiveSymbolDetailedInfo | undefined;
			if (options.activeEditorContext?.documentUri) {
				try {
					activeSymbolInfo = await this._getActiveSymbolInfo(
						options.activeEditorContext.documentUri
					);
				} catch (error) {
					console.warn("Failed to get active symbol info:", error);
				}
			}

			// Perform precision search
			const searchStartTime = Date.now();
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Performing precision search for relevant files...",
			});

			const searchResult = await this.precisionSearch.searchRelevantFiles(
				userRequest,
				allScannedFiles,
				rootFolder.uri,
				{
					activeEditorContext: options.activeEditorContext,
					fileDependencies,
					reverseFileDependencies,
					activeSymbolInfo,
					diagnostics: options.diagnostics,
					chatHistory: options.chatHistory,
				}
			);

			const searchTime = Date.now() - searchStartTime;
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Found ${searchResult.files.length} relevant files in ${searchTime}ms.`,
			});

			// Build ultra-precision context
			const contextStartTime = Date.now();
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Building ultra-precision context...",
			});

			const contextResult =
				await this.ultraPrecisionContext.buildUltraPrecisionContext(
					userRequest,
					allScannedFiles,
					rootFolder.uri,
					{
						activeEditorContext: options.activeEditorContext,
						fileDependencies,
						reverseFileDependencies,
						activeSymbolInfo,
						diagnostics: options.diagnostics,
						chatHistory: options.chatHistory,
					}
				);

			const contextTime = Date.now() - contextStartTime;
			const totalTime = Date.now() - startTime;

			// Calculate precision metrics
			const precisionMetrics = this._calculatePrecisionMetrics(
				searchResult,
				contextResult,
				totalTime,
				searchTime,
				contextTime
			);

			// Validate accuracy if enabled
			if (this.config.enableAccuracyValidation) {
				this._validateAccuracy(precisionMetrics, userRequest);
			}

			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Ultra-precision context built in ${totalTime}ms with ${(
					precisionMetrics.confidenceScore * 100
				).toFixed(1)}% confidence.`,
			});

			return {
				contextString: contextResult.contextString,
				relevantFiles: contextResult.relevantFiles,
				precisionMetrics,
				searchStats: this.precisionSearch.getSearchStats(),
				contextStats: this.ultraPrecisionContext.getContextStats(),
			};
		} catch (error) {
			console.error(
				"[EnhancedPrecisionService] Error building context:",
				error
			);
			return this._createErrorResult(
				`Error: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Get active symbol information
	 */
	private async _getActiveSymbolInfo(
		documentUri: vscode.Uri
	): Promise<ActiveSymbolDetailedInfo | undefined> {
		try {
			const document = await vscode.workspace.openTextDocument(documentUri);
			const position = new vscode.Position(0, 0); // Default position

			// Get symbol at position
			const symbols = await vscode.commands.executeCommand<
				vscode.DocumentSymbol[]
			>("vscode.executeDocumentSymbolProvider", documentUri);

			if (!symbols || symbols.length === 0) {
				return undefined;
			}

			// Find the most relevant symbol (simplified)
			const symbol = symbols[0];

			return {
				name: symbol.name,
				kind: symbol.kind.toString(),
				detail: symbol.detail,
				filePath: documentUri.fsPath,
				fullRange: symbol.range,
				childrenHierarchy: JSON.stringify(symbol.children),
				// Other properties will be undefined as they require more complex analysis
			};
		} catch (error) {
			console.warn("Failed to get active symbol info:", error);
			return undefined;
		}
	}

	/**
	 * Calculate precision metrics
	 */
	private _calculatePrecisionMetrics(
		searchResult: any,
		contextResult: any,
		totalTime: number,
		searchTime: number,
		contextTime: number
	): EnhancedPrecisionResult["precisionMetrics"] {
		const relevanceScore = searchResult.accuracyMetrics?.confidence || 0;
		const accuracyScore = searchResult.accuracyMetrics?.precision || 0;
		const confidenceScore = contextResult.qualityMetrics?.confidenceScore || 0;

		return {
			relevanceScore,
			accuracyScore,
			confidenceScore,
			processingTime: totalTime,
			searchTime,
			contextSize: contextResult.qualityMetrics?.contextSize || 0,
			fileCount: searchResult.files?.length || 0,
			cacheHit: searchResult.cacheHit || false,
		};
	}

	/**
	 * Validate accuracy
	 */
	private _validateAccuracy(
		metrics: EnhancedPrecisionResult["precisionMetrics"],
		userRequest: string
	): void {
		if (metrics.confidenceScore < 0.6) {
			console.warn(
				`[EnhancedPrecisionService] Low confidence (${(
					metrics.confidenceScore * 100
				).toFixed(1)}%) for request: ${userRequest.substring(0, 50)}...`
			);
		}

		if (metrics.fileCount === 0) {
			console.warn(
				`[EnhancedPrecisionService] No files selected for request: ${userRequest.substring(
					0,
					50
				)}...`
			);
		}

		if (metrics.processingTime > this.config.maxProcessingTime) {
			console.warn(
				`[EnhancedPrecisionService] Slow processing (${
					metrics.processingTime
				}ms) for request: ${userRequest.substring(0, 50)}...`
			);
		}
	}

	/**
	 * Create error result
	 */
	private _createErrorResult(message: string): EnhancedPrecisionResult {
		return {
			contextString: `[Error: ${message}]`,
			relevantFiles: [],
			precisionMetrics: {
				relevanceScore: 0,
				accuracyScore: 0,
				confidenceScore: 0,
				processingTime: 0,
				searchTime: 0,
				contextSize: 0,
				fileCount: 0,
				cacheHit: false,
			},
			searchStats: {},
			contextStats: {},
		};
	}

	/**
	 * Get service statistics
	 */
	public getServiceStats(): {
		config: EnhancedPrecisionConfig;
		searchStats: any;
		contextStats: any;
	} {
		return {
			config: this.config,
			searchStats: this.precisionSearch.getSearchStats(),
			contextStats: this.ultraPrecisionContext.getContextStats(),
		};
	}

	/**
	 * Clear all caches
	 */
	public clearCaches(): void {
		this.precisionSearch.clearCache();
		this.ultraPrecisionContext.clearCache();
	}

	/**
	 * Update configuration
	 */
	public updateConfig(updates: Partial<EnhancedPrecisionConfig>): void {
		this.config = { ...this.config, ...updates };

		// Update precision search config
		this.precisionSearch.updateConfig({
			minRelevanceScore: this.config.minRelevanceScore,
			maxContextFiles: this.config.maxContextFiles,
			enableSmartCaching: this.config.enableSmartCaching,
			cachePrecisionThreshold: this.config.cachePrecisionThreshold,
			maxSearchTime: this.config.maxSearchTime,
			enableProgressiveLoading: this.config.enableProgressiveLoading,
			enableAccuracyValidation: this.config.enableAccuracyValidation,
			enableFeedbackLoop: this.config.enableFeedbackLoop,
		});

		// Update context builder config
		this.ultraPrecisionContext.updateConfig({
			enableIntelligentCaching: this.config.enableSmartCaching,
			cachePrecisionThreshold: this.config.cachePrecisionThreshold,
			maxProcessingTime: this.config.maxProcessingTime,
			enableProgressiveLoading: this.config.enableProgressiveLoading,
			enableAccuracyValidation: this.config.enableAccuracyValidation,
			enableFeedbackIntegration: this.config.enableFeedbackLoop,
			enableContinuousImprovement: this.config.enableContinuousImprovement,
		});
	}
}

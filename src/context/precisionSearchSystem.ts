import * as vscode from "vscode";
import * as path from "path";
import { PlanGenerationContext } from "../sidebar/common/sidebarTypes";
import { ActiveSymbolDetailedInfo } from "../services/contextService";

// Precision search configuration
interface PrecisionSearchConfig {
	// Accuracy settings
	minRelevanceScore: number; // Minimum score for inclusion (0.0-1.0)
	maxContextFiles: number; // Maximum files to include in context
	enableSemanticSearch: boolean; // Use semantic understanding
	enableDependencyAnalysis: boolean; // Analyze file dependencies
	enableSymbolAnalysis: boolean; // Analyze symbols and references

	// Performance settings
	enableSmartCaching: boolean; // Intelligent cache management
	cachePrecisionThreshold: number; // Cache only high-precision results
	maxSearchTime: number; // Maximum search time in milliseconds

	// Context optimization
	enableDynamicSizing: boolean; // Adjust context size based on request
	enableProgressiveLoading: boolean; // Load context progressively
	enableRelevanceRanking: boolean; // Rank files by relevance

	// Quality assurance
	enableAccuracyValidation: boolean; // Validate search accuracy
	enableFeedbackLoop: boolean; // Learn from user feedback
}

// File relevance information
interface FileRelevanceInfo {
	uri: vscode.Uri;
	score: number; // 0.0-1.0 relevance score
	reasons: string[]; // Why this file is relevant
	dependencies: string[]; // Direct dependencies
	reverseDependencies: string[]; // Files that depend on this
	symbols: string[]; // Relevant symbols in the file
	lastModified: number; // Last modification timestamp
	size: number; // File size in bytes
}

// Search result with accuracy metrics
interface PrecisionSearchResult {
	files: vscode.Uri[];
	relevanceScores: Map<string, number>;
	accuracyMetrics: {
		precision: number; // How many selected files are actually relevant
		recall: number; // How many relevant files were selected
		f1Score: number; // Harmonic mean of precision and recall
		confidence: number; // Overall confidence in the result
	};
	searchTime: number; // Time taken for search in milliseconds
	cacheHit: boolean; // Whether result came from cache
	contextSize: number; // Total context size in characters
}

// Cache entry for precision search
interface PrecisionSearchCache {
	timestamp: number;
	result: PrecisionSearchResult;
	userRequest: string;
	activeFile?: string;
	workspaceHash: string;
}

export class PrecisionSearchSystem {
	private static readonly DEFAULT_CONFIG: PrecisionSearchConfig = {
		minRelevanceScore: 0.3,
		maxContextFiles: 50,
		enableSemanticSearch: true,
		enableDependencyAnalysis: true,
		enableSymbolAnalysis: true,
		enableSmartCaching: true,
		cachePrecisionThreshold: 0.8,
		maxSearchTime: 10000, // 10 seconds
		enableDynamicSizing: true,
		enableProgressiveLoading: true,
		enableRelevanceRanking: true,
		enableAccuracyValidation: true,
		enableFeedbackLoop: true,
	};

	private config: PrecisionSearchConfig;
	private searchCache = new Map<string, PrecisionSearchCache>();
	private accuracyHistory: Array<{
		request: string;
		precision: number;
		recall: number;
		timestamp: number;
	}> = [];

	constructor(config?: Partial<PrecisionSearchConfig>) {
		this.config = { ...PrecisionSearchSystem.DEFAULT_CONFIG, ...config };
	}

	/**
	 * Perform precision search for relevant files
	 */
	public async searchRelevantFiles(
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
	): Promise<PrecisionSearchResult> {
		const startTime = Date.now();
		const workspaceHash = await this._calculateWorkspaceHash(allScannedFiles);
		const cacheKey = this._generateCacheKey(
			userRequest,
			workspaceHash,
			options
		);

		// Check cache first
		if (this.config.enableSmartCaching) {
			const cached = this.searchCache.get(cacheKey);
			if (cached && this._isCacheValid(cached, workspaceHash)) {
				console.log(
					`[PrecisionSearch] Cache hit for request: ${userRequest.substring(
						0,
						50
					)}...`
				);
				return {
					...cached.result,
					searchTime: Date.now() - startTime,
					cacheHit: true,
				};
			}
		}

		// Perform precision search
		const result = await this._performPrecisionSearch(
			userRequest,
			allScannedFiles,
			projectRoot,
			options,
			startTime
		);

		// Cache high-precision results
		if (
			this.config.enableSmartCaching &&
			result.accuracyMetrics.confidence >= this.config.cachePrecisionThreshold
		) {
			this._cacheResult(cacheKey, result, userRequest, workspaceHash, options);
		}

		// Update accuracy history for learning
		if (this.config.enableFeedbackLoop) {
			this._updateAccuracyHistory(userRequest, result.accuracyMetrics);
		}

		return result;
	}

	/**
	 * Perform the actual precision search
	 */
	private async _performPrecisionSearch(
		userRequest: string,
		allScannedFiles: ReadonlyArray<vscode.Uri>,
		projectRoot: vscode.Uri,
		options: any,
		startTime: number
	): Promise<PrecisionSearchResult> {
		// Step 1: Initial relevance scoring
		const relevanceScores = await this._calculateRelevanceScores(
			userRequest,
			allScannedFiles,
			projectRoot,
			options
		);

		// Step 2: Filter by minimum relevance score
		const relevantFiles = allScannedFiles.filter((file) => {
			const score = relevanceScores.get(file.fsPath) || 0;
			return score >= this.config.minRelevanceScore;
		});

		// Step 3: Rank files by relevance
		const rankedFiles = this._rankFilesByRelevance(
			relevantFiles,
			relevanceScores
		);

		// Step 4: Apply dynamic sizing
		const selectedFiles = this._applyDynamicSizing(rankedFiles, userRequest);

		// Step 5: Calculate accuracy metrics
		const accuracyMetrics = this._calculateAccuracyMetrics(
			selectedFiles,
			relevanceScores,
			userRequest
		);

		// Step 6: Calculate context size
		const contextSize = await this._calculateContextSize(
			selectedFiles,
			projectRoot
		);

		return {
			files: selectedFiles,
			relevanceScores,
			accuracyMetrics,
			searchTime: Date.now() - startTime,
			cacheHit: false,
			contextSize,
		};
	}

	/**
	 * Calculate relevance scores for all files
	 */
	private async _calculateRelevanceScores(
		userRequest: string,
		allScannedFiles: ReadonlyArray<vscode.Uri>,
		projectRoot: vscode.Uri,
		options: any
	): Promise<Map<string, number>> {
		const scores = new Map<string, number>();
		const requestKeywords = this._extractKeywords(userRequest);

		for (const file of allScannedFiles) {
			const relativePath = path.relative(projectRoot.fsPath, file.fsPath);
			let score = 0;

			// 1. Path-based scoring
			score += this._calculatePathScore(relativePath, requestKeywords);

			// 2. Active file proximity scoring
			if (options.activeEditorContext?.filePath) {
				score += this._calculateProximityScore(
					relativePath,
					options.activeEditorContext.filePath
				);
			}

			// 3. Dependency-based scoring
			if (this.config.enableDependencyAnalysis && options.fileDependencies) {
				score += this._calculateDependencyScore(
					relativePath,
					options.fileDependencies,
					options.activeEditorContext?.filePath
				);
			}

			// 4. Symbol-based scoring
			if (this.config.enableSymbolAnalysis && options.activeSymbolInfo) {
				score += this._calculateSymbolScore(
					relativePath,
					options.activeSymbolInfo,
					projectRoot
				);
			}

			// 5. Semantic scoring
			if (this.config.enableSemanticSearch) {
				score += await this._calculateSemanticScore(
					file,
					userRequest,
					requestKeywords
				);
			}

			// Normalize score to 0.0-1.0 range
			scores.set(file.fsPath, Math.min(1.0, Math.max(0.0, score)));
		}

		return scores;
	}

	/**
	 * Extract keywords from user request
	 */
	private _extractKeywords(userRequest: string): string[] {
		// Remove common words and extract meaningful keywords
		const commonWords = new Set([
			"the",
			"a",
			"an",
			"and",
			"or",
			"but",
			"in",
			"on",
			"at",
			"to",
			"for",
			"of",
			"with",
			"by",
			"is",
			"are",
			"was",
			"were",
			"be",
			"been",
			"have",
			"has",
			"had",
			"do",
			"does",
			"did",
			"will",
			"would",
			"could",
			"should",
			"can",
			"may",
			"might",
			"must",
			"shall",
		]);

		return userRequest
			.toLowerCase()
			.split(/\s+/)
			.filter((word) => word.length > 2 && !commonWords.has(word))
			.map((word) => word.replace(/[^\w]/g, ""));
	}

	/**
	 * Calculate score based on file path
	 */
	private _calculatePathScore(filePath: string, keywords: string[]): number {
		let score = 0;
		const pathParts = filePath.toLowerCase().split(/[\/\\]/);

		for (const keyword of keywords) {
			for (const part of pathParts) {
				if (part.includes(keyword)) {
					score += 0.3; // High score for path matches
				}
			}
		}

		// Bonus for exact filename matches
		const fileName = path.basename(filePath).toLowerCase();
		for (const keyword of keywords) {
			if (fileName.includes(keyword)) {
				score += 0.5; // Very high score for filename matches
			}
		}

		return score;
	}

	/**
	 * Calculate score based on proximity to active file
	 */
	private _calculateProximityScore(
		filePath: string,
		activeFilePath: string
	): number {
		const activeDir = path.dirname(activeFilePath);
		const fileDir = path.dirname(filePath);

		// Same directory gets high score
		if (fileDir === activeDir) {
			return 0.4;
		}

		// Parent/child directory relationship
		if (
			fileDir.startsWith(activeDir + "/") ||
			activeDir.startsWith(fileDir + "/")
		) {
			return 0.3;
		}

		// Same top-level directory
		const activeTopLevel = activeDir.split("/")[0];
		const fileTopLevel = fileDir.split("/")[0];
		if (activeTopLevel === fileTopLevel) {
			return 0.2;
		}

		return 0;
	}

	/**
	 * Calculate score based on dependencies
	 */ private _calculateDependencyScore(
		filePath: string,
		dependencies: Map<string, string[]>,
		activeFilePath?: string
	): number {
		let score = 0;

		// Direct dependencies of active file
		if (activeFilePath) {
			const activeDeps = dependencies.get(activeFilePath);
			if (activeDeps?.includes(filePath)) {
				score += 0.4;
			}
		}

		// Files that import this file
		const reverseDeps = Array.from(dependencies.entries())
			.filter(([_, deps]) => deps.includes(filePath))
			.map(([file, _]) => file);

		if (reverseDeps.length > 0) {
			score += Math.min(0.3, reverseDeps.length * 0.1);
		}

		return score;
	}

	/**
	 * Calculate score based on symbol information
	 */ private _calculateSymbolScore(
		filePath: string,
		activeSymbolInfo: ActiveSymbolDetailedInfo,
		projectRoot: vscode.Uri
	): number {
		let score = 0;

		// Same file as active symbol
		if (activeSymbolInfo.filePath === filePath) {
			score += 0.5;
		}

		// Files with incoming/outgoing calls
		if (activeSymbolInfo.incomingCalls) {
			const hasIncomingCall = activeSymbolInfo.incomingCalls.some((call) => {
				const callPath = path.relative(
					projectRoot.fsPath,
					call.from.uri.fsPath
				);
				return callPath === filePath;
			});
			if (hasIncomingCall) {
				score += 0.3;
			}
		}

		if (activeSymbolInfo.outgoingCalls) {
			const hasOutgoingCall = activeSymbolInfo.outgoingCalls.some((call) => {
				const callPath = path.relative(projectRoot.fsPath, call.to.uri.fsPath);
				return callPath === filePath;
			});
			if (hasOutgoingCall) {
				score += 0.3;
			}
		}

		return score;
	}

	/**
	 * Calculate semantic score based on file content
	 */ private async _calculateSemanticScore(
		file: vscode.Uri,
		userRequest: string,
		keywords: string[]
	): Promise<number> {
		try {
			// Read file content (limited to first 10KB for performance)
			const content = await vscode.workspace.fs.readFile(file);
			const text = Buffer.from(content).toString("utf-8").substring(0, 10000);
			const lowerText = text.toLowerCase();

			let score = 0;

			// Keyword frequency scoring
			for (const keyword of keywords) {
				const matches = (lowerText.match(new RegExp(keyword, "g")) || [])
					.length;
				score += Math.min(0.2, matches * 0.05);
			}

			// Import/export analysis
			const importMatches =
				lowerText.match(/import.*from\s+['"]([^'"]+)['"]/g) || [];
			const exportMatches =
				lowerText.match(
					/export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type)/g
				) || [];

			score += Math.min(0.1, importMatches.length * 0.02);
			score += Math.min(0.1, exportMatches.length * 0.02);

			return score;
		} catch (error) {
			console.warn(
				`Failed to read file ${file.fsPath} for semantic analysis:`,
				error
			);
			return 0;
		}
	}

	/**
	 * Rank files by relevance score
	 */ private _rankFilesByRelevance(
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
	 * Apply dynamic sizing based on request complexity
	 */ private _applyDynamicSizing(
		files: vscode.Uri[],
		userRequest: string
	): vscode.Uri[] {
		if (!this.config.enableDynamicSizing) {
			return files.slice(0, this.config.maxContextFiles);
		}

		// Analyze request complexity
		const complexity = this._analyzeRequestComplexity(userRequest);
		const maxFiles = Math.min(
			this.config.maxContextFiles,
			Math.max(5, Math.floor(complexity * 20))
		);

		return files.slice(0, maxFiles);
	}

	/**
	 * Analyze request complexity
	 */ private _analyzeRequestComplexity(userRequest: string): number {
		let complexity = 0.5; // Base complexity

		// More keywords = higher complexity
		const keywords = this._extractKeywords(userRequest);
		complexity += Math.min(0.3, keywords.length * 0.05);

		// Longer requests = higher complexity
		complexity += Math.min(0.2, userRequest.length / 1000);

		// Specific patterns indicate complexity
		if (userRequest.includes("refactor") || userRequest.includes("optimize")) {
			complexity += 0.2;
		}
		if (userRequest.includes("bug") || userRequest.includes("fix")) {
			complexity += 0.1;
		}
		if (userRequest.includes("test") || userRequest.includes("spec")) {
			complexity += 0.1;
		}

		return Math.min(1.0, complexity);
	}

	/**
	 * Calculate accuracy metrics
	 */ private _calculateAccuracyMetrics(
		selectedFiles: vscode.Uri[],
		scores: Map<string, number>,
		userRequest: string
	): PrecisionSearchResult["accuracyMetrics"] {
		if (selectedFiles.length === 0) {
			return {
				precision: 0,
				recall: 0,
				f1Score: 0,
				confidence: 0,
			};
		}

		// Calculate average relevance score
		const avgScore =
			selectedFiles.reduce((sum, file) => {
				return sum + (scores.get(file.fsPath) || 0);
			}, 0) / selectedFiles.length;

		// Estimate precision based on score distribution
		const highScoreFiles = selectedFiles.filter((file) => {
			return (scores.get(file.fsPath) || 0) > 0.7;
		}).length;

		const precision =
			selectedFiles.length > 0 ? highScoreFiles / selectedFiles.length : 0;
		const recall = 1.0; // We can't know true recall without user feedback
		const f1Score =
			precision > 0 ? (2 * precision * recall) / (precision + recall) : 0;
		const confidence = avgScore * precision;

		return {
			precision,
			recall,
			f1Score,
			confidence,
		};
	}

	/**
	 * Calculate context size
	 */ private async _calculateContextSize(
		files: vscode.Uri[],
		projectRoot: vscode.Uri
	): Promise<number> {
		let totalSize = 0;

		for (const file of files) {
			try {
				const stats = await vscode.workspace.fs.stat(file);
				totalSize += stats.size;
			} catch (error) {
				console.warn(`Failed to get file size for ${file.fsPath}:`, error);
			}
		}

		return totalSize;
	}

	/**
	 * Calculate a hash for the current workspace state
	 */ private async _calculateWorkspaceHash(
		files: ReadonlyArray<vscode.Uri>
	): Promise<string> {
		const fileStats = await Promise.all(
			files.map(async (file) => {
				try {
					const stat = await vscode.workspace.fs.stat(file);
					return `${file.fsPath}:${stat.mtime}`;
				} catch {
					return "";
				}
			})
		);

		const allStats = fileStats.filter(Boolean).sort().join("|");
		// Simple hash function (not crypto-secure, but good enough for cache key)
		let hash = 0;
		for (let i = 0; i < allStats.length; i++) {
			const char = allStats.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash |= 0; // Convert to 32bit integer
		}
		return hash.toString(16);
	}

	/**
	 * Generate cache key
	 */ private _generateCacheKey(
		userRequest: string,
		workspaceHash: string,
		options: any
	): string {
		const components = [
			userRequest.substring(0, 100),
			workspaceHash,
			options.activeEditorContext?.filePath || "",
			options.activeSymbolInfo?.symbolName || "",
		];

		return components.join("|");
	}

	/**
	 * Check if cache is valid
	 */ private _isCacheValid(
		cache: PrecisionSearchCache,
		currentWorkspaceHash: string
	): boolean {
		const now = Date.now();
		const maxAge = 5 * 60 * 1000; // 5 minutes
		if (now - cache.timestamp >= maxAge) {
			return false;
		}
		return cache.workspaceHash === currentWorkspaceHash;
	}

	/**
	 * Cache search result
	 */ private _cacheResult(
		key: string,
		result: PrecisionSearchResult,
		userRequest: string,
		workspaceHash: string,
		options: any
	): void {
		// Limit cache size
		if (this.searchCache.size >= 100) {
			const oldestKey = this.searchCache.keys().next().value;
			if (oldestKey) {
				this.searchCache.delete(oldestKey);
			}
		}

		this.searchCache.set(key, {
			timestamp: Date.now(),
			result,
			userRequest,
			activeFile: options.activeEditorContext?.filePath,
			workspaceHash: workspaceHash,
		});
	}

	/**
	 * Update accuracy history for learning
	 */ private _updateAccuracyHistory(
		userRequest: string,
		metrics: PrecisionSearchResult["accuracyMetrics"]
	): void {
		this.accuracyHistory.push({
			request: userRequest.substring(0, 100),
			precision: metrics.precision,
			recall: metrics.recall,
			timestamp: Date.now(),
		});

		// Keep only recent history
		if (this.accuracyHistory.length > 1000) {
			this.accuracyHistory = this.accuracyHistory.slice(-500);
		}
	}

	/**
	 * Get search statistics
	 */ public getSearchStats(): {
		cacheSize: number;
		accuracyHistory: Array<{
			precision: number;
			recall: number;
			timestamp: number;
		}>;
		config: PrecisionSearchConfig;
	} {
		return {
			cacheSize: this.searchCache.size,
			accuracyHistory: this.accuracyHistory,
			config: this.config,
		};
	}

	/**
	 * Clear cache
	 */ public clearCache(): void {
		this.searchCache.clear();
	}

	/**
	 * Update configuration
	 */ public updateConfig(updates: Partial<PrecisionSearchConfig>): void {
		this.config = { ...this.config, ...updates };
	}
}

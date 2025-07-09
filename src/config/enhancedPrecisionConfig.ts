/**
 * Configuration for enhanced precision search system
 */
export interface EnhancedPrecisionConfig {
	// Core precision settings
	enableUltraPrecision: boolean;
	enablePrecisionSearch: boolean;
	enableSmartCaching: boolean;

	// Accuracy thresholds
	minRelevanceScore: number; // 0.0-1.0 minimum relevance for inclusion
	maxContextFiles: number; // Maximum files to include in context
	cachePrecisionThreshold: number; // 0.0-1.0 minimum confidence for caching

	// Performance settings
	maxSearchTime: number; // Maximum search time in milliseconds
	maxProcessingTime: number; // Maximum total processing time
	enableProgressiveLoading: boolean; // Load context progressively

	// Quality assurance
	enableAccuracyValidation: boolean; // Validate search accuracy
	enableFeedbackLoop: boolean; // Learn from user feedback
	enableContinuousImprovement: boolean; // Continuously improve

	// Search optimization
	enableSemanticSearch: boolean; // Use semantic understanding
	enableDependencyAnalysis: boolean; // Analyze file dependencies
	enableSymbolAnalysis: boolean; // Analyze symbols and references
	enableDynamicSizing: boolean; // Adjust context size based on request
	enableRelevanceRanking: boolean; // Rank files by relevance

	// Context optimization
	maxContextLength: number; // Maximum context length in characters
	maxFileLength: number; // Maximum file content length
	maxSymbolChars: number; // Maximum symbol information length
	enableSmartTruncation: boolean; // Smart truncation of content
	enableContextOptimization: boolean; // Optimize context for AI

	// Caching settings
	enableIntelligentCaching: boolean; // Smart caching system
	cacheMaxSize: number; // Maximum cache entries
	cacheTTL: number; // Cache time-to-live in milliseconds
	cacheStalenessThreshold: number; // Staleness threshold in milliseconds

	// Validation settings
	enableContextValidation: boolean; // Validate context quality
	enableFeedbackIntegration: boolean; // Integrate user feedback
	enableQualityMonitoring: boolean; // Monitor quality metrics
}

/**
 * Default configuration for enhanced precision
 */
export const DEFAULT_ENHANCED_PRECISION_CONFIG: EnhancedPrecisionConfig = {
	// Core precision settings
	enableUltraPrecision: true,
	enablePrecisionSearch: true,
	enableSmartCaching: true,

	// Accuracy thresholds
	minRelevanceScore: 0.35, // Higher threshold for better accuracy
	maxContextFiles: 40, // Optimized for performance and accuracy
	cachePrecisionThreshold: 0.8, // Only cache high-confidence results

	// Performance settings
	maxSearchTime: 12000, // 12 seconds
	maxProcessingTime: 18000, // 18 seconds
	enableProgressiveLoading: true,

	// Quality assurance
	enableAccuracyValidation: true,
	enableFeedbackLoop: true,
	enableContinuousImprovement: true,

	// Search optimization
	enableSemanticSearch: true,
	enableDependencyAnalysis: true,
	enableSymbolAnalysis: true,
	enableDynamicSizing: true,
	enableRelevanceRanking: true,

	// Context optimization
	maxContextLength: 75000, // Optimized for performance
	maxFileLength: 10000, // Optimized for performance
	maxSymbolChars: 5000, // Optimized for performance
	enableSmartTruncation: true,
	enableContextOptimization: true,

	// Caching settings
	enableIntelligentCaching: true,
	cacheMaxSize: 100, // Increased for better performance
	cacheTTL: 5 * 60 * 1000, // 5 minutes
	cacheStalenessThreshold: 2 * 60 * 1000, // 2 minutes

	// Validation settings
	enableContextValidation: true,
	enableFeedbackIntegration: true,
	enableQualityMonitoring: true,
};

/**
 * High-precision configuration for maximum accuracy
 */
export const HIGH_PRECISION_CONFIG: EnhancedPrecisionConfig = {
	...DEFAULT_ENHANCED_PRECISION_CONFIG,
	minRelevanceScore: 0.5, // Higher threshold
	maxContextFiles: 25, // Fewer files for higher precision
	cachePrecisionThreshold: 0.9, // Very high threshold
	maxSearchTime: 15000, // More time for accuracy
	maxProcessingTime: 25000, // More time for accuracy
	maxContextLength: 60000, // Smaller context for precision
	maxFileLength: 8000, // Smaller files for precision
};

/**
 * Performance-optimized configuration
 */
export const PERFORMANCE_CONFIG: EnhancedPrecisionConfig = {
	...DEFAULT_ENHANCED_PRECISION_CONFIG,
	minRelevanceScore: 0.25, // Lower threshold for more files
	maxContextFiles: 60, // More files for broader context
	cachePrecisionThreshold: 0.7, // Lower threshold for more caching
	maxSearchTime: 8000, // Faster search
	maxProcessingTime: 12000, // Faster processing
	maxContextLength: 100000, // Larger context
	maxFileLength: 15000, // Larger files
};

/**
 * Balanced configuration for general use
 */
export const BALANCED_CONFIG: EnhancedPrecisionConfig = {
	...DEFAULT_ENHANCED_PRECISION_CONFIG,
	minRelevanceScore: 0.3, // Balanced threshold
	maxContextFiles: 50, // Balanced file count
	cachePrecisionThreshold: 0.75, // Balanced caching
	maxSearchTime: 10000, // Balanced time
	maxProcessingTime: 15000, // Balanced processing time
	maxContextLength: 80000, // Balanced context size
	maxFileLength: 12000, // Balanced file size
};

/**
 * Configuration manager for enhanced precision
 */
export class EnhancedPrecisionConfigManager {
	private config: EnhancedPrecisionConfig;

	constructor(config?: Partial<EnhancedPrecisionConfig>) {
		this.config = { ...DEFAULT_ENHANCED_PRECISION_CONFIG, ...config };
	}

	/**
	 * Get current configuration
	 */
	public getConfig(): EnhancedPrecisionConfig {
		return { ...this.config };
	}

	/**
	 * Update configuration
	 */
	public updateConfig(updates: Partial<EnhancedPrecisionConfig>): void {
		this.config = { ...this.config, ...updates };
	}

	/**
	 * Set configuration preset
	 */
	public setPreset(
		preset: "default" | "high-precision" | "performance" | "balanced"
	): void {
		switch (preset) {
			case "high-precision":
				this.config = { ...HIGH_PRECISION_CONFIG };
				break;
			case "performance":
				this.config = { ...PERFORMANCE_CONFIG };
				break;
			case "balanced":
				this.config = { ...BALANCED_CONFIG };
				break;
			default:
				this.config = { ...DEFAULT_ENHANCED_PRECISION_CONFIG };
		}
	}

	/**
	 * Check if ultra-precision is enabled
	 */
	public isUltraPrecisionEnabled(): boolean {
		return this.config.enableUltraPrecision;
	}

	/**
	 * Check if precision search is enabled
	 */
	public isPrecisionSearchEnabled(): boolean {
		return this.config.enablePrecisionSearch;
	}

	/**
	 * Check if smart caching is enabled
	 */
	public isSmartCachingEnabled(): boolean {
		return this.config.enableSmartCaching;
	}

	/**
	 * Get accuracy settings
	 */
	public getAccuracySettings(): {
		minRelevanceScore: number;
		maxContextFiles: number;
		cachePrecisionThreshold: number;
	} {
		return {
			minRelevanceScore: this.config.minRelevanceScore,
			maxContextFiles: this.config.maxContextFiles,
			cachePrecisionThreshold: this.config.cachePrecisionThreshold,
		};
	}

	/**
	 * Get performance settings
	 */
	public getPerformanceSettings(): {
		maxSearchTime: number;
		maxProcessingTime: number;
		enableProgressiveLoading: boolean;
	} {
		return {
			maxSearchTime: this.config.maxSearchTime,
			maxProcessingTime: this.config.maxProcessingTime,
			enableProgressiveLoading: this.config.enableProgressiveLoading,
		};
	}

	/**
	 * Get search optimization settings
	 */
	public getSearchOptimizationSettings(): {
		enableSemanticSearch: boolean;
		enableDependencyAnalysis: boolean;
		enableSymbolAnalysis: boolean;
		enableDynamicSizing: boolean;
		enableRelevanceRanking: boolean;
	} {
		return {
			enableSemanticSearch: this.config.enableSemanticSearch,
			enableDependencyAnalysis: this.config.enableDependencyAnalysis,
			enableSymbolAnalysis: this.config.enableSymbolAnalysis,
			enableDynamicSizing: this.config.enableDynamicSizing,
			enableRelevanceRanking: this.config.enableRelevanceRanking,
		};
	}

	/**
	 * Get context optimization settings
	 */
	public getContextOptimizationSettings(): {
		maxContextLength: number;
		maxFileLength: number;
		maxSymbolChars: number;
		enableSmartTruncation: boolean;
		enableContextOptimization: boolean;
	} {
		return {
			maxContextLength: this.config.maxContextLength,
			maxFileLength: this.config.maxFileLength,
			maxSymbolChars: this.config.maxSymbolChars,
			enableSmartTruncation: this.config.enableSmartTruncation,
			enableContextOptimization: this.config.enableContextOptimization,
		};
	}

	/**
	 * Get caching settings
	 */
	public getCachingSettings(): {
		enableIntelligentCaching: boolean;
		cacheMaxSize: number;
		cacheTTL: number;
		cacheStalenessThreshold: number;
	} {
		return {
			enableIntelligentCaching: this.config.enableIntelligentCaching,
			cacheMaxSize: this.config.cacheMaxSize,
			cacheTTL: this.config.cacheTTL,
			cacheStalenessThreshold: this.config.cacheStalenessThreshold,
		};
	}

	/**
	 * Get validation settings
	 */
	public getValidationSettings(): {
		enableAccuracyValidation: boolean;
		enableFeedbackLoop: boolean;
		enableContinuousImprovement: boolean;
		enableContextValidation: boolean;
		enableFeedbackIntegration: boolean;
		enableQualityMonitoring: boolean;
	} {
		return {
			enableAccuracyValidation: this.config.enableAccuracyValidation,
			enableFeedbackLoop: this.config.enableFeedbackLoop,
			enableContinuousImprovement: this.config.enableContinuousImprovement,
			enableContextValidation: this.config.enableContextValidation,
			enableFeedbackIntegration: this.config.enableFeedbackIntegration,
			enableQualityMonitoring: this.config.enableQualityMonitoring,
		};
	}

	/**
	 * Reset to default configuration
	 */
	public resetToDefault(): void {
		this.config = { ...DEFAULT_ENHANCED_PRECISION_CONFIG };
	}

	/**
	 * Validate configuration
	 */
	public validateConfig(): { isValid: boolean; errors: string[] } {
		const errors: string[] = [];

		// Validate thresholds
		if (
			this.config.minRelevanceScore < 0 ||
			this.config.minRelevanceScore > 1
		) {
			errors.push("minRelevanceScore must be between 0 and 1");
		}

		if (
			this.config.cachePrecisionThreshold < 0 ||
			this.config.cachePrecisionThreshold > 1
		) {
			errors.push("cachePrecisionThreshold must be between 0 and 1");
		}

		if (this.config.maxContextFiles <= 0) {
			errors.push("maxContextFiles must be greater than 0");
		}

		if (this.config.maxSearchTime <= 0) {
			errors.push("maxSearchTime must be greater than 0");
		}

		if (this.config.maxProcessingTime <= 0) {
			errors.push("maxProcessingTime must be greater than 0");
		}

		if (this.config.maxContextLength <= 0) {
			errors.push("maxContextLength must be greater than 0");
		}

		if (this.config.maxFileLength <= 0) {
			errors.push("maxFileLength must be greater than 0");
		}

		if (this.config.maxSymbolChars <= 0) {
			errors.push("maxSymbolChars must be greater than 0");
		}

		if (this.config.cacheMaxSize <= 0) {
			errors.push("cacheMaxSize must be greater than 0");
		}

		if (this.config.cacheTTL <= 0) {
			errors.push("cacheTTL must be greater than 0");
		}

		if (this.config.cacheStalenessThreshold <= 0) {
			errors.push("cacheStalenessThreshold must be greater than 0");
		}

		return {
			isValid: errors.length === 0,
			errors,
		};
	}
}

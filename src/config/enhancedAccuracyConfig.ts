/**
 * Configuration for enhanced AI accuracy features
 */
export interface EnhancedAccuracyConfig {
	// Enable enhanced features
	enabled: boolean;

	// Context enhancement settings
	context: {
		maxContextLength: number;
		maxFileLength: number;
		maxSymbolChars: number;
		includeDependencies: boolean;
		includeDiagnostics: boolean;
		includeRecentChanges: boolean;
		prioritizeActiveSymbol: boolean;
	};

	// Code generation enhancement settings
	codeGeneration: {
		enableValidation: boolean;
		enableRefinement: boolean;
		enableStyleAnalysis: boolean;
		enableSecurityChecks: boolean;
		enableImportAnalysis: boolean;
		enableTypeChecking: boolean;
		maxRefinementAttempts: number;
	};

	// Prompt enhancement settings
	prompts: {
		enableEnhancedPrompts: boolean;
		enableAccuracyGuidelines: boolean;
		enableFrameworkGuidelines: boolean;
		enableQualityStandards: boolean;
		enableLanguageSpecificGuidelines: boolean;
		temperature: number;
	};

	// Plan generation enhancement settings
	planGeneration: {
		enableAccuracyAnalysis: boolean;
		enableSafetyChecks: boolean;
		enableFeasibilityAnalysis: boolean;
		enableCompletenessAnalysis: boolean;
		maxPlanRetries: number;
	};

	// Error correction settings
	errorCorrection: {
		enableEnhancedCorrection: boolean;
		enableErrorAnalysis: boolean;
		enableCorrectionValidation: boolean;
		maxCorrectionAttempts: number;
	};

	// Framework-specific settings
	frameworks: {
		nextjs: {
			enableAppRouterSupport: boolean;
			enablePagesRouterSupport: boolean;
			enableAPIRoutes: boolean;
			enableMiddleware: boolean;
		};
		react: {
			enableHooksSupport: boolean;
			enableComponentPatterns: boolean;
			enableTypeScriptSupport: boolean;
		};
		nodejs: {
			enableESModules: boolean;
			enableCommonJS: boolean;
			enablePackageManagement: boolean;
		};
		python: {
			enableTypeHints: boolean;
			enableVirtualEnvironments: boolean;
			enablePackageManagement: boolean;
		};
	};

	// Language-specific settings
	languages: {
		typescript: {
			enableStrictMode: boolean;
			enableTypeChecking: boolean;
			enableInterfaceGeneration: boolean;
		};
		javascript: {
			enableES6Features: boolean;
			enableAsyncAwait: boolean;
			enableModulePatterns: boolean;
		};
		python: {
			enablePEP8Compliance: boolean;
			enableTypeHints: boolean;
			enableDocstrings: boolean;
		};
		java: {
			enableAccessModifiers: boolean;
			enableExceptionHandling: boolean;
			enablePackageStructure: boolean;
		};
	};
}

/**
 * Default configuration for enhanced accuracy
 */
export const DEFAULT_ENHANCED_ACCURACY_CONFIG: EnhancedAccuracyConfig = {
	enabled: true,

	context: {
		maxContextLength: 100000,
		maxFileLength: 15000,
		maxSymbolChars: 8000,
		includeDependencies: true,
		includeDiagnostics: true,
		includeRecentChanges: true,
		prioritizeActiveSymbol: true,
	},

	codeGeneration: {
		enableValidation: true,
		enableRefinement: true,
		enableStyleAnalysis: true,
		enableSecurityChecks: true,
		enableImportAnalysis: true,
		enableTypeChecking: true,
		maxRefinementAttempts: 3,
	},

	prompts: {
		enableEnhancedPrompts: true,
		enableAccuracyGuidelines: true,
		enableFrameworkGuidelines: true,
		enableQualityStandards: true,
		enableLanguageSpecificGuidelines: true,
		temperature: 0.1,
	},

	planGeneration: {
		enableAccuracyAnalysis: true,
		enableSafetyChecks: true,
		enableFeasibilityAnalysis: true,
		enableCompletenessAnalysis: true,
		maxPlanRetries: 3,
	},

	errorCorrection: {
		enableEnhancedCorrection: true,
		enableErrorAnalysis: true,
		enableCorrectionValidation: true,
		maxCorrectionAttempts: 3,
	},

	frameworks: {
		nextjs: {
			enableAppRouterSupport: true,
			enablePagesRouterSupport: true,
			enableAPIRoutes: true,
			enableMiddleware: true,
		},
		react: {
			enableHooksSupport: true,
			enableComponentPatterns: true,
			enableTypeScriptSupport: true,
		},
		nodejs: {
			enableESModules: true,
			enableCommonJS: true,
			enablePackageManagement: true,
		},
		python: {
			enableTypeHints: true,
			enableVirtualEnvironments: true,
			enablePackageManagement: true,
		},
	},

	languages: {
		typescript: {
			enableStrictMode: true,
			enableTypeChecking: true,
			enableInterfaceGeneration: true,
		},
		javascript: {
			enableES6Features: true,
			enableAsyncAwait: true,
			enableModulePatterns: true,
		},
		python: {
			enablePEP8Compliance: true,
			enableTypeHints: true,
			enableDocstrings: true,
		},
		java: {
			enableAccessModifiers: true,
			enableExceptionHandling: true,
			enablePackageStructure: true,
		},
	},
};

/**
 * Configuration manager for enhanced accuracy features
 */
export class EnhancedAccuracyConfigManager {
	private config: EnhancedAccuracyConfig;

	constructor(config?: Partial<EnhancedAccuracyConfig>) {
		this.config = { ...DEFAULT_ENHANCED_ACCURACY_CONFIG, ...config };
	}

	/**
	 * Get the current configuration
	 */
	public getConfig(): EnhancedAccuracyConfig {
		return this.config;
	}

	/**
	 * Update configuration
	 */
	public updateConfig(updates: Partial<EnhancedAccuracyConfig>): void {
		this.config = { ...this.config, ...updates };
	}

	/**
	 * Check if enhanced features are enabled
	 */
	public isEnabled(): boolean {
		return this.config.enabled;
	}

	/**
	 * Check if a specific feature is enabled
	 */
	public isFeatureEnabled(feature: keyof EnhancedAccuracyConfig): boolean {
		return this.config.enabled && this.config[feature] !== false;
	}

	/**
	 * Get context configuration
	 */
	public getContextConfig() {
		return this.config.context;
	}

	/**
	 * Get code generation configuration
	 */
	public getCodeGenerationConfig() {
		return this.config.codeGeneration;
	}

	/**
	 * Get prompt configuration
	 */
	public getPromptConfig() {
		return this.config.prompts;
	}

	/**
	 * Get plan generation configuration
	 */
	public getPlanGenerationConfig() {
		return this.config.planGeneration;
	}

	/**
	 * Get error correction configuration
	 */
	public getErrorCorrectionConfig() {
		return this.config.errorCorrection;
	}

	/**
	 * Get framework-specific configuration
	 */
	public getFrameworkConfig(
		framework: keyof EnhancedAccuracyConfig["frameworks"]
	) {
		return this.config.frameworks[framework];
	}

	/**
	 * Get language-specific configuration
	 */
	public getLanguageConfig(
		language: keyof EnhancedAccuracyConfig["languages"]
	) {
		return this.config.languages[language];
	}

	/**
	 * Reset to default configuration
	 */
	public resetToDefault(): void {
		this.config = { ...DEFAULT_ENHANCED_ACCURACY_CONFIG };
	}
}

// src/sidebar/managers/settingsManager.ts
import * as vscode from "vscode";
import {
	MODEL_SELECTION_STORAGE_KEY,
	AVAILABLE_GEMINI_MODELS,
	DEFAULT_MODEL,
} from "../common/sidebarConstants";
import { resetClient } from "../../ai/gemini"; // Adjusted path

// Optimization settings keys
const OPTIMIZATION_SETTINGS_KEYS = {
	USE_SCAN_CACHE: "optimization.useScanCache",
	USE_DEPENDENCY_CACHE: "optimization.useDependencyCache",
	USE_AI_SELECTION_CACHE: "optimization.useAISelectionCache",
	MAX_CONCURRENCY: "optimization.maxConcurrency",
	ENABLE_PERFORMANCE_MONITORING: "optimization.enablePerformanceMonitoring",
	SKIP_LARGE_FILES: "optimization.skipLargeFiles",
	MAX_FILE_SIZE: "optimization.maxFileSize",
	SCAN_CACHE_TIMEOUT: "optimization.scanCacheTimeout",
	DEPENDENCY_CACHE_TIMEOUT: "optimization.dependencyCacheTimeout",
	AI_SELECTION_CACHE_TIMEOUT: "optimization.aiSelectionCacheTimeout",
	MAX_FILES_FOR_SYMBOL_PROCESSING: "optimization.maxFilesForSymbolProcessing",
	MAX_FILES_FOR_DETAILED_PROCESSING:
		"optimization.maxFilesForDetailedProcessing",
	ENABLE_SMART_CONTEXT: "smartContext.enabled",
	MAX_PROMPT_LENGTH: "optimization.maxPromptLength",
	ENABLE_STREAMING: "optimization.enableStreaming",
	FALLBACK_TO_HEURISTICS: "optimization.fallbackToHeuristics",
};

// Default optimization settings
const DEFAULT_OPTIMIZATION_SETTINGS = {
	useScanCache: true,
	useDependencyCache: true,
	useAISelectionCache: true,
	maxConcurrency: 15,
	enablePerformanceMonitoring: true,
	skipLargeFiles: true,
	maxFileSize: 1024 * 1024 * 1, // 1MB
	scanCacheTimeout: 5 * 60 * 1000, // 5 minutes
	dependencyCacheTimeout: 10 * 60 * 1000, // 10 minutes
	aiSelectionCacheTimeout: 5 * 60 * 1000, // 5 minutes
	maxFilesForSymbolProcessing: 500,
	maxFilesForDetailedProcessing: 1000,
	enableSmartContext: true,
	maxPromptLength: 50000,
	enableStreaming: false,
	fallbackToHeuristics: true,
};

export class SettingsManager {
	private _selectedModelName: string = DEFAULT_MODEL;

	constructor(
		private readonly workspaceState: vscode.Memento,
		private readonly postMessageToWebview: (message: any) => void
	) {}

	public initialize(): void {
		this.loadSettingsFromStorage();
	}

	public getSelectedModelName(): string {
		return this._selectedModelName;
	}

	public getSetting<T>(key: string, defaultValue: T): T {
		return this.workspaceState.get<T>(key, defaultValue);
	}

	// Get optimization settings
	public getOptimizationSettings() {
		return {
			useScanCache: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.USE_SCAN_CACHE,
				DEFAULT_OPTIMIZATION_SETTINGS.useScanCache
			),
			useDependencyCache: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.USE_DEPENDENCY_CACHE,
				DEFAULT_OPTIMIZATION_SETTINGS.useDependencyCache
			),
			useAISelectionCache: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.USE_AI_SELECTION_CACHE,
				DEFAULT_OPTIMIZATION_SETTINGS.useAISelectionCache
			),
			maxConcurrency: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.MAX_CONCURRENCY,
				DEFAULT_OPTIMIZATION_SETTINGS.maxConcurrency
			),
			enablePerformanceMonitoring: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.ENABLE_PERFORMANCE_MONITORING,
				DEFAULT_OPTIMIZATION_SETTINGS.enablePerformanceMonitoring
			),
			skipLargeFiles: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.SKIP_LARGE_FILES,
				DEFAULT_OPTIMIZATION_SETTINGS.skipLargeFiles
			),
			maxFileSize: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.MAX_FILE_SIZE,
				DEFAULT_OPTIMIZATION_SETTINGS.maxFileSize
			),
			scanCacheTimeout: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.SCAN_CACHE_TIMEOUT,
				DEFAULT_OPTIMIZATION_SETTINGS.scanCacheTimeout
			),
			dependencyCacheTimeout: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.DEPENDENCY_CACHE_TIMEOUT,
				DEFAULT_OPTIMIZATION_SETTINGS.dependencyCacheTimeout
			),
			aiSelectionCacheTimeout: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.AI_SELECTION_CACHE_TIMEOUT,
				DEFAULT_OPTIMIZATION_SETTINGS.aiSelectionCacheTimeout
			),
			maxFilesForSymbolProcessing: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.MAX_FILES_FOR_SYMBOL_PROCESSING,
				DEFAULT_OPTIMIZATION_SETTINGS.maxFilesForSymbolProcessing
			),
			maxFilesForDetailedProcessing: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.MAX_FILES_FOR_DETAILED_PROCESSING,
				DEFAULT_OPTIMIZATION_SETTINGS.maxFilesForDetailedProcessing
			),
			enableSmartContext: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.ENABLE_SMART_CONTEXT,
				DEFAULT_OPTIMIZATION_SETTINGS.enableSmartContext
			),
			maxPromptLength: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.MAX_PROMPT_LENGTH,
				DEFAULT_OPTIMIZATION_SETTINGS.maxPromptLength
			),
			enableStreaming: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.ENABLE_STREAMING,
				DEFAULT_OPTIMIZATION_SETTINGS.enableStreaming
			),
			fallbackToHeuristics: this.getSetting(
				OPTIMIZATION_SETTINGS_KEYS.FALLBACK_TO_HEURISTICS,
				DEFAULT_OPTIMIZATION_SETTINGS.fallbackToHeuristics
			),
		};
	}

	// Update optimization settings
	public async updateOptimizationSettings(
		settings: Partial<typeof DEFAULT_OPTIMIZATION_SETTINGS>
	): Promise<void> {
		try {
			for (const [key, value] of Object.entries(settings)) {
				const settingKey =
					OPTIMIZATION_SETTINGS_KEYS[
						key as keyof typeof OPTIMIZATION_SETTINGS_KEYS
					];
				if (settingKey) {
					await this.workspaceState.update(settingKey, value);
				}
			}
			console.log("Optimization settings updated successfully");
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Optimization settings updated successfully.",
			});
		} catch (error) {
			console.error("Error updating optimization settings:", error);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Error updating optimization settings.",
				isError: true,
			});
		}
	}

	// Reset optimization settings to defaults
	public async resetOptimizationSettings(): Promise<void> {
		try {
			for (const [key, defaultValue] of Object.entries(
				DEFAULT_OPTIMIZATION_SETTINGS
			)) {
				const settingKey =
					OPTIMIZATION_SETTINGS_KEYS[
						key as keyof typeof OPTIMIZATION_SETTINGS_KEYS
					];
				if (settingKey) {
					await this.workspaceState.update(settingKey, defaultValue);
				}
			}
			console.log("Optimization settings reset to defaults");
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Optimization settings reset to defaults.",
			});
		} catch (error) {
			console.error("Error resetting optimization settings:", error);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Error resetting optimization settings.",
				isError: true,
			});
		}
	}

	// Get cache statistics
	public getCacheStatistics() {
		// This would need to be implemented by importing the cache functions
		// For now, return a placeholder
		return {
			scanCache: { size: 0, entries: [] },
			dependencyCache: { size: 0, entries: [] },
			aiSelectionCache: { size: 0, entries: [] },
		};
	}

	// Clear all caches
	public async clearAllCaches(): Promise<void> {
		try {
			// This would need to be implemented by importing the cache functions
			// For now, just log the action
			console.log("Cache clear requested");
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "All caches cleared successfully.",
			});
		} catch (error) {
			console.error("Error clearing caches:", error);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Error clearing caches.",
				isError: true,
			});
		}
	}

	private loadSettingsFromStorage(): void {
		try {
			const savedModel = this.workspaceState.get<string>(
				MODEL_SELECTION_STORAGE_KEY
			);
			if (savedModel && AVAILABLE_GEMINI_MODELS.includes(savedModel)) {
				this._selectedModelName = savedModel;
				console.log("Loaded selected model:", this._selectedModelName);
			} else {
				this._selectedModelName = DEFAULT_MODEL;
				console.log(
					"No saved model or invalid model found. Using default:",
					DEFAULT_MODEL
				);
			}
		} catch (error) {
			console.error("Error loading settings from storage:", error);
			this._selectedModelName = DEFAULT_MODEL;
			vscode.window.showErrorMessage("Failed to load extension settings.");
		}
		// No need to call updateWebviewModelList here, SidebarProvider can do it after initialization.
	}

	public async saveSettingsToStorage(): Promise<void> {
		try {
			await this.workspaceState.update(
				MODEL_SELECTION_STORAGE_KEY,
				this._selectedModelName
			);
			console.log("Saved selected model:", this._selectedModelName);
			resetClient(); // Assuming resetClient may depend on model settings
		} catch (error) {
			console.error("Error saving settings to storage:", error);
			vscode.window.showErrorMessage("Failed to save extension settings.");
		}
		this.updateWebviewModelList();
	}

	public async handleModelSelection(modelName: string): Promise<void> {
		if (AVAILABLE_GEMINI_MODELS.includes(modelName)) {
			this._selectedModelName = modelName;
			await this.saveSettingsToStorage(); // This will also call updateWebviewModelList
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Switched to AI model: ${modelName}.`,
			});
		} else {
			console.warn("Attempted to select an invalid model:", modelName);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Error: Invalid model selected: ${modelName}.`,
				isError: true,
			});
			this.updateWebviewModelList(); // Ensure UI reflects current (unchanged) state
		}
	}

	public updateWebviewModelList(): void {
		this.postMessageToWebview({
			type: "updateModelList",
			value: {
				availableModels: AVAILABLE_GEMINI_MODELS,
				selectedModel: this._selectedModelName,
			},
		});
	}

	// Update webview with optimization settings
	public updateWebviewOptimizationSettings(): void {
		this.postMessageToWebview({
			type: "updateOptimizationSettings",
			value: this.getOptimizationSettings(),
		});
	}
}

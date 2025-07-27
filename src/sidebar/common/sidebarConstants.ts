// src/sidebar/common/sidebarConstants.ts

// Secret storage keys
export const GEMINI_API_KEY_SECRET_KEY = "geminiApiKey"; // New constant for the single API key

// Workspace state keys
export const MODEL_SELECTION_STORAGE_KEY = "geminiSelectedModel";

// DONT CHANGE THESE MODELS (NEVER)
export const AVAILABLE_GEMINI_MODELS = [
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
];

export const DEFAULT_PRO_MODEL = "gemini-2.5-pro";
export const DEFAULT_FLASH_MODEL = "gemini-2.5-flash";
export const DEFAULT_FLASH_LITE_MODEL = "gemini-2.5-flash-lite";

export const DEFAULT_MODEL =
	(AVAILABLE_GEMINI_MODELS.length > 0 &&
		AVAILABLE_GEMINI_MODELS.find((model) => model === "gemini-2.5-flash")) ||
	AVAILABLE_GEMINI_MODELS[AVAILABLE_GEMINI_MODELS.length - 1];

export const TEMPERATURE = 2;

// Minovative commands for the chat input
export const MINOVATIVE_COMMANDS = ["/plan", "/commit"];

// Optimization settings keys (heuristics context)
export const OPTIMIZATION_SETTINGS_KEYS = {
	MAX_HEURISTIC_FILES_TOTAL: "heuristicContext.maxHeuristicFilesTotal",
	MAX_SAME_DIRECTORY_FILES: "heuristicContext.maxSameDirectoryFiles",
	MAX_DIRECT_DEPENDENCIES: "heuristicContext.maxDirectDependencies",
	MAX_REVERSE_DEPENDENCIES: "heuristicContext.maxReverseDependencies",
	MAX_CALL_HIERARCHY_FILES: "heuristicContext.maxCallHierarchyFiles",
};

// Default optimization settings for heuristics context
export const DEFAULT_OPTIMIZATION_SETTINGS = {
	[OPTIMIZATION_SETTINGS_KEYS.MAX_HEURISTIC_FILES_TOTAL]: 7,
	[OPTIMIZATION_SETTINGS_KEYS.MAX_SAME_DIRECTORY_FILES]: 3,
	[OPTIMIZATION_SETTINGS_KEYS.MAX_DIRECT_DEPENDENCIES]: 3,
	[OPTIMIZATION_SETTINGS_KEYS.MAX_REVERSE_DEPENDENCIES]: 2,
	[OPTIMIZATION_SETTINGS_KEYS.MAX_CALL_HIERARCHY_FILES]: 2,
};

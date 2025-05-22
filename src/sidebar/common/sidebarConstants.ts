// src/sidebar/common/sidebarConstants.ts

// Secret storage keys
export const GEMINI_API_KEYS_LIST_SECRET_KEY = "geminiApiKeysList";
export const GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY = "geminiActiveApiKeyIndex";

// Workspace state keys
export const MODEL_SELECTION_STORAGE_KEY = "geminiSelectedModel";

// DONT CHANGE THESE MODELS
export const AVAILABLE_GEMINI_MODELS = [
	"gemini-2.5-pro-preview-05-06",
	"gemini-2.5-pro-exp-03-25",
	"gemini-2.5-flash-preview-05-20",
];
export const DEFAULT_MODEL = AVAILABLE_GEMINI_MODELS[2];

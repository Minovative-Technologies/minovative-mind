// src/sidebar/common/sidebarConstants.ts

// Secret storage keys
export const GEMINI_API_KEYS_LIST_SECRET_KEY = "geminiApiKeysList";
export const GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY = "geminiActiveApiKeyIndex";

// Workspace state keys
export const MODEL_SELECTION_STORAGE_KEY = "geminiSelectedModel";

// DONT CHANGE THESE MODELS (NEVER)
export const AVAILABLE_GEMINI_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"];

export const DEFAULT_MODEL =
	(AVAILABLE_GEMINI_MODELS.length > 0 &&
		AVAILABLE_GEMINI_MODELS.find((model) => model === "gemini-2.5-flash")) ||
	AVAILABLE_GEMINI_MODELS[AVAILABLE_GEMINI_MODELS.length - 1];

export const TEMPERATURE = 2;

// Minovative commands for the chat input
export const MINOVATIVE_COMMANDS = ["/plan", "/commit"];

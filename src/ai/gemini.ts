// src/ai/gemini.ts
import * as vscode from "vscode";
import {
	GoogleGenerativeAI,
	GenerativeModel,
	Content,
} from "@google/generative-ai";

// REMOVED: const MODEL_NAME = ...

let generativeAI: GoogleGenerativeAI | null = null;
let model: GenerativeModel | null = null;
let currentApiKey: string | null = null; // Store the key used for initialization
let currentModelName: string | null = null; // Store the model name used

/**
 * Initializes the GoogleGenerativeAI client and the GenerativeModel if needed.
 * Re-initializes if the API key or model name changes.
 *
 * @param apiKey The Google Gemini API key.
 * @param modelName The specific Gemini model name to use (e.g., "gemini-1.5-flash-latest").
 * @returns True if initialization was successful or already initialized correctly, false otherwise.
 */
function initializeGenerativeAI(apiKey: string, modelName: string): boolean {
	try {
		if (!apiKey) {
			console.error("Gemini API Key is missing.");
			if (model) {
				// Reset if key becomes invalid
				resetClient();
			}
			return false;
		}
		if (!modelName) {
			console.error("Gemini Model Name is missing.");
			if (model) {
				// Reset if model name becomes invalid
				resetClient();
			}
			return false;
		}

		// Re-initialize if API key or model name has changed, or if not initialized yet
		if (
			!generativeAI ||
			!model ||
			apiKey !== currentApiKey ||
			modelName !== currentModelName
		) {
			console.log(
				`Initializing/Re-initializing Gemini. Key changed: ${
					apiKey !== currentApiKey
				}, Model changed: ${modelName !== currentModelName}`
			);
			generativeAI = new GoogleGenerativeAI(apiKey);
			model = generativeAI.getGenerativeModel({ model: modelName });
			currentApiKey = apiKey; // Store current key
			currentModelName = modelName; // Store current model name
			console.log("GoogleGenerativeAI initialized with model:", modelName);
		}
		return true;
	} catch (error) {
		console.error("Error initializing GoogleGenerativeAI:", error);
		vscode.window.showErrorMessage(
			`Failed to initialize Gemini AI (${modelName}): ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		resetClient(); // Reset on error
		return false;
	}
}

/**
 * Generates content using the initialized Gemini model.
 *
 * @param apiKey The API key.
 * @param modelName The specific Gemini model name to use.
 * @param prompt The user's text prompt.
 * @param history Optional chat history for context.
 * @returns The generated text content or an error message string.
 */
export async function generateContent(
	apiKey: string,
	modelName: string, // <-- Added modelName parameter
	prompt: string,
	history?: Content[]
): Promise<string> {
	// Ensure initialization with the correct key AND model
	if (!initializeGenerativeAI(apiKey, modelName)) {
		return `Error: Gemini AI client not initialized. Please check your API key and selected model (${modelName}).`;
	}

	// Defensive check, should be initialized by the call above
	if (!model) {
		// This case should ideally be covered by initializeGenerativeAI, but good practice
		return `Error: Gemini model (${modelName}) is not available after initialization attempt.`;
	}

	try {
		// Start a new chat session with the current model instance
		const chat = model.startChat({
			history: history || [],
			// generationConfig: { ... } // Optional configuration
		});

		console.log(
			`Sending prompt to Gemini (${modelName}):`,
			prompt.substring(0, 100) + "..."
		);
		const result = await chat.sendMessage(prompt);

		// Optional: Check for safety ratings
		// if (result.response.promptFeedback?.blockReason) { ... }

		const response = result.response;
		const text = response.text();
		console.log(
			`Received response from Gemini (${modelName}):`,
			text.substring(0, 100) + "..."
		);
		return text;
	} catch (error) {
		console.error(
			`Error generating content with Gemini (${modelName}):`,
			error
		);
		// Provide a more user-friendly error message
		let errorMessage = `An error occurred while communicating with the Gemini API (${modelName}).`;
		if (error instanceof Error) {
			// Specific error checks
			if (error.message.includes("API key not valid")) {
				errorMessage =
					"Error: Invalid API Key. Please check your key in the settings.";
				resetClient(); // Reset client state on invalid key
			} else if (error.message.includes("quota")) {
				errorMessage = `Error: API quota exceeded for model ${modelName}. Please check your usage or try again later.`;
			} else if (error.message.includes("invalid model")) {
				errorMessage = `Error: The selected model '${modelName}' is not valid or not accessible with your API key.`;
				resetClient(); // Reset client state on invalid model
			} else {
				errorMessage = `Error (${modelName}): ${error.message}`;
			}
		} else {
			errorMessage = `Error (${modelName}): ${String(error)}`;
		}
		vscode.window.showErrorMessage(errorMessage);
		return errorMessage; // Return error message for display
	}
}

/**
 * Resets the client state, clearing the model, API key, and model name.
 */
export function resetClient() {
	generativeAI = null;
	model = null;
	currentApiKey = null;
	currentModelName = null;
	console.log("Gemini AI client state has been reset.");
}

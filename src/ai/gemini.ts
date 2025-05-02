// src/ai/gemini.ts
import * as vscode from "vscode";
import {
	GoogleGenerativeAI,
	GenerativeModel,
	Content,
} from "@google/generative-ai";

// Define the model name you want to use
// See https://ai.google.dev/models/gemini for available models
const MODEL_NAME = "gemini-2.5-flash-preview-04-17"; // Or "gemini-2.0-flash" || "gemini-2.5-flash-preview-04-17", etc.

let generativeAI: GoogleGenerativeAI | null = null;
let model: GenerativeModel | null = null;

/**
 * Initializes the GoogleGenerativeAI client and the GenerativeModel.
 * Should be called with a valid API key.
 *
 * @param apiKey The Google Gemini API key.
 * @returns True if initialization was successful, false otherwise.
 */
function initializeGenerativeAI(apiKey: string): boolean {
	try {
		if (!apiKey) {
			console.error("Gemini API Key is missing.");
			return false;
		}
		// Only create new instances if they don't exist or if the key changes (optional)
		if (!generativeAI || !model) {
			generativeAI = new GoogleGenerativeAI(apiKey);
			model = generativeAI.getGenerativeModel({ model: MODEL_NAME });
			console.log("GoogleGenerativeAI initialized with model:", MODEL_NAME);
		}
		return true;
	} catch (error) {
		console.error("Error initializing GoogleGenerativeAI:", error);
		vscode.window.showErrorMessage(
			`Failed to initialize Gemini AI: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		generativeAI = null; // Reset on error
		model = null;
		return false;
	}
}

/**
 * Generates content using the initialized Gemini model.
 * Assumes initializeGenerativeAI has been called successfully.
 *
 * @param apiKey The API key (needed to re-initialize if necessary).
 * @param prompt The user's text prompt.
 * @param history Optional chat history for context.
 * @returns The generated text content or an error message string.
 */
export async function generateContent(
	apiKey: string,
	prompt: string,
	history?: Content[]
): Promise<string> {
	// Ensure initialization with the correct key
	if (!initializeGenerativeAI(apiKey)) {
		return "Error: Gemini AI client not initialized. Please check your API key.";
	}

	// Defensive check, should be initialized by the call above
	if (!model) {
		return "Error: Gemini model is not available.";
	}

	try {
		// For simplicity, starting a new chat each time for basic Q&A.
		// For conversational context, you'd manage the history array.
		const chat = model.startChat({
			history: history || [],
			// generationConfig: { // Optional: configure temp, topP, etc.
			//   maxOutputTokens: 200,
			// },
		});

		console.log("Sending prompt to Gemini:", prompt);
		const result = await chat.sendMessage(prompt);

		// Check for safety ratings if needed (optional)
		// if (result.response.promptFeedback?.blockReason) {
		// 	return `Blocked due to: ${result.response.promptFeedback.blockReason}`;
		// }

		const response = result.response;
		const text = response.text();
		console.log("Received response from Gemini:", text);
		return text;
	} catch (error) {
		console.error("Error generating content with Gemini:", error);
		// Provide a more user-friendly error message
		let errorMessage =
			"An error occurred while communicating with the Gemini API.";
		if (error instanceof Error) {
			// Check for common API key or quota issues (example)
			if (error.message.includes("API key not valid")) {
				errorMessage =
					"Error: Invalid API Key. Please check your key in the settings.";
			} else if (error.message.includes("quota")) {
				errorMessage =
					"Error: API quota exceeded. Please check your usage or try again later.";
			} else {
				errorMessage = `Error: ${error.message}`;
			}
		} else {
			errorMessage = `Error: ${String(error)}`;
		}
		vscode.window.showErrorMessage(errorMessage); // Show detailed error in VS Code
		return errorMessage; // Return error message to be displayed in chat
	}
}

// Optional: Function to clear the model if the API key changes or is removed
export function resetClient() {
	generativeAI = null;
	model = null;
	console.log("Gemini AI client has been reset.");
}

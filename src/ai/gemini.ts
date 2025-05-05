// src/ai/gemini.ts
import * as vscode from "vscode";
import {
	GoogleGenerativeAI,
	GenerativeModel,
	Content,
} from "@google/generative-ai";

// --- Add this constant ---
export const ERROR_QUOTA_EXCEEDED = "ERROR_GEMINI_QUOTA_EXCEEDED";
// --- End Add ---

let generativeAI: GoogleGenerativeAI | null = null;
let model: GenerativeModel | null = null;
let currentApiKey: string | null = null; // Store the key used for initialization
let currentModelName: string | null = null; // Store the model name used

/**
 * Initializes the GoogleGenerativeAI client and the GenerativeModel if needed.
 * Re-initializes if the API key or model name changes.
 *
 * @param apiKey The Google Gemini API key.
 * @param modelName The specific Gemini model name to use (e.g., "gemini-2.0-flash").
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
 * @param token Optional cancellation token to allow aborting the request before it's sent. // Added token parameter documentation
 * @returns The generated text content or an error message string.
 */
export async function generateContent(
	apiKey: string,
	modelName: string,
	prompt: string,
	history?: Content[],
	token?: vscode.CancellationToken // MODIFICATION 1: Added optional token parameter
): Promise<string> {
	// Return type remains string, but can be our special error string

	// MODIFICATION 2: Check for cancellation before proceeding
	// Check if the request was cancelled before attempting to initialize or call the API
	if (token?.isCancellationRequested) {
		console.log("Gemini request cancelled before sending."); // Log cancellation
		return "Cancelled by user."; // Return a specific message indicating cancellation
	}

	if (!initializeGenerativeAI(apiKey, modelName)) {
		// Return a standard error string for initialization failure
		return `Error: Gemini AI client not initialized. Please check your API key and selected model (${modelName}).`;
	}
	if (!model) {
		// Return a standard error string for model unavailability
		return `Error: Gemini model (${modelName}) is not available after initialization attempt.`;
	}

	try {
		// The cancellation check is performed *before* this try block, as requested.
		// This ensures we don't even attempt the API call if cancellation was requested early.

		const chat = model.startChat({
			history: history || [],
		});
		console.log(
			`Sending prompt to Gemini (${modelName}):`,
			prompt.substring(0, 100) + "..."
		);

		// Note: The Gemini SDK's `sendMessage` might not inherently support cancellation via a token
		// after the request has started. This check primarily prevents initiating the request.
		const result = await chat.sendMessage(prompt);

		// Optional: Check cancellation again *after* the call returns, in case the user cancelled
		// during the request and we want to avoid processing the result.
		if (token?.isCancellationRequested) {
			console.log(
				"Gemini request cancelled after response received, before processing."
			);
			return "Cancelled by user (after response received).";
		}

		const response = result.response;

		// --- Optional: More robust safety check ---
		if (response.promptFeedback?.blockReason) {
			console.warn(
				`Gemini (${modelName}) blocked prompt: ${response.promptFeedback.blockReason}`,
				response.promptFeedback.safetyRatings
			);
			return `Error: Request blocked by Gemini due to safety settings (${response.promptFeedback.blockReason}). Please adjust your prompt.`;
		}
		if (
			response.candidates &&
			response.candidates.length > 0 &&
			response.candidates[0].finishReason !== "STOP"
		) {
			console.warn(
				`Gemini (${modelName}) finished unexpectedly: ${response.candidates[0].finishReason}`,
				response.candidates[0].safetyRatings
			);
			// Provide specific messages based on finishReason if desired
			return `Error: Gemini stopped generation unexpectedly (${response.candidates[0].finishReason}).`;
		}
		// --- End safety check ---

		const text = response.text();
		console.log(
			`Received response from Gemini (${modelName}):`,
			text.substring(0, 100) + "..."
		);
		return text;
	} catch (error) {
		// Also check for cancellation in the catch block.
		if (token?.isCancellationRequested) {
			console.log("Gemini request cancelled during error handling.");
			return "Cancelled by user.";
		}

		console.error(
			`Error generating content with Gemini (${modelName}):`,
			error
		);

		// --- Refined Error Handling ---
		let errorMessage = `An error occurred while communicating with the Gemini API (${modelName}).`;
		let isQuotaError = false;
		let isInvalidKeyError = false;

		if (error instanceof Error) {
			const lowerErrorMessage = error.message.toLowerCase();

			// Check for specific quota/rate limit errors (adjust keywords as needed based on actual SDK errors)
			if (
				lowerErrorMessage.includes("quota") ||
				lowerErrorMessage.includes("rate limit") ||
				lowerErrorMessage.includes("resource has been exhausted") ||
				(error.name === "GoogleGenerativeAIError" &&
					(error as any).status === 429) // Example if SDK uses standard HTTP status codes in errors
			) {
				errorMessage = `API quota or rate limit exceeded for model ${modelName}.`;
				isQuotaError = true; // Signal quota issue
			}
			// Check for invalid API key errors
			else if (
				lowerErrorMessage.includes("api key not valid") ||
				lowerErrorMessage.includes("invalid api key")
			) {
				errorMessage =
					"Error: Invalid API Key. Please check your key in the settings.";
				isInvalidKeyError = true;
				resetClient(); // Reset client state on definitively invalid key
			}
			// Check for invalid model errors
			else if (
				lowerErrorMessage.includes("invalid model") ||
				lowerErrorMessage.includes("model not found")
			) {
				errorMessage = `Error: The selected model '${modelName}' is not valid or not accessible with your API key.`;
				isInvalidKeyError = true; // Treat as key/model issue, reset
				resetClient();
			} else {
				errorMessage = `Error (${modelName}): ${error.message}`; // General error
			}
		} else {
			errorMessage = `Error (${modelName}): ${String(error)}`; // Non-Error object thrown
		}

		// Return the special signal for quota errors, otherwise return the descriptive error message
		if (isQuotaError) {
			console.log(`Gemini (${modelName}): Detected quota/rate limit error.`);
			return ERROR_QUOTA_EXCEEDED; // Return signal
		} else {
			// Show error message only for non-quota errors, as quota errors will be retried silently first.
			// If retries fail, the provider will show a final message.
			if (!isQuotaError) {
				vscode.window.showErrorMessage(errorMessage);
			}
			return errorMessage; // Return standard error message for other issues
		}
		// --- End Refined Error Handling ---
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

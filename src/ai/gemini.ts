// src/ai/gemini.ts
import * as vscode from "vscode";
import {
	GoogleGenerativeAI,
	GenerativeModel,
	Content,
	GenerationConfig, // <-- Add this import
	StartChatParams, // <-- Add this import
} from "@google/generative-ai";

export const ERROR_QUOTA_EXCEEDED = "ERROR_GEMINI_QUOTA_EXCEEDED";

let generativeAI: GoogleGenerativeAI | null = null;
let model: GenerativeModel | null = null;
let currentApiKey: string | null = null;
let currentModelName: string | null = null;

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
				resetClient();
			}
			return false;
		}
		if (!modelName) {
			console.error("Gemini Model Name is missing.");
			if (model) {
				resetClient();
			}
			return false;
		}

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
			// Note: Default generationConfig can be set here if needed for all calls using this model instance
			// model = generativeAI.getGenerativeModel({ model: modelName, generationConfig: { temperature: 0.7 } });
			// However, for JSON mode, it's often better to apply it per-request.
			model = generativeAI.getGenerativeModel({ model: modelName });
			currentApiKey = apiKey;
			currentModelName = modelName;
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
		resetClient();
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
 * @param generationConfig Optional configuration for this generation request (e.g., for JSON mode).
 * @param token Optional cancellation token.
 * @returns The generated text content or an error message string.
 */
export async function generateContent(
	apiKey: string,
	modelName: string,
	prompt: string,
	history?: Content[],
	generationConfig?: GenerationConfig, // <-- MODIFIED: Added generationConfig parameter
	token?: vscode.CancellationToken
): Promise<string> {
	// 1. Check for cancellation at the very beginning of the function.
	if (token?.isCancellationRequested) {
		console.log("Cancelled by user."); // MODIFIED: Log message updated
		return "Cancelled by user.";
	}

	if (!initializeGenerativeAI(apiKey, modelName)) {
		return `Error: Gemini AI client not initialized. Please check your API key and selected model (${modelName}).`;
	}
	if (!model) {
		return `Error: Gemini model (${modelName}) is not available after initialization attempt.`;
	}

	try {
		// --- MODIFIED: Include generationConfig in StartChatParams ---
		const chatParams: StartChatParams = {
			history: history || [],
		};
		if (generationConfig) {
			chatParams.generationConfig = generationConfig;
			console.log(
				`Starting chat with custom generationConfig for model ${modelName}:`,
				generationConfig
			);
		}

		const chat = model.startChat(chatParams); // Pass params here
		console.log(
			`Sending prompt to Gemini (${modelName}):`,
			prompt.substring(0, 100) + "..."
		);

		// 2. Check for cancellation immediately before the chat.sendMessage(prompt) call.
		if (token?.isCancellationRequested) {
			console.log("Cancelled by user."); // ADDED: Cancellation check
			return "Cancelled by user.";
		}

		const result = await chat.sendMessage(prompt);

		// 3. Check for cancellation immediately after result = await chat.sendMessage(prompt) resolves.
		if (token?.isCancellationRequested) {
			console.log("Cancelled by user (after response received)."); // MODIFIED: Log message updated
			return "Cancelled by user (after response received).";
		}

		const response = result.response;

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
			response.candidates[0].finishReason !== "STOP" &&
			response.candidates[0].finishReason !== "MAX_TOKENS" // MAX_TOKENS is a valid stop reason if output is partial
		) {
			console.warn(
				`Gemini (${modelName}) finished unexpectedly: ${response.candidates[0].finishReason}`,
				response.candidates[0].safetyRatings
			);
			return `Error: Gemini stopped generation unexpectedly (${response.candidates[0].finishReason}).`;
		}

		const text = response.text();
		console.log(
			`Received response from Gemini (${modelName}):`,
			text.substring(0, 100) + "..."
		);
		return text;
	} catch (error) {
		// 4. Check for cancellation inside the catch (error) block, as the first check.
		if (token?.isCancellationRequested) {
			console.log("Cancelled by user."); // MODIFIED: Log message updated
			return "Cancelled by user.";
		}

		console.error(
			`Error generating content with Gemini (${modelName}):`,
			error
		);

		let errorMessage = `An error occurred while communicating with the Gemini API (${modelName}).`;
		let isQuotaError = false;

		if (error instanceof Error) {
			const lowerErrorMessage = error.message.toLowerCase();
			const errorName = (error as any).name || ""; // Handle cases where name might not exist
			const errorStatus = (error as any).status || (error as any).code; // Common places for status codes

			if (
				lowerErrorMessage.includes("quota") ||
				lowerErrorMessage.includes("rate limit") ||
				lowerErrorMessage.includes("resource has been exhausted") ||
				((errorName === "GoogleGenerativeAIError" ||
					errorName.includes("HttpError")) && // Broader check for HTTP errors
					(errorStatus === 429 || String(errorStatus).startsWith("429")))
			) {
				errorMessage = `API quota or rate limit exceeded for model ${modelName}.`;
				isQuotaError = true;
			} else if (
				lowerErrorMessage.includes("api key not valid") ||
				lowerErrorMessage.includes("invalid api key") ||
				((errorName === "GoogleGenerativeAIError" ||
					errorName.includes("HttpError")) &&
					(errorStatus === 400 || errorStatus === 401 || errorStatus === 403) && // 400 can be bad API key
					(lowerErrorMessage.includes("permission denied") ||
						lowerErrorMessage.includes("api key"))) // More specific checks for 403
			) {
				errorMessage =
					"Error: Invalid API Key or insufficient permissions. Please check your key in the settings.";
				resetClient();
			} else if (
				lowerErrorMessage.includes("invalid model") ||
				lowerErrorMessage.includes("model not found") ||
				((errorName === "GoogleGenerativeAIError" ||
					errorName.includes("HttpError")) &&
					errorStatus === 404) // 404 for model not found
			) {
				errorMessage = `Error: The selected model '${modelName}' is not valid or not accessible with your API key.`;
				resetClient();
			} else if (
				lowerErrorMessage.includes("json_parsing_error") ||
				(generationConfig?.responseMimeType === "application/json" &&
					lowerErrorMessage.includes("response was not valid json"))
			) {
				// Specific error if the model fails to produce JSON when explicitly asked
				errorMessage = `Error: Gemini (${modelName}) failed to generate valid JSON as requested. The model's response might have been: ${error.message}`;
				console.warn(
					`Gemini (${modelName}) was asked for JSON but failed:`,
					error
				);
			} else {
				errorMessage = `Error (${modelName}): ${error.message}`;
			}
		} else {
			errorMessage = `Error (${modelName}): ${String(error)}`;
		}

		if (isQuotaError) {
			console.log(`Gemini (${modelName}): Detected quota/rate limit error.`);
			return ERROR_QUOTA_EXCEEDED;
		} else {
			// Show error message only for non-quota errors
			vscode.window.showErrorMessage(errorMessage);
			return errorMessage;
		}
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

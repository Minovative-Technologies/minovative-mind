import * as vscode from "vscode";
import {
	GoogleGenerativeAI,
	GenerativeModel,
	Content,
	GenerationConfig,
} from "@google/generative-ai";

export const ERROR_QUOTA_EXCEEDED = "ERROR_GEMINI_QUOTA_EXCEEDED";
// Define a specific error message constant for cancellation
export const ERROR_OPERATION_CANCELLED = "Operation cancelled by user.";
// Add a new error constant for service unavailability
export const ERROR_SERVICE_UNAVAILABLE = "ERROR_GEMINI_SERVICE_UNAVAILABLE";

let generativeAI: GoogleGenerativeAI | null = null;
let model: GenerativeModel | null = null;
let currentApiKey: string | null = null;
let currentModelName: string | null = null;

/**
 * Initializes the GoogleGenerativeAI client and the GenerativeModel if needed.
 * Re-initializes if the API key or model name changes.
 *
 * @param apiKey The Google Gemini API key.
 * @param modelName The specific Gemini model name to use (e.g., "gemini-2.5-pro").
 * @returns True if initialization was successful or already initialized correctly, false otherwise.
 */
function initializeGenerativeAI(apiKey: string, modelName: string): boolean {
	console.log(
		`Gemini: Attempting to initialize GoogleGenerativeAI with model: ${modelName}...`
	);
	try {
		if (!apiKey) {
			console.error("Gemini: API Key is missing.");
			if (model) {
				// If a model existed, reset it as config is now invalid
				resetClient();
			}
			return false;
		}
		if (!modelName) {
			console.error("Gemini: Model Name is missing.");
			if (model) {
				// If a model existed, reset it
				resetClient();
			}
			return false;
		}

		const needsInitialization =
			!generativeAI ||
			!model ||
			apiKey !== currentApiKey ||
			modelName !== currentModelName;

		if (needsInitialization) {
			console.log(
				`Gemini: Re-initializing client. Key changed: ${
					apiKey !== currentApiKey
				}, Model changed: ${
					modelName !== currentModelName
				}. New model: ${modelName}`
			);
			generativeAI = new GoogleGenerativeAI(apiKey);
			// For `generateContentStream`, generationConfig is applied per-request.
			model = generativeAI.getGenerativeModel({ model: modelName });
			currentApiKey = apiKey;
			currentModelName = modelName;
			console.log("Gemini: GoogleGenerativeAI initialized successfully.");
		} else {
			console.log("Gemini: Client already initialized with correct settings.");
		}
		return true;
	} catch (error) {
		console.error("Gemini: Error initializing GoogleGenerativeAI:", error);
		vscode.window.showErrorMessage(
			`Failed to initialize Gemini AI (${modelName}): ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		resetClient(); // Ensure client is reset on initialization failure
		return false;
	}
}

/**
 * Generates content as an asynchronous stream using the initialized Gemini model.
 *
 * @param apiKey The API key.
 * @param modelName The specific Gemini model name to use.
 * @param prompt The user's text prompt.
 * @param history Optional chat history for context.
 * @param generationConfig Optional configuration for this generation request (e.g., for JSON mode).
 * @param token Optional cancellation token from VS Code.
 * @param isMergeOperation Optional boolean, true if this generation is for a merge conflict resolution.
 * @returns An AsyncIterableIterator yielding generated text chunks.
 * @throws Will throw `ERROR_OPERATION_CANCELLED` if the operation is cancelled by the user.
 *         Will throw an error if initialization fails, the request is blocked before yielding any content,
 *         or a critical API error occurs. Quota errors throw `new Error(ERROR_QUOTA_EXCEEDED)`.
 *         Service Unavailable errors throw `new Error(ERROR_SERVICE_UNAVAILABLE)`.
 */
export async function* generateContentStream(
	apiKey: string,
	modelName: string,
	prompt: string,
	history?: Content[],
	generationConfig?: GenerationConfig,
	token?: vscode.CancellationToken,
	isMergeOperation: boolean = false // Added optional cancellation token parameter
): AsyncIterableIterator<string> {
	// 1. Initial cancellation check (before any significant work)
	if (token?.isCancellationRequested) {
		console.log(
			"Gemini: Cancellation requested before starting stream generation."
		);
		// Throw the specific cancellation error
		throw new Error(ERROR_OPERATION_CANCELLED);
	}

	// 2. Initialize AI client and model
	if (!initializeGenerativeAI(apiKey, modelName)) {
		// initializeGenerativeAI already shows an error message and logs.
		// Throw an error to signal failure to the caller, halting the generator.
		throw new Error(
			`Gemini AI client not initialized. Please check API key and selected model (${modelName}).`
		);
	}
	// Model should be non-null if initializeGenerativeAI succeeded. Defensive check.
	if (!model) {
		throw new Error(
			`Gemini model (${modelName}) is not available after initialization attempt. This should not happen if initialization succeeded.`
		);
	}

	// 3. Construct request contents: combine history and the new prompt
	const requestContents: Content[] = [
		...(history || []), // Spread existing history if provided
		{ role: "user", parts: [{ text: prompt }] }, // the new user prompt
	];

	let contentYielded = false; // Flag to track if any content has been successfully yielded

	try {
		// Log request details before sending
		const truncatedPrompt =
			prompt.length > 100 ? `${prompt.substring(0, 100)}...` : prompt;
		console.log(
			`Gemini (${modelName}): Sending stream request. Truncated Prompt: ${truncatedPrompt}`
		);
		if (generationConfig) {
			// Log the config being used, stringify it
			console.log(
				`Gemini (${modelName}): Using custom generationConfig: ${JSON.stringify(
					generationConfig
				)}`
			);
		}
		if (isMergeOperation) {
			console.log(`Gemini (${modelName}): This is a merge operation.`);
		}

		// Validation loop for requestContents
		for (const contentItem of requestContents) {
			if (contentItem && Array.isArray(contentItem.parts)) {
				for (const part of contentItem.parts) {
					if (part && typeof part === "object") {
						const partKeys = Object.keys(part);
						// Expected keys for Gemini ContentPart types
						const expectedPartKeys = ["text", "inlineData", "fileData"];
						const unexpectedKeys = partKeys.filter(
							(key) => !expectedPartKeys.includes(key)
						);

						if (unexpectedKeys.length > 0) {
							// Log a detailed warning/error
							console.warn(
								`Gemini (${modelName}): Detected unexpected properties in content part. ` +
									`Problematic part structure: ${JSON.stringify(part)}. ` +
									`Unexpected keys: ${unexpectedKeys.join(", ")}. ` +
									`This might indicate an issue with how content parts are constructed (e.g., passing non-standard properties from VS Code objects directly).`
							);
						}
					}
				}
			}
		}

		// 4. Initiate stream generation with the model
		// model.generateContentStream returns a Promise that resolves to a StreamGenerateContentResult object
		const result = await model.generateContentStream({
			contents: requestContents,
			generationConfig, // Pass through the generation configuration
		});

		// 5. Stream content chunks from result.stream
		for await (const chunk of result.stream) {
			// Check for cancellation *before* processing/yielding the chunk
			if (token?.isCancellationRequested) {
				console.log("Gemini: Cancellation requested during streaming.");
				// Throw the specific cancellation error
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			const text = chunk.text(); // Extract text from the current chunk
			if (text && text.length > 0) {
				// Ensure text is not null/empty before yielding
				contentYielded = true; // Mark that content has been yielded
				// Log received chunk (truncated)
				const truncatedChunk =
					text.length > 50 ? `${text.substring(0, 50)}...` : text;
				console.log(
					`Gemini (${modelName}): Received chunk: "${truncatedChunk}"`
				);
				yield text; // Yield the text chunk
			}
		}

		console.log(`Gemini (${modelName}): Stream finished.`);

		// 6. Process final response data after the stream is fully consumed
		// result.response is a Promise that resolves when the stream is finished.
		const finalResponse = await result.response;

		// Check for prompt feedback (e.g., if the prompt itself was blocked)
		if (finalResponse.promptFeedback?.blockReason) {
			const blockReason = finalResponse.promptFeedback.blockReason;
			const safetyRatings = JSON.stringify(
				finalResponse.promptFeedback.safetyRatings
			);
			const message = `Gemini (${modelName}) request was blocked. Reason: ${blockReason}. Safety Ratings: ${safetyRatings}`;

			if (!contentYielded) {
				// If no content was yielded, this is a critical error preventing any output. Throw.
				console.error(message + " (No content yielded, throwing error)");
				throw new Error(
					`Request blocked by Gemini (reason: ${blockReason}). Adjust prompt or check safety settings.`
				);
			} else {
				// If content was already yielded, the stream was cut short. Log as a warning.
				console.warn(message + " (Content was partially yielded before block)");
			}
		}

		// Check candidate's finish reason if candidates exist and it's not a normal stop
		if (finalResponse.candidates && finalResponse.candidates.length > 0) {
			const candidate = finalResponse.candidates[0];
			const finishReason = candidate.finishReason;

			// Check if the finish reason is abnormal (not STOP or MAX_TOKENS)
			if (
				finishReason &&
				finishReason !== "STOP" &&
				finishReason !== "MAX_TOKENS" // MAX_TOKENS is a valid way to end if output is long
			) {
				// Other reasons include "SAFETY", "RECITATION", "OTHER"
				const safetyRatings = JSON.stringify(candidate.safetyRatings);
				const message = `Gemini (${modelName}) stream finished unexpectedly or due to policy. Reason: ${finishReason}. Safety Ratings: ${safetyRatings}`;

				if (!contentYielded) {
					// If no content yielded and finish was abnormal, throw an error.
					console.error(message + " (No content yielded, throwing error)");
					throw new Error(
						`Gemini stream stopped prematurely (reason: ${finishReason}).`
					);
				} else {
					// If content was partially yielded, log as a warning.
					console.warn(
						message + " (Content was partially yielded before stop)"
					);
				}
			}
		} else if (!contentYielded && !finalResponse.promptFeedback?.blockReason) {
			// This case: no candidates, no explicit block reason, and no content yielded.
			// Could be a valid empty response from the model, or an unhandled edge case.
			// Log for awareness, but don't throw an error as it might be legitimate.
			console.warn(
				`Gemini (${modelName}): Stream ended without yielding content and no explicit block/error reason in final response. The prompt might have resulted in an empty output, or check API logs for silent errors.`
			);
		}
	} catch (error: any) {
		// 7. Handle errors from API calls, network issues, or other exceptions during the process.

		// Log the raw error first for detailed debugging
		console.error(
			`Gemini (${modelName}): Raw error caught during content stream generation:`,
			error
		);

		// If the error itself is the cancellation error, re-throw it immediately.
		if (error instanceof Error && error.message === ERROR_OPERATION_CANCELLED) {
			console.log("Gemini: Caught specific cancellation error, re-throwing.");
			// Re-throw the specific cancellation error so callers can distinguish it.
			throw error;
		}

		let errorMessage = `An error occurred with the Gemini API (${modelName}) during streaming.`;
		let isQuotaError = false;
		let errorTypeLogged = "Other"; // Default type for logging

		if (error instanceof Error) {
			const lowerErrorMessage = error.message.toLowerCase();
			// Attempt to get more specific error details from GoogleGenerativeAIError if possible
			const errorName = (error as any).name || ""; // e.g., "GoogleGenerativeAIError", "GoogleGenerativeAIResponseError"
			const errorStatus = // Try to find HTTP status code from common error properties
				(error as any).status ||
				(error as any).httpGoogleError?.code || // Nested Google HTTP error code for some SDK errors
				(error as any).code; // Generic code property

			// --- Specific Error Type Handling and Logging ---

			if (
				lowerErrorMessage.includes("quota") ||
				lowerErrorMessage.includes("rate limit") ||
				lowerErrorMessage.includes("resource has been exhausted") ||
				errorStatus === 429 || // HTTP 429 Too Many Requests
				(typeof errorStatus === "string" && errorStatus.startsWith("429")) // Some SDKs might return status as string
			) {
				errorMessage = `API quota or rate limit exceeded. Please check your Google Cloud account limits.`;
				isQuotaError = true;
				errorTypeLogged = "Quota Exceeded";
			} else if (
				lowerErrorMessage.includes("api key not valid") ||
				lowerErrorMessage.includes("invalid api key") ||
				((errorName.includes("GoogleGenerativeAI") ||
					errorName.includes("HttpError")) && // Check for SDK or HTTP error names
					(errorStatus === 400 || errorStatus === 401 || errorStatus === 403) && // Bad Request, Unauthorized, Forbidden
					(lowerErrorMessage.includes("permission denied") ||
						lowerErrorMessage.includes("api key")))
			) {
				errorMessage = `Invalid API Key while using Gemini model ${modelName}. Please verify your API key.`;
				resetClient(); // API key is likely bad, reset client state
				errorTypeLogged = "Invalid API Key/Permissions";
			} else if (
				lowerErrorMessage.includes("invalid model") ||
				lowerErrorMessage.includes("model not found") ||
				errorStatus === 404 // HTTP 404 Not Found
			) {
				errorMessage = `The selected Gemini model '${modelName}' is not valid, not found, or not accessible with your current API key.`;
				resetClient(); // Model name or access issue, reset client state
				errorTypeLogged = "Invalid Model";
			} else if (
				// Handle Service Unavailable specifically
				errorStatus === 503 ||
				lowerErrorMessage.includes("service unavailable") ||
				lowerErrorMessage.includes("model is overloaded")
			) {
				errorMessage = "AI service is currently overloaded. Please try again.";
				errorTypeLogged = "Service Unavailable";
				throw new Error(ERROR_SERVICE_UNAVAILABLE); // Propagate specific error constant
			} else if (
				lowerErrorMessage.includes("json_parsing_error") ||
				(generationConfig?.responseMimeType === "application/json" && // If JSON was expected
					(lowerErrorMessage.includes("response was not valid json") ||
						lowerErrorMessage.includes("failed to parse")))
			) {
				errorMessage = `Gemini (${modelName}) was requested to return JSON but failed to generate valid JSON. Model response might be malformed. Details: ${error.message}`;
				errorTypeLogged = "JSON Parsing Error";
			} else if (
				// This handles cases where the SDK throws an error directly related to content blocking
				// *before* any content could be yielded (e.g., request validation failure due to safety).
				(errorName === "GoogleGenerativeAIResponseError" ||
					lowerErrorMessage.includes("safety settings") ||
					lowerErrorMessage.includes("blocked")) &&
				!contentYielded // Crucially, only if no content was yielded yet.
			) {
				errorMessage = `Request to Gemini (${modelName}) was blocked due to safety settings or other policy before any content could be generated. Details: ${error.message}`;
				errorTypeLogged = "Request Blocked (Pre-generation)";
			} else {
				// Generic error message fallback using the error's message
				errorMessage = `Gemini (${modelName}) error: ${error.message}`;
				errorTypeLogged = "Generic API Error";
			}

			// Log the derived error details before throwing
			console.error(
				`Gemini (${modelName}): Processed error type: ${errorTypeLogged}, Status: ${errorStatus}, Name: ${errorName}, Message: "${errorMessage}"`
			);
		} else {
			// Non-Error object thrown, convert to string
			errorMessage = `An unknown error occurred with Gemini (${modelName}): ${String(
				error
			)}`;
			errorTypeLogged = "Unknown/Non-Error Type";
			console.error(
				`Gemini (${modelName}): Processed error type: ${errorTypeLogged}, Message: "${errorMessage}"`
			);
		}

		if (isQuotaError) {
			// For quota errors, throw the specific constant string wrapped in an Error object.
			// This allows callers to specifically catch and handle quota issues.
			throw new Error(ERROR_QUOTA_EXCEEDED);
		} else {
			// For other errors, throw a new error with the composed, informative message.
			throw new Error(errorMessage);
		}
	}
}

/**
 * Resets the client state, clearing the model, API key, and model name.
 * This is typically called when the API key or model configuration is found to be invalid,
 * or if the user changes these settings.
 */
export function resetClient() {
	generativeAI = null;
	model = null;
	currentApiKey = null;
	currentModelName = null;
	console.log("Gemini: AI client state has been reset.");
}

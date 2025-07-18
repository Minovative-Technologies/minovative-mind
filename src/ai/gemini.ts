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
 * @param modelName The specific Gemini model name to use (e.g., "gemini-1.5-pro-latest").
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
				resetClient();
			}
			return false;
		}
		if (!modelName) {
			console.error("Gemini: Model Name is missing.");
			if (model) {
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
		resetClient();
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
 */
export async function* generateContentStream(
	apiKey: string,
	modelName: string,
	prompt: string,
	history?: Content[],
	generationConfig?: GenerationConfig,
	token?: vscode.CancellationToken,
	isMergeOperation: boolean = false
): AsyncIterableIterator<string> {
	if (token?.isCancellationRequested) {
		console.log(
			"Gemini: Cancellation requested before starting stream generation."
		);
		throw new Error(ERROR_OPERATION_CANCELLED);
	}

	if (!initializeGenerativeAI(apiKey, modelName)) {
		throw new Error(
			`Gemini AI client not initialized. Please check API key and selected model (${modelName}).`
		);
	}
	if (!model) {
		throw new Error(
			`Gemini model (${modelName}) is not available after initialization attempt.`
		);
	}

	const requestContents: Content[] = [
		...(history || []),
		{ role: "user", parts: [{ text: prompt }] },
	];

	// This is now valid after updating the @google/generative-ai package.
	const requestConfig = {
		...generationConfig,
		thinkingConfig: {
			thinkingBudget: -1,
		},
	};

	let contentYielded = false;

	try {
		const truncatedPrompt =
			prompt.length > 100 ? `${prompt.substring(0, 100)}...` : prompt;
		console.log(
			`Gemini (${modelName}): Sending stream request. Prompt: "${truncatedPrompt}"`
		);
		console.log(
			`Gemini (${modelName}): Using generationConfig: ${JSON.stringify(
				requestConfig
			)}`
		);
		if (isMergeOperation) {
			console.log(`Gemini (${modelName}): This is a merge operation.`);
		}

		const result = await model.generateContentStream({
			contents: requestContents,
			generationConfig: requestConfig,
		});

		for await (const chunk of result.stream) {
			if (token?.isCancellationRequested) {
				console.log("Gemini: Cancellation requested during streaming.");
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			const text = chunk.text();
			if (text && text.length > 0) {
				contentYielded = true;
				const truncatedChunk =
					text.length > 50 ? `${text.substring(0, 50)}...` : text;
				console.log(
					`Gemini (${modelName}): Received chunk: "${truncatedChunk}"`
				);
				yield text;
			}
		}

		console.log(`Gemini (${modelName}): Stream finished.`);
		const finalResponse = await result.response;

		if (finalResponse.promptFeedback?.blockReason) {
			const { blockReason, safetyRatings } = finalResponse.promptFeedback;
			const message = `Gemini (${modelName}) request blocked. Reason: ${blockReason}. Ratings: ${JSON.stringify(
				safetyRatings
			)}`;
			if (!contentYielded) {
				console.error(message);
				throw new Error(`Request blocked by Gemini (reason: ${blockReason}).`);
			} else {
				console.warn(`${message} (partially yielded)`);
			}
		}

		const candidate = finalResponse.candidates?.[0];
		if (candidate) {
			const { finishReason, safetyRatings } = candidate;
			if (
				finishReason &&
				finishReason !== "STOP" &&
				finishReason !== "MAX_TOKENS"
			) {
				const message = `Gemini (${modelName}) stream finished unexpectedly. Reason: ${finishReason}. Ratings: ${JSON.stringify(
					safetyRatings
				)}`;
				if (!contentYielded) {
					console.error(message);
					throw new Error(
						`Gemini stream stopped prematurely (reason: ${finishReason}).`
					);
				} else {
					console.warn(`${message} (partially yielded)`);
				}
			}
		} else if (!contentYielded && !finalResponse.promptFeedback?.blockReason) {
			console.warn(
				`Gemini (${modelName}): Stream ended without yielding content or a block reason.`
			);
		}
	} catch (error: any) {
		console.error(`Gemini (${modelName}): Raw error during stream:`, error);

		if (error instanceof Error && error.message === ERROR_OPERATION_CANCELLED) {
			throw error;
		}

		let errorMessage = `An error occurred with the Gemini API (${modelName}).`;
		const lowerErrorMessage = (error.message || "").toLowerCase();
		const status = error.httpGoogleError?.code || error.status;

		if (lowerErrorMessage.includes("quota") || status === 429) {
			throw new Error(ERROR_QUOTA_EXCEEDED);
		} else if (
			lowerErrorMessage.includes("api key not valid") ||
			status === 400 ||
			status === 403
		) {
			errorMessage = `Invalid API Key for Gemini model ${modelName}. Please verify your key.`;
			resetClient();
		} else if (
			lowerErrorMessage.includes("model not found") ||
			status === 404
		) {
			errorMessage = `The model '${modelName}' is not valid or accessible.`;
			resetClient();
		} else if (
			status === 503 ||
			lowerErrorMessage.includes("service unavailable")
		) {
			throw new Error(ERROR_SERVICE_UNAVAILABLE);
		} else {
			errorMessage = `Gemini (${modelName}) error: ${error.message}`;
		}

		throw new Error(errorMessage);
	}
}

/**
 * Resets the client state.
 */
export function resetClient() {
	generativeAI = null;
	model = null;
	currentApiKey = null;
	currentModelName = null;
	console.log("Gemini: AI client state has been reset.");
}

/**
 * Accurately counts tokens using the Gemini API's countTokens method.
 * It ensures the Gemini model client is initialized for the given API key and model.
 *
 * @param apiKey The API key to use.
 * @param modelName The name of the model (e.g., 'gemini-pro').
 * @param text The main text content to count.
 * @param history Optional conversation history as Gemini Content objects.
 * @returns The total token count.
 */
export async function countGeminiTokens(
	apiKey: string,
	modelName: string,
	text: string,
	history?: Content[]
): Promise<number> {
	// Ensure the generative AI client and model are initialized for the given key and model name.
	// This function internally sets the global 'model' variable if needed.
	if (!initializeGenerativeAI(apiKey, modelName)) {
		throw new Error(
			`Gemini AI client not initialized for token counting. Please check API key and selected model (${modelName}).`
		);
	}
	if (!model) {
		// This check is a safeguard, as initializeGenerativeAI should ensure 'model' is set upon success.
		throw new Error(
			`Gemini model (${modelName}) is not available after initialization attempt for token counting.`
		);
	}

	const parts = [{ text: text }];
	// Combine history and current text into contents array for token counting
	const requestContents: Content[] = [
		...(history || []),
		{ role: "user", parts },
	];

	try {
		console.log(
			`[Gemini Token Counter] Requesting token count for model '${modelName}'...`
		);
		const { totalTokens } = await model.countTokens({
			contents: requestContents,
		});
		console.log(
			`[Gemini Token Counter] Successfully counted ${totalTokens} tokens for model '${modelName}'.`
		);
		return totalTokens;
	} catch (error) {
		console.error(
			`[Gemini Token Counter] Failed to count tokens for model '${modelName}':`,
			error
		);
		// Re-throw specific errors if they indicate cancellation or other critical issues
		if (error instanceof Error && error.message === ERROR_OPERATION_CANCELLED) {
			throw error;
		}
		// Wrap and re-throw other errors for consistent handling in calling services
		throw new Error(
			`Failed to count tokens via Gemini API for model '${modelName}': ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
}

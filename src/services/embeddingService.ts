import * as vscode from "vscode";
import { ApiKeyManager } from "../sidebar/managers/apiKeyManager";
import {
	generateEmbedding,
	EMBEDDING_MODEL_NAME,
	ERROR_OPERATION_CANCELLED,
	ERROR_QUOTA_EXCEEDED,
	ERROR_SERVICE_UNAVAILABLE,
	ERROR_AI_TIMEOUT,
} from "../ai/gemini";

export class EmbeddingService {
	private readonly MAX_SERVICE_UNAVAILABLE_RETRIES_PER_KEY = 3; // Max times to retry SERVICE_UNAVAILABLE on a single API key before switching/failing
	private readonly SERVICE_UNAVAILABLE_RETRY_DELAY_MS = 45000; // 45 seconds as per AIRequestService

	constructor(
		private apiKeyManager: ApiKeyManager,
		private postMessageToWebview: (message: any) => void
	) {}

	/**
	 * Generates an embedding vector for the given text using the configured embedding model.
	 * Implements robust retry logic for transient AI errors and API key rotation for quota issues.
	 *
	 * @param text The input text string to be embedded.
	 * @param cancellationToken An optional VS Code cancellation token to abort the operation.
	 * @returns A promise that resolves to an an array of numbers representing the embedding vector.
	 * @throws {Error} If the operation is cancelled, times out, all API keys are exhausted, or other unrecoverable errors occur.
	 */
	public async embed(
		text: string,
		cancellationToken?: vscode.CancellationToken
	): Promise<number[]> {
		const apiKeyList = this.apiKeyManager.getApiKeyList();
		let currentApiKey = this.apiKeyManager.getActiveApiKey();

		// Initial check and activation of a key if none is active
		if (!currentApiKey) {
			if (apiKeyList.length > 0) {
				this.apiKeyManager.setActiveKeyIndex(0);
				await this.apiKeyManager.saveKeysToStorage(); // Ensure the change is persisted
				currentApiKey = this.apiKeyManager.getActiveApiKey();
				console.log(
					`[EmbeddingService] Initializing: No active key, set to first available key ending in ...${currentApiKey?.slice(
						-4
					)}`
				);
			} else {
				const errorMsg =
					"Error: No API Key available for embedding. Please add an API key in the settings.";
				console.error(`[EmbeddingService] ${errorMsg}`);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: errorMsg,
					isError: true,
				});
				throw new Error(errorMsg);
			}
		}

		if (!currentApiKey) {
			// Double check if key is still not available after trying to activate one
			const errorMsg =
				"Error: Unable to obtain a valid API key for embedding after initialization attempt.";
			console.error(`[EmbeddingService] ${errorMsg}`);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: errorMsg,
				isError: true,
			});
			throw new Error(errorMsg);
		}

		const triedKeysForQuota = new Set<string>(); // Tracks keys that have specifically failed due to quota
		let serviceUnavailableRetryCount = 0; // Counts consecutive SERVICE_UNAVAILABLE retries for the current key

		while (true) {
			// Loop indefinitely, exit conditions handled by throws and returns
			if (cancellationToken?.isCancellationRequested) {
				console.log(
					"[EmbeddingService] Embedding operation cancelled by user."
				);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Embedding generation cancelled.",
					isError: true,
				});
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			console.log(
				`[EmbeddingService] Attempting embedding with key ending in ...${currentApiKey.slice(
					-4
				)} (SU retries: ${serviceUnavailableRetryCount})`
			);

			try {
				const embedding = await generateEmbedding(
					currentApiKey,
					EMBEDDING_MODEL_NAME,
					text,
					cancellationToken
				);
				console.log(
					`[EmbeddingService] Embedding generated successfully. Vector length: ${embedding.length}`
				);
				return embedding; // Success: return immediately
			} catch (error: unknown) {
				const err = error as Error;
				const errorMessage = err.message;

				if (errorMessage === ERROR_OPERATION_CANCELLED) {
					console.log(
						"[EmbeddingService] Embedding generation cancelled from underlying AI call."
					);
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Embedding generation cancelled.",
						isError: true,
					});
					throw err; // Re-throw cancellation immediately
				} else if (errorMessage === ERROR_AI_TIMEOUT) {
					console.warn(
						`[EmbeddingService] Embedding request timed out for model ${EMBEDDING_MODEL_NAME}.`
					);
					this.postMessageToWebview({
						type: "statusUpdate",
						value: `Embedding request timed out.`,
						isError: true,
					});
					throw err; // Re-throw timeout immediately
				} else if (errorMessage === ERROR_QUOTA_EXCEEDED) {
					triedKeysForQuota.add(currentApiKey); // Mark current key as having hit quota

					const availableKeysCount = this.apiKeyManager.getApiKeyList().length; // Re-fetch in case list changed dynamically? Not expected, but safer.
					console.warn(
						`[EmbeddingService] Quota/Rate limit hit for key ending in ...${currentApiKey?.slice(
							-4
						)}. ${
							triedKeysForQuota.size
						} of ${availableKeysCount} distinct keys tried for quota.`
					);

					if (triedKeysForQuota.size >= availableKeysCount) {
						const finalError = `API quota or rate limit exceeded for embedding model ${EMBEDDING_MODEL_NAME}. All ${availableKeysCount} available API key(s) failed due to quota.`;
						console.error(`[EmbeddingService] ${finalError}`);
						this.postMessageToWebview({
							type: "statusUpdate",
							value: finalError,
							isError: true,
						});
						throw new Error(finalError);
					}

					// Attempt to switch to the next available, untried key
					const nextKey = await this.apiKeyManager.switchToNextApiKey(
						triedKeysForQuota
					);
					if (nextKey) {
						currentApiKey = nextKey;
						serviceUnavailableRetryCount = 0; // Reset service unavailable retries for the new key
						this.postMessageToWebview({
							type: "statusUpdate",
							value: `Embedding quota limit hit. Retrying with next key...`,
						});
						this.postMessageToWebview({
							type: "apiKeyStatus",
							value: `Switched to key ending in ...${currentApiKey.slice(
								-4
							)} for embedding retry.`,
						});
						// Loop continues to try with the new key
					} else {
						// This case should ideally not be reached if triedKeysForQuota.size < availableKeysCount
						// but serves as a safeguard against unexpected ApiKeyManager behavior.
						const finalError = `API quota or rate limit exceeded for embedding model ${EMBEDDING_MODEL_NAME}. No more untried keys available.`;
						console.error(`[EmbeddingService] ${finalError}`);
						this.postMessageToWebview({
							type: "statusUpdate",
							value: finalError,
							isError: true,
						});
						throw new Error(finalError);
					}
				} else if (errorMessage === ERROR_SERVICE_UNAVAILABLE) {
					serviceUnavailableRetryCount++;
					if (
						serviceUnavailableRetryCount >
						this.MAX_SERVICE_UNAVAILABLE_RETRIES_PER_KEY
					) {
						const finalError = `AI service for embedding model ${EMBEDDING_MODEL_NAME} remains unavailable after ${
							this.MAX_SERVICE_UNAVAILABLE_RETRIES_PER_KEY
						} retries with key ending in ...${currentApiKey.slice(-4)}.`;
						console.error(`[EmbeddingService] ${finalError}`);
						this.postMessageToWebview({
							type: "statusUpdate",
							value: finalError,
							isError: true,
						});
						throw new Error(finalError);
					}

					console.warn(
						`[EmbeddingService] Service unavailable for embedding model ${EMBEDDING_MODEL_NAME}. Retrying (attempt ${serviceUnavailableRetryCount}/${this.MAX_SERVICE_UNAVAILABLE_RETRIES_PER_KEY}) with same key after delay.`
					);
					this.postMessageToWebview({
						type: "statusUpdate",
						value: `AI service temporarily unavailable for embeddings. Retrying in ${
							this.SERVICE_UNAVAILABLE_RETRY_DELAY_MS / 1000
						} seconds...`,
					});
					await new Promise((resolve) =>
						setTimeout(resolve, this.SERVICE_UNAVAILABLE_RETRY_DELAY_MS)
					);
					// Loop continues with the same key
				} else {
					// For any other non-retryable error
					const finalError = `Error generating embedding: ${errorMessage}`;
					console.error(
						`[EmbeddingService] Unrecoverable error during embedding:`,
						err
					);
					this.postMessageToWebview({
						type: "statusUpdate",
						value: finalError,
						isError: true,
					});
					throw new Error(finalError);
				}
			}
		}
	}
}

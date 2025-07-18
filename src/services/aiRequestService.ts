// src/services/aiRequestService.ts
import * as vscode from "vscode";
import { Content, GenerationConfig } from "@google/generative-ai";
import { ApiKeyManager } from "../sidebar/managers/apiKeyManager";
import { HistoryEntry } from "../sidebar/common/sidebarTypes";
import {
	ERROR_OPERATION_CANCELLED,
	ERROR_QUOTA_EXCEEDED,
	ERROR_SERVICE_UNAVAILABLE,
	generateContentStream,
	countGeminiTokens, // <-- ADD THIS IMPORT
} from "../ai/gemini";
import {
	ParallelProcessor,
	ParallelTask,
	ParallelTaskResult,
} from "../utils/parallelProcessor";
import { TokenTrackingService } from "./tokenTrackingService";

export class AIRequestService {
	constructor(
		private apiKeyManager: ApiKeyManager,
		private postMessageToWebview: (message: any) => void,
		private tokenTrackingService?: TokenTrackingService
	) {}

	/**
	 * Transforms an array of internal HistoryEntry objects into the format required by the Gemini API's `Content` type.
	 */
	private transformHistoryForGemini(history: HistoryEntry[]): Content[] {
		return history.map((entry) => ({
			role: entry.role,
			parts: entry.parts.map((part) => ({
				text: part.text,
			})),
		}));
	}

	/**
	 * A robust wrapper for making generation requests to the AI.
	 * It handles API key rotation on quota errors, retries, and cancellation.
	 */
	public async generateWithRetry(
		prompt: string,
		modelName: string,
		history: readonly HistoryEntry[] | undefined,
		requestType: string = "request",
		generationConfig?: GenerationConfig,
		streamCallbacks?: {
			onChunk: (chunk: string) => Promise<void> | void;
			onComplete?: () => void;
		},
		token?: vscode.CancellationToken,
		isMergeOperation: boolean = false
	): Promise<string> {
		await this.apiKeyManager.switchToNextApiKey();
		let currentApiKey = this.apiKeyManager.getActiveApiKey();
		const triedKeys = new Set<string>();
		const apiKeyList = this.apiKeyManager.getApiKeyList();

		let consecutiveTransientErrorCount = 0;
		const baseDelayMs = 60000;
		const maxDelayMs = 10 * 60 * 1000;

		// Initialize these variables at the top of generateWithRetry
		let finalInputTokens = 0;
		let finalOutputTokens = 0; // Initialize here for broader scope
		let totalInputTextForContext = prompt; // Default to prompt, will include history below

		if (!currentApiKey) {
			if (apiKeyList.length > 0) {
				this.apiKeyManager.setActiveKeyIndex(0);
				await this.apiKeyManager.saveKeysToStorage();
				currentApiKey = this.apiKeyManager.getActiveApiKey();
			} else {
				return `Error: No API Key available. Please add an API key.`;
			}
		}

		if (!currentApiKey) {
			return `Error: Unable to obtain a valid API key.`;
		}

		let result = ""; // Stores the last error type or the successful generation result

		const historyForGemini =
			history && history.length > 0
				? this.transformHistoryForGemini(history as HistoryEntry[])
				: undefined;

		// Construct totalInputTextForContext including history for consistent heuristic fallback and tracking context
		if (history && history.length > 0) {
			const historyText = history
				.map((entry) => entry.parts.map((part) => part.text).join(" "))
				.join(" ");
			totalInputTextForContext = historyText + " " + prompt;
		}

		// NEW: Calculate input tokens accurately using Gemini API before starting the request
		if (this.tokenTrackingService && currentApiKey) {
			try {
				finalInputTokens = await countGeminiTokens(
					currentApiKey,
					modelName,
					prompt,
					historyForGemini
				);
				console.log(
					`[AIRequestService] Accurately counted ${finalInputTokens} input tokens for model ${modelName}.`
				);
			} catch (e) {
				console.warn(
					`[AIRequestService] Failed to get accurate input token count from Gemini API (${modelName}), falling back to estimate. Error:`,
					e
				);
				// Fallback to heuristic if API call for counting fails
				finalInputTokens = this.tokenTrackingService.estimateTokens(
					totalInputTextForContext
				);
				console.log(
					`[AIRequestService] Estimated ${finalInputTokens} input tokens using heuristic for model ${modelName}.`
				);
			}
		}

		while (true) {
			if (token?.isCancellationRequested) {
				console.log(
					"[AIRequestService] Cancellation requested at start of retry loop."
				);
				if (streamCallbacks?.onComplete) {
					streamCallbacks.onComplete();
				}
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			console.log(
				`[AIRequestService] Attempt with key ...${currentApiKey.slice(
					-4
				)} for ${requestType}.`
			);

			let accumulatedResult = "";
			try {
				if (!currentApiKey) {
					throw new Error("API Key became invalid during retry loop.");
				}

				const stream = generateContentStream(
					currentApiKey,
					modelName,
					prompt,
					historyForGemini, // Ensure historyForGemini is passed to generateContentStream
					generationConfig,
					token,
					isMergeOperation
				);

				let chunkCount = 0;
				for await (const chunk of stream) {
					if (token?.isCancellationRequested) {
						throw new Error(ERROR_OPERATION_CANCELLED);
					}
					accumulatedResult += chunk;
					chunkCount++;

					// Maintain Real-time Streaming Token Estimates:
					// This block remains, as it uses the heuristic for performance during streaming.
					// Update: Use totalInputTextForContext for more accurate real-time input estimation.
					if (this.tokenTrackingService && chunkCount % 10 === 0) {
						const estimates =
							this.tokenTrackingService.getRealTimeTokenEstimates(
								totalInputTextForContext, // <-- Use the prepared full input context here
								accumulatedResult
							);
						this.tokenTrackingService.triggerRealTimeUpdate();
					}

					if (streamCallbacks?.onChunk) {
						await streamCallbacks.onChunk(chunk);
					}
				}
				result = accumulatedResult; // Store successful final result

				// NEW: Accurately count and track output tokens after the response is complete
				if (this.tokenTrackingService && currentApiKey) {
					try {
						finalOutputTokens = await countGeminiTokens(
							currentApiKey,
							modelName,
							accumulatedResult
						);
						console.log(
							`[AIRequestService] Accurately counted ${finalOutputTokens} output tokens for model ${modelName}.`
						);
					} catch (e) {
						console.warn(
							`[AIRequestService] Failed to get accurate output token count from Gemini API (${modelName}), falling back to estimate. Error:`,
							e
						);
						finalOutputTokens =
							this.tokenTrackingService.estimateTokens(accumulatedResult);
						console.log(
							`[AIRequestService] Estimated ${finalOutputTokens} output tokens using heuristic for model ${modelName}.`
						);
					}

					// Update the trackTokenUsage call with the accurately counted tokens
					this.tokenTrackingService.trackTokenUsage(
						finalInputTokens, // Use the accurately counted input tokens
						finalOutputTokens, // Use the accurately counted output tokens
						requestType,
						modelName,
						totalInputTextForContext.length > 1000 // Use the full input context for tracking
							? totalInputTextForContext.substring(0, 1000) + "..."
							: totalInputTextForContext
					);
				}

				if (streamCallbacks?.onComplete) {
					streamCallbacks.onComplete();
				}
				consecutiveTransientErrorCount = 0; // Reset counter on success
				return result; // Success: return immediately
			} catch (error: unknown) {
				const err = error as Error;
				const errorMessage = err.message;

				if (errorMessage === ERROR_OPERATION_CANCELLED) {
					console.log(
						"[AIRequestService] Operation cancelled from underlying AI stream."
					);
					if (streamCallbacks?.onComplete) {
						streamCallbacks.onComplete();
					}
					throw err; // Re-throw cancellation immediately, do NOT retry
				}

				if (errorMessage === ERROR_QUOTA_EXCEEDED) {
					result = ERROR_QUOTA_EXCEEDED; // Mark result for outer handling (key switch)
					const currentDelay = Math.min(
						maxDelayMs,
						baseDelayMs * 2 ** consecutiveTransientErrorCount
					);
					console.warn(
						`[AIRequestService] Quota/Rate limit hit for key ...${currentApiKey?.slice(
							-4
						)}. Pausing for ${(currentDelay / 60000).toFixed(0)} minutes.`
					);
					this.postMessageToWebview({
						type: "statusUpdate",
						value: `API quota limit hit. Pausing for ${(
							currentDelay / 60000
						).toFixed(0)} minutes before retrying.`,
						isError: true,
					});
					await new Promise((resolve) => setTimeout(resolve, currentDelay));
					if (token?.isCancellationRequested) {
						throw new Error(ERROR_OPERATION_CANCELLED);
					}
					consecutiveTransientErrorCount++;
					triedKeys.add(currentApiKey);
					const availableKeys = this.apiKeyManager.getApiKeyList();

					if (triedKeys.size < availableKeys.length) {
						const nextKey = await this.apiKeyManager.switchToNextApiKey(
							triedKeys
						);
						if (nextKey) {
							currentApiKey = nextKey;
							this.postMessageToWebview({
								type: "statusUpdate",
								value: `Quota limit hit. Retrying with next key...`,
							});
							this.postMessageToWebview({
								type: "apiKeyStatus",
								value: `Switched to key ...${currentApiKey.slice(
									-4
								)} for retry.`,
							});
						} else {
							// Should not happen if triedKeys.size < availableKeys.length is true
							this.postMessageToWebview({
								type: "statusUpdate",
								value: `No new API keys available. Retrying with the last key after pause.`,
								isError: true,
							});
						}
					} else {
						this.postMessageToWebview({
							type: "statusUpdate",
							value: `All available API keys exhausted for quota. Retrying with the last key after pause.`,
							isError: true,
						});
					}
					continue;
				} else if (errorMessage === ERROR_SERVICE_UNAVAILABLE) {
					const currentDelay = Math.min(
						maxDelayMs,
						baseDelayMs * 2 ** consecutiveTransientErrorCount
					);
					console.warn(
						`[AIRequestService] Service unavailable for model ${modelName}. Retrying after ${(
							currentDelay / 60000
						).toFixed(0)} minutes.`
					);
					this.postMessageToWebview({
						type: "statusUpdate",
						value: `AI service temporarily unavailable. Waiting ${(
							currentDelay / 60000
						).toFixed(0)} minutes before retrying...`,
					});
					await new Promise((resolve) => setTimeout(resolve, currentDelay));
					if (token?.isCancellationRequested) {
						throw new Error(ERROR_OPERATION_CANCELLED);
					}
					consecutiveTransientErrorCount++;
					continue;
				} else {
					// For any other non-retryable error, set result and exit the loop / return immediately
					consecutiveTransientErrorCount = 0; // Reset counter for non-transient errors
					result = `Error: ${errorMessage}`;
					console.error(`[AIRequestService] Error during generation:`, err);
					return result; // Return other errors immediately (they are not retryable)
				}
			}
		}
		// Removed final `if (result === ERROR_QUOTA_EXCEEDED) { ... } else if ...` block as it's now unreachable.
	}

	/**
	 * Execute multiple AI requests in parallel with concurrency control
	 */
	public async generateMultipleInParallel(
		requests: Array<{
			id: string;
			prompt: string;
			modelName: string;
			history?: readonly HistoryEntry[];
			generationConfig?: GenerationConfig;
			priority?: number;
		}>,
		config: {
			maxConcurrency?: number;
			timeout?: number;
			retries?: number;
		} = {},
		token?: vscode.CancellationToken // Added optional cancellation token
	): Promise<Map<string, ParallelTaskResult<string>>> {
		const tasks: ParallelTask<string>[] = requests.map((request) => ({
			id: request.id,
			task: () =>
				this.generateWithRetry(
					request.prompt,
					request.modelName,
					request.history,
					`parallel-${request.id}`,
					request.generationConfig,
					undefined,
					token, // Pass the cancellation token to generateWithRetry
					false
				),
			priority: request.priority ?? 0,
			timeout: config.timeout,
			retries: config.retries,
		}));

		return ParallelProcessor.executeParallel(tasks, {
			maxConcurrency: config.maxConcurrency ?? 3, // Limit concurrent AI requests
			defaultTimeout: config.timeout ?? 60000,
			defaultRetries: config.retries ?? 1,
			enableRetries: true,
			enableTimeout: true,
			cancellationToken: token, // Pass the cancellation token to ParallelProcessor
		});
	}

	/**
	 * Process multiple files in parallel with AI analysis
	 */
	public async processFilesInParallel<T>(
		files: vscode.Uri[],
		processor: (file: vscode.Uri) => Promise<T>,
		config: {
			maxConcurrency?: number;
			timeout?: number;
			retries?: number;
		} = {},
		token?: vscode.CancellationToken // Added optional cancellation token
	): Promise<Map<string, ParallelTaskResult<T>>> {
		return ParallelProcessor.processFilesInParallel(files, processor, {
			maxConcurrency: config.maxConcurrency ?? 4,
			defaultTimeout: config.timeout ?? 30000,
			defaultRetries: config.retries ?? 2,
			enableRetries: true,
			enableTimeout: true,
			cancellationToken: token, // Pass the cancellation token to ParallelProcessor
		});
	}

	/**
	 * Execute AI requests in batches to manage memory and API limits
	 */
	public async generateInBatches(
		requests: Array<{
			id: string;
			prompt: string;
			modelName: string;
			history?: readonly HistoryEntry[];
			generationConfig?: GenerationConfig;
			priority?: number;
		}>,
		batchSize: number = 5,
		config: {
			maxConcurrency?: number;
			timeout?: number;
			retries?: number;
		} = {},
		token?: vscode.CancellationToken // Added optional cancellation token
	): Promise<Map<string, ParallelTaskResult<string>>> {
		const tasks: ParallelTask<string>[] = requests.map((request) => ({
			id: request.id,
			task: () =>
				this.generateWithRetry(
					request.prompt,
					request.modelName,
					request.history,
					`batch-${request.id}`,
					request.generationConfig,
					undefined,
					token, // Pass the cancellation token to generateWithRetry
					false
				),
			priority: request.priority ?? 0,
			timeout: config.timeout,
			retries: config.retries,
		}));

		return ParallelProcessor.executeInBatches(tasks, batchSize, {
			maxConcurrency: config.maxConcurrency ?? 3,
			defaultTimeout: config.timeout ?? 60000,
			defaultRetries: config.retries ?? 1,
			enableRetries: true,
			enableTimeout: true,
			cancellationToken: token, // Pass the cancellation token to ParallelProcessor
		});
	}
}

// src/services/aiRequestService.ts
import * as vscode from "vscode";
import { Content, GenerationConfig } from "@google/generative-ai";
import { ApiKeyManager } from "../sidebar/managers/apiKeyManager";
import { HistoryEntry } from "../sidebar/common/sidebarTypes";
import {
	ERROR_OPERATION_CANCELLED,
	ERROR_QUOTA_EXCEEDED,
	ERROR_SERVICE_UNAVAILABLE, // MODIFICATION 1: Import new error constant
	generateContentStream,
} from "../ai/gemini";
import {
	ParallelProcessor,
	ParallelTask,
	ParallelTaskResult,
} from "../utils/parallelProcessor";

export class AIRequestService {
	constructor(
		private apiKeyManager: ApiKeyManager,
		private postMessageToWebview: (message: any) => void
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
		const maxRetries = apiKeyList.length > 0 ? apiKeyList.length : 1; // maxRetries refers to number of distinct keys to attempt for quota errors

		let attempts = 0; // Total attempts made, including retries on same key

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

		while (attempts < maxRetries) {
			if (token?.isCancellationRequested) {
				console.log(
					"[AIRequestService] Cancellation requested at start of retry loop."
				);
				if (streamCallbacks?.onComplete) {
					streamCallbacks.onComplete();
				}
				throw new Error(ERROR_OPERATION_CANCELLED);
			}

			attempts++;
			console.log(
				`[AIRequestService] Attempt ${attempts}/${maxRetries} for ${requestType} with key ...${currentApiKey.slice(
					-4
				)}`
			);

			let accumulatedResult = "";
			try {
				if (!currentApiKey) {
					throw new Error("API Key became invalid during retry loop.");
				}

				const historyForGemini =
					history && history.length > 0
						? this.transformHistoryForGemini(history as HistoryEntry[])
						: undefined;

				const stream = generateContentStream(
					currentApiKey,
					modelName,
					prompt,
					historyForGemini,
					generationConfig,
					token,
					isMergeOperation
				);

				for await (const chunk of stream) {
					if (token?.isCancellationRequested) {
						throw new Error(ERROR_OPERATION_CANCELLED);
					}
					accumulatedResult += chunk;
					if (streamCallbacks?.onChunk) {
						await streamCallbacks.onChunk(chunk);
					}
				}
				result = accumulatedResult; // Store successful result
				if (streamCallbacks?.onComplete) {
					streamCallbacks.onComplete();
				}
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
					console.warn(
						`[AIRequestService] Quota/Rate limit hit for key ...${currentApiKey?.slice(
							-4
						)}.`
					);
				} else if (errorMessage === ERROR_SERVICE_UNAVAILABLE) {
					// MODIFICATION 3: New service unavailable condition
					result = ERROR_SERVICE_UNAVAILABLE; // Mark result to retry with same key
					console.warn(
						`[AIRequestService] Service unavailable for model ${modelName}. Retrying attempt ${attempts} of ${maxRetries}.`
					);
					this.postMessageToWebview({
						type: "statusUpdate",
						value: `AI service temporarily unavailable. Retrying...`,
					});
					await new Promise((resolve) => setTimeout(resolve, 30000)); // 30-second delay
					continue; // MODIFICATION 4: Stay in the loop with the same key
				} else {
					// For any other non-retryable error, set result and exit the loop / return immediately
					result = `Error: ${errorMessage}`;
					console.error(
						`[AIRequestService] Error during generation on attempt ${attempts}:`,
						err
					);
					return result; // Return other errors immediately (they are not retryable)
				}
			}

			// This block is reached ONLY if `result` was `ERROR_QUOTA_EXCEEDED`.
			// If `ERROR_SERVICE_UNAVAILABLE` occurred, the `continue` statement above skips this block.
			// If a non-retryable error occurred, the `return result;` above skips this block.
			if (result === ERROR_QUOTA_EXCEEDED) {
				triedKeys.add(currentApiKey);
				const availableKeysCount = apiKeyList.length;

				if (availableKeysCount <= 1 || triedKeys.size >= availableKeysCount) {
					// No more keys to try or all keys have been tried for quota.
					return `API quota or rate limit exceeded for model ${modelName}. All ${availableKeysCount} API key(s) failed.`;
				}

				const nextKey = await this.apiKeyManager.switchToNextApiKey(triedKeys);
				if (nextKey) {
					currentApiKey = nextKey;
					this.postMessageToWebview({
						type: "statusUpdate",
						value: `Quota limit hit. Retrying with next key...`,
					});
					this.postMessageToWebview({
						type: "apiKeyStatus",
						value: `Switched to key ...${currentApiKey.slice(-4)} for retry.`,
					});
					// Loop will continue with the new key in the next iteration.
				} else {
					// No more untried keys, even if maxRetries isn't technically exhausted.
					return `API quota or rate limit exceeded for model ${modelName}. All available API keys have been tried.`;
				}
			}
			// If `result` was anything else, it would have been returned or continued from the catch block.
			// The loop will naturally continue if a new key was assigned for quota errors.
		}

		// MODIFICATION 5: After the while loop, modify final return statements
		// This point is reached if the `while` loop condition `attempts < maxRetries` became false,
		// meaning all allowed attempts (related to key switching or direct retries on same key) have been exhausted.
		// `result` holds the error message from the *last* failed attempt.
		if (result === ERROR_QUOTA_EXCEEDED) {
			return `API quota or rate limit exceeded for model ${modelName}. Failed after trying ${attempts} keys.`;
		} else if (result === ERROR_SERVICE_UNAVAILABLE) {
			return `AI service for model ${modelName} remains unavailable after ${attempts} retries. Please try again later.`;
		} else {
			// This case should ideally not be reached if non-retryable errors are returned immediately within the loop.
			// It serves as a robust fallback for unexpected loop termination conditions.
			return `An unexpected error occurred after all retries for model ${modelName}. Last error: ${result}`;
		}
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
		} = {}
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
					undefined,
					false
				),
			priority: request.priority ?? 0,
			timeout: config.timeout,
			retries: config.retries,
		}));

		return ParallelProcessor.executeParallel(tasks, {
			maxConcurrency: config.maxConcurrency ?? 3, // Limit concurrent AI requests
			defaultTimeout: config.timeout ?? 60000, // 60 seconds default
			defaultRetries: config.retries ?? 1,
			enableRetries: true,
			enableTimeout: true,
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
		} = {}
	): Promise<Map<string, ParallelTaskResult<T>>> {
		return ParallelProcessor.processFilesInParallel(files, processor, {
			maxConcurrency: config.maxConcurrency ?? 4,
			defaultTimeout: config.timeout ?? 30000,
			defaultRetries: config.retries ?? 2,
			enableRetries: true,
			enableTimeout: true,
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
		} = {}
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
					undefined,
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
		});
	}
}

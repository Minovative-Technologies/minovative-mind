// src/services/aiRequestService.ts
import * as vscode from "vscode";
import { Content, GenerationConfig } from "@google/generative-ai";
import { ApiKeyManager } from "../sidebar/managers/apiKeyManager";
import { HistoryEntry } from "../sidebar/common/sidebarTypes";
import {
	ERROR_OPERATION_CANCELLED,
	ERROR_QUOTA_EXCEEDED,
	generateContentStream,
} from "../ai/gemini";

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
		token?: vscode.CancellationToken
	): Promise<string> {
		await this.apiKeyManager.switchToNextApiKey();
		let currentApiKey = this.apiKeyManager.getActiveApiKey();
		const triedKeys = new Set<string>();
		const apiKeyList = this.apiKeyManager.getApiKeyList();
		const maxRetries = apiKeyList.length > 0 ? apiKeyList.length : 1;
		let attempts = 0;

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

		let result = "";

		while (attempts < maxRetries) {
			if (token?.isCancellationRequested) {
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
						? this.transformHistoryForGemini(history as HistoryEntry[]) // Cast as transformHistoryForGemini expects HistoryEntry[]
						: undefined;

				const stream = generateContentStream(
					currentApiKey,
					modelName,
					prompt,
					historyForGemini,
					generationConfig,
					token
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
				result = accumulatedResult;
				if (streamCallbacks?.onComplete) {
					streamCallbacks.onComplete();
				}
				return result; // Success
			} catch (error: unknown) {
				const err = error as Error;

				if (err.message === ERROR_QUOTA_EXCEEDED) {
					result = ERROR_QUOTA_EXCEEDED;
					console.warn(
						`[AIRequestService] Quota/Rate limit hit for key ...${currentApiKey?.slice(
							-4
						)}.`
					);
				} else if (err.message === ERROR_OPERATION_CANCELLED) {
					if (streamCallbacks?.onComplete) {
						streamCallbacks.onComplete();
					}
					throw err; // Re-throw cancellation error
				} else {
					result = `Error: ${err.message}`;
					console.error(
						`[AIRequestService] Error during generation on attempt ${attempts}:`,
						err
					);
				}
			}

			if (result === ERROR_QUOTA_EXCEEDED) {
				triedKeys.add(currentApiKey);
				const availableKeysCount = apiKeyList.length;

				if (availableKeysCount <= 1 || triedKeys.size >= availableKeysCount) {
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
				} else {
					return `API quota or rate limit exceeded for model ${modelName}. All available API keys have been tried.`;
				}
			} else {
				return result; // Return other errors immediately
			}
		}
		// Fallback if loop finishes
		return `API quota or rate limit exceeded for model ${modelName}. Failed after trying ${attempts} keys.`;
	}
}

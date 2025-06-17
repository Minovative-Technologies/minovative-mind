// src/sidebar/managers/apiKeyManager.ts
import * as vscode from "vscode";
import {
	GEMINI_API_KEYS_LIST_SECRET_KEY,
	GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
} from "../common/sidebarConstants";
import { ApiKeyInfo, KeyUpdateData } from "../common/sidebarTypes";
import { resetClient } from "../../ai/gemini"; // Adjusted path

export class ApiKeyManager {
	private _apiKeyList: string[] = [];
	private _activeKeyIndex: number = -1;

	constructor(
		private readonly secretStorage: vscode.SecretStorage,
		private readonly postMessageToWebview: (message: any) => void
	) {}

	public async initialize(): Promise<void> {
		await this.loadKeysFromStorage();
	}

	public getActiveApiKey(): string | undefined {
		if (
			this._activeKeyIndex >= 0 &&
			this._activeKeyIndex < this._apiKeyList.length
		) {
			return this._apiKeyList[this._activeKeyIndex];
		}
		return undefined;
	}

	public getApiKeyList(): readonly string[] {
		return this._apiKeyList;
	}

	public getActiveKeyIndex(): number {
		return this._activeKeyIndex;
	}

	public setActiveKeyIndex(index: number): void {
		this._activeKeyIndex = index;
		// Note: _saveKeysToStorage should be called after this if persistence is desired.
	}

	public async loadKeysFromStorage(): Promise<void> {
		try {
			const keysJson = await this.secretStorage.get(
				GEMINI_API_KEYS_LIST_SECRET_KEY
			);
			this._apiKeyList = keysJson ? JSON.parse(keysJson) : [];

			const activeIndexStr = await this.secretStorage.get(
				GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
			);
			let potentialIndex = activeIndexStr ? parseInt(activeIndexStr, 10) : -1;

			if (potentialIndex < 0 || potentialIndex >= this._apiKeyList.length) {
				potentialIndex = this._apiKeyList.length > 0 ? 0 : -1;
				const storedIndex = activeIndexStr ? parseInt(activeIndexStr, 10) : -2; // Use a different default if parsing fails
				if (potentialIndex !== storedIndex) {
					if (potentialIndex !== -1) {
						await this.secretStorage.store(
							GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
							String(potentialIndex)
						);
						console.log(`Corrected active key index to ${potentialIndex}`);
					} else {
						await this.secretStorage.delete(
							GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
						);
						console.log(
							`Cleared active index from storage as key list is empty.`
						);
					}
				}
			}
			this._activeKeyIndex = potentialIndex;

			console.log(
				`Loaded ${this._apiKeyList.length} keys. Active index: ${this._activeKeyIndex}`
			);
			resetClient(); // Assumes resetClient correctly uses the new active key logic
			this.updateWebviewKeyList();
		} catch (error) {
			console.error("Error loading API keys from storage:", error);
			this._apiKeyList = [];
			this._activeKeyIndex = -1;
			vscode.window.showErrorMessage("Failed to load API keys.");
			this.updateWebviewKeyList();
		}
	}

	public async saveKeysToStorage(): Promise<void> {
		let saveError: any = null;
		try {
			await this.secretStorage.store(
				GEMINI_API_KEYS_LIST_SECRET_KEY,
				JSON.stringify(this._apiKeyList)
			);
			if (this._activeKeyIndex !== -1) {
				await this.secretStorage.store(
					GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
					String(this._activeKeyIndex)
				);
			} else {
				await this.secretStorage.delete(GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY);
			}
			console.log(
				`Saved ${this._apiKeyList.length} keys. Active index: ${this._activeKeyIndex}`
			);
		} catch (error) {
			saveError = error;
			console.error("Error saving API keys to storage:", error);
		}

		resetClient();
		this.updateWebviewKeyList();

		if (saveError) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Error: Failed to save key changes.",
				isError: true,
			});
		}
	}

	public async addApiKey(key: string): Promise<void> {
		if (this._apiKeyList.includes(key)) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: `Info: Key ...${key.slice(-4)} is already stored.`,
			});
			return;
		}
		this._apiKeyList.push(key);
		this._activeKeyIndex = this._apiKeyList.length - 1;
		await this.saveKeysToStorage();
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ending in ...${key.slice(-4)} added and set as active.`,
		});
	}

	public async deleteActiveApiKey(): Promise<void> {
		if (
			this._activeKeyIndex === -1 ||
			this._activeKeyIndex >= this._apiKeyList.length
		) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value:
					this._apiKeyList.length === 0
						? "Error: Cannot delete, key list is empty."
						: "Error: No active key selected to delete.",
				isError: true,
			});
			return;
		}
		const keyToDelete = this._apiKeyList[this._activeKeyIndex];
		this._apiKeyList.splice(this._activeKeyIndex, 1);
		const oldIndex = this._activeKeyIndex;

		if (this._apiKeyList.length === 0) {
			this._activeKeyIndex = -1;
		} else if (this._activeKeyIndex >= this._apiKeyList.length) {
			// If last key was deleted
			this._activeKeyIndex = this._apiKeyList.length - 1; // Make new last key active
		}
		// If a key in the middle was deleted, the current index might still be valid if it pointed to a key after the deleted one,
		// or it might need adjustment if it was the one deleted. The current logic covers the deleted key being active.
		// If it was the last one, index becomes new last one. If list becomes empty, index becomes -1.
		// If a key *before* the active one was deleted, the active index remains correct.
		// The current logic focuses on the *active* key being deleted. If a non-active key deletion UI is added later, this might need adjustment.

		console.log(
			`Key deleted. Old index: ${oldIndex}, New active index: ${this._activeKeyIndex}`
		);
		await this.saveKeysToStorage();
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ...${keyToDelete.slice(-4)} deleted.`,
		});
	}

	public async switchToNextApiKey(
		triedKeys?: Set<string>
	): Promise<string | undefined> {
		let newKey: string | undefined = undefined;
		let foundNewKey: boolean = false;
		let switchReason: "retry" | "next request" = "next request"; // Default to proactive

		if (this._apiKeyList.length === 0) {
			console.log(`[ApiKeyManager] Not switching API key: list is empty.`);
			return undefined;
		}

		if (triedKeys instanceof Set) {
			// Scenario 1: Retry-based switching
			switchReason = "retry";
			// Determine the starting point for the search, wrapping around.
			// If _activeKeyIndex is -1, it means no key is active, so we start search from index 0.
			// Otherwise, we start from the next key after the current active one.
			const startIndex =
				(this._activeKeyIndex === -1 ? 0 : this._activeKeyIndex + 1) %
				this._apiKeyList.length;

			for (let i = 0; i < this._apiKeyList.length; i++) {
				const currentIndex = (startIndex + i) % this._apiKeyList.length;
				const candidateKey = this._apiKeyList[currentIndex];

				if (!triedKeys.has(candidateKey)) {
					this._activeKeyIndex = currentIndex;
					newKey = candidateKey;
					foundNewKey = true;
					console.log(
						`[ApiKeyManager] Switched to key ...${newKey.slice(
							-4
						)} for retry. (New Index: ${this._activeKeyIndex})`
					);
					break;
				}
			}

			if (!foundNewKey) {
				console.log(
					`[ApiKeyManager] No new API key found for retry after trying all available keys.`
				);
				return undefined;
			}
		} else {
			// Scenario 2: Proactive switching (original logic)
			if (this._apiKeyList.length <= 1) {
				const currentKey = this.getActiveApiKey();
				const reason =
					this._apiKeyList.length === 0
						? "list is empty"
						: "only one key exists";
				console.log(
					`[ApiKeyManager] Not proactively switching because API key ${reason}. Current active key: ${
						currentKey ? "..." + currentKey.slice(-4) : "None"
					}`
				);
				return currentKey; // Stay on current key or undefined if none
			}

			// If _activeKeyIndex is -1, this correctly sets it to 0.
			this._activeKeyIndex =
				(this._activeKeyIndex + 1) % this._apiKeyList.length;
			newKey = this._apiKeyList[this._activeKeyIndex];
			foundNewKey = true;
			console.log(
				`[ApiKeyManager] Proactively switched to key ...${newKey.slice(
					-4
				)} for the upcoming request. (New Index: ${this._activeKeyIndex})`
			);
		}

		// Common actions if a new key was found and set
		if (foundNewKey && newKey !== undefined) {
			await this.saveKeysToStorage(); // This calls resetClient() and updateWebviewKeyList()
			const message = `Switched to key ...${newKey.slice(
				-4
			)} for the ${switchReason}.`;
			this.postMessageToWebview({ type: "apiKeyStatus", value: message });
			return newKey;
		} else {
			// This path should ideally not be reached if foundNewKey logic is correct
			// as it would have returned undefined earlier if no key was found.
			return undefined;
		}
	}

	public async switchToPreviousApiKey(): Promise<void> {
		if (this._apiKeyList.length <= 1 || this._activeKeyIndex === -1) {
			return;
		}
		this._activeKeyIndex =
			(this._activeKeyIndex - 1 + this._apiKeyList.length) %
			this._apiKeyList.length;
		await this.saveKeysToStorage();
		const newKey = this._apiKeyList[this._activeKeyIndex];
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Switched to key ...${newKey.slice(-4)}.`,
		});
	}

	private updateWebviewKeyList(): void {
		const keyInfos: ApiKeyInfo[] = this._apiKeyList.map((key, index) => ({
			maskedKey: `Key ...${key.slice(-4)} (${index + 1}/${
				this._apiKeyList.length
			})`,
			index: index,
			isActive: index === this._activeKeyIndex,
		}));
		const updateData: KeyUpdateData = {
			keys: keyInfos,
			activeIndex: this._activeKeyIndex,
			totalKeys: this._apiKeyList.length,
		};
		this.postMessageToWebview({ type: "updateKeyList", value: updateData });
	}
}

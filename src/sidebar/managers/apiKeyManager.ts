import * as vscode from "vscode";
import { GEMINI_API_KEY_SECRET_KEY } from "../common/sidebarConstants";
import { ApiKeyInfo, KeyUpdateData } from "../common/sidebarTypes";
import { resetClient } from "../../ai/gemini"; // Adjusted path

export class ApiKeyManager {
	private _apiKey: string | undefined;

	constructor(
		private readonly secretStorage: vscode.SecretStorage,
		private readonly postMessageToWebview: (message: any) => void
	) {}

	public async initialize(): Promise<void> {
		await this.loadKeysFromStorage();
	}

	public getActiveApiKey(): string | undefined {
		return this._apiKey;
	}

	public async loadKeysFromStorage(): Promise<void> {
		try {
			this._apiKey = await this.secretStorage.get(GEMINI_API_KEY_SECRET_KEY);

			console.log(
				`Loaded API key. Key ${this._apiKey ? "exists" : "does not exist"}`
			);
			resetClient();
			this.updateWebviewKeyList();
		} catch (error) {
			console.error("Error loading API key from storage:", error);
			this._apiKey = undefined;
			vscode.window.showErrorMessage("Failed to load API key.");
			this.updateWebviewKeyList();
		}
	}

	public async saveKeysToStorage(): Promise<void> {
		let saveError: any = null;
		try {
			if (this._apiKey) {
				await this.secretStorage.store(GEMINI_API_KEY_SECRET_KEY, this._apiKey);
				console.log(`Saved API key ending in ...${this._apiKey.slice(-4)}`);
			} else {
				await this.secretStorage.delete(GEMINI_API_KEY_SECRET_KEY);
				console.log("Deleted API key from storage.");
			}
		} catch (error) {
			saveError = error;
			console.error("Error saving API key to storage:", error);
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
		if (this._apiKey === key) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: `Info: Key ...${key.slice(-4)} is already stored.`,
			});
			return;
		}
		this._apiKey = key;
		await this.saveKeysToStorage();
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `API Key ending in ...${key.slice(-4)} added.`,
		});
	}

	public async deleteActiveApiKey(): Promise<void> {
		if (!this._apiKey) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Error: No API Key available to delete.",
				isError: true,
			});
			return;
		}
		const keyToDelete = this._apiKey;
		this._apiKey = undefined;
		await this.saveKeysToStorage();
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `API Key ...${keyToDelete.slice(-4)} deleted.`,
		});
	}

	private updateWebviewKeyList(): void {
		let keyInfos: ApiKeyInfo[] = [];
		let activeIndex = -1;
		let totalKeys = 0;

		if (this._apiKey) {
			keyInfos = [
				{
					maskedKey: `Key ...${this._apiKey.slice(-4)}`,
					index: 0,
					isActive: true,
				},
			];
			activeIndex = 0;
			totalKeys = 1;
		}

		const updateData: KeyUpdateData = {
			keys: keyInfos,
			activeIndex: activeIndex,
			totalKeys: totalKeys,
		};
		this.postMessageToWebview({ type: "updateKeyList", value: updateData });
	}
}

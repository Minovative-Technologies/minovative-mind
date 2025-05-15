// src/sidebar/managers/settingsManager.ts
import * as vscode from "vscode";
import {
	MODEL_SELECTION_STORAGE_KEY,
	AVAILABLE_GEMINI_MODELS,
	DEFAULT_MODEL,
} from "../common/sidebarConstants";
import { resetClient } from "../../ai/gemini"; // Adjusted path

export class SettingsManager {
	private _selectedModelName: string = DEFAULT_MODEL;

	constructor(
		private readonly workspaceState: vscode.Memento,
		private readonly postMessageToWebview: (message: any) => void
	) {}

	public initialize(): void {
		this.loadSettingsFromStorage();
	}

	public getSelectedModelName(): string {
		return this._selectedModelName;
	}

	private loadSettingsFromStorage(): void {
		try {
			const savedModel = this.workspaceState.get<string>(
				MODEL_SELECTION_STORAGE_KEY
			);
			if (savedModel && AVAILABLE_GEMINI_MODELS.includes(savedModel)) {
				this._selectedModelName = savedModel;
				console.log("Loaded selected model:", this._selectedModelName);
			} else {
				this._selectedModelName = DEFAULT_MODEL;
				console.log(
					"No saved model or invalid model found. Using default:",
					DEFAULT_MODEL
				);
			}
		} catch (error) {
			console.error("Error loading settings from storage:", error);
			this._selectedModelName = DEFAULT_MODEL;
			vscode.window.showErrorMessage("Failed to load extension settings.");
		}
		// No need to call updateWebviewModelList here, SidebarProvider can do it after initialization.
	}

	public async saveSettingsToStorage(): Promise<void> {
		try {
			await this.workspaceState.update(
				MODEL_SELECTION_STORAGE_KEY,
				this._selectedModelName
			);
			console.log("Saved selected model:", this._selectedModelName);
			resetClient(); // Assuming resetClient may depend on model settings
		} catch (error) {
			console.error("Error saving settings to storage:", error);
			vscode.window.showErrorMessage("Failed to save extension settings.");
		}
		this.updateWebviewModelList();
	}

	public async handleModelSelection(modelName: string): Promise<void> {
		if (AVAILABLE_GEMINI_MODELS.includes(modelName)) {
			this._selectedModelName = modelName;
			await this.saveSettingsToStorage(); // This will also call updateWebviewModelList
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Switched to AI model: ${modelName}.`,
			});
		} else {
			console.warn("Attempted to select an invalid model:", modelName);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Error: Invalid model selected: ${modelName}.`,
				isError: true,
			});
			this.updateWebviewModelList(); // Ensure UI reflects current (unchanged) state
		}
	}

	public updateWebviewModelList(): void {
		this.postMessageToWebview({
			type: "updateModelList",
			value: {
				availableModels: AVAILABLE_GEMINI_MODELS,
				selectedModel: this._selectedModelName,
			},
		});
	}
}

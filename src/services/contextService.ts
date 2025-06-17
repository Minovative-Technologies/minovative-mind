// src/services/contextService.ts
import * as vscode from "vscode";
import * as path from "path";
import BPromise from "bluebird";
import { SettingsManager } from "../sidebar/managers/settingsManager";
import { ChatHistoryManager } from "../sidebar/managers/chatHistoryManager";
import { ProjectChangeLogger } from "../workflow/ProjectChangeLogger";
import { AIRequestService } from "./aiRequestService";
import { PlanGenerationContext } from "../sidebar/common/sidebarTypes";
import { scanWorkspace } from "../context/workspaceScanner";
import { buildDependencyGraph } from "../context/dependencyGraphBuilder";
import {
	selectRelevantFilesAI,
	SelectRelevantFilesAIOptions,
} from "../context/smartContextSelector";
import {
	buildContextString,
	DEFAULT_CONTEXT_CONFIG,
} from "../context/contextBuilder";
import * as SymbolService from "./symbolService";

export class ContextService {
	constructor(
		private settingsManager: SettingsManager,
		private chatHistoryManager: ChatHistoryManager,
		private changeLogger: ProjectChangeLogger,
		private aiRequestService: AIRequestService,
		private postMessageToWebview: (message: any) => void
	) {}

	public async buildProjectContext(
		cancellationToken: vscode.CancellationToken | undefined,
		userRequest?: string,
		editorContext?: PlanGenerationContext["editorContext"],
		diagnosticsString?: string
	): Promise<string> {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return "[No workspace open]";
			}
			const rootFolder = workspaceFolders[0];

			const allScannedFiles = await scanWorkspace({ respectGitIgnore: true });
			let fileDependencies: Map<string, string[]> | undefined;

			try {
				fileDependencies = await buildDependencyGraph(
					allScannedFiles,
					rootFolder.uri
				);
			} catch (depGraphError: any) {
				console.error(
					`[ContextService] Error building dependency graph: ${depGraphError.message}`
				);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: `Warning: Could not build dependency graph. Reason: ${depGraphError.message}`,
				});
			}

			if (allScannedFiles.length === 0) {
				return "[No relevant files found in workspace]";
			}

			let filesForContextBuilding = allScannedFiles;
			const currentQueryForSelection =
				userRequest || editorContext?.instruction;
			const smartContextEnabled = this.settingsManager.getSetting<boolean>(
				"smartContext.enabled",
				true
			);

			if (
				currentQueryForSelection &&
				smartContextEnabled &&
				!currentQueryForSelection.startsWith("/commit")
			) {
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Minovative Mind is identifying relevant files...",
				});
				try {
					const selectionOptions: SelectRelevantFilesAIOptions = {
						userRequest: currentQueryForSelection,
						chatHistory: this.chatHistoryManager.getChatHistory(),
						allScannedFiles,
						projectRoot: rootFolder.uri,
						activeEditorContext: editorContext,
						diagnostics: diagnosticsString,
						aiModelCall: this.aiRequestService.generateWithRetry.bind(
							this.aiRequestService
						),
						modelName: this.settingsManager.getSelectedModelName(),
						cancellationToken,
						fileDependencies,
					};
					const selectedFiles = await selectRelevantFilesAI(selectionOptions);

					if (selectedFiles.length > 0) {
						filesForContextBuilding = selectedFiles;
						this.postMessageToWebview({
							type: "statusUpdate",
							value: `Using ${selectedFiles.length} relevant file(s) for context.`,
						});
					} else {
						// Fallback logic
						filesForContextBuilding = editorContext?.documentUri
							? [editorContext.documentUri]
							: [];
						this.postMessageToWebview({
							type: "statusUpdate",
							value:
								filesForContextBuilding.length > 0
									? `Focusing context on the active file.`
									: `No specific files identified by AI.`,
						});
					}
				} catch (error: any) {
					console.error(
						`[ContextService] Error during smart file selection: ${error.message}`
					);
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Smart context selection failed. Using limited context.",
						isError: true,
					});
					filesForContextBuilding = allScannedFiles.slice(
						0,
						Math.min(allScannedFiles.length, 10)
					);
				}
			} else if (currentQueryForSelection?.startsWith("/commit")) {
				return "[Project context not applicable for git commit message generation]";
			}

			if (filesForContextBuilding.length === 0) {
				return "[No relevant files selected for context.]";
			}

			const documentSymbolsMap = new Map<
				string,
				vscode.DocumentSymbol[] | undefined
			>();
			await BPromise.map(
				filesForContextBuilding,
				async (fileUri: vscode.Uri) => {
					if (cancellationToken?.isCancellationRequested) {
						return;
					}
					try {
						const symbols = await SymbolService.getSymbolsInDocument(fileUri);
						const relativePath = path
							.relative(rootFolder.uri.fsPath, fileUri.fsPath)
							.replace(/\\/g, "/");
						documentSymbolsMap.set(relativePath, symbols);
					} catch (symbolError: any) {
						console.warn(
							`[ContextService] Failed to get symbols for ${fileUri.fsPath}: ${symbolError.message}`
						);
					}
				},
				{ concurrency: 5 }
			);

			return await buildContextString(
				filesForContextBuilding,
				rootFolder.uri,
				DEFAULT_CONTEXT_CONFIG,
				this.changeLogger.getChangeLog(),
				fileDependencies,
				documentSymbolsMap
			);
		} catch (error: any) {
			console.error(`[ContextService] Error building project context:`, error);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Error building project context: ${error.message}`,
				isError: true,
			});
			return `[Error building project context: ${error.message}]`;
		}
	}
}

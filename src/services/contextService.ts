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
import { DiagnosticService } from "../utils/diagnosticUtils"; // Import DiagnosticService

// Constants for symbol processing
const MAX_SYMBOL_HIERARCHY_DEPTH_CONSTANT = 6; // Example depth for symbol hierarchy serialization
const MAX_REFERENCED_TYPE_CONTENT_CHARS_CONSTANT = 5000; // Truncation limit for referenced type content preview

// 1. Define the ActiveSymbolDetailedInfo interface
export interface ActiveSymbolDetailedInfo {
	name?: string;
	kind?: string;
	detail?: string; // Added optional detail property
	fullRange?: vscode.Range; // NEW
	definition?: vscode.Location | vscode.Location[];
	implementations?: vscode.Location[];
	typeDefinition?: vscode.Location | vscode.Location[];
	incomingCalls?: vscode.CallHierarchyIncomingCall[];
	outgoingCalls?: vscode.CallHierarchyOutgoingCall[];
	childrenHierarchy?: any; // NEW (e.g., a serialized tree structure of children)
	referencedTypeDefinitions?: { filePath: string; content: string }[]; // NEW
}

// Define a new interface 'BuildProjectContextResult'
export interface BuildProjectContextResult {
	contextString: string;
	relevantFiles: string[];
}

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
		initialDiagnosticsString?: string // Renamed parameter for clarity
	): Promise<BuildProjectContextResult> {
		try {
			// 2a. Initialize activeSymbolDetailedInfo
			let activeSymbolDetailedInfo: ActiveSymbolDetailedInfo | undefined;

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return { contextString: "[No workspace open]", relevantFiles: [] };
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

			// --- Determine effective diagnostics string ---
			let effectiveDiagnosticsString: string | undefined =
				initialDiagnosticsString;

			if (editorContext?.documentUri) {
				// If there's an active editor, always fetch and filter live diagnostics
				const diagnosticsForActiveFile =
					await DiagnosticService.formatContextualDiagnostics(
						editorContext.documentUri,
						rootFolder.uri, // Pass workspace root for relative path formatting
						editorContext.selection, // Pass selection if available
						undefined, // maxTotalChars (use default)
						undefined, // maxPerSeverity (use default)
						cancellationToken // Pass cancellation token
					);
				if (diagnosticsForActiveFile) {
					effectiveDiagnosticsString = diagnosticsForActiveFile;
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Minovative Mind applied diagnostic filtering.",
					});
				} else if (initialDiagnosticsString) {
					// If no relevant live diagnostics but an initial string was provided, use it
					effectiveDiagnosticsString = initialDiagnosticsString;
				} else {
					effectiveDiagnosticsString = undefined;
				}
			}
			// --- End Determine effective diagnostics string ---

			// 2b. Add new conditional block for activeSymbolDetailedInfo
			// This block is added after fileDependencies is built.
			if (editorContext?.documentUri && editorContext?.selection) {
				const activeFileUri = editorContext.documentUri;
				try {
					// 2b.iii. Call SymbolService.getSymbolsInDocument
					const activeDocumentSymbols =
						await SymbolService.getSymbolsInDocument(
							activeFileUri,
							cancellationToken
						);

					if (activeDocumentSymbols && activeDocumentSymbols.length > 0) {
						// 2b.iv. Iterate through DocumentSymbols to find symbolAtCursor
						const symbolAtCursor = activeDocumentSymbols.find((s) =>
							s.range.contains(editorContext.selection!.start)
						);

						if (symbolAtCursor) {
							// 2b.v. Populate activeSymbolDetailedInfo.name and activeSymbolDetailedInfo.kind
							activeSymbolDetailedInfo = {
								name: symbolAtCursor.name,
								kind: vscode.SymbolKind[symbolAtCursor.kind], // Convert enum to string
								fullRange: symbolAtCursor.range, // Modification 1
							};

							// Assign symbolAtCursor.detail if it exists
							if (symbolAtCursor.detail) {
								activeSymbolDetailedInfo.detail = symbolAtCursor.detail;
							}

							// Modification 2: Populate childrenHierarchy if symbol has children
							const relativePathOfTheActiveFile = path
								.relative(rootFolder.uri.fsPath, activeFileUri.fsPath)
								.replace(/\\/g, "/");
							if (
								symbolAtCursor.children &&
								symbolAtCursor.children.length > 0
							) {
								activeSymbolDetailedInfo.childrenHierarchy =
									SymbolService.serializeDocumentSymbolHierarchy(
										symbolAtCursor,
										relativePathOfTheActiveFile,
										0, // initial depth
										MAX_SYMBOL_HIERARCHY_DEPTH_CONSTANT
									);
							}

							// 2b.vi. Asynchronously call SymbolService functions, wrapping each in a try-catch
							await Promise.allSettled([
								(async () => {
									try {
										activeSymbolDetailedInfo!.definition =
											await SymbolService.getDefinition(
												activeFileUri,
												symbolAtCursor.selectionRange.start,
												cancellationToken
											);
									} catch (e: any) {
										console.warn(
											`[ContextService] Failed to get definition for ${symbolAtCursor.name}: ${e.message}`
										);
									}
								})(),
								(async () => {
									try {
										activeSymbolDetailedInfo!.implementations =
											await SymbolService.getImplementations(
												activeFileUri,
												symbolAtCursor.selectionRange.start,
												cancellationToken
											);
									} catch (e: any) {
										console.warn(
											`[ContextService] Failed to get implementations for ${symbolAtCursor.name}: ${e.message}`
										);
									}
								})(),
								(async () => {
									try {
										activeSymbolDetailedInfo!.typeDefinition =
											await SymbolService.getTypeDefinition(
												activeFileUri,
												symbolAtCursor.selectionRange.start,
												cancellationToken
											);
									} catch (e: any) {
										console.warn(
											`[ContextService] Failed to get type definition for ${symbolAtCursor.name}: ${e.message}`
										);
									}
								})(),
								// Modification 3: Add logic for referenced type definitions
								(async () => {
									try {
										if (activeSymbolDetailedInfo!.typeDefinition) {
											const locations = Array.isArray(
												activeSymbolDetailedInfo!.typeDefinition
											)
												? activeSymbolDetailedInfo!.typeDefinition
												: [activeSymbolDetailedInfo!.typeDefinition];

											const referencedTypeContents: {
												filePath: string;
												content: string;
											}[] = [];
											const processedFilePaths = new Set<string>(); // To ensure uniqueness of files

											await BPromise.map(
												locations,
												async (location: vscode.Location) => {
													if (cancellationToken?.isCancellationRequested) {
														return;
													}
													const relativeFilePath = path
														.relative(
															rootFolder.uri.fsPath,
															location.uri.fsPath
														)
														.replace(/\\/g, "/");

													// Only process each unique file path once
													if (processedFilePaths.has(relativeFilePath)) {
														return;
													}
													processedFilePaths.add(relativeFilePath);

													const content =
														await SymbolService.getDocumentContentAtLocation(
															location,
															cancellationToken
														);
													if (content) {
														let truncatedContent = content;
														if (
															truncatedContent.length >
															MAX_REFERENCED_TYPE_CONTENT_CHARS_CONSTANT
														) {
															truncatedContent =
																truncatedContent.substring(
																	0,
																	MAX_REFERENCED_TYPE_CONTENT_CHARS_CONSTANT
																) + "\n... (content truncated)";
														}
														referencedTypeContents.push({
															filePath: relativeFilePath,
															content: truncatedContent,
														});
													}
												},
												{ concurrency: 5 } // Limit concurrent file reads
											);
											activeSymbolDetailedInfo!.referencedTypeDefinitions =
												referencedTypeContents;
										}
									} catch (e: any) {
										console.warn(
											`[ContextService] Failed to get referenced type definitions for ${symbolAtCursor.name}: ${e.message}`
										);
									}
								})(),
								(async () => {
									try {
										const callHierarchyItems =
											await SymbolService.prepareCallHierarchy(
												activeFileUri,
												symbolAtCursor.selectionRange.start,
												cancellationToken
											);
										if (callHierarchyItems && callHierarchyItems.length > 0) {
											// Select a primary item (e.g., matching name or the first)
											const primaryCallHierarchyItem =
												callHierarchyItems.find(
													(item) => item.name === symbolAtCursor.name
												) || callHierarchyItems[0];

											if (primaryCallHierarchyItem) {
												activeSymbolDetailedInfo!.incomingCalls =
													await SymbolService.resolveIncomingCalls(
														primaryCallHierarchyItem,
														cancellationToken
													);
												activeSymbolDetailedInfo!.outgoingCalls =
													await SymbolService.resolveOutgoingCalls(
														primaryCallHierarchyItem,
														cancellationToken
													);
											}
										}
									} catch (e: any) {
										console.warn(
											`[ContextService] Failed to get call hierarchy for ${symbolAtCursor.name}: ${e.message}`
										);
									}
								})(),
							]);
						}
					}
				} catch (e: any) {
					console.error(
						`[ContextService] Error getting detailed symbol info: ${e.message}`
					);
				}
			}

			if (allScannedFiles.length === 0) {
				return {
					contextString: "[No relevant files found in workspace]",
					relevantFiles: [],
				};
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
						diagnostics: effectiveDiagnosticsString, // UPDATED: Use effectiveDiagnosticsString
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
				return {
					contextString:
						"[Project context not applicable for git commit message generation]",
					relevantFiles: [],
				};
			}

			if (filesForContextBuilding.length === 0) {
				return {
					contextString: "[No relevant files selected for context.]",
					relevantFiles: [],
				};
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

			// Convert filesForContextBuilding (vscode.Uri[]) to relative string paths
			const relativeFilesForContextBuilding: string[] =
				filesForContextBuilding.map((uri: vscode.Uri) =>
					path.relative(rootFolder.uri.fsPath, uri.fsPath).replace(/\\/g, "/")
				);

			// 3. Update the final call to buildContextString to pass activeSymbolDetailedInfo
			const contextString = await buildContextString(
				filesForContextBuilding, // Still pass URIs to buildContextString for content reading
				rootFolder.uri,
				DEFAULT_CONTEXT_CONFIG,
				this.changeLogger.getChangeLog(),
				fileDependencies,
				documentSymbolsMap,
				activeSymbolDetailedInfo // Pass the new argument
			);

			// Return the new object structure
			return {
				contextString: contextString,
				relevantFiles: relativeFilesForContextBuilding,
			};
		} catch (error: any) {
			console.error(`[ContextService] Error building project context:`, error);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Error building project context: ${error.message}`,
				isError: true,
			});
			return {
				contextString: `[Error building project context: ${error.message}]`,
				relevantFiles: [],
			};
		}
	}
}

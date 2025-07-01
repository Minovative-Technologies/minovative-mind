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
import {
	buildDependencyGraph,
	buildReverseDependencyGraph,
} from "../context/dependencyGraphBuilder";
import { getHeuristicRelevantFiles } from "../context/heuristicContextSelector"; // NEW: Import heuristic selector
import {
	selectRelevantFilesAI,
	SelectRelevantFilesAIOptions,
	MAX_FILE_SUMMARY_LENGTH_FOR_AI_SELECTION, // NEW: Import for summary length
} from "../context/smartContextSelector";
import {
	buildContextString,
	DEFAULT_CONTEXT_CONFIG,
} from "../context/contextBuilder";
import * as SymbolService from "./symbolService";
import { DiagnosticService } from "../utils/diagnosticUtils";
import { intelligentlySummarizeFileContent } from "../context/fileContentProcessor"; // NEW: Import for file content summarization

// Constants for symbol processing
const MAX_SYMBOL_HIERARCHY_DEPTH_CONSTANT = 6; // Example depth for symbol hierarchy serialization
const MAX_REFERENCED_TYPE_CONTENT_CHARS_CONSTANT = 5000; // Truncation limit for referenced type content preview

// 1. Define the ActiveSymbolDetailedInfo interface
export interface ActiveSymbolDetailedInfo {
	name?: string;
	kind?: string;
	detail?: string; // Added optional detail property
	fullRange?: vscode.Range;
	filePath?: string; // New: relative path of the file where the symbol is defined
	definition?: vscode.Location | vscode.Location[];
	implementations?: vscode.Location[];
	typeDefinition?: vscode.Location | vscode.Location[];
	incomingCalls?: vscode.CallHierarchyIncomingCall[];
	outgoingCalls?: vscode.CallHierarchyOutgoingCall[];
	childrenHierarchy?: any; // (e.g., a serialized tree structure of children)
	referencedTypeDefinitions?: { filePath: string; content: string }[]; //
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
			if (cancellationToken?.isCancellationRequested) {
				throw new Error("Operation cancelled by user.");
			}
			// 2a. Initialize activeSymbolDetailedInfo
			let activeSymbolDetailedInfo: ActiveSymbolDetailedInfo | undefined;

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return { contextString: "[No workspace open]", relevantFiles: [] };
			}
			const rootFolder = workspaceFolders[0];

			const allScannedFiles = await scanWorkspace({ respectGitIgnore: true });
			let fileDependencies: Map<string, string[]> | undefined;
			let reverseFileDependencies: Map<string, string[]> | undefined; // NEW variable

			try {
				fileDependencies = await buildDependencyGraph(
					allScannedFiles,
					rootFolder.uri
				);
				// NEW: Build reverse dependency graph if fileDependencies was successfully created
				if (fileDependencies) {
					reverseFileDependencies =
						buildReverseDependencyGraph(fileDependencies);
				}
			} catch (depGraphError: any) {
				console.error(
					`[ContextService] Error building dependency graph: ${depGraphError.message}`
				);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: `Warning: Could not build dependency graph. Reason: ${depGraphError.message}`,
				});
				// fileDependencies and reverseFileDependencies will remain undefined if error occurs
			}
			if (cancellationToken?.isCancellationRequested) {
				throw new Error("Operation cancelled by user.");
			}

			// Moved: Populate documentSymbolsMap for all scanned files upfront
			const documentSymbolsMap = new Map<
				string,
				vscode.DocumentSymbol[] | undefined
			>();
			await BPromise.map(
				allScannedFiles, // Modified to allScannedFiles
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
							// Calculate relative path for the active file
							const relativePathOfTheActiveFile = path
								.relative(rootFolder.uri.fsPath, activeFileUri.fsPath)
								.replace(/\\/g, "/");

							// 2b.v. Populate activeSymbolDetailedInfo.name, activeSymbolDetailedInfo.kind, fullRange, and filePath
							activeSymbolDetailedInfo = {
								name: symbolAtCursor.name,
								kind: vscode.SymbolKind[symbolAtCursor.kind], // Convert enum to string
								fullRange: symbolAtCursor.range,
								filePath: relativePathOfTheActiveFile, // Add the filePath property here
							};

							// Assign symbolAtCursor.detail if it exists
							if (symbolAtCursor.detail) {
								activeSymbolDetailedInfo.detail = symbolAtCursor.detail;
							}

							// Modification 2: Populate childrenHierarchy if symbol has children
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
			let heuristicSelectedFiles: vscode.Uri[] = []; // NEW: Declare heuristicSelectedFiles

			// NEW: Populate heuristicSelectedFiles by awaiting a call to getHeuristicRelevantFiles
			try {
				heuristicSelectedFiles = await getHeuristicRelevantFiles(
					allScannedFiles,
					rootFolder.uri,
					editorContext,
					fileDependencies,
					reverseFileDependencies, // NEW: Pass reverseFileDependencies
					activeSymbolDetailedInfo, // NEW: Pass activeSymbolDetailedInfo
					cancellationToken
				);
				if (heuristicSelectedFiles.length > 0) {
					this.postMessageToWebview({
						type: "statusUpdate",
						value: `Identified ${heuristicSelectedFiles.length} heuristically relevant file(s).`,
					});
				}
			} catch (heuristicError: any) {
				console.error(
					`[ContextService] Error during heuristic file selection: ${heuristicError.message}`
				);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: `Warning: Heuristic file selection failed. Reason: ${heuristicError.message}`,
					isError: true,
				});
				// Continue without heuristic files if an error occurs
				heuristicSelectedFiles = [];
			}

			// NEW: Summary generation logic
			const MAX_FILES_TO_SUMMARIZE_ALL_FOR_SELECTION_PROMPT = 100; // User-defined threshold

			let filesToSummarizeForSelectionPrompt: vscode.Uri[];
			if (
				allScannedFiles.length <=
				MAX_FILES_TO_SUMMARIZE_ALL_FOR_SELECTION_PROMPT
			) {
				this.postMessageToWebview({
					type: "statusUpdate",
					value: `Summarizing all ${allScannedFiles.length} files for AI selection prompt...`,
				});
				filesToSummarizeForSelectionPrompt = Array.from(allScannedFiles);
			} else {
				this.postMessageToWebview({
					type: "statusUpdate",
					value: `Summarizing ${heuristicSelectedFiles.length} heuristically relevant files for AI selection prompt...`,
				});
				filesToSummarizeForSelectionPrompt = Array.from(heuristicSelectedFiles);
			}

			const fileSummariesForAI = new Map<string, string>();
			const summaryGenerationPromises = filesToSummarizeForSelectionPrompt.map(
				async (fileUri) => {
					if (cancellationToken?.isCancellationRequested) {
						return;
					}
					const relativePath = path
						.relative(rootFolder.uri.fsPath, fileUri.fsPath)
						.replace(/\\/g, "/");
					try {
						const contentBytes = await vscode.workspace.fs.readFile(fileUri);
						const fileContentRaw = Buffer.from(contentBytes).toString("utf-8");
						const symbolsForFile = documentSymbolsMap.get(relativePath);

						const summary = intelligentlySummarizeFileContent(
							fileContentRaw,
							symbolsForFile,
							undefined,
							MAX_FILE_SUMMARY_LENGTH_FOR_AI_SELECTION
						);
						fileSummariesForAI.set(relativePath, summary);
					} catch (error: any) {
						console.warn(
							`[ContextService] Could not generate summary for ${relativePath}: ${error.message}`
						);
					}
				}
			);
			await BPromise.allSettled(summaryGenerationPromises);

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
					value: "Minovative Mind is identifying relevant files using AI...", // Updated message
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
						preSelectedHeuristicFiles: heuristicSelectedFiles, // NEW: Pass heuristicSelectedFiles
						fileSummaries: fileSummariesForAI, // NEW: Pass the generated file summaries
					};
					const selectedFiles = await selectRelevantFilesAI(selectionOptions);

					if (selectedFiles.length > 0) {
						filesForContextBuilding = selectedFiles;
						this.postMessageToWebview({
							type: "statusUpdate",
							value: `Using ${selectedFiles.length} relevant file(s) for context (hybrid selection).`, // Updated message
						});
					} else {
						// Fallback logic: if AI returns no *additional* files, or its selection was empty/invalid,
						// fall back to the heuristically selected files.
						filesForContextBuilding = heuristicSelectedFiles;
						this.postMessageToWebview({
							type: "statusUpdate",
							value:
								filesForContextBuilding.length > 0
									? `AI identified no additional files. Using ${filesForContextBuilding.length} heuristically relevant file(s).` // Updated message
									: `AI identified no specific files. No heuristically relevant files found either.`, // Updated message
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
					// On AI error, first fallback to heuristic files
					filesForContextBuilding = heuristicSelectedFiles;
					if (
						filesForContextBuilding.length === 0 &&
						editorContext?.documentUri
					) {
						// If no heuristics either, fall back to just the active file
						filesForContextBuilding = [editorContext.documentUri];
					}
					if (filesForContextBuilding.length === 0) {
						// As a last resort, if nothing else, take a small subset of all scanned files
						filesForContextBuilding = allScannedFiles.slice(
							0,
							Math.min(allScannedFiles.length, 10)
						);
					}
					this.postMessageToWebview({
						type: "statusUpdate",
						value: `Smart context selection failed. Falling back to ${filesForContextBuilding.length} file(s).`,
						isError: true,
					});
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

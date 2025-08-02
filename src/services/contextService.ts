import * as vscode from "vscode";
import * as path from "path";
import BPromise from "bluebird";
import { GenerationConfig } from "@google/generative-ai";
import { SettingsManager } from "../sidebar/managers/settingsManager";
import { ChatHistoryManager } from "../sidebar/managers/chatHistoryManager";
import { ProjectChangeLogger } from "../workflow/ProjectChangeLogger";
import { AIRequestService } from "./aiRequestService";
import {
	PlanGenerationContext,
	HistoryEntryPart,
	HistoryEntry,
} from "../sidebar/common/sidebarTypes";
import { scanWorkspace } from "../context/workspaceScanner";
import {
	buildDependencyGraph,
	buildReverseDependencyGraph,
} from "../context/dependencyGraphBuilder";
import {
	getHeuristicRelevantFiles,
	HeuristicSelectionOptions,
} from "../context/heuristicContextSelector"; // Import heuristic selector
import {
	selectRelevantFilesAI,
	SelectRelevantFilesAIOptions,
	MAX_FILE_SUMMARY_LENGTH_FOR_AI_SELECTION, // Import for summary length
} from "../context/smartContextSelector";
import {
	buildContextString,
	DEFAULT_CONTEXT_CONFIG,
} from "../context/contextBuilder";
import * as SymbolService from "./symbolService";
import { DiagnosticService } from "../utils/diagnosticUtils";
import { intelligentlySummarizeFileContent } from "../context/fileContentProcessor"; // Import for file content summarization
import { SequentialContextService } from "./sequentialContextService"; // Import sequential context service
import {
	detectProjectType,
	formatProjectProfileForPrompt,
} from "./projectTypeDetector"; // Import project type detection and formatting
import {
	DEFAULT_FLASH_LITE_MODEL,
	DEFAULT_MODEL,
} from "../sidebar/common/sidebarConstants";

// Constants for symbol processing
const MAX_SYMBOL_HIERARCHY_DEPTH_CONSTANT = 6; // Example depth for symbol hierarchy serialization
export const MAX_REFERENCED_TYPE_CONTENT_CHARS_CONSTANT = 5000;

// Performance monitoring constants
const PERFORMANCE_THRESHOLDS = {
	SCAN_TIME_WARNING: 15000, // 5 seconds
	DEPENDENCY_BUILD_TIME_WARNING: 10000, // 10 seconds
	CONTEXT_BUILD_TIME_WARNING: 15000, // 15 seconds
	MAX_FILES_FOR_DETAILED_PROCESSING: 2000,
	MAX_FILES_FOR_SYMBOL_PROCESSING: 500,
};

// Configuration interface for context building
interface ContextBuildOptions {
	useScanCache?: boolean;
	useDependencyCache?: boolean;
	useAISelectionCache?: boolean;
	maxConcurrency?: number;
	enablePerformanceMonitoring?: boolean;
	skipLargeFiles?: boolean;
	maxFileSize?: number;
}

export interface ActiveSymbolDetailedInfo {
	name?: string;
	kind?: string;
	detail?: string;
	fullRange?: vscode.Range;
	filePath?: string;
	childrenHierarchy?: string;
	definition?: vscode.Location | vscode.Location[];
	implementations?: vscode.Location[];
	typeDefinition?: vscode.Location | vscode.Location[];
	referencedTypeDefinitions?: Map<string, string[]>;
	incomingCalls?: vscode.CallHierarchyIncomingCall[];
	outgoingCalls?: vscode.CallHierarchyOutgoingCall[];
}

export interface BuildProjectContextResult {
	contextString: string;
	relevantFiles: string[];
	performanceMetrics?: {
		scanTime: number;
		dependencyBuildTime: number;
		contextBuildTime: number;
		totalTime: number;
		fileCount: number;
		processedFileCount: number;
	};
	activeSymbolDetailedInfo?: ActiveSymbolDetailedInfo;
}

export class ContextService {
	private settingsManager: SettingsManager;
	private chatHistoryManager: ChatHistoryManager;
	private changeLogger: ProjectChangeLogger;
	private aiRequestService: AIRequestService;
	private postMessageToWebview: (message: any) => void;
	private sequentialContextService?: SequentialContextService;

	constructor(
		settingsManager: SettingsManager,
		chatHistoryManager: ChatHistoryManager,
		changeLogger: ProjectChangeLogger,
		aiRequestService: AIRequestService,
		postMessageToWebview: (message: any) => void
	) {
		this.settingsManager = settingsManager;
		this.chatHistoryManager = chatHistoryManager;
		this.changeLogger = changeLogger;
		this.aiRequestService = aiRequestService;
		this.postMessageToWebview = postMessageToWebview;
	}

	/**
	 * Initialize sequential context service if not already initialized
	 */
	private initializeSequentialContextService(): SequentialContextService {
		if (!this.sequentialContextService) {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				throw new Error("No workspace folder open");
			}
			const workspaceRoot = workspaceFolders[0].uri;
			this.sequentialContextService = new SequentialContextService(
				this.aiRequestService,
				workspaceRoot,
				this.postMessageToWebview,
				this.settingsManager
			);
		}
		return this.sequentialContextService;
	}

	public async buildProjectContext(
		cancellationToken: vscode.CancellationToken | undefined,
		userRequest?: string,
		editorContext?: PlanGenerationContext["editorContext"],
		initialDiagnosticsString?: string, // Renamed parameter for clarity
		options?: ContextBuildOptions, // Options parameter
		includePersona: boolean = true, // New optional parameter with default true
		includeVerboseHeaders: boolean = true // ADDED: New optional parameter with default true
	): Promise<BuildProjectContextResult> {
		const startTime = Date.now();
		const enablePerformanceMonitoring =
			options?.enablePerformanceMonitoring ?? true;

		try {
			// Get workspace root with better error handling
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return {
					contextString: "[No workspace folder open]",
					relevantFiles: [],
				};
			}
			const rootFolder = workspaceFolders[0];

			// Optimized workspace scanning with performance monitoring
			const scanStartTime = Date.now();
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Scanning workspace for relevant files",
				showLoadingDots: true, // ADDED
			});

			const allScannedFiles = await scanWorkspace({
				useCache: options?.useScanCache ?? true,
				maxConcurrentReads: options?.maxConcurrency ?? 15,
				maxFileSize: options?.maxFileSize ?? 1024 * 1024 * 1, // 1MB
				cacheTimeout: 5 * 60 * 1000, // 5 minutes
			});

			// Detect project type after scanning
			const detectedProjectProfile = await detectProjectType(
				rootFolder.uri,
				allScannedFiles,
				{ useCache: options?.useScanCache ?? true }
			);

			const scanTime = Date.now() - scanStartTime;
			if (
				enablePerformanceMonitoring &&
				scanTime > PERFORMANCE_THRESHOLDS.SCAN_TIME_WARNING
			) {
				console.warn(
					`[ContextService] Workspace scan took ${scanTime}ms (threshold: ${PERFORMANCE_THRESHOLDS.SCAN_TIME_WARNING}ms)`
				);
			}

			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Found ${allScannedFiles.length} relevant files in ${scanTime}ms.`,
			});

			if (allScannedFiles.length === 0) {
				return {
					contextString: "[No relevant files found in workspace]",
					relevantFiles: [],
					performanceMetrics: {
						scanTime,
						dependencyBuildTime: 0,
						contextBuildTime: 0,
						totalTime: Date.now() - startTime,
						fileCount: 0,
						processedFileCount: 0,
					},
				};
			}

			// Optimized dependency graph building
			const dependencyStartTime = Date.now();
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Analyzing file dependencies",
				showLoadingDots: true, // ADDED
			});

			const fileDependencies = await buildDependencyGraph(
				allScannedFiles,
				rootFolder.uri,
				{
					useCache: options?.useDependencyCache ?? true,
					maxConcurrency: options?.maxConcurrency ?? 15,
					skipLargeFiles: options?.skipLargeFiles ?? true,
					maxFileSizeForParsing: options?.maxFileSize ?? 1024 * 1024 * 1, // 1MB
					retryFailedFiles: true,
					maxRetries: 3,
				}
			);

			const dependencyBuildTime = Date.now() - dependencyStartTime;
			if (
				enablePerformanceMonitoring &&
				dependencyBuildTime >
					PERFORMANCE_THRESHOLDS.DEPENDENCY_BUILD_TIME_WARNING
			) {
				console.warn(
					`[ContextService] Dependency graph build took ${dependencyBuildTime}ms (threshold: ${PERFORMANCE_THRESHOLDS.DEPENDENCY_BUILD_TIME_WARNING}ms)`
				);
			}

			const reverseFileDependencies = buildReverseDependencyGraph(
				fileDependencies,
				rootFolder.uri
			);

			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Analyzed ${fileDependencies.size} file dependencies in ${dependencyBuildTime}ms.`,
			});

			// Optimized symbol processing with limits
			const documentSymbolsMap = new Map<string, vscode.DocumentSymbol[]>();
			const maxFilesForSymbolProcessing = Math.min(
				allScannedFiles.length,
				PERFORMANCE_THRESHOLDS.MAX_FILES_FOR_SYMBOL_PROCESSING
			);

			// Process symbols only for files that are likely to be relevant
			const filesForSymbolProcessing = allScannedFiles.slice(
				0,
				maxFilesForSymbolProcessing
			);

			await BPromise.map(
				filesForSymbolProcessing,
				async (fileUri: vscode.Uri) => {
					if (cancellationToken?.isCancellationRequested) {
						return;
					}
					try {
						const symbols = await SymbolService.getSymbolsInDocument(fileUri);
						const relativePath = path
							.relative(rootFolder.uri.fsPath, fileUri.fsPath)
							.replace(/\\/g, "/");
						documentSymbolsMap.set(relativePath, symbols || []);
					} catch (symbolError: any) {
						console.warn(
							`[ContextService] Failed to get symbols for ${fileUri.fsPath}: ${symbolError.message}`
						);
					}
				},
				{ concurrency: options?.maxConcurrency ?? 5 }
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
			let activeSymbolDetailedInfo: ActiveSymbolDetailedInfo | undefined;
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
							// 2b.v. Initialize activeSymbolDetailedInfo
							activeSymbolDetailedInfo = {
								referencedTypeDefinitions: new Map<string, string[]>(),
							};

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
								(async () => {
									try {
										// Get referenced type definitions
										const referencedTypeContents = new Map<string, string[]>();
										const referencedTypeDefinitions =
											await SymbolService.getTypeDefinition(
												activeFileUri,
												symbolAtCursor.selectionRange.start,
												cancellationToken
											);

										if (referencedTypeDefinitions) {
											const typeDefs = Array.isArray(referencedTypeDefinitions)
												? referencedTypeDefinitions
												: [referencedTypeDefinitions];

											await BPromise.map(
												typeDefs,
												async (typeDef) => {
													try {
														const content =
															await SymbolService.getDocumentContentAtLocation(
																typeDef,
																cancellationToken
															);
														if (content) {
															const relativePath = path
																.relative(
																	rootFolder.uri.fsPath,
																	typeDef.uri.fsPath
																)
																.replace(/\\/g, "/");
															referencedTypeContents.set(relativePath, [
																content.substring(
																	0,
																	MAX_REFERENCED_TYPE_CONTENT_CHARS_CONSTANT
																),
															]);
														}
													} catch (e: any) {
														console.warn(
															`[ContextService] Failed to get content for referenced type definition: ${e.message}`
														);
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

			let filesForContextBuilding = allScannedFiles;
			let heuristicSelectedFiles: vscode.Uri[] = []; // Declare heuristicSelectedFiles

			// Populate heuristicSelectedFiles by awaiting a call to getHeuristicRelevantFiles
			try {
				// Retrieve optimization settings
				const optimizationSettings =
					this.settingsManager.getOptimizationSettings();
				// Create a heuristicOptions object populated with these settings
				const heuristicOptions: HeuristicSelectionOptions =
					optimizationSettings;

				heuristicSelectedFiles = await getHeuristicRelevantFiles(
					allScannedFiles,
					rootFolder.uri,
					editorContext,
					fileDependencies,
					reverseFileDependencies, // Pass reverseFileDependencies
					activeSymbolDetailedInfo, // Pass activeSymbolDetailedInfo
					cancellationToken,
					heuristicOptions // Pass heuristicOptions as the last argument
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

			// Summary generation logic with optimization
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
				async (fileUri: vscode.Uri) => {
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
					value: "Identifying relevant files", // Updated message
					showLoadingDots: true, // ADDED
				});
				try {
					const selectionOptions: SelectRelevantFilesAIOptions = {
						userRequest: currentQueryForSelection,
						chatHistory: this.chatHistoryManager.getChatHistory(),
						allScannedFiles,
						projectRoot: rootFolder.uri,
						activeEditorContext: editorContext,
						diagnostics: effectiveDiagnosticsString, // UPDATED: Use effectiveDiagnosticsString
						activeEditorSymbols: editorContext?.documentUri
							? documentSymbolsMap.get(
									path
										.relative(
											rootFolder.uri.fsPath,
											editorContext.documentUri.fsPath
										)
										.replace(/\\/g, "/")
							  )
							: undefined,
						// Modified to adapt prompt from string to HistoryEntryPart[]
						aiModelCall: async (
							prompt: string,
							modelName: string,
							history: HistoryEntry[] | undefined,
							requestType: string,
							generationConfig: GenerationConfig | undefined,
							streamCallbacks:
								| {
										onChunk: (chunk: string) => Promise<void> | void;
										onComplete?: () => void;
								  }
								| undefined,
							token: vscode.CancellationToken | undefined
						) => {
							const messages: HistoryEntryPart[] = [{ text: prompt }];
							return this.aiRequestService.generateWithRetry(
								messages,
								modelName,
								history,
								requestType,
								generationConfig,
								streamCallbacks,
								token
							);
						},
						modelName: DEFAULT_FLASH_LITE_MODEL, // Use the default model for selection
						cancellationToken,
						fileDependencies,
						preSelectedHeuristicFiles: heuristicSelectedFiles, // Pass heuristicSelectedFiles
						fileSummaries: fileSummariesForAI, // Pass the generated file summaries
						selectionOptions: {
							useCache: options?.useAISelectionCache ?? true,
							cacheTimeout: 5 * 60 * 1000, // 5 minutes
							maxPromptLength: 50000,
							enableStreaming: false,
							fallbackToHeuristics: true,
						},
					};
					const selectedFiles = await selectRelevantFilesAI(selectionOptions);

					if (selectedFiles.length > 0) {
						filesForContextBuilding = selectedFiles;
						this.postMessageToWebview({
							type: "statusUpdate",
							value: `${selectedFiles.length} relevant file(s) for context`, // Updated message
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
									: `AI identified no specific files.`, // Updated message
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

			// Context building with performance monitoring
			const contextBuildStartTime = Date.now();

			// Define verboseHeaderMarker before preamble logic
			let verboseHeaderMarker = "";
			if (includeVerboseHeaders) {
				verboseHeaderMarker = "/* VERBOSE_HEADERS_ENABLED */";
			}

			// 3. Update the final call to buildContextString to pass activeSymbolDetailedInfo
			const rawContextString = await buildContextString(
				filesForContextBuilding, // Still pass URIs to buildContextString for content reading
				rootFolder.uri,
				DEFAULT_CONTEXT_CONFIG,
				this.changeLogger.getChangeLog(),
				fileDependencies,
				documentSymbolsMap,
				activeSymbolDetailedInfo, // Pass the new argument
				activeSymbolDetailedInfo?.referencedTypeDefinitions ?? undefined // Corrected argument
			);

			// --- New logic to prepend project type preamble ---
			let preamble = "";
			try {
				if (detectedProjectProfile) {
					preamble = formatProjectProfileForPrompt(detectedProjectProfile);
				} else {
					console.log("[ContextService] No specific project type detected.");
				}
			} catch (preambleError: any) {
				console.warn(
					`[ContextService] Error generating project type preamble: ${preambleError.message}`
				);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: `Warning: Could not generate project type info. Reason: ${preambleError.message}`,
					isError: true,
				});
			}

			let finalContextString = rawContextString; // Initialize with the originally built context string
			// Prepend verboseHeaderMarker if present
			if (verboseHeaderMarker) {
				finalContextString = `${verboseHeaderMarker}\n${rawContextString}`;
			}

			// Wrap the persona/preamble logic within the includePersona condition
			if (includePersona && preamble) {
				// Prepend the detected project type information
				finalContextString = `${preamble}\n\nProject Context:\n${finalContextString}`;
			}
			// --- End new logic ---

			const contextBuildTime = Date.now() - contextBuildStartTime;
			const totalTime = Date.now() - startTime;

			if (
				enablePerformanceMonitoring &&
				contextBuildTime > PERFORMANCE_THRESHOLDS.CONTEXT_BUILD_TIME_WARNING
			) {
				console.warn(
					`[ContextService] Context building took ${contextBuildTime}ms (threshold: ${PERFORMANCE_THRESHOLDS.CONTEXT_BUILD_TIME_WARNING}ms)`
				);
			}

			// Return the new object structure with performance metrics
			return {
				contextString: finalContextString, // Use the potentially modified context string
				relevantFiles: relativeFilesForContextBuilding,
				performanceMetrics: {
					scanTime,
					dependencyBuildTime,
					contextBuildTime,
					totalTime,
					fileCount: allScannedFiles.length,
					processedFileCount: filesForContextBuilding.length,
				},
				activeSymbolDetailedInfo: activeSymbolDetailedInfo,
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

	/**
	 * Build context using sequential file processing
	 */
	public async buildSequentialProjectContext(
		userRequest: string,
		options?: {
			enableSequentialProcessing?: boolean;
			maxFilesPerBatch?: number;
			summaryLength?: number;
			enableDetailedAnalysis?: boolean;
			includeDependencies?: boolean;
			complexityThreshold?: "low" | "medium" | "high";
			modelName?: string;
			onProgress?: (
				currentFile: string,
				totalFiles: number,
				progress: number
			) => void;
			onFileProcessed?: (summary: any) => void;
		}
	): Promise<BuildProjectContextResult> {
		try {
			const sequentialService = this.initializeSequentialContextService();

			const result = await sequentialService.buildSequentialContext(
				userRequest,
				{
					enableSequentialProcessing:
						options?.enableSequentialProcessing ?? true,
					maxFilesPerBatch: options?.maxFilesPerBatch ?? 10,
					summaryLength: options?.summaryLength ?? 2000,
					enableDetailedAnalysis: options?.enableDetailedAnalysis ?? true,
					includeDependencies: options?.includeDependencies ?? true,
					complexityThreshold: options?.complexityThreshold ?? "medium",
					modelName: DEFAULT_FLASH_LITE_MODEL, // Use the default model for sequential processing
					onProgress: options?.onProgress,
					onFileProcessed: options?.onFileProcessed,
				}
			);

			return {
				contextString: result.contextString,
				relevantFiles: result.relevantFiles.map((uri) =>
					vscode.workspace.asRelativePath(uri)
				),
				performanceMetrics: {
					scanTime: result.processingMetrics.totalTime,
					dependencyBuildTime: 0, // Not applicable for sequential processing
					contextBuildTime: result.processingMetrics.totalTime,
					totalTime: result.processingMetrics.totalTime,
					fileCount: result.processingMetrics.totalFiles,
					processedFileCount: result.processingMetrics.processedFiles,
				},
			};
		} catch (error) {
			console.error("Error in sequential context building:", error);
			// Fallback to traditional context building
			return this.buildProjectContext(
				undefined,
				userRequest,
				undefined,
				undefined,
				{
					enablePerformanceMonitoring: false,
				}
			);
		}
	}
}

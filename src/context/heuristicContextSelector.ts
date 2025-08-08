import * as vscode from "vscode";
import * as path from "path";
import { PlanGenerationContext } from "../sidebar/common/sidebarTypes";
import { ActiveSymbolDetailedInfo } from "../services/contextService";

export interface HeuristicSelectionOptions {
	maxHeuristicFilesTotal: number;
	maxSameDirectoryFiles: number;
	maxDirectDependencies: number;
	maxReverseDependencies: number;
	maxCallHierarchyFiles: number;
}

export async function getHeuristicRelevantFiles(
	allScannedFiles: ReadonlyArray<vscode.Uri>,
	projectRoot: vscode.Uri,
	activeEditorContext?: PlanGenerationContext["editorContext"],
	fileDependencies?: Map<string, string[]>,
	reverseFileDependencies?: Map<string, string[]>,
	activeSymbolDetailedInfo?: ActiveSymbolDetailedInfo,
	cancellationToken?: vscode.CancellationToken,
	options?: Partial<HeuristicSelectionOptions>
): Promise<vscode.Uri[]> {
	const relevantFilesSet = new Set<vscode.Uri>();

	const effectiveOptions: HeuristicSelectionOptions = {
		maxHeuristicFilesTotal: options?.maxHeuristicFilesTotal ?? 7,
		maxSameDirectoryFiles: options?.maxSameDirectoryFiles ?? 3,
		maxDirectDependencies: options?.maxDirectDependencies ?? 3,
		maxReverseDependencies: options?.maxReverseDependencies ?? 2,
		maxCallHierarchyFiles: options?.maxCallHierarchyFiles ?? 2,
	};

	// Identify files strongly related to the active symbol for biasing
	const symbolRelatedRelativePaths = new Set<string>();
	if (activeSymbolDetailedInfo) {
		// Helper to add URI to symbolRelatedRelativePaths set
		const addUriToSymbolRelated = (
			location: vscode.Uri | vscode.Location | vscode.Location[] | undefined
		) => {
			if (!location) {
				return;
			}
			let actualUri: vscode.Uri | undefined;
			if (location instanceof vscode.Uri) {
				actualUri = location;
			} else if ("uri" in location) {
				// For vscode.Location
				actualUri = location.uri;
			} else if (Array.isArray(location) && location.length > 0) {
				// For vscode.Location[]
				actualUri = location[0].uri; // Take the first one, assuming relevance
			}

			if (actualUri && actualUri.scheme === "file") {
				symbolRelatedRelativePaths.add(
					path
						.relative(projectRoot.fsPath, actualUri.fsPath)
						.replace(/\\/g, "/")
				);
			}
		};

		// Add definition, type definition, and implementations URIs
		addUriToSymbolRelated(activeSymbolDetailedInfo.definition);
		addUriToSymbolRelated(activeSymbolDetailedInfo.typeDefinition);
		if (activeSymbolDetailedInfo.implementations) {
			activeSymbolDetailedInfo.implementations.forEach((loc) =>
				addUriToSymbolRelated(loc)
			);
		}

		// Add referenced type definitions URIs
		if (activeSymbolDetailedInfo.referencedTypeDefinitions) {
			for (const relativePath of activeSymbolDetailedInfo.referencedTypeDefinitions.keys()) {
				// The key is already a relative path, so add directly
				symbolRelatedRelativePaths.add(relativePath);
			}
		}

		// Add call hierarchy URIs (from the call objects themselves)
		if (activeSymbolDetailedInfo.incomingCalls) {
			for (const call of activeSymbolDetailedInfo.incomingCalls) {
				addUriToSymbolRelated(call.from.uri);
			}
		}
		if (activeSymbolDetailedInfo.outgoingCalls) {
			for (const call of activeSymbolDetailedInfo.outgoingCalls) {
				addUriToSymbolRelated(call.to.uri);
			}
		}
	}

	// 1. Always include the active file if present
	if (activeEditorContext?.documentUri) {
		relevantFilesSet.add(activeEditorContext.documentUri);
	}

	// 2. Include files in the same directory as the active file, biased by symbol relevance
	if (activeEditorContext?.filePath) {
		const activeFileDir = path.dirname(activeEditorContext.filePath);
		const sameDirFilesWithBias: {
			uri: vscode.Uri;
			isSymbolRelated: boolean;
		}[] = [];

		for (const fileUri of allScannedFiles) {
			if (cancellationToken?.isCancellationRequested) {
				break;
			}
			const relativePath = path
				.relative(projectRoot.fsPath, fileUri.fsPath)
				.replace(/\\/g, "/");
			if (path.dirname(relativePath) === activeFileDir) {
				const isSymbolRelated = symbolRelatedRelativePaths.has(relativePath);
				sameDirFilesWithBias.push({ uri: fileUri, isSymbolRelated });
			}
		}

		// Prioritize symbol-related files within the same directory
		sameDirFilesWithBias.sort(
			(a, b) => (b.isSymbolRelated ? 1 : 0) - (a.isSymbolRelated ? 1 : 0)
		); // Move symbol-related files to front

		let sameDirCount = 0;
		for (const fileEntry of sameDirFilesWithBias) {
			if (cancellationToken?.isCancellationRequested) {
				break;
			}
			if (sameDirCount >= effectiveOptions.maxSameDirectoryFiles) {
				break;
			}
			if (!relevantFilesSet.has(fileEntry.uri)) {
				relevantFilesSet.add(fileEntry.uri);
				sameDirCount++;
			}
		}
	}

	// 3. Include direct dependencies of the active file, biased by symbol relevance
	if (
		activeEditorContext?.filePath &&
		activeEditorContext?.documentUri && // Ensure documentUri is present for relative path conversion
		fileDependencies &&
		fileDependencies.size > 0
	) {
		const activeFileRelativePath = path
			.relative(projectRoot.fsPath, activeEditorContext.documentUri.fsPath)
			.replace(/\\/g, "/");
		const importedByActiveFile = fileDependencies.get(activeFileRelativePath);

		if (importedByActiveFile) {
			const directDependenciesWithBias: {
				uri: vscode.Uri;
				isSymbolRelated: boolean;
			}[] = [];
			for (const depPath of importedByActiveFile) {
				if (cancellationToken?.isCancellationRequested) {
					break;
				}
				// Find the original URI for the dependency from allScannedFiles
				const depUri = allScannedFiles.find(
					(uri) =>
						path
							.relative(projectRoot.fsPath, uri.fsPath)
							.replace(/\\/g, "/") === depPath
				);
				if (depUri) {
					const isSymbolRelated = symbolRelatedRelativePaths.has(depPath);
					directDependenciesWithBias.push({ uri: depUri, isSymbolRelated });
				}
			}

			// Prioritize symbol-related direct dependencies
			directDependenciesWithBias.sort(
				(a, b) => (b.isSymbolRelated ? 1 : 0) - (a.isSymbolRelated ? 1 : 0)
			);

			let directDepCount = 0;
			for (const depEntry of directDependenciesWithBias) {
				if (cancellationToken?.isCancellationRequested) {
					break;
				}
				if (directDepCount >= effectiveOptions.maxDirectDependencies) {
					break;
				}
				if (!relevantFilesSet.has(depEntry.uri)) {
					relevantFilesSet.add(depEntry.uri);
					directDepCount++;
				}
			}
		}
	}

	// 4. Include files that directly import the active file (reverse dependencies), biased by symbol relevance
	if (
		activeEditorContext?.filePath &&
		activeEditorContext?.documentUri && // Ensure documentUri is also present for relative path conversion
		reverseFileDependencies &&
		reverseFileDependencies.size > 0
	) {
		const activeFileRelativePath = path
			.relative(projectRoot.fsPath, activeEditorContext.documentUri.fsPath)
			.replace(/\\/g, "/");

		const importersOfActiveFile = reverseFileDependencies.get(
			activeFileRelativePath
		);

		if (importersOfActiveFile && importersOfActiveFile.length > 0) {
			const reverseDependenciesWithBias: {
				uri: vscode.Uri;
				isSymbolRelated: boolean;
			}[] = [];
			for (const importerPath of importersOfActiveFile) {
				if (cancellationToken?.isCancellationRequested) {
					break;
				}
				// Find the original URI for the importer from allScannedFiles
				const importerUri = allScannedFiles.find(
					(uri) =>
						path
							.relative(projectRoot.fsPath, uri.fsPath)
							.replace(/\\/g, "/") === importerPath
				);
				if (importerUri) {
					const isSymbolRelated = symbolRelatedRelativePaths.has(importerPath);
					reverseDependenciesWithBias.push({
						uri: importerUri,
						isSymbolRelated,
					});
				}
			}

			// Prioritize symbol-related reverse dependencies
			reverseDependenciesWithBias.sort(
				(a, b) => (b.isSymbolRelated ? 1 : 0) - (a.isSymbolRelated ? 1 : 0)
			);

			let countAdded = 0;
			for (const importerEntry of reverseDependenciesWithBias) {
				if (cancellationToken?.isCancellationRequested) {
					break;
				}
				if (countAdded >= effectiveOptions.maxReverseDependencies) {
					break; // Stop if cancelled or limit reached
				}
				if (!relevantFilesSet.has(importerEntry.uri)) {
					relevantFilesSet.add(importerEntry.uri);
					countAdded++;
				}
			}
		}
	}

	// 5. Include files from active symbol's call hierarchy (incoming and outgoing calls)
	// This section inherently deals with symbol-relevant files, so no additional 'biasing' logic is needed here.
	if (
		activeEditorContext?.documentUri && // Ensure there's an active file
		activeSymbolDetailedInfo // Ensure detailed symbol info is available
	) {
		let callHierarchyFilesAdded = 0; // Single counter for combined call hierarchy

		// Helper function to process calls and add URIs to the set
		const addCallHierarchyUris = (
			calls:
				| vscode.CallHierarchyIncomingCall[]
				| vscode.CallHierarchyOutgoingCall[]
				| undefined
		) => {
			if (!calls || calls.length === 0) {
				return;
			}
			for (const call of calls) {
				if (cancellationToken?.isCancellationRequested) {
					return; // Return early if cancelled
				}
				if (callHierarchyFilesAdded >= effectiveOptions.maxCallHierarchyFiles) {
					return; // Limit reached, return from helper
				}
				let callUri: vscode.Uri | undefined;
				// Differentiate based on CallHierarchy type to get the correct URI
				if ("from" in call) {
					// IncomingCall
					callUri = call.from.uri;
				} else if ("to" in call) {
					// OutgoingCall
					callUri = call.to.uri;
				}

				if (callUri && callUri.scheme === "file") {
					// Ensure it's a file URI
					// Find the original URI from allScannedFiles to ensure it's a known project file
					const relativeCallPath = path
						.relative(projectRoot.fsPath, callUri.fsPath)
						.replace(/\\/g, "/");
					const projectFileUri = allScannedFiles.find(
						(uri) =>
							path
								.relative(projectRoot.fsPath, uri.fsPath)
								.replace(/\\/g, "/") === relativeCallPath
					);

					if (projectFileUri && !relevantFilesSet.has(projectFileUri)) {
						relevantFilesSet.add(projectFileUri);
						callHierarchyFilesAdded++; // Increment the global counter
					}
				}
			}
		};

		// Process incoming calls
		if (activeSymbolDetailedInfo.incomingCalls) {
			addCallHierarchyUris(activeSymbolDetailedInfo.incomingCalls);
		}

		// Process outgoing calls
		if (activeSymbolDetailedInfo.outgoingCalls) {
			addCallHierarchyUris(activeSymbolDetailedInfo.outgoingCalls);
		}
	}

	let resultFiles = Array.from(relevantFilesSet);

	// Prioritize active editor context document URI if it exists and is in the set
	if (activeEditorContext?.documentUri) {
		const activeFileUri = activeEditorContext.documentUri;
		const activeFileIndex = resultFiles.findIndex(
			(uri) => uri.fsPath === activeFileUri.fsPath
		);
		if (activeFileIndex !== -1) {
			// Remove the active file from its current position
			resultFiles.splice(activeFileIndex, 1);
			// Add it to the beginning of the array
			resultFiles.unshift(activeFileUri);
		}
	}

	// Enforce overall total limit after prioritizing active file
	if (resultFiles.length > effectiveOptions.maxHeuristicFilesTotal) {
		resultFiles = resultFiles.slice(0, effectiveOptions.maxHeuristicFilesTotal);
	}

	return resultFiles;
}

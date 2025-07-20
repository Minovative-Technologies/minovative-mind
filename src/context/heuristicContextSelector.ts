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

	// 1. Always include the active file if present
	if (activeEditorContext?.documentUri) {
		relevantFilesSet.add(activeEditorContext.documentUri);
	}

	// 2. Include files in the same directory as the active file
	if (activeEditorContext?.filePath) {
		const activeFileDir = path.dirname(activeEditorContext.filePath);
		let sameDirCount = 0;
		for (const fileUri of allScannedFiles) {
			if (cancellationToken?.isCancellationRequested) {
				break;
			}
			const relativePath = path
				.relative(projectRoot.fsPath, fileUri.fsPath)
				.replace(/\\/g, "/");
			if (path.dirname(relativePath) === activeFileDir) {
				if (sameDirCount >= effectiveOptions.maxSameDirectoryFiles) {
					break;
				}
				if (!relevantFilesSet.has(fileUri)) {
					// Only add and count if genuinely new to the set
					relevantFilesSet.add(fileUri);
					sameDirCount++;
				}
			}
		}
	}

	// 3. Include direct dependencies of the active file
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
			let directDepCount = 0;
			for (const depPath of importedByActiveFile) {
				if (cancellationToken?.isCancellationRequested) {
					break;
				}
				if (directDepCount >= effectiveOptions.maxDirectDependencies) {
					break;
				}
				// Find the original URI for the dependency from allScannedFiles
				const depUri = allScannedFiles.find(
					(uri) =>
						path
							.relative(projectRoot.fsPath, uri.fsPath)
							.replace(/\\/g, "/") === depPath
				);
				if (depUri && !relevantFilesSet.has(depUri)) {
					// Only add and count if genuinely new to the set
					relevantFilesSet.add(depUri);
					directDepCount++;
				}
			}
		}
	}

	// 4. Include files that directly import the active file (reverse dependencies)
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
			let countAdded = 0;
			for (const importerPath of importersOfActiveFile) {
				if (
					cancellationToken?.isCancellationRequested ||
					countAdded >= effectiveOptions.maxReverseDependencies // Use effectiveOptions
				) {
					break; // Stop if cancelled or limit reached
				}
				// Find the original URI for the importer from allScannedFiles
				const importerUri = allScannedFiles.find(
					(uri) =>
						path
							.relative(projectRoot.fsPath, uri.fsPath)
							.replace(/\\/g, "/") === importerPath
				);
				if (importerUri && !relevantFilesSet.has(importerUri)) {
					// Only add and count if genuinely new to the set
					relevantFilesSet.add(importerUri);
					countAdded++;
				}
			}
		}
	}

	// 5. Include files from active symbol's call hierarchy (incoming and outgoing calls)
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

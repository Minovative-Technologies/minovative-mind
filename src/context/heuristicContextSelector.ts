import * as vscode from "vscode";
import * as path from "path";
import { PlanGenerationContext } from "../sidebar/common/sidebarTypes";
import { ActiveSymbolDetailedInfo } from "../services/contextService"; // NEW IMPORT

export async function getHeuristicRelevantFiles(
	allScannedFiles: ReadonlyArray<vscode.Uri>,
	projectRoot: vscode.Uri,
	activeEditorContext?: PlanGenerationContext["editorContext"],
	fileDependencies?: Map<string, string[]>,
	reverseFileDependencies?: Map<string, string[]>,
	activeSymbolDetailedInfo?: ActiveSymbolDetailedInfo, // NEW PARAMETER
	cancellationToken?: vscode.CancellationToken
): Promise<vscode.Uri[]> {
	const relevantFilesSet = new Set<vscode.Uri>();
	const MAX_REVERSE_DEPENDENCIES_TO_INCLUDE = 10; // Define the limit
	const MAX_CALL_HIERARCHY_INCOMING_FILES_TO_INCLUDE = 8; // NEW CONSTANT
	const MAX_CALL_HIERARCHY_OUTGOING_FILES_TO_INCLUDE = 8; // NEW CONSTANT

	// 1. Always include the active file if present
	if (activeEditorContext?.documentUri) {
		relevantFilesSet.add(activeEditorContext.documentUri);
	}

	// 2. Include files in the same directory as the active file
	if (activeEditorContext?.filePath) {
		const activeFileDir = path.dirname(activeEditorContext.filePath);
		for (const fileUri of allScannedFiles) {
			if (cancellationToken?.isCancellationRequested) {
				break;
			}
			const relativePath = path
				.relative(projectRoot.fsPath, fileUri.fsPath)
				.replace(/\\/g, "/");
			if (path.dirname(relativePath) === activeFileDir) {
				relevantFilesSet.add(fileUri);
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
					relevantFilesSet.add(depUri);
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
					countAdded >= MAX_REVERSE_DEPENDENCIES_TO_INCLUDE
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
				if (importerUri) {
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
		// Helper function to process calls and add URIs to the set
		const addCallHierarchyUris = (
			calls:
				| vscode.CallHierarchyIncomingCall[]
				| vscode.CallHierarchyOutgoingCall[]
				| undefined,
			limit: number
		) => {
			if (!calls || calls.length === 0) {
				return;
			}
			let countAdded = 0;
			for (const call of calls) {
				if (cancellationToken?.isCancellationRequested || countAdded >= limit) {
					break;
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

					if (projectFileUri) {
						relevantFilesSet.add(projectFileUri);
						countAdded++;
					}
				}
			}
		};

		// Process incoming calls
		if (activeSymbolDetailedInfo.incomingCalls) {
			addCallHierarchyUris(
				activeSymbolDetailedInfo.incomingCalls,
				MAX_CALL_HIERARCHY_INCOMING_FILES_TO_INCLUDE
			);
		}

		// Process outgoing calls
		if (activeSymbolDetailedInfo.outgoingCalls) {
			addCallHierarchyUris(
				activeSymbolDetailedInfo.outgoingCalls,
				MAX_CALL_HIERARCHY_OUTGOING_FILES_TO_INCLUDE
			);
		}
	}

	return Array.from(relevantFilesSet);
}

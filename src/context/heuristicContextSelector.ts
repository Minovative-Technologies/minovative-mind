import * as vscode from "vscode";
import * as path from "path";
import { PlanGenerationContext } from "../sidebar/common/sidebarTypes";

export async function getHeuristicRelevantFiles(
	allScannedFiles: ReadonlyArray<vscode.Uri>,
	projectRoot: vscode.Uri,
	activeEditorContext?: PlanGenerationContext["editorContext"],
	fileDependencies?: Map<string, string[]>,
	reverseFileDependencies?: Map<string, string[]>, // NEW PARAMETER
	cancellationToken?: vscode.CancellationToken
): Promise<vscode.Uri[]> {
	const relevantFilesSet = new Set<vscode.Uri>();
	const MAX_REVERSE_DEPENDENCIES_TO_INCLUDE = 10; // Define the limit

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

	return Array.from(relevantFilesSet);
}

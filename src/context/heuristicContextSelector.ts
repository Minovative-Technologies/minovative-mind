import * as vscode from "vscode";
import * as path from "path";
import { PlanGenerationContext } from "../sidebar/common/sidebarTypes";
import { ActiveSymbolDetailedInfo } from "../services/contextService";

// Scoring weights constants
const HIGH_RELEVANCE = 100;
const MEDIUM_RELEVANCE = 80;
const LOW_RELEVANCE = 50;
const ACTIVE_FILE_SCORE_BOOST = 200;

export interface HeuristicSelectionOptions {
	maxHeuristicFilesTotal: number;
	maxSameDirectoryFiles: number;
	maxDirectDependencies: number;
	maxReverseDependencies: number;
	maxCallHierarchyFiles: number;
	sameDirectoryWeight: number;
	directDependencyWeight: number;
	reverseDependencyWeight: number;
	callHierarchyWeight: number;
	definitionWeight: number;
	implementationWeight: number;
	typeDefinitionWeight: number;
	referencedTypeDefinitionWeight: number;
	generalSymbolRelatedBoost: number;
	dependencyWeight: number;
	directoryWeight: number;
	neighborDirectoryWeight: number;
	sharedAncestorWeight: number;
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
	// Initialize effective options with provided options or default weights
	const effectiveOptions: HeuristicSelectionOptions = {
		maxHeuristicFilesTotal: options?.maxHeuristicFilesTotal ?? 30,
		maxSameDirectoryFiles: options?.maxSameDirectoryFiles ?? 15,
		maxDirectDependencies: options?.maxDirectDependencies ?? 10,
		maxReverseDependencies: options?.maxReverseDependencies ?? 10,
		maxCallHierarchyFiles: options?.maxCallHierarchyFiles ?? 10,
		sameDirectoryWeight: options?.sameDirectoryWeight ?? LOW_RELEVANCE,
		directDependencyWeight: options?.directDependencyWeight ?? MEDIUM_RELEVANCE,
		reverseDependencyWeight:
			options?.reverseDependencyWeight ?? MEDIUM_RELEVANCE,
		callHierarchyWeight: options?.callHierarchyWeight ?? HIGH_RELEVANCE,
		definitionWeight: options?.definitionWeight ?? HIGH_RELEVANCE * 2, // Definition is often very important
		implementationWeight: options?.implementationWeight ?? HIGH_RELEVANCE,
		typeDefinitionWeight: options?.typeDefinitionWeight ?? HIGH_RELEVANCE,
		referencedTypeDefinitionWeight:
			options?.referencedTypeDefinitionWeight ?? MEDIUM_RELEVANCE,
		generalSymbolRelatedBoost:
			options?.generalSymbolRelatedBoost ?? MEDIUM_RELEVANCE,
		dependencyWeight: options?.dependencyWeight ?? MEDIUM_RELEVANCE,
		directoryWeight: options?.directoryWeight ?? LOW_RELEVANCE,
		neighborDirectoryWeight: options?.neighborDirectoryWeight ?? LOW_RELEVANCE, // New default value
		sharedAncestorWeight: options?.sharedAncestorWeight ?? LOW_RELEVANCE, // New default value
	};

	const fileScores = new Map<vscode.Uri, number>();

	// Pre-process symbol-related URIs for direct lookups
	const symbolRelatedRelativePaths = new Set<string>(); // General set for any symbol relation
	const definitionRelativePaths = new Set<string>();
	const typeDefinitionRelativePaths = new Set<string>();
	const implementationRelativePaths = new Set<string>();
	const referencedTypeDefinitionRelativePaths = new Set<string>();
	const incomingCallRelativePaths = new Set<string>();
	const outgoingCallRelativePaths = new Set<string>();

	// Helper to add URI from a location to various symbol-related sets
	const addUriToSymbolSets = (
		location: vscode.Uri | vscode.Location | vscode.Location[] | undefined,
		specificSet?: Set<string> // Optional specific set to add to
	) => {
		if (!location) {
			return;
		}
		let actualUris: vscode.Uri[] = [];
		if (location instanceof vscode.Uri) {
			actualUris = [location];
		} else if ("uri" in location) {
			// For vscode.Location
			actualUris = [location.uri];
		} else if (Array.isArray(location) && location.length > 0) {
			// For vscode.Location[]
			actualUris = location.map((loc) => loc.uri);
		}

		actualUris.forEach((uri) => {
			if (uri && uri.scheme === "file") {
				const relativePath = path
					.relative(projectRoot.fsPath, uri.fsPath)
					.replace(/\\/g, "/");
				symbolRelatedRelativePaths.add(relativePath); // Add to general set
				specificSet?.add(relativePath); // Add to specific set if provided
			}
		});
	};

	if (activeSymbolDetailedInfo) {
		addUriToSymbolSets(
			activeSymbolDetailedInfo.definition,
			definitionRelativePaths
		);
		addUriToSymbolSets(
			activeSymbolDetailedInfo.typeDefinition,
			typeDefinitionRelativePaths
		);
		if (activeSymbolDetailedInfo.implementations) {
			activeSymbolDetailedInfo.implementations.forEach((loc) =>
				addUriToSymbolSets(loc, implementationRelativePaths)
			);
		}
		if (activeSymbolDetailedInfo.referencedTypeDefinitions) {
			for (const relativePath of activeSymbolDetailedInfo.referencedTypeDefinitions.keys()) {
				// The key is already a relative path, so add directly
				symbolRelatedRelativePaths.add(relativePath);
				referencedTypeDefinitionRelativePaths.add(relativePath);
			}
		}
		if (activeSymbolDetailedInfo.incomingCalls) {
			activeSymbolDetailedInfo.incomingCalls.forEach((call) =>
				addUriToSymbolSets(call.from.uri, incomingCallRelativePaths)
			);
		}
		if (activeSymbolDetailedInfo.outgoingCalls) {
			activeSymbolDetailedInfo.outgoingCalls.forEach((call) =>
				addUriToSymbolSets(call.to.uri, outgoingCallRelativePaths)
			);
		}
	}

	const activeFileRelativePath = activeEditorContext?.documentUri
		? path
				.relative(projectRoot.fsPath, activeEditorContext.documentUri.fsPath)
				.replace(/\\/g, "/")
		: undefined;

	const activeFileDirRelativePath = activeEditorContext?.filePath
		? path
				.dirname(
					path.relative(projectRoot.fsPath, activeEditorContext.filePath)
				)
				.replace(/\\/g, "/")
		: undefined;

	for (const fileUri of allScannedFiles) {
		if (cancellationToken?.isCancellationRequested) {
			break;
		}

		const relativePath = path
			.relative(projectRoot.fsPath, fileUri.fsPath)
			.replace(/\\/g, "/");
		let score = 0;

		// 1. Prioritize active file with a very high boost
		if (activeEditorContext?.documentUri?.fsPath === fileUri.fsPath) {
			score += ACTIVE_FILE_SCORE_BOOST;
		}

		// 2. Score based on specific symbol relationships
		if (definitionRelativePaths.has(relativePath)) {
			score += effectiveOptions.definitionWeight;
		}
		if (typeDefinitionRelativePaths.has(relativePath)) {
			score += effectiveOptions.typeDefinitionWeight;
		}
		if (implementationRelativePaths.has(relativePath)) {
			score += effectiveOptions.implementationWeight;
		}
		if (referencedTypeDefinitionRelativePaths.has(relativePath)) {
			score += effectiveOptions.referencedTypeDefinitionWeight;
		}
		// Combine incoming and outgoing calls into one "call hierarchy" weight
		if (
			incomingCallRelativePaths.has(relativePath) ||
			outgoingCallRelativePaths.has(relativePath)
		) {
			score += effectiveOptions.callHierarchyWeight;
		}

		// 3. General symbol related boost (if it's related to any symbol)
		if (symbolRelatedRelativePaths.has(relativePath)) {
			score += effectiveOptions.generalSymbolRelatedBoost;
		}

		// 4. Score for direct dependencies
		if (
			activeFileRelativePath &&
			fileDependencies?.has(activeFileRelativePath)
		) {
			const importedByActiveFile = fileDependencies.get(activeFileRelativePath);
			if (importedByActiveFile?.includes(relativePath)) {
				score += effectiveOptions.directDependencyWeight;
			}
		}

		// 5. Score for reverse dependencies
		if (
			activeFileRelativePath &&
			reverseFileDependencies?.has(activeFileRelativePath)
		) {
			const importersOfActiveFile = reverseFileDependencies.get(
				activeFileRelativePath
			);
			if (importersOfActiveFile?.includes(relativePath)) {
				score += effectiveOptions.reverseDependencyWeight;
			}
		}

		// 6. Score for files in the same directory
		if (activeFileDirRelativePath) {
			if (path.dirname(relativePath) === activeFileDirRelativePath) {
				score += effectiveOptions.sameDirectoryWeight;
			}
			// 7. Score for files in neighbor directories (sibling directories)
			const fileDir = path.dirname(relativePath);
			const activeFileParentDir = path.dirname(activeFileDirRelativePath);
			if (
				activeFileParentDir !== "." && // Not root
				fileDir !== activeFileDirRelativePath && // Not same directory
				path.dirname(fileDir) === activeFileParentDir // Sibling directory
			) {
				score += effectiveOptions.neighborDirectoryWeight;
			}

			// 8. Score for files sharing a significant common ancestor directory (e.g., within 2-3 levels up)
			const activeFileComponents = activeFileDirRelativePath.split("/");
			const fileComponents = fileDir.split("/");
			let commonAncestorLength = 0;
			for (
				let i = 0;
				i < Math.min(activeFileComponents.length, fileComponents.length);
				i++
			) {
				if (activeFileComponents[i] === fileComponents[i]) {
					commonAncestorLength++;
				} else {
					break;
				}
			}

			// Apply shared ancestor weight if there's a significant common path, but not the same directory
			if (commonAncestorLength > 0 && fileDir !== activeFileDirRelativePath) {
				// The deeper the common ancestor, the higher the base weight might be.
				// This is a simple linear scale; more complex logic could be applied.
				score += effectiveOptions.sharedAncestorWeight * commonAncestorLength;
			}
		}

		// Only add to map if score is greater than 0
		if (score > 0) {
			// Accumulate scores for a file if it matches multiple criteria
			fileScores.set(fileUri, (fileScores.get(fileUri) || 0) + score);
		}
	}

	let resultFiles = Array.from(fileScores.entries())
		.sort(([, scoreA], [, scoreB]) => scoreB - scoreA) // Sort by score descending
		.map(([uri]) => uri); // Get back just the URIs

	// Enforce overall total limit after sorting
	if (resultFiles.length > effectiveOptions.maxHeuristicFilesTotal) {
		resultFiles = resultFiles.slice(0, effectiveOptions.maxHeuristicFilesTotal);
	}

	return resultFiles;
}

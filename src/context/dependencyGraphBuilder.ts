import * as vscode from "vscode";
import * as path from "path";
import BPromise from "bluebird";
import { parseFileImports } from "../utils/fileDependencyParser";
import * as ts from "typescript";
import {
	findAndLoadTsConfig,
	createProjectCompilerHost,
} from "../utils/tsConfigLoader";

export async function buildDependencyGraph(
	allScannedFiles: vscode.Uri[],
	projectRoot: vscode.Uri,
	cancellationToken?: vscode.CancellationToken
): Promise<Map<string, string[]>> {
	if (cancellationToken?.isCancellationRequested) {
		throw new Error("Operation cancelled by user.");
	}

	const dependencyGraph = new Map<string, string[]>();
	const concurrencyLimit = 10; // Concurrency limit set between 5-10

	const parsedCommandLine = await findAndLoadTsConfig(projectRoot);
	const compilerOptions = parsedCommandLine?.options || {
		moduleResolution: ts.ModuleResolutionKind.NodeJs,
		target: ts.ScriptTarget.ES2020, // Sensible default, or use ts.ScriptTarget.Latest
	};
	const compilerHost = createProjectCompilerHost(projectRoot, compilerOptions);
	const moduleResolutionCache = ts.createModuleResolutionCache(
		compilerHost.getCurrentDirectory(),
		compilerHost.getCanonicalFileName,
		compilerOptions
	);

	await BPromise.map(
		allScannedFiles,
		async (fileUri: vscode.Uri) => {
			if (cancellationToken?.isCancellationRequested) {
				throw new Error("Operation cancelled by user.");
			}
			try {
				const relativePath = path.relative(projectRoot.fsPath, fileUri.fsPath);
				const imports = await parseFileImports(
					fileUri.fsPath,
					projectRoot,
					compilerOptions,
					compilerHost,
					moduleResolutionCache
				);
				dependencyGraph.set(relativePath, imports);
			} catch (error) {
				// If parseFileImports fails for a specific file, it means we couldn't
				// extract its dependencies. As per instructions, we only store the
				// "result". If there's an error, there's no successful result to store
				// for this file. It will simply be absent from the map.
			}
		},
		{ concurrency: concurrencyLimit }
	);

	return dependencyGraph;
}

/**
 * Builds a reverse dependency graph from a forward dependency graph.
 * The reverse graph maps an imported file path to a list of files that import it.
 * @param fileDependencies A map where key is a file path (importer) and value is an array of files it imports.
 * @returns A map where key is an imported file path and value is an array of files that import it.
 */
export function buildReverseDependencyGraph(
	fileDependencies: Map<string, string[]>
): Map<string, string[]> {
	const reverseDependencyGraph = new Map<string, string[]>();

	for (const [importerPath, importedPaths] of fileDependencies.entries()) {
		for (const importedPath of importedPaths) {
			// Ensure the importedPath exists as a key in the reverse map
			if (!reverseDependencyGraph.has(importedPath)) {
				reverseDependencyGraph.set(importedPath, []);
			}
			// Add the current importerPath to the list of files that import importedPath
			reverseDependencyGraph.get(importedPath)!.push(importerPath);
		}
	}
	return reverseDependencyGraph;
}

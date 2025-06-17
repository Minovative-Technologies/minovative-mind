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
	projectRoot: vscode.Uri
): Promise<Map<string, string[]>> {
	const dependencyGraph = new Map<string, string[]>();
	const concurrencyLimit = 10; // Concurrency limit set between 5-10, chosen 8

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

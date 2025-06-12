import * as ts from "typescript";
import * as vscode from "vscode";
import * as path from "path";
import { TextDecoder } from "util";

export async function parseFileImports(
	filePath: string,
	projectRoot: vscode.Uri
): Promise<string[]> {
	const importedPaths = new Set<string>();

	try {
		// Read the file content
		const fileContentUint8 = await vscode.workspace.fs.readFile(
			vscode.Uri.file(filePath)
		);
		const fileContent = new TextDecoder("utf-8").decode(fileContentUint8);

		// Parse the file into an AST
		const sourceFile = ts.createSourceFile(
			filePath,
			fileContent,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS
		);

		const fileDir = path.dirname(filePath);
		const projectRootFsPath = projectRoot.fsPath;

		// Traverse the AST
		ts.forEachChild(sourceFile, (node) => {
			let moduleSpecifierText: string | undefined;

			// Check for ImportDeclaration nodes
			if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
				if (ts.isStringLiteral(node.moduleSpecifier)) {
					moduleSpecifierText = node.moduleSpecifier.text;
				}
			}
			// Check for ExportDeclaration nodes (e.g., `export { A } from './B';`)
			else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
				if (ts.isStringLiteral(node.moduleSpecifier)) {
					moduleSpecifierText = node.moduleSpecifier.text;
				}
			}

			if (moduleSpecifierText) {
				// Filter out bare specifiers (external modules like 'react', 'lodash')
				// These typically do not start with '.' or '/'
				if (
					!moduleSpecifierText.startsWith(".") &&
					!moduleSpecifierText.startsWith("/")
				) {
					return; // Skip external modules
				}

				try {
					// Resolve the module specifier into an absolute path
					const absoluteResolvedPath = path.resolve(
						fileDir,
						moduleSpecifierText
					);

					// Make the path relative to the project root
					let relativeToProjectRoot = path.relative(
						projectRootFsPath,
						absoluteResolvedPath
					);

					// Normalize path separators to use forward slashes for consistency across OS
					relativeToProjectRoot = relativeToProjectRoot.replace(/\\/g, "/");

					importedPaths.add(relativeToProjectRoot);
				} catch (pathResolutionError) {
					// Log error if path resolution fails for a specific specifier
					console.error(
						`Failed to resolve path for specifier '${moduleSpecifierText}' in file '${filePath}':`,
						pathResolutionError
					);
				}
			}
		});
	} catch (error) {
		// Robust error handling for file reading or AST parsing
		console.error(`Error processing file ${filePath}:`, error);
		// Return an empty array on error as per instructions
		return [];
	}

	return Array.from(importedPaths);
}

import * as vscode from "vscode";
import * as path from "path";

/**
 * Retrieves all document symbols (classes, functions, variables, etc.) within a given URI.
 * @param uri The URI of the document.
 * @returns A promise that resolves to an array of vscode.DocumentSymbol objects, or undefined if no symbols are found or an error occurs.
 */
export async function getSymbolsInDocument(
	uri: vscode.Uri
): Promise<vscode.DocumentSymbol[] | undefined> {
	try {
		// Execute the 'vscode.executeDocumentSymbolProvider' command to get document symbols
		const symbols = await vscode.commands.executeCommand<
			vscode.DocumentSymbol[]
		>("vscode.executeDocumentSymbolProvider", uri);
		return symbols;
	} catch (error: any) {
		console.warn(
			`Error getting symbols for document ${uri.fsPath}: ${error.message}`
		);
		// Return undefined or an empty array to gracefully handle errors
		return undefined;
	}
}

/**
 * Finds all references to a symbol at a given position within a document and across the workspace.
 * @param uri The URI of the document where the symbol is located.
 * @param position The position of the symbol within the document.
 * @param cancellationToken An optional cancellation token to signal cancellation.
 * @returns A promise that resolves to an array of vscode.Location objects, or undefined if no references are found or an error occurs.
 */
export async function findReferences(
	uri: vscode.Uri,
	position: vscode.Position,
	cancellationToken?: vscode.CancellationToken
): Promise<vscode.Location[] | undefined> {
	try {
		// Execute the 'vscode.executeReferenceProvider' command to find references
		const references = await vscode.commands.executeCommand<vscode.Location[]>(
			"vscode.executeReferenceProvider",
			uri,
			position,
			cancellationToken
		);
		return references;
	} catch (error: any) {
		console.warn(
			`Error finding references for symbol at ${uri.fsPath}:${
				position.line + 1
			}:${position.character + 1}: ${error.message}`
		);
		return undefined;
	}
}

/**
 * Retrieves the definition(s) of a symbol at a given position within a document.
 * @param uri The URI of the document where the symbol is located.
 * @param position The position of the symbol within the document.
 * @returns A promise that resolves to a vscode.Location or an array of vscode.Location objects, or undefined if no definition is found or an error occurs.
 */
export async function getDefinition(
	uri: vscode.Uri,
	position: vscode.Position
): Promise<vscode.Location | vscode.Location[] | undefined> {
	try {
		// Execute the 'vscode.executeDefinitionProvider' command to get definitions
		const definition = await vscode.commands.executeCommand<
			vscode.Location | vscode.Location[]
		>("vscode.executeDefinitionProvider", uri, position);
		return definition;
	} catch (error: any) {
		console.warn(
			`Error getting definition for symbol at ${uri.fsPath}:${
				position.line + 1
			}:${position.character + 1}: ${error.message}`
		);
		return undefined;
	}
}

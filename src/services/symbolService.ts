import * as vscode from "vscode";

/**
 * Retrieves all document symbols (classes, functions, variables, etc.) within a given URI.
 * @param documentUri The URI of the document.
 * @param cancellationToken An optional cancellation token to signal cancellation.
 * @returns A promise that resolves to an array of vscode.DocumentSymbol objects, or undefined if no symbols are found or an error occurs.
 */
export async function getSymbolsInDocument(
	documentUri: vscode.Uri,
	cancellationToken?: vscode.CancellationToken
): Promise<vscode.DocumentSymbol[] | undefined> {
	try {
		// Execute the 'vscode.executeDocumentSymbolProvider' command to get document symbols
		const symbols = await vscode.commands.executeCommand<
			vscode.DocumentSymbol[]
		>("vscode.executeDocumentSymbolProvider", documentUri, cancellationToken);
		return symbols;
	} catch (error: any) {
		console.warn(
			`Error getting symbols for document ${documentUri.fsPath}: ${error.message}`
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
 * @param cancellationToken An optional cancellation token to signal cancellation.
 * @returns A promise that resolves to a vscode.Location or an array of vscode.Location objects, or undefined if no definition is found or an error occurs.
 */
export async function getDefinition(
	uri: vscode.Uri,
	position: vscode.Position,
	cancellationToken?: vscode.CancellationToken
): Promise<vscode.Location | vscode.Location[] | undefined> {
	try {
		// Execute the 'vscode.executeDefinitionProvider' command to get definitions
		const definition = await vscode.commands.executeCommand<
			vscode.Location | vscode.Location[]
		>("vscode.executeDefinitionProvider", uri, position, cancellationToken);
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

/**
 * Retrieves the implementation(s) of a symbol at a given position within a document.
 * @param uri The URI of the document where the symbol is located.
 * @param position The position of the symbol within the document.
 * @param cancellationToken An optional cancellation token to signal cancellation.
 * @returns A promise that resolves to an array of vscode.Location objects, or undefined if no implementations are found or an error occurs.
 */
export async function getImplementations(
	uri: vscode.Uri,
	position: vscode.Position,
	cancellationToken?: vscode.CancellationToken
): Promise<vscode.Location[] | undefined> {
	try {
		const implementations = await vscode.commands.executeCommand<
			vscode.Location[]
		>("vscode.executeImplementationProvider", uri, position, cancellationToken);
		return implementations;
	} catch (error: any) {
		console.warn(
			`Error getting implementations for symbol at ${uri.fsPath}:${
				position.line + 1
			}:${position.character + 1}: ${error.message}`
		);
		return undefined;
	}
}

/**
 * Retrieves the type definition(s) of a symbol at a given position within a document.
 * @param uri The URI of the document where the symbol is located.
 * @param position The position of the symbol within the document.
 * @param cancellationToken An optional cancellation token to signal cancellation.
 * @returns A promise that resolves to a vscode.Location or an array of vscode.Location objects, or undefined if no type definition is found or an error occurs.
 */
export async function getTypeDefinition(
	uri: vscode.Uri,
	position: vscode.Position,
	cancellationToken?: vscode.CancellationToken
): Promise<vscode.Location | vscode.Location[] | undefined> {
	try {
		const typeDefinition = await vscode.commands.executeCommand<
			vscode.Location | vscode.Location[]
		>("vscode.executeTypeDefinitionProvider", uri, position, cancellationToken);
		return typeDefinition;
	} catch (error: any) {
		console.warn(
			`Error getting type definition for symbol at ${uri.fsPath}:${
				position.line + 1
			}:${position.character + 1}: ${error.message}`
		);
		return undefined;
	}
}

/**
 * Prepares the call hierarchy for a symbol at a given position within a document.
 * This function typically returns an array of `vscode.CallHierarchyItem` which are the entry points for call hierarchy.
 * @param uri The URI of the document where the symbol is located.
 * @param position The position of the symbol within the document.
 * @param cancellationToken An optional cancellation token to signal cancellation.
 * @returns A promise that resolves to an array of vscode.CallHierarchyItem objects, or undefined if no call hierarchy items are found or an error occurs.
 */
export async function prepareCallHierarchy(
	uri: vscode.Uri,
	position: vscode.Position,
	cancellationToken?: vscode.CancellationToken
): Promise<vscode.CallHierarchyItem[] | undefined> {
	try {
		const items = await vscode.commands.executeCommand<
			vscode.CallHierarchyItem[]
		>(
			"vscode.executeCallHierarchyProvider.prepare",
			uri,
			position,
			cancellationToken
		);
		return items;
	} catch (error: any) {
		console.warn(
			`Error preparing call hierarchy for symbol at ${uri.fsPath}:${
				position.line + 1
			}:${position.character + 1}: ${error.message}`
		);
		return undefined;
	}
}

/**
 * Resolves incoming calls for a given `vscode.CallHierarchyItem`.
 * @param item The CallHierarchyItem for which to resolve incoming calls.
 * @param cancellationToken An optional cancellation token to signal cancellation.
 * @returns A promise that resolves to an array of vscode.CallHierarchyIncomingCall objects, or undefined if no incoming calls are found or an error occurs.
 */
export async function resolveIncomingCalls(
	item: vscode.CallHierarchyItem,
	cancellationToken?: vscode.CancellationToken
): Promise<vscode.CallHierarchyIncomingCall[] | undefined> {
	try {
		const incomingCalls = await vscode.commands.executeCommand<
			vscode.CallHierarchyIncomingCall[]
		>(
			"vscode.executeCallHierarchyProvider.resolveIncomingCalls",
			item,
			cancellationToken
		);
		return incomingCalls;
	} catch (error: any) {
		console.warn(
			`Error resolving incoming calls for item ${item.uri.fsPath}:${
				item.range.start.line + 1
			}: ${error.message}`
		);
		return undefined;
	}
}

/**
 * Resolves outgoing calls for a given `vscode.CallHierarchyItem`.
 * @param item The CallHierarchyItem for which to resolve outgoing calls.
 * @param cancellationToken An optional cancellation token to signal cancellation.
 * @returns A promise that resolves to an array of vscode.CallHierarchyOutgoingCall objects, or undefined if no outgoing calls are found or an error occurs.
 */
export async function resolveOutgoingCalls(
	item: vscode.CallHierarchyItem,
	cancellationToken?: vscode.CancellationToken
): Promise<vscode.CallHierarchyOutgoingCall[] | undefined> {
	try {
		const outgoingCalls = await vscode.commands.executeCommand<
			vscode.CallHierarchyOutgoingCall[]
		>(
			"vscode.executeCallHierarchyProvider.resolveOutgoingCalls",
			item,
			cancellationToken
		);
		return outgoingCalls;
	} catch (error: any) {
		console.warn(
			`Error resolving outgoing calls for item ${item.uri.fsPath}:${
				item.range.start.line + 1
			}: ${error.message}`
		);
		return undefined;
	}
}

/**
 * Retrieves the content of a document at a specific location.
 * @param location The vscode.Location object specifying the document URI and range.
 * @param cancellationToken An optional cancellation token to signal cancellation.
 * @returns A promise that resolves to the string content within the location's range, or undefined if the document cannot be opened or an error occurs.
 */
export async function getDocumentContentAtLocation(
	location: vscode.Location,
	cancellationToken?: vscode.CancellationToken
): Promise<string | undefined> {
	try {
		const document = await vscode.workspace.openTextDocument(location.uri);
		if (cancellationToken?.isCancellationRequested) {
			return undefined;
		}
		return document.getText(location.range);
	} catch (error: any) {
		console.warn(
			`Error getting document content at ${location.uri.fsPath}:${
				location.range.start.line + 1
			}:${location.range.start.character + 1}: ${error.message}`
		);
		return undefined;
	}
}

/**
 * Recursively serializes a vscode.DocumentSymbol and its children into a human-readable string hierarchy.
 * @param symbol The vscode.DocumentSymbol to serialize.
 * @param relativePath The relative path of the document containing the symbol. This is included once at the top level.
 * @param currentDepth The current depth of the recursion, used for indentation.
 * @param maxDepth The maximum depth to serialize symbols. Children beyond this depth will not be included.
 * @returns A formatted string representing the symbol hierarchy.
 */
export function serializeDocumentSymbolHierarchy(
	symbol: vscode.DocumentSymbol,
	relativePath: string,
	currentDepth: number = 0,
	maxDepth: number = 2
): string {
	let result = "";
	const indent = "  ".repeat(currentDepth);

	if (currentDepth === 0) {
		// Only prepend the relative path for the top-level symbol being serialized
		// This uses the relativePath as a contextual header for the file's symbol hierarchy.
		result += `${relativePath}\n`;
	}

	const kindName = vscode.SymbolKind[symbol.kind];
	const detail = symbol.detail ? ` - ${symbol.detail}` : "";
	result += `${indent}${symbol.name} (${kindName}) [Line: ${
		symbol.range.start.line + 1
	}]${detail}\n`;

	if (currentDepth < maxDepth) {
		for (const child of symbol.children) {
			result += serializeDocumentSymbolHierarchy(
				child,
				relativePath, // Pass relativePath down, though it's only used at depth 0 for prefixing.
				currentDepth + 1,
				maxDepth
			);
		}
	}

	return result;
}

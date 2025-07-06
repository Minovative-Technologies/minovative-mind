import * as vscode from "vscode";
import * as path from "path";
import { createAsciiTree } from "../utilities/treeFormatter";
import { FileChangeEntry } from "../types/workflow";
import { ActiveSymbolDetailedInfo } from "../services/contextService";
import { intelligentlySummarizeFileContent } from "./fileContentProcessor";

/**
 * Enhanced context builder that provides more accurate and relevant context
 * to improve AI code generation accuracy
 */
export class EnhancedContextBuilder {
	private static readonly MAX_CONTEXT_LENGTH = 100000; // Increased for better accuracy
	private static readonly MAX_FILE_LENGTH = 15000; // Increased for better file understanding
	private static readonly MAX_SYMBOL_CHARS = 8000; // Increased for better symbol understanding

	/**
	 * Build enhanced context with better accuracy and relevance
	 */
	public async buildEnhancedContext(
		relevantFiles: vscode.Uri[],
		workspaceRoot: vscode.Uri,
		options: {
			userRequest?: string;
			activeSymbolInfo?: ActiveSymbolDetailedInfo;
			recentChanges?: FileChangeEntry[];
			dependencyGraph?: Map<string, string[]>;
			documentSymbols?: Map<string, vscode.DocumentSymbol[] | undefined>;
			diagnostics?: vscode.Diagnostic[];
			chatHistory?: any[];
		} = {}
	): Promise<string> {
		let context = `Enhanced Project Context (Workspace: ${path.basename(
			workspaceRoot.fsPath
		)}):\n`;
		context += `Relevant files identified: ${relevantFiles.length}\n\n`;

		let currentLength = context.length;

		// 1. Enhanced File Structure with Dependencies
		context += await this._buildEnhancedFileStructure(
			relevantFiles,
			workspaceRoot,
			options.dependencyGraph
		);
		currentLength = context.length;

		// 2. Active Symbol Analysis (if available)
		if (options.activeSymbolInfo) {
			const symbolContext = this._buildActiveSymbolContext(
				options.activeSymbolInfo
			);
			if (
				currentLength + symbolContext.length <=
				EnhancedContextBuilder.MAX_CONTEXT_LENGTH
			) {
				context += symbolContext;
				currentLength += symbolContext.length;
			}
		}

		// 3. Enhanced Recent Changes
		if (options.recentChanges && options.recentChanges.length > 0) {
			const changesContext = this._buildEnhancedChangesContext(
				options.recentChanges
			);
			if (
				currentLength + changesContext.length <=
				EnhancedContextBuilder.MAX_CONTEXT_LENGTH
			) {
				context += changesContext;
				currentLength += changesContext.length;
			}
		}

		// 4. Diagnostics Context
		if (options.diagnostics && options.diagnostics.length > 0) {
			const diagnosticsContext = this._buildDiagnosticsContext(
				options.diagnostics,
				workspaceRoot
			);
			if (
				currentLength + diagnosticsContext.length <=
				EnhancedContextBuilder.MAX_CONTEXT_LENGTH
			) {
				context += diagnosticsContext;
				currentLength += diagnosticsContext.length;
			}
		}

		// 5. Enhanced File Contents with Better Prioritization
		const fileContents = await this._buildEnhancedFileContents(
			relevantFiles,
			workspaceRoot,
			options.documentSymbols,
			options.activeSymbolInfo,
			currentLength
		);
		context += fileContents;

		return context.trim();
	}

	/**
	 * Build enhanced file structure with dependency information
	 */
	private async _buildEnhancedFileStructure(
		relevantFiles: vscode.Uri[],
		workspaceRoot: vscode.Uri,
		dependencyGraph?: Map<string, string[]>
	): Promise<string> {
		let structure = "Enhanced File Structure:\n";

		// Create ASCII tree
		const relativePaths = relevantFiles.map((uri) =>
			path.relative(workspaceRoot.fsPath, uri.fsPath).replace(/\\/g, "/")
		);
		const fileStructureString = createAsciiTree(
			relativePaths,
			path.basename(workspaceRoot.fsPath)
		);
		structure += fileStructureString + "\n\n";

		// Add dependency information if available
		if (dependencyGraph) {
			structure += "File Dependencies:\n";
			for (const [file, dependencies] of dependencyGraph.entries()) {
				if (dependencies.length > 0) {
					structure += `- ${file} depends on: ${dependencies.join(", ")}\n`;
				}
			}
			structure += "\n";
		}

		return structure;
	}

	/**
	 * Build enhanced active symbol context
	 */
	private _buildActiveSymbolContext(
		activeSymbolInfo: ActiveSymbolDetailedInfo
	): string {
		let context = "Active Symbol Detailed Information:\n";

		context += `Symbol Name: ${activeSymbolInfo.name}\n`;
		context += `Symbol Kind: ${activeSymbolInfo.kind}\n`;
		context += `File Path: ${activeSymbolInfo.filePath}\n`;

		if (activeSymbolInfo.detail) {
			context += `Detail: ${activeSymbolInfo.detail}\n`;
		}

		// Documentation is not available in the current interface
		// if (activeSymbolInfo.documentation) {
		// 	context += `Documentation: ${activeSymbolInfo.documentation}\n`;
		// }

		// Add definition information
		if (activeSymbolInfo.definition) {
			const def = activeSymbolInfo.definition;
			if (Array.isArray(def)) {
				context += `Definitions (${def.length}):\n`;
				for (const [i, d] of def.entries()) {
					context += `  ${i + 1}. ${d.uri.fsPath}:${d.range.start.line + 1}\n`;
				}
			} else {
				context += `Definition Location: ${def.uri.fsPath}:${
					def.range.start.line + 1
				}\n`;
			}
		}

		// Add implementations
		if (
			activeSymbolInfo.implementations &&
			activeSymbolInfo.implementations.length > 0
		) {
			context += `Implementations (${activeSymbolInfo.implementations.length}):\n`;
			for (const impl of activeSymbolInfo.implementations) {
				context += `  - ${impl.uri.fsPath}:${impl.range.start.line + 1}\n`;
			}
		}

		// Add type definitions
		if (activeSymbolInfo.typeDefinition) {
			const typeDefs = activeSymbolInfo.typeDefinition;
			if (Array.isArray(typeDefs)) {
				context += `Type Definitions (${typeDefs.length}):\n`;
				for (const typeDef of typeDefs) {
					context += `  - ${typeDef.uri.fsPath}:${
						typeDef.range.start.line + 1
					}\n`;
				}
			} else {
				context += `Type Definition: ${typeDefs.uri.fsPath}:${
					typeDefs.range.start.line + 1
				}\n`;
			}
		}

		// Add call hierarchy
		if (
			activeSymbolInfo.incomingCalls &&
			activeSymbolInfo.incomingCalls.length > 0
		) {
			context += `Incoming Calls (${activeSymbolInfo.incomingCalls.length}):\n`;
			for (const call of activeSymbolInfo.incomingCalls) {
				context += `  - ${call.from.name} at ${call.from.uri.fsPath}:${
					call.from.range.start.line + 1
				}\n`;
			}
		}

		if (
			activeSymbolInfo.outgoingCalls &&
			activeSymbolInfo.outgoingCalls.length > 0
		) {
			context += `Outgoing Calls (${activeSymbolInfo.outgoingCalls.length}):\n`;
			for (const call of activeSymbolInfo.outgoingCalls) {
				context += `  - ${call.to.name} at ${call.to.uri.fsPath}:${
					call.to.range.start.line + 1
				}\n`;
			}
		}

		// Add referenced types content
		if (activeSymbolInfo.referencedTypeDefinitions) {
			context += `Referenced Type Definitions:\n`;
			for (const [
				typeName,
				typeContent,
			] of activeSymbolInfo.referencedTypeDefinitions.entries()) {
				// Limit to prevent context overflow
				context += `  - ${typeName}:\n`;
				context += `    ${typeContent.substring(0, 500)}${
					typeContent.length > 500 ? "..." : ""
				}\n`;
			}
		}

		context += "\n";
		return context;
	}

	/**
	 * Build enhanced changes context
	 */
	private _buildEnhancedChangesContext(
		recentChanges: FileChangeEntry[]
	): string {
		let context = "Enhanced Recent Project Changes:\n";

		for (const change of recentChanges) {
			context += `--- File ${change.changeType.toUpperCase()}: ${
				change.filePath
			} ---\n`;
			context += `Summary: ${change.summary}\n`;

			if (change.diffContent) {
				context += `Changes:\n${change.diffContent}\n`;
			}

			context += `Timestamp: ${new Date(change.timestamp).toISOString()}\n\n`;
		}

		return context;
	}

	/**
	 * Build diagnostics context
	 */
	private _buildDiagnosticsContext(
		diagnostics: vscode.Diagnostic[],
		workspaceRoot: vscode.Uri
	): string {
		let context = "Current Diagnostics:\n";

		const errors = diagnostics.filter(
			(d) => d.severity === vscode.DiagnosticSeverity.Error
		);
		const warnings = diagnostics.filter(
			(d) => d.severity === vscode.DiagnosticSeverity.Warning
		);

		if (errors.length > 0) {
			context += `Errors (${errors.length}):\n`;
			for (const error of errors.slice(0, 10)) {
				// Limit to prevent context overflow
				const relativePath = path.relative(
					workspaceRoot.fsPath,
					error.source || "unknown"
				);
				context += `  - ${relativePath}:${error.range.start.line + 1}: ${
					error.message
				}\n`;
			}
		}

		if (warnings.length > 0) {
			context += `Warnings (${warnings.length}):\n`;
			for (const warning of warnings.slice(0, 10)) {
				// Limit to prevent context overflow
				const relativePath = path.relative(
					workspaceRoot.fsPath,
					warning.source || "unknown"
				);
				context += `  - ${relativePath}:${warning.range.start.line + 1}: ${
					warning.message
				}\n`;
			}
		}

		context += "\n";
		return context;
	}

	/**
	 * Build enhanced file contents with better prioritization
	 */
	private async _buildEnhancedFileContents(
		relevantFiles: vscode.Uri[],
		workspaceRoot: vscode.Uri,
		documentSymbols?: Map<string, vscode.DocumentSymbol[] | undefined>,
		activeSymbolInfo?: ActiveSymbolDetailedInfo,
		currentLength: number = 0
	): Promise<string> {
		let context = "Enhanced File Contents:\n";
		let contentAdded = false;
		let filesSkipped = 0;

		// Sort files by relevance (active symbol file first, then by importance)
		const sortedFiles = this._sortFilesByRelevance(
			relevantFiles,
			workspaceRoot,
			activeSymbolInfo
		);

		for (const fileUri of sortedFiles) {
			if (currentLength >= EnhancedContextBuilder.MAX_CONTEXT_LENGTH) {
				filesSkipped++;
				continue;
			}

			const relativePath = path
				.relative(workspaceRoot.fsPath, fileUri.fsPath)
				.replace(/\\/g, "/");

			try {
				const contentBytes = await vscode.workspace.fs.readFile(fileUri);
				const fileContentRaw = Buffer.from(contentBytes).toString("utf-8");
				const symbolsForFile = documentSymbols?.get(relativePath);

				// Determine if this is the active file for enhanced prioritization
				const isActiveFile = activeSymbolInfo?.filePath === relativePath;
				let activeSymbolInfoForCurrentFile:
					| ActiveSymbolDetailedInfo
					| undefined = undefined;
				if (isActiveFile) {
					activeSymbolInfoForCurrentFile = activeSymbolInfo;
				}

				// Enhanced content summarization
				const fileContentForContext = this._enhancedSummarizeFileContent(
					fileContentRaw,
					symbolsForFile,
					activeSymbolInfoForCurrentFile,
					EnhancedContextBuilder.MAX_FILE_LENGTH
				);

				const fileHeader = `--- File: ${relativePath} ---\n`;
				const contentToAdd = fileHeader + fileContentForContext + "\n\n";

				if (
					currentLength + contentToAdd.length <=
					EnhancedContextBuilder.MAX_CONTEXT_LENGTH
				) {
					context += contentToAdd;
					currentLength += contentToAdd.length;
					contentAdded = true;
				} else {
					filesSkipped++;
				}
			} catch (error) {
				console.warn(`Could not read file content for ${relativePath}:`, error);
				filesSkipped++;
			}
		}

		if (filesSkipped > 0) {
			context += `... (Content from ${filesSkipped} more files omitted due to context limit)\n`;
		}

		return context;
	}

	/**
	 * Sort files by relevance for better context prioritization
	 */
	private _sortFilesByRelevance(
		files: vscode.Uri[],
		workspaceRoot: vscode.Uri,
		activeSymbolInfo?: ActiveSymbolDetailedInfo
	): vscode.Uri[] {
		return files.sort((a, b) => {
			const aPath = path
				.relative(workspaceRoot.fsPath, a.fsPath)
				.replace(/\\/g, "/");
			const bPath = path
				.relative(workspaceRoot.fsPath, b.fsPath)
				.replace(/\\/g, "/");

			// Active symbol file gets highest priority
			if (activeSymbolInfo && aPath === activeSymbolInfo.filePath) {
				return -1;
			}
			if (activeSymbolInfo && bPath === activeSymbolInfo.filePath) {
				return 1;
			}

			// Configuration files get high priority
			const aIsConfig = this._isConfigFile(aPath);
			const bIsConfig = this._isConfigFile(bPath);
			if (aIsConfig && !bIsConfig) {
				return -1;
			}
			if (!aIsConfig && bIsConfig) {
				return 1;
			}

			// Type definition files get high priority
			const aIsTypeDef = aPath.includes(".d.ts") || aPath.includes("types/");
			const bIsTypeDef = bPath.includes(".d.ts") || bPath.includes("types/");
			if (aIsTypeDef && !bIsTypeDef) {
				return -1;
			}
			if (!aIsTypeDef && bIsTypeDef) {
				return 1;
			}

			// Smaller files get priority (easier to process)
			return aPath.length - bPath.length;
		});
	}

	/**
	 * Check if file is a configuration file
	 */
	private _isConfigFile(filePath: string): boolean {
		const configPatterns = [
			"package.json",
			"tsconfig.json",
			"webpack.config",
			"next.config",
			".env",
			".eslintrc",
			".prettierrc",
			"jest.config",
			"vite.config",
		];
		return configPatterns.some((pattern) => filePath.includes(pattern));
	}

	/**
	 * Enhanced file content summarization with better prioritization
	 */
	private _enhancedSummarizeFileContent(
		fileContent: string,
		documentSymbols: vscode.DocumentSymbol[] | undefined,
		activeSymbolDetailedInfo: ActiveSymbolDetailedInfo | undefined,
		maxAllowedLength: number
	): string {
		// Use the existing intelligentlySummarizeFileContent but with enhanced parameters
		return intelligentlySummarizeFileContent(
			fileContent,
			documentSymbols,
			activeSymbolDetailedInfo,
			maxAllowedLength
		);
	}
}

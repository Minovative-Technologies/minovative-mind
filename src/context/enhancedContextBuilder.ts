import * as vscode from "vscode";
import * as path from "path";
import { createAsciiTree } from "../utilities/treeFormatter";
import { FileChangeEntry } from "../types/workflow";
import { ActiveSymbolDetailedInfo } from "../services/contextService";
import { intelligentlySummarizeFileContent } from "./fileContentProcessor";

/**
 * Cache entry for enhanced context
 */
interface ContextCacheEntry {
	context: string;
	timestamp: number;
	fileHashes: Map<string, string>;
	optionsHash: string;
}

/**
 * Enhanced context builder that provides more accurate and relevant context
 * to improve AI code generation accuracy with caching support
 */
export class EnhancedContextBuilder {
	private static readonly MAX_CONTEXT_LENGTH = 100000; // Increased for better accuracy
	private static readonly MAX_FILE_LENGTH = 15000; // Increased for better file understanding
	private static readonly MAX_SYMBOL_CHARS = 8000; // Increased for better symbol understanding

	// Cache configuration
	private static readonly CACHE_MAX_SIZE = 50; // Maximum number of cached entries
	private static readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes TTL
	private static readonly CACHE_STALENESS_THRESHOLD = 2 * 60 * 1000; // 2 minutes staleness threshold

	// Context cache
	private contextCache = new Map<string, ContextCacheEntry>();
	private cacheHits = 0;
	private cacheMisses = 0;

	/**
	 * Build enhanced context with caching support
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
		// Try to get cached context first
		const cacheKey = this._generateContextCacheKey(
			relevantFiles,
			workspaceRoot,
			options
		);
		const cached = this.contextCache.get(cacheKey);

		if (cached && !this._isContextStale(cached, relevantFiles, workspaceRoot)) {
			this.cacheHits++;
			console.log(
				`[EnhancedContextBuilder] Cache hit for context with ${relevantFiles.length} files`
			);
			return cached.context;
		}

		this.cacheMisses++;
		console.log(
			`[EnhancedContextBuilder] Cache miss for context with ${relevantFiles.length} files`
		);

		// Build fresh context
		const freshContext = await this._buildFreshContext(
			relevantFiles,
			workspaceRoot,
			options
		);

		// Cache the fresh context
		this._cacheContext(
			cacheKey,
			freshContext,
			relevantFiles,
			workspaceRoot,
			options
		);

		return freshContext;
	}

	/**
	 * Generate a cache key for the context
	 */
	private _generateContextCacheKey(
		relevantFiles: vscode.Uri[],
		workspaceRoot: vscode.Uri,
		options: any
	): string {
		// Create a deterministic cache key based on file paths and options
		const filePaths = relevantFiles
			.map((uri) => path.relative(workspaceRoot.fsPath, uri.fsPath))
			.sort()
			.join("|");

		const optionsHash = this._hashOptions(options);

		return `${workspaceRoot.fsPath}|${filePaths}|${optionsHash}`;
	}

	/**
	 * Hash options for cache key generation
	 */
	private _hashOptions(options: any): string {
		const relevantOptions = {
			userRequest: options.userRequest,
			activeSymbolPath: options.activeSymbolInfo?.filePath,
			recentChangesCount: options.recentChanges?.length || 0,
			diagnosticsCount: options.diagnostics?.length || 0,
			chatHistoryCount: options.chatHistory?.length || 0,
		};

		return JSON.stringify(relevantOptions);
	}

	/**
	 * Check if cached context is stale
	 */
	private async _isContextStale(
		cached: ContextCacheEntry,
		relevantFiles: vscode.Uri[],
		workspaceRoot: vscode.Uri
	): Promise<boolean> {
		// Check if cache entry is too old
		const now = Date.now();
		if (now - cached.timestamp > EnhancedContextBuilder.CACHE_TTL) {
			return true;
		}

		// Check if any files have been modified since cache was created
		for (const fileUri of relevantFiles) {
			try {
				const stats = await vscode.workspace.fs.stat(fileUri);
				const fileHash = `${stats.mtime}-${stats.size}`;
				const cachedHash = cached.fileHashes.get(fileUri.fsPath);

				if (cachedHash !== fileHash) {
					console.log(
						`[EnhancedContextBuilder] File ${fileUri.fsPath} has changed, invalidating cache`
					);
					return true;
				}
			} catch (error) {
				console.warn(
					`[EnhancedContextBuilder] Could not check file stats for ${fileUri.fsPath}:`,
					error
				);
				return true; // Assume stale if we can't check
			}
		}

		return false;
	}

	/**
	 * Cache context with file hashes
	 */
	private async _cacheContext(
		cacheKey: string,
		context: string,
		relevantFiles: vscode.Uri[],
		workspaceRoot: vscode.Uri,
		options: any
	): Promise<void> {
		// Collect file hashes for staleness detection
		const fileHashes = new Map<string, string>();

		for (const fileUri of relevantFiles) {
			try {
				const stats = await vscode.workspace.fs.stat(fileUri);
				const fileHash = `${stats.mtime}-${stats.size}`;
				fileHashes.set(fileUri.fsPath, fileHash);
			} catch (error) {
				console.warn(
					`[EnhancedContextBuilder] Could not get file stats for ${fileUri.fsPath}:`,
					error
				);
			}
		}

		const cacheEntry: ContextCacheEntry = {
			context,
			timestamp: Date.now(),
			fileHashes,
			optionsHash: this._hashOptions(options),
		};

		// Manage cache size
		if (this.contextCache.size >= EnhancedContextBuilder.CACHE_MAX_SIZE) {
			this._evictOldestCacheEntry();
		}

		this.contextCache.set(cacheKey, cacheEntry);
		console.log(
			`[EnhancedContextBuilder] Cached context for ${relevantFiles.length} files`
		);
	}

	/**
	 * Evict the oldest cache entry when cache is full
	 */
	private _evictOldestCacheEntry(): void {
		let oldestKey: string | undefined;
		let oldestTimestamp = Date.now();

		for (const [key, entry] of this.contextCache.entries()) {
			if (entry.timestamp < oldestTimestamp) {
				oldestTimestamp = entry.timestamp;
				oldestKey = key;
			}
		}

		if (oldestKey) {
			this.contextCache.delete(oldestKey);
			console.log(`[EnhancedContextBuilder] Evicted oldest cache entry`);
		}
	}

	/**
	 * Build fresh context (original implementation)
	 */
	private async _buildFreshContext(
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

	/**
	 * Get cache statistics
	 */
	public getCacheStats(): { hits: number; misses: number; size: number } {
		return {
			hits: this.cacheHits,
			misses: this.cacheMisses,
			size: this.contextCache.size,
		};
	}

	/**
	 * Clear the context cache
	 */
	public clearCache(): void {
		this.contextCache.clear();
		this.cacheHits = 0;
		this.cacheMisses = 0;
		console.log(`[EnhancedContextBuilder] Cache cleared`);
	}

	/**
	 * Preload context for frequently accessed files
	 */
	public async preloadContext(
		relevantFiles: vscode.Uri[],
		workspaceRoot: vscode.Uri,
		options: any = {}
	): Promise<void> {
		try {
			await this.buildEnhancedContext(relevantFiles, workspaceRoot, options);
			console.log(
				`[EnhancedContextBuilder] Preloaded context for ${relevantFiles.length} files`
			);
		} catch (error) {
			console.warn(
				`[EnhancedContextBuilder] Failed to preload context:`,
				error
			);
		}
	}
}

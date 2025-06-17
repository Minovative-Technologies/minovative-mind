import * as ts from "typescript";
import * as vscode from "vscode";
import { TextDecoder } from "util";
import * as path from "path";

/**
 * Finds and loads a tsconfig.json or jsconfig.json file within the given project root.
 * If not found, returns a default ParsedCommandLine.
 * @param projectRoot The root URI of the project.
 * @returns A Promise resolving to a ParsedCommandLine object.
 */
export async function findAndLoadTsConfig(
	projectRoot: vscode.Uri
): Promise<ts.ParsedCommandLine> {
	// Use ts.sys.findConfigFile as it expects synchronous file system checks,
	// which vscode.workspace.fs does not provide directly.
	// This allows us to find the config file path efficiently using Node.js FS APIs,
	// then read its content using vscode.workspace.fs.
	const tsConfigPath = ts.findConfigFile(
		projectRoot.fsPath,
		ts.sys.fileExists, // Use ts.sys for the synchronous file existence check
		"tsconfig.json"
	);

	const jsConfigPath = ts.findConfigFile(
		projectRoot.fsPath,
		ts.sys.fileExists, // Use ts.sys for the synchronous file existence check
		"jsconfig.json"
	);

	const configFilePath = tsConfigPath || jsConfigPath;

	const defaultParsedConfig: ts.ParsedCommandLine = {
		options: {
			moduleResolution: ts.ModuleResolutionKind.Node10, // Updated from NodeJs to Node10
			target: ts.ScriptTarget.ES2016, // A reasonable default
			module: ts.ModuleKind.CommonJS, // A reasonable default
			jsx: ts.JsxEmit.React, // Common for modern JS/TS projects
			allowJs: true, // Allow JS files to be part of the project
			checkJs: false, // Do not type-check JS files by default
			esModuleInterop: true, // Enable for better module interop
			forceConsistentCasingInFileNames: true, // Ensure consistent casing
			strict: true, // Enable all strict type-checking options
			skipLibCheck: true, // Skip type checking of all declaration files (*.d.ts)
		},
		fileNames: [],
		errors: [],
		raw: {},
	};

	if (!configFilePath) {
		return defaultParsedConfig;
	}

	let configContent: string | undefined;
	try {
		const buffer = await vscode.workspace.fs.readFile(
			vscode.Uri.file(configFilePath)
		);
		configContent = new TextDecoder("utf-8").decode(buffer);
	} catch (e) {
		console.error(`Failed to read config file ${configFilePath}: ${e}`);
		return defaultParsedConfig;
	}

	if (!configContent) {
		return defaultParsedConfig;
	}

	const json = ts.parseConfigFileTextToJson(configFilePath, configContent);
	if (json.error) {
		// Log the error but return default options as parsing failed
		console.error(
			`Failed to parse config file JSON ${configFilePath}: ${json.error.messageText}`
		);
		return defaultParsedConfig;
	}

	const configDirectory = path.dirname(configFilePath);

	// Create a ParseConfigHost specifically for ts.parseJsonConfigFileContent
	// This host is used by TypeScript to resolve 'extends' clauses and other references
	// within the tsconfig.json itself. It now uses ts.sys for synchronous operations.
	const parseConfigHost: ts.ParseConfigHost = {
		useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames, // Use TypeScript's internal check for case sensitivity
		readDirectory: (
			rootDir: string,
			extensions?: readonly string[],
			exclude?: readonly string[],
			include?: readonly string[],
			depth?: number
		): string[] => {
			return ts.sys.readDirectory(rootDir, extensions, exclude, include, depth);
		},
		fileExists: (filePath: string): boolean => {
			return ts.sys.fileExists(filePath);
		},
		readFile: (filePath: string): string | undefined => {
			return ts.sys.readFile(filePath);
		},
	};

	const parsedConfig = ts.parseJsonConfigFileContent(
		json.config,
		parseConfigHost,
		configDirectory,
		undefined, // existingOptions
		configFilePath
	);

	// If parsing resulted in very minimal options (e.g., extends only),
	// merge with our default options to ensure a complete set.
	if (!parsedConfig.options || Object.keys(parsedConfig.options).length === 0) {
		parsedConfig.options = {
			...defaultParsedConfig.options,
			...parsedConfig.options,
		};
	}

	return parsedConfig;
}

/**
 * Creates a TypeScript CompilerHost implementation.
 * This host now uses `ts.sys` for all file system operations and
 * fully conforms to the synchronous `ts.CompilerHost` interface.
 *
 * @param projectRoot The root URI of the project.
 * @param compilerOptions The compiler options to use for this host.
 * @returns An object implementing ts.CompilerHost.
 */
export function createProjectCompilerHost(
	projectRoot: vscode.Uri,
	compilerOptions: ts.CompilerOptions
): ts.CompilerHost {
	return {
		// Required ts.CompilerHost methods - implemented using ts.sys
		fileExists: (filePath: string): boolean => {
			return ts.sys.fileExists(filePath);
		},

		readFile: (filePath: string): string | undefined => {
			return ts.sys.readFile(filePath);
		},

		// Optional but highly recommended methods for better performance and correctness
		directoryExists: (directoryPath: string): boolean => {
			return ts.sys.directoryExists(directoryPath);
		},

		readDirectory: (
			path: string,
			extensions?: readonly string[],
			exclude?: readonly string[],
			include?: readonly string[],
			depth?: number
		): string[] => {
			return ts.sys.readDirectory(path, extensions, exclude, include, depth);
		},

		// Standard ts.CompilerHost methods that are synchronous and don't require FS access
		getCanonicalFileName: (fileName: string): string => {
			// Normalize path separators and handle case-insensitivity based on OS.
			// ts.sys.useCaseSensitiveFileNames provides the correct flag for the current environment.
			return ts.sys.useCaseSensitiveFileNames
				? path.normalize(fileName)
				: path.normalize(fileName).toLowerCase();
		},

		getCurrentDirectory: (): string => {
			return projectRoot.fsPath;
		},

		getNewLine: (): string => {
			return ts.sys.newLine;
		},

		// writeFile is often required for emitting compiled files.
		writeFile: (
			filePath: string,
			contents: string,
			writeByteOrderMark: boolean
		) => {
			ts.sys.writeFile(filePath, contents, writeByteOrderMark);
		},

		// Provide ts.sys.useCaseSensitiveFileNames as a function
		useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,

		// New methods added
		getSourceFile: (
			fileName: string,
			languageVersion: ts.ScriptTarget,
			onError?: (message: string) => void,
			shouldCreateNewSourceFile?: boolean
		): ts.SourceFile | undefined => {
			const fileContent = ts.sys.readFile(fileName);
			if (fileContent === undefined) {
				onError?.(`File not found or unreadable: ${fileName}`);
				return undefined;
			}
			return ts.createSourceFile(
				fileName,
				fileContent,
				languageVersion,
				shouldCreateNewSourceFile
			);
		},

		getDefaultLibFileName: (options: ts.CompilerOptions): string => {
			return ts.getDefaultLibFilePath(options);
		},

		realpath: ts.sys.realpath,
	};
}

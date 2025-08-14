// src/utils/codeAnalysisUtils.ts
import * as vscode from "vscode";
import * as path from "path";
import { FileStructureAnalysis } from "../types/codeGenerationTypes";
import { DEFAULT_SIZE } from "../sidebar/common/sidebarConstants";

/**
 * Get language ID from file extension
 */
export function getLanguageId(extension: string): string {
	const languageMap: Record<string, string> = {
		".ts": "typescript",
		".tsx": "typescript",
		".js": "javascript",
		".jsx": "javascript",
		".py": "python",
		".java": "java",
		".cs": "csharp",
		".cpp": "cpp",
		".c": "c",
		".go": "go",
		".rs": "rust",
		".php": "php",
		".rb": "ruby",
		".swift": "swift",
		".kt": "kotlin",
	};

	return languageMap[extension] || "text";
}

/**
 * Extracts a code snippet around a given line number.
 */
export function getCodeSnippet(
	fullContent: string,
	lineNumber: number,
	linesBefore: number = 2,
	linesAfter: number = 2
): string {
	const lines = fullContent.split("\n");
	const zeroBasedLineNumber = lineNumber - 1;

	const start = Math.max(0, zeroBasedLineNumber - linesBefore);
	const end = Math.min(lines.length - 1, zeroBasedLineNumber + linesAfter);

	const snippetLines: string[] = [];
	const maxLineNumLength = String(end + 1).length;

	for (let i = start; i <= end; i++) {
		const currentLineNum = i + 1;
		const paddedLineNum = String(currentLineNum).padStart(
			maxLineNumLength,
			" "
		);
		snippetLines.push(`${paddedLineNum}: ${lines[i]}`);
	}

	return snippetLines.join("\n");
}

/**
 * Analyze file structure for modification context
 */
export async function analyzeFileStructure(
	filePath: string,
	content: string
): Promise<FileStructureAnalysis> {
	const lines = content.split("\n");
	const structure: FileStructureAnalysis = {
		imports: [],
		exports: [],
		functions: [],
		classes: [],
		variables: [],
		comments: [],
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		if (line.startsWith("import ")) {
			structure.imports.push({ line: i + 1, content: line });
		} else if (line.startsWith("export ")) {
			structure.exports.push({ line: i + 1, content: line });
		} else if (line.includes("function ") || line.includes("=>")) {
			structure.functions.push({ line: i + 1, content: line });
		} else if (line.includes("class ")) {
			structure.classes.push({ line: i + 1, content: line });
		} else if (
			line.includes("const ") ||
			line.includes("let ") ||
			line.includes("var ")
		) {
			structure.variables.push({ line: i + 1, content: line });
		} else if (line.startsWith("//") || line.startsWith("/*")) {
			structure.comments.push({ line: i + 1, content: line });
		}
	}

	return structure;
}

/**
 * Heuristically determines if the AI's raw text output is likely an error message
 */
export function isAIOutputLikelyErrorMessage(content: string): boolean {
	const lowerContent = content.toLowerCase().trim();
	const errorPhrases = [
		"i am sorry",
		"i'm sorry",
		"i cannot fulfill this request",
		"i encountered an error",
		"i ran into an issue",
		"an error occurred",
		"i am unable to provide",
		"please try again",
		"i couldn't generate",
		"i'm having trouble",
		"error:",
		"failure:",
		"exception:",
		"i can't",
		"i am not able to",
		"as an ai model",
		"i lack the ability to",
		"insufficient information",
		"invalid request",
		"not enough context",
	];
	const systemErrorPhrases = [
		"access denied",
		"file not found",
		"permission denied",
		"timeout",
		"rate limit",
		"quota exceeded",
		"server error",
		"api error",
	];
	const allErrorPhrases = [...errorPhrases, ...systemErrorPhrases];

	if (allErrorPhrases.some((phrase) => lowerContent.includes(phrase))) {
		return true;
	}
	if (
		content.length < 200 &&
		(lowerContent.includes("error") ||
			lowerContent.includes("fail") ||
			lowerContent.includes("issue"))
	) {
		return true;
	}

	const markdownErrorPattern =
		/(?:[a-zA-Z0-9]+)?\s*(error|fail|exception|apology|i am sorry)[\s\S]*?/i;
	return markdownErrorPattern.test(content);
}

/**
 * Heuristically determines if the user's prompt indicates an intent for a major rewrite.
 */
export function isRewriteIntentDetected(
	prompt: string,
	filePath?: string
): boolean {
	const lowerPrompt = prompt.toLowerCase();
	const rewriteKeywords = [
		"rewrite",
		"replace entirely",
		"generate from scratch",
		"completely change",
		"full overhaul",
		"start fresh",
		"reimplement",
		"rebuild",
		"design from scratch",
		"new implementation",
		"complete refactor",
	];

	if (rewriteKeywords.some((keyword) => lowerPrompt.includes(keyword))) {
		return true;
	}

	if (filePath) {
		const fileBaseName = path.basename(filePath).toLowerCase();
		if (
			lowerPrompt.includes(`completely change file ${fileBaseName}`) ||
			lowerPrompt.includes(`completely change this file`) ||
			lowerPrompt.includes(`rewrite file ${fileBaseName}`) ||
			lowerPrompt.includes(`rewrite this file`)
		) {
			return true;
		}
	}

	return false;
}

/**
 * Formats contents of selected file URIs into Markdown fenced code blocks.
 */
export async function formatSelectedFilesIntoSnippets(
	fileUris: vscode.Uri[],
	workspaceRoot: vscode.Uri,
	token: vscode.CancellationToken
): Promise<string> {
	if (!fileUris || fileUris.length === 0) {
		return "";
	}

	const formattedSnippets: string[] = [];
	const maxFileSizeForSnippet = DEFAULT_SIZE;

	for (const fileUri of fileUris) {
		if (token.isCancellationRequested) {
			break;
		}

		const relativePath = path
			.relative(workspaceRoot.fsPath, fileUri.fsPath)
			.replace(/\\/g, "/");
		let languageId =
			path.extname(fileUri.fsPath).substring(1) ||
			path.basename(fileUri.fsPath).toLowerCase();

		const langMap: { [key: string]: string } = {
			makefile: "makefile",
			dockerfile: "dockerfile",
			jsonc: "json",
			eslintignore: "ignore",
			prettierignore: "ignore",
			gitignore: "ignore",
			license: "plaintext",
		};
		languageId = langMap[languageId] || languageId;

		try {
			const fileStat = await vscode.workspace.fs.stat(fileUri);
			if (fileStat.type === vscode.FileType.Directory) {
				continue;
			}

			if (fileStat.size > maxFileSizeForSnippet) {
				formattedSnippets.push(
					`--- Relevant File: ${relativePath} ---\n\`\`\`plaintext\n[File skipped: too large]\n\`\`\`\n`
				);
				continue;
			}

			const contentBuffer = await vscode.workspace.fs.readFile(fileUri);
			const content = Buffer.from(contentBuffer).toString("utf8");

			if (content.includes("\0")) {
				formattedSnippets.push(
					`--- Relevant File: ${relativePath} ---\n\`\`\`plaintext\n[File skipped: appears to be binary]\n\`\`\`\n`
				);
				continue;
			}

			formattedSnippets.push(
				`--- Relevant File: ${relativePath} ---\n\`\`\`${languageId}\n${content}\n\`\`\`\n`
			);
		} catch (error: any) {
			formattedSnippets.push(
				`--- Relevant File: ${relativePath} ---\n\`\`\`plaintext\n[File skipped: could not be read: ${error.message}]\n\`\`\`\n`
			);
		}
	}

	return formattedSnippets.join("\n");
}

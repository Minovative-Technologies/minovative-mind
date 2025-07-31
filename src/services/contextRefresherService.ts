// src/services/contextRefresherService.ts
import * as vscode from "vscode";
import * as path from "path";
import { ContextService } from "./contextService";
import { ProjectChangeLogger } from "../workflow/ProjectChangeLogger";
import {
	EnhancedGenerationContext,
	CodeIssue,
} from "../types/codeGenerationTypes";
import {
	getLanguageId,
	formatSelectedFilesIntoSnippets,
} from "../utils/codeAnalysisUtils";
import {
	formatGroupedIssuesForPrompt,
	groupAndPrioritizeIssues,
} from "../utils/issueProcessingUtils";
import { formatSuccessfulChangesForPrompt } from "../workflow/changeHistoryFormatter";

export class ContextRefresherService {
	constructor(
		private contextService: ContextService,
		private changeLogger: ProjectChangeLogger,
		private workspaceRoot: vscode.Uri
	) {}

	public async refreshErrorFocusedContext(
		filePath: string,
		currentContent: string,
		currentIssues: CodeIssue[],
		currentContext: EnhancedGenerationContext,
		token?: vscode.CancellationToken
	): Promise<EnhancedGenerationContext> {
		if (currentIssues.length === 0) {
			return currentContext;
		}

		try {
			const languageId = getLanguageId(path.extname(filePath));
			const documentUri = vscode.Uri.file(filePath);

			const editorContextForRefresh = {
				filePath: filePath,
				fullText: currentContent,
				languageId: languageId,
				documentUri: documentUri,
				selection: new vscode.Range(0, 0, 0, 0),
				instruction: "",
				selectedText: "",
			};

			const formattedDiagnostics = formatGroupedIssuesForPrompt(
				groupAndPrioritizeIssues(currentIssues),
				languageId,
				currentContent
			);

			const refreshResult = await this.contextService.buildProjectContext(
				token,
				undefined,
				editorContextForRefresh,
				formattedDiagnostics,
				{ useAISelectionCache: false, enablePerformanceMonitoring: false },
				false,
				false
			);

			const relevantFileUris = refreshResult.relevantFiles.map((rfPath) =>
				vscode.Uri.joinPath(this.workspaceRoot, rfPath)
			);

			const effectiveToken =
				token ?? new vscode.CancellationTokenSource().token;
			const relevantSnippetsContent = await formatSelectedFilesIntoSnippets(
				relevantFileUris,
				this.workspaceRoot,
				effectiveToken
			);

			return {
				...currentContext,
				projectContext: refreshResult.contextString,
				relevantFiles: refreshResult.relevantFiles.join("\n"),
				relevantSnippets: relevantSnippetsContent,
				activeSymbolInfo: refreshResult.activeSymbolDetailedInfo,
				successfulChangeHistory: formatSuccessfulChangesForPrompt(
					this.changeLogger.getCompletedPlanChangeSets()
				),
			};
		} catch (error: any) {
			console.error(
				`Error refreshing error-focused context for ${filePath}:`,
				error
			);
			return currentContext;
		}
	}
}

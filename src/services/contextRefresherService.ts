import * as vscode from "vscode";
import * as path from "path";
import { ContextService } from "./contextService";
import { ProjectChangeLogger } from "../workflow/ProjectChangeLogger";
import {
	EnhancedGenerationContext,
	CodeIssue,
} from "../types/codeGenerationTypes";
import { getLanguageId } from "../utils/codeAnalysisUtils";
import {
	formatGroupedIssuesForPrompt,
	groupAndPrioritizeIssues,
} from "../utils/issueProcessingUtils";

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

			const formattedDiagnostics = formatGroupedIssuesForPrompt(
				groupAndPrioritizeIssues(currentIssues),
				languageId,
				currentContent
			);

			return {
				...currentContext,
				projectContext: formattedDiagnostics,
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

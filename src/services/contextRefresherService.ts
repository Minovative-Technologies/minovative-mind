import * as vscode from "vscode";
import * as path from "path";
import { ContextService } from "./contextService";
import { ProjectChangeLogger } from "../workflow/ProjectChangeLogger";
import {
	EnhancedGenerationContext,
	CodeIssue,
} from "../types/codeGenerationTypes";
import { DiagnosticService } from "../utils/diagnosticUtils"; // New import

export class ContextRefresherService {
	constructor(
		private contextService: ContextService,
		private changeLogger: ProjectChangeLogger,
		private workspaceRoot: vscode.Uri
	) {}

	public async refreshErrorFocusedContext(
		filePath: string,
		currentContent: string, // Parameter kept for signature compatibility, no longer used internally
		currentIssues: CodeIssue[], // Parameter kept for signature compatibility, no longer used internally
		currentContext: EnhancedGenerationContext,
		token?: vscode.CancellationToken
	): Promise<EnhancedGenerationContext> {
		// The original `if (currentIssues.length === 0)` check is now implicitly handled
		// by `DiagnosticService.formatContextualDiagnostics`, which returns `undefined`
		// if no diagnostics are found for the file.

		try {
			const fileUri = vscode.Uri.file(filePath);

			const formattedDiagnostics =
				await DiagnosticService.formatContextualDiagnostics(
					fileUri,
					this.workspaceRoot,
					undefined, // selection: No specific text selection focus for this context
					undefined, // maxTotalChars: Use default from DiagnosticService (25000 chars)
					25, // maxPerSeverity: Include up to 25 diagnostics per severity level.
					token,
					[
						// includeSeverities: For issue resolution ('fix' request type), all severities are relevant.
						vscode.DiagnosticSeverity.Error,
						vscode.DiagnosticSeverity.Warning,
						vscode.DiagnosticSeverity.Information,
						vscode.DiagnosticSeverity.Hint,
					]
				);

			if (!formattedDiagnostics) {
				// If no diagnostics were found or formatted by the DiagnosticService,
				// return the current context without changes to projectContext.
				return currentContext;
			}

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

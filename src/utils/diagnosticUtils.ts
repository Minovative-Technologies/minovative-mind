import * as vscode from "vscode";
import * as path from "path";

interface FormattedDiagnostic {
	filePath: string;
	range: vscode.Range;
	severity: vscode.DiagnosticSeverity;
	message: string;
}

function getSeverityName(severity: vscode.DiagnosticSeverity): string {
	switch (severity) {
		case vscode.DiagnosticSeverity.Error:
			return "Error";
		case vscode.DiagnosticSeverity.Warning:
			return "Warning";
		case vscode.DiagnosticSeverity.Information:
			return "Info";
		case vscode.DiagnosticSeverity.Hint:
			return "Hint";
		default:
			return "Unknown";
	}
}

export class DiagnosticService {
	/**
	 * Retrieves all diagnostics for a given URI.
	 * @param uri The URI of the document.
	 * @returns An array of vscode.Diagnostic objects.
	 */
	public static getDiagnosticsForUri(uri: vscode.Uri): vscode.Diagnostic[] {
		return vscode.languages.getDiagnostics(uri);
	}

	/**
	 * Filters, prioritizes, and formats diagnostics into a string for AI context.
	 *
	 * @param documentUri The URI of the document to get diagnostics for.
	 * @param workspaceRoot The root URI of the workspace for relative paths.
	 * @param selection An optional vscode.Range representing the user's text selection.
	 * @param maxTotalChars The maximum character length for the output string.
	 * @param maxPerSeverity The maximum number of diagnostics to include per severity level when no selection.
	 * @returns A formatted string of diagnostics, or undefined if no relevant diagnostics.
	 */
	public static formatContextualDiagnostics(
		documentUri: vscode.Uri,
		workspaceRoot: vscode.Uri,
		selection?: vscode.Range,
		maxTotalChars: number = 25000,
		maxPerSeverity: number = 25
	): string | undefined {
		const allDiagnostics = DiagnosticService.getDiagnosticsForUri(documentUri);
		if (!allDiagnostics || allDiagnostics.length === 0) {
			return undefined;
		}

		let filteredDiagnostics: vscode.Diagnostic[] = [];

		if (selection) {
			// Scenario 1: User has a selection - prioritize diagnostics within selection
			filteredDiagnostics = allDiagnostics.filter((d) =>
				selection.intersection(d.range)
			);
			// Sort by severity (Error > Warning > Info > Hint) and then by line number
			filteredDiagnostics.sort((a, b) => {
				if (a.severity !== b.severity) {
					return a.severity - b.severity; // Lower severity value means higher priority (Error=0, Warning=1...)
				}
				return a.range.start.line - b.range.start.line;
			});
		} else {
			// Scenario 2: No selection (whole file) - prioritize errors over warnings
			// Filter out hints as they are often less critical for AI fixes
			const relevantDiagnostics = allDiagnostics.filter(
				(d) => d.severity !== vscode.DiagnosticSeverity.Hint
			);

			const errors = relevantDiagnostics.filter(
				(d) => d.severity === vscode.DiagnosticSeverity.Error
			);
			const warnings = relevantDiagnostics.filter(
				(d) => d.severity === vscode.DiagnosticSeverity.Warning
			);
			const infos = relevantDiagnostics.filter(
				(d) => d.severity === vscode.DiagnosticSeverity.Information
			);

			// Sort each group by line number
			errors.sort((a, b) => a.range.start.line - b.range.start.line);
			warnings.sort((a, b) => a.range.start.line - b.range.start.line);
			infos.sort((a, b) => a.range.start.line - b.range.start.line);

			// Combine: All errors, then limited warnings, then limited infos
			filteredDiagnostics.push(...errors);
			filteredDiagnostics.push(...warnings.slice(0, maxPerSeverity));
			filteredDiagnostics.push(...infos.slice(0, maxPerSeverity / 2)); // Half as many infos
		}

		if (filteredDiagnostics.length === 0) {
			return undefined;
		}

		let diagnosticsString = "--- Relevant Diagnostics ---\n";
		let currentLength = diagnosticsString.length;
		const relativePath = path
			.relative(workspaceRoot.fsPath, documentUri.fsPath)
			.replace(/\\/g, "/");

		for (const diag of filteredDiagnostics) {
			const diagLine = `- [${getSeverityName(diag.severity)}] ${relativePath}:${
				diag.range.start.line + 1
			}:${diag.range.start.character + 1} - ${diag.message}\n`;

			if (currentLength + diagLine.length > maxTotalChars) {
				diagnosticsString += `... (${
					filteredDiagnostics.length - filteredDiagnostics.indexOf(diag)
				} more diagnostics truncated)\n`;
				break;
			}
			diagnosticsString += diagLine;
			currentLength += diagLine.length;
		}

		diagnosticsString += "--- End Relevant Diagnostics ---\n";
		return diagnosticsString;
	}
}

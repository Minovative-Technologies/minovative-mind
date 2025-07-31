// src/services/codeValidationService.ts
import * as vscode from "vscode";
import { CodeValidationResult, CodeIssue } from "../types/codeGenerationTypes";
import { DiagnosticService, getSeverityName } from "../utils/diagnosticUtils";
import { cleanCodeOutput } from "../utils/codeUtils";

export class CodeValidationService {
	constructor(private diagnosticService: DiagnosticService) {}

	/**
	 * Validate code for common issues using VS Code's diagnostic service.
	 */
	public async validateCode(
		filePath: string,
		content: string
	): Promise<CodeValidationResult> {
		const issues: CodeIssue[] = [];
		const suggestions: string[] = [];
		let hasError = false;

		const fileUri = vscode.Uri.file(filePath);
		const diagnostics = DiagnosticService.getDiagnosticsForUri(fileUri);

		for (const diag of diagnostics) {
			const severityName = getSeverityName(diag.severity);
			let issueSeverity: CodeIssue["severity"] = "info";
			if (severityName === "Error") {
				issueSeverity = "error";
				hasError = true;
			} else if (severityName === "Warning") {
				issueSeverity = "warning";
			}

			const messageLower = diag.message.toLowerCase();
			let issueType: CodeIssue["type"] = "other";
			if (messageLower.includes("unused import")) {
				issueType = "unused_import";
			} else if (issueSeverity === "error" || messageLower.includes("syntax")) {
				issueType = "syntax";
			} else if (messageLower.includes("security")) {
				issueType = "security";
			} else if (messageLower.includes("best practice")) {
				issueType = "best_practice";
			}

			let issueCode: string | number | undefined;
			if (
				typeof diag.code === "object" &&
				diag.code !== null &&
				"value" in diag.code
			) {
				issueCode = (diag.code as { value: string | number }).value;
			} else if (
				typeof diag.code === "string" ||
				typeof diag.code === "number"
			) {
				issueCode = diag.code;
			}

			issues.push({
				type: issueType,
				message: diag.message,
				line: diag.range.start.line + 1,
				severity: issueSeverity,
				code: issueCode,
			});
		}

		if (issues.length === 0) {
			suggestions.push("Code appears to be well-structured.");
		} else {
			suggestions.push(
				"Consider addressing the identified issues for better code quality."
			);
		}

		return { isValid: !hasError, finalContent: content, issues, suggestions };
	}

	/**
	 * Checks if the raw AI response adheres to the XBEGIN_CODEX/XEND_CODEX format.
	 */
	public checkPureCodeFormat(rawAIResponse: string): CodeValidationResult {
		const issues: CodeIssue[] = [];
		const suggestions: string[] = [];
		const cleanedContent = cleanCodeOutput(rawAIResponse);
		const BEGIN_CODEX_REGEX = /XBEGIN_CODEX\n?([\s\S]*?)\n?XEND_CODEX/i;
		const delimiterMatch = rawAIResponse.match(BEGIN_CODEX_REGEX);

		if (!delimiterMatch) {
			issues.push({
				type: "format_error",
				message:
					"AI response did not contain the required XBEGIN_CODEX/XEND_CODEX delimiters.",
				line: 1,
				severity: "error",
				source: "PureCodeFormatCheck",
			});
			suggestions.push(
				"Instruct the AI to generate only code within delimiters."
			);
		} else if (delimiterMatch[1]?.trim().length === 0) {
			issues.push({
				type: "format_error",
				message: "AI response contained delimiters but no content within them.",
				line: 1,
				severity: "error",
				source: "PureCodeFormatCheck",
			});
			suggestions.push(
				"Instruct the AI to generate code, not just conversational filler."
			);
		}

		return {
			isValid: issues.length === 0,
			finalContent: cleanedContent,
			issues,
			suggestions,
		};
	}
}

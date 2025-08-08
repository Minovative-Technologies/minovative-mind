// src/services/codeValidationService.ts
import * as vscode from "vscode";
import { CodeValidationResult, CodeIssue } from "../types/codeGenerationTypes";
import { DiagnosticService, getSeverityName } from "../utils/diagnosticUtils";
import { cleanCodeOutput } from "../utils/codeUtils";
import { BEGIN_CODEX_REGEX } from "../utils/extractingDelimiters";

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
		let finalContent = content; // Initialize finalContent with original content

		// Locate the call to this.checkPureCodeFormat(content) and change it to this.checkPureCodeFormat(content, false)
		// This assumes 'content' passed to validateCode should not have delimiters.
		const pureCodeFormatResult = this.checkPureCodeFormat(content, false);
		issues.push(...pureCodeFormatResult.issues);
		suggestions.push(...pureCodeFormatResult.suggestions);
		finalContent = pureCodeFormatResult.finalContent; // Update finalContent based on stripping
		if (!pureCodeFormatResult.isValid) {
			// If checkPureCodeFormat found an "error" severity issue, mark as hasError
			if (pureCodeFormatResult.issues.some(issue => issue.severity === "error")) {
				hasError = true;
			}
		}

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

		return { isValid: !hasError, finalContent: finalContent, issues, suggestions };
	}

	/**
	 * Checks if the raw AI response adheres to the XBEGIN_CODEX/XEND_CODEX format.
	 * @param rawAIResponse The raw string response from the AI.
	 * @param expectDelimiters If true, delimiters are expected and their absence/emptiness is an error.
	 *                         If false, delimiters are NOT expected, their presence is a warning, and they will be stripped.
	 * @returns A CodeValidationResult indicating format validity and the cleaned content.
	 */
	public checkPureCodeFormat(rawAIResponse: string, expectDelimiters: boolean = true): CodeValidationResult {
		const issues: CodeIssue[] = [];
		const suggestions: string[] = [];
		let finalContent = rawAIResponse; // Default to raw AI response
		
		const delimiterMatch = rawAIResponse.match(BEGIN_CODEX_REGEX);

		if (expectDelimiters) {
			// Existing delimiter checking logic wrapped
			if (!delimiterMatch) {
				// Condition 1: Delimiters are completely missing.
				issues.push({
					type: "format_error",
					message:
						"AI response did not contain the required XBEGIN_CODEX/XEND_CODEX delimiters.",
					line: 1, // Assuming the issue pertains to the overall response format
					severity: "error", // This is a critical error for AI responses expected to be delimited.
					source: "PureCodeFormatCheck",
				});
				suggestions.push(
					"Instruct the AI to generate only code within delimiters."
				);
				// finalContent remains rawAIResponse, as we couldn't reliably extract.
			} else {
				// Delimiters are present, now check if content is empty after cleaning.
				const cleanedContent = cleanCodeOutput(rawAIResponse);
				if (cleanedContent === "") {
					// Condition 2: Delimiters are present, but the content extracted by cleanCodeOutput is empty.
					// This covers cases where delimiters exist but are empty, or contain only stripped-away non-code elements.
					issues.push({
						type: "format_error",
						message:
							"AI response provided empty delimiters (XBEGIN_CODEX/XEND_CODEX) or contained only non-code elements within them.",
						line: 1, // Assuming the issue pertains to the overall response format
						severity: "error", // This is a critical error, as no actual code was provided.
						source: "PureCodeFormatCheck",
					});
					suggestions.push(
						"Ensure the AI generates actual code content within the delimiters."
					);
				}
				finalContent = cleanedContent; // Use cleaned content when delimiters are expected and found.
			}
		} else { // expectDelimiters is false
			if (delimiterMatch) {
				// Delimiters are present, but not expected. Issue a warning and strip them.
				issues.push({
					type: "format_error",
					message: "AI response contained unexpected XBEGIN_CODEX/XEND_CODEX delimiters. They have been removed.",
					line: 1, // Issue pertains to the overall response format
					severity: "warning", // Not a critical error, content is still usable after stripping.
					source: "PureCodeFormatCheck",
				});
				suggestions.push(
					"Instruct the AI not to include delimiters when generating file content directly."
				);
				finalContent = cleanCodeOutput(rawAIResponse); // Strip them
			} else {
				// Delimiters are absent and not expected. No format error generated.
				// finalContent is already rawAIResponse by default.
			}
		}

		// Determine isValid based on whether there are any 'error' severity issues
		const isValid = !issues.some(issue => issue.severity === "error");

		// Return the result object conforming to CodeValidationResult
		return {
			isValid: isValid,
			finalContent: finalContent,
			issues,
			suggestions,
		};
	}
}
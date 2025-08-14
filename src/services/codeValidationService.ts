// src/services/codeValidationService.ts
import * as vscode from "vscode";
import { CodeValidationResult, CodeIssue } from "../types/codeGenerationTypes";
import { DiagnosticService, getSeverityName } from "../utils/diagnosticUtils";
import { cleanCodeOutput } from "../utils/codeUtils";
import { BEGIN_CODEX_REGEX } from "../utils/extractingDelimiters";

/**
 * Service responsible for validating code content for various issues,
 * including format adherence, syntax errors, and best practices.
 * It integrates with VS Code's diagnostic system.
 *
 * This service relies on a properly instantiated `DiagnosticService` for VS Code diagnostics.
 * Ensure that `SidebarProvider.ts` (or any other consumer) correctly provides an instance
 * of `DiagnosticService` during construction.
 */
export class CodeValidationService {
	/**
	 * Creates an instance of CodeValidationService.
	 * @param diagnosticService An instance of DiagnosticService to retrieve VS Code diagnostics.
	 */
	constructor(private readonly diagnosticService: DiagnosticService) {}

	/**
	 * Helper to standardize CodeIssue creation.
	 * @param type The type of the code issue.
	 * @param message The message describing the issue.
	 * @param severity The severity of the issue.
	 * @param line The line number where the issue occurred (1-indexed). Defaults to 1.
	 * @param code Optional error code.
	 * @param source The source of the issue (e.g., "VSCodeDiagnostics", "PureCodeFormatCheck").
	 *               Defaults to "CodeValidationService".
	 * @returns A CodeIssue object.
	 */
	private _createIssue(
		type: CodeIssue["type"],
		message: string,
		severity: CodeIssue["severity"],
		line: number = 1,
		code?: string | number,
		source: string = "CodeValidationService"
	): CodeIssue {
		return { type, message, line, severity, code, source };
	}

	/**
	 * Maps a VS Code Diagnostic object to a CodeIssue object.
	 * This method categorizes the diagnostic into a more generalized `CodeIssue` type.
	 *
	 * @param diag The VS Code Diagnostic to map.
	 * @returns A CodeIssue object.
	 */
	private _mapVsCodeDiagnosticToCodeIssue(diag: vscode.Diagnostic): CodeIssue {
		const severityName = getSeverityName(diag.severity);
		let issueSeverity: CodeIssue["severity"];
		switch (severityName) {
			case "Error":
				issueSeverity = "error";
				break;
			case "Warning":
				issueSeverity = "warning";
				break;
			case "Info":
				issueSeverity = "info";
				break;
			case "Hint":
			default:
				issueSeverity = "info"; // Default to info for hints or unknown
				break;
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
		} else if (typeof diag.code === "string" || typeof diag.code === "number") {
			issueCode = diag.code;
		}

		return this._createIssue(
			issueType,
			diag.message,
			issueSeverity,
			diag.range.start.line + 1, // VS Code lines are 0-indexed, CodeIssue are 1-indexed
			issueCode,
			"VSCodeDiagnostics"
		);
	}

	/**
	 * Provides a default CodeValidationResult for unrecoverable error scenarios within the service.
	 * @param initialContent The content that was being processed, to be returned as `finalContent`.
	 * @param errorMessage The specific error message.
	 * @param errorSource The source of the error. Defaults to "CodeValidationService".
	 * @returns A CodeValidationResult indicating failure.
	 */
	private _getDefaultErrorResult(
		initialContent: string,
		errorMessage: string,
		errorSource: string = "CodeValidationService"
	): CodeValidationResult {
		return {
			isValid: false,
			finalContent: initialContent,
			issues: [
				this._createIssue(
					"other",
					`An internal validation error occurred: ${errorMessage}`,
					"error",
					1, // Line 1 as a general error
					"INTERNAL_SERVICE_ERROR",
					errorSource
				),
			],
			suggestions: [
				"An unexpected error occurred during validation. Please check logs for details.",
			],
		};
	}

	/**
	 * Validates code for common issues using VS Code's diagnostic service
	 * and performs format checks based on expected delimiters.
	 *
	 * @param filePath The full path to the file being validated. Used to retrieve VS Code diagnostics.
	 * @param content The string content of the code to validate.
	 * @returns A Promise that resolves to a `CodeValidationResult` detailing validation outcomes.
	 *          Returns `isValid: false` and an error issue if inputs are invalid or an unexpected error occurs.
	 */
	public async validateCode(
		filePath: string,
		content: string
	): Promise<CodeValidationResult> {
		// Guard against null/undefined/empty inputs
		if (!filePath || typeof filePath !== "string") {
			const errorMsg =
				"Invalid 'filePath' provided (null, undefined, or empty).";
			console.error(`[CodeValidationService] ${errorMsg}`);
			return this._getDefaultErrorResult(
				content ?? "",
				errorMsg,
				"validateCode"
			);
		}
		if (content === null || content === undefined) {
			const errorMsg = "Invalid 'content' provided (null or undefined).";
			console.error(`[CodeValidationService] ${errorMsg}`);
			return this._getDefaultErrorResult("", errorMsg, "validateCode");
		}

		let issues: CodeIssue[] = [];
		let suggestions: string[] = [];
		let hasError: boolean = false;
		let finalContent: string = content; // Start with the original content

		try {
			// Step 1: Check code format (delimiters, empty content within delimiters).
			// For `validateCode`, the input `content` is typically the final code,
			// which should NOT contain delimiters. If found, they are warnings and stripped.
			const pureCodeFormatResult = this.checkPureCodeFormat(content, false);
			issues.push(...pureCodeFormatResult.issues);
			suggestions.push(...pureCodeFormatResult.suggestions);
			// Update finalContent based on the format check result (delimiters might have been stripped)
			finalContent = pureCodeFormatResult.finalContent;

			// If `checkPureCodeFormat` found an "error" severity issue, mark `hasError`.
			if (
				!pureCodeFormatResult.isValid &&
				pureCodeFormatResult.issues.some((issue) => issue.severity === "error")
			) {
				hasError = true;
			}
		} catch (error: any) {
			console.error(
				`[CodeValidationService] Unexpected error during code format check for ${filePath}:`,
				error
			);
			issues.push(
				this._createIssue(
					"other",
					`An unexpected error occurred during format check: ${
						error.message || String(error)
					}`,
					"error",
					1,
					"FORMAT_CHECK_RUNTIME_ERROR",
					"PureCodeFormatCheck"
				)
			);
			hasError = true;
		}

		try {
			// Step 2: Retrieve VS Code diagnostics for the file based on its URI.
			const fileUri = vscode.Uri.file(filePath);
			// Use the injected diagnosticService instance
			const diagnostics = DiagnosticService.getDiagnosticsForUri(fileUri);

			for (const diag of diagnostics) {
				const codeIssue = this._mapVsCodeDiagnosticToCodeIssue(diag);
				issues.push(codeIssue);
				if (codeIssue.severity === "error") {
					hasError = true;
				}
			}
		} catch (error: any) {
			console.error(
				`[CodeValidationService] Unexpected error retrieving VS Code diagnostics for ${filePath}:`,
				error
			);
			issues.push(
				this._createIssue(
					"other",
					`An unexpected error occurred while retrieving VS Code diagnostics: ${
						error.message || String(error)
					}`,
					"error",
					1,
					"DIAGNOSTICS_RETRIEVAL_RUNTIME_ERROR",
					"VSCodeDiagnostics"
				)
			);
			hasError = true;
		}

		// Step 3: Add general suggestions based on issues found
		if (issues.length === 0) {
			suggestions.push(
				"Code appears to be well-structured and free of immediate issues."
			);
		} else {
			suggestions.push(
				"Consider addressing the identified issues for better code quality and correctness."
			);
		}

		return {
			isValid: !hasError,
			finalContent: finalContent,
			issues,
			suggestions,
		};
	}

	/**
	 * Checks if the raw AI response adheres to the XBEGIN_CODEX/XEND_CODEX format.
	 *
	 * @param rawAIResponse The raw string response from the AI.
	 * @param expectDelimiters If true, delimiters are expected and their absence/emptiness is an error.
	 *                         If false, delimiters are NOT expected, their presence is a warning, and they will be stripped.
	 * @returns A `CodeValidationResult` indicating format validity and the cleaned content.
	 *          Returns `isValid: false` and an error issue if `rawAIResponse` is invalid or an unexpected error occurs.
	 */
	public checkPureCodeFormat(
		rawAIResponse: string,
		expectDelimiters: boolean = true
	): CodeValidationResult {
		// Guard against null/undefined inputs
		if (rawAIResponse === null || rawAIResponse === undefined) {
			const errorMsg =
				"Invalid 'rawAIResponse' provided (null or undefined) for format check.";
			console.error(`[CodeValidationService] ${errorMsg}`);
			return this._getDefaultErrorResult("", errorMsg, "checkPureCodeFormat");
		}

		const issues: CodeIssue[] = [];
		const suggestions: string[] = [];
		let finalContent: string;
		let hasError: boolean = false; // Tracks if any 'error' severity issue was added during this check

		try {
			const delimiterMatch = rawAIResponse.match(BEGIN_CODEX_REGEX);

			if (expectDelimiters) {
				if (!delimiterMatch) {
					// Condition 1: Delimiters are completely missing when expected.
					issues.push(
						this._createIssue(
							"format_error",
							"AI response did not contain the required XBEGIN_CODEX/XEND_CODEX delimiters.",
							"error",
							1,
							"DELIMITERS_MISSING",
							"PureCodeFormatCheck"
						)
					);
					suggestions.push(
						"Instruct the AI to generate only code within delimiters (e.g., `XBEGIN_CODEX...XEND_CODEX`)."
					);
					finalContent = rawAIResponse; // Can't reliably extract, so return original content
					hasError = true;
				} else {
					// Delimiters are present, now extract content and check if it's empty after cleaning markdown fences.
					const extractedContent = delimiterMatch[1] ?? ""; // Use nullish coalescing for safety
					const cleanedContent = cleanCodeOutput(extractedContent); // Remove markdown fences from extracted content

					if (cleanedContent.trim() === "") {
						// Condition 2: Delimiters are present, but the extracted and cleaned content is empty.
						issues.push(
							this._createIssue(
								"format_error",
								"AI response provided empty delimiters (XBEGIN_CODEX/XEND_CODEX) or contained only non-code elements within them.",
								"error",
								1,
								"EMPTY_DELIMITERS",
								"PureCodeFormatCheck"
							)
						);
						suggestions.push(
							"Ensure the AI generates actual code content within the delimiters."
						);
						hasError = true;
					}
					finalContent = cleanedContent; // Use the cleaned content (stripped of delimiters and markdown fences)
				}
			} else {
				// expectDelimiters is false
				if (delimiterMatch) {
					// Delimiters are present, but not expected. Issue a warning and strip them.
					issues.push(
						this._createIssue(
							"format_error",
							"AI response contained unexpected XBEGIN_CODEX/XEND_CODEX delimiters. They have been removed.",
							"warning",
							1,
							"UNEXPECTED_DELIMITERS",
							"PureCodeFormatCheck"
						)
					);
					suggestions.push(
						"Instruct the AI not to include delimiters when generating file content directly (i.e., when generating a complete file)."
					);
					finalContent = cleanCodeOutput(delimiterMatch[1] ?? ""); // Strip delimiters AND clean potential markdown inside
				} else {
					// Delimiters are absent and not expected. No format error generated.
					finalContent = cleanCodeOutput(rawAIResponse); // Simply clean markdown fences from the whole response
				}
			}
		} catch (error: any) {
			console.error(
				`[CodeValidationService] Unexpected error during pure code format check:`,
				error
			);
			return this._getDefaultErrorResult(
				rawAIResponse,
				`An unexpected error occurred during pure code format check: ${
					error.message || String(error)
				}`,
				"checkPureCodeFormat"
			);
		}

		// `isValid` is true if no 'error' severity issues were found during this format check.
		const isValid = !hasError;

		return {
			isValid: isValid,
			finalContent: finalContent,
			issues,
			suggestions,
		};
	}
}

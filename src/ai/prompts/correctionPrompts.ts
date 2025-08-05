import * as vscode from "vscode";
import * as path from "path";
import { ActiveSymbolDetailedInfo } from "../../services/contextService";
import { HistoryEntryPart } from "../../sidebar/common/sidebarTypes";
import * as sidebarTypes from "../../sidebar/common/sidebarTypes";
import { CodeIssue } from "../../ai/enhancedCodeGeneration"; // NEW: Import CodeIssue
import {
	MAX_REFERENCED_TYPE_CONTENT_CHARS_PROMPT,
	MAX_REFERENCED_TYPES_TO_INCLUDE_PROMPT,
} from "../../sidebar/common/sidebarConstants";
import { fewShotCorrectionExamples } from "./jsonFormatExamples";
import { escapeForJsonValue } from "../../utils/aiUtils";

/**
 * Encapsulates feedback from a previous failed correction attempt,
 * used to guide the AI in generating a better correction plan.
 */
export interface CorrectionFeedback {
	type:
		| "no_improvement" // Correction attempt made no improvement in issue count
		| "new_errors_introduced" // New errors were introduced by the correction
		| "parsing_failed" // AI's JSON output for the plan was malformed/invalid
		| "unreasonable_diff" // The generated diff was too drastic or illogical
		| "command_failed" // A command executed as part of the plan failed
		| "unknown" // Other or uncategorized failure
		| "oscillation_detected"; // Detected a repeating pattern of unresolved issues
	message: string; // A concise summary of the failure reason
	details?: {
		parsingError?: string;
		failedJson?: string;
		stdout?: string;
		stderr?: string;
		previousIssues?: CodeIssue[];
		currentIssues?: CodeIssue[];
	}; // More elaborate details, e.g., stack trace, specific error message
	failedJson?: string; // The malformed JSON output if parsing failed
	issuesRemaining: CodeIssue[]; // List of issues that still persist after the attempt
	issuesIntroduced?: CodeIssue[]; // List of *new* issues introduced by the attempt
	relevantDiff?: string; // The diff that caused the issues or was part of the failed attempt
}

// Helper for formatting location (single or array of vscode.Location objects).
// Attempts to make path relative using a heuristic based on editor context if available.
const formatLocation = (
	location: vscode.Location | vscode.Location[] | undefined,
	editorContext: sidebarTypes.EditorContext | undefined
): string => {
	if (!location) {
		return "N/A";
	}
	const actualLocation = Array.isArray(location)
		? location.length > 0
			? location[0]
			: undefined
		: location;
	if (!actualLocation || !actualLocation.uri) {
		return "N/A";
	}

	let formattedPath = actualLocation.uri.fsPath; // Default to absolute path

	// Heuristically try to make path relative if within the assumed workspace
	if (editorContext) {
		// Find the common root by looking for common project structures (like 'src/', 'pages/', 'app/')
		const editorPathSegments = editorContext.documentUri.fsPath.split(path.sep);
		let commonRootIndex = -1;
		// Find the deepest common ancestor that looks like a project root or a folder above src/
		for (let i = editorPathSegments.length - 1; i >= 0; i--) {
			const segment = editorPathSegments[i].toLowerCase();
			if (["src", "pages", "app"].includes(segment) && i > 0) {
				commonRootIndex = i - 1; // Take the directory above src/pages/app as root
				break;
			}
		}
		let inferredRootPath = "";
		if (commonRootIndex !== -1) {
			inferredRootPath = editorPathSegments
				.slice(0, commonRootIndex + 1)
				.join(path.sep);
		} else {
			// If no specific project structure is found, use the current workspace folder's root
			// This is a best-effort guess without an explicit workspaceRootUri being passed in.
			if (
				vscode.workspace.workspaceFolders &&
				vscode.workspace.workspaceFolders.length > 0
			) {
				inferredRootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
			}
		}

		if (
			inferredRootPath &&
			actualLocation.uri.fsPath.startsWith(inferredRootPath)
		) {
			formattedPath = path
				.relative(inferredRootPath, actualLocation.uri.fsPath)
				.replace(/\\/g, "/");
		} else {
			// Fallback to absolute if the heuristic doesn't find a good relative path
			formattedPath = actualLocation.uri.fsPath;
		}
	}

	return `${formattedPath}:${actualLocation.range.start.line + 1}`;
};

// Helper for formatting arrays of vscode.Location objects.
const formatLocations = (
	locations: vscode.Location[] | undefined,
	limit: number = 5,
	editorContext: sidebarTypes.EditorContext | undefined
): string => {
	if (!locations || locations.length === 0) {
		return "None";
	}
	const limited = locations.slice(0, limit);
	const formatted = limited
		.map((loc) => formatLocation(loc, editorContext))
		.join(", ");
	return locations.length > limit
		? `${formatted}, ... (${locations.length - limit} more)`
		: formatted;
};

// Helper for formatting Call Hierarchy (Incoming/Outgoing) data.
const formatCallHierarchy = (
	calls:
		| vscode.CallHierarchyIncomingCall[]
		| vscode.CallHierarchyOutgoingCall[]
		| undefined,
	limit: number = 5,
	editorContext: sidebarTypes.EditorContext | undefined
): string => {
	if (!calls || calls.length === 0) {
		return `No Calls`;
	}
	const limitedCalls = calls.slice(0, limit);
	const formatted = limitedCalls
		.map((call) => {
			let uri: vscode.Uri | undefined;
			let name: string = "Unknown";
			let detail: string | undefined;
			let rangeStartLine: number | undefined;

			if ("from" in call) {
				// IncomingCall
				uri = call.from.uri;
				name = call.from.name;
				detail = call.from.detail;
				rangeStartLine =
					call.fromRanges.length > 0
						? call.fromRanges[0].start.line + 1
						: undefined;
			} else if ("to" in call) {
				// OutgoingCall
				uri = call.to.uri;
				name = call.to.name;
				detail = call.to.detail;
				rangeStartLine = call.to.range.start.line + 1;
			}

			if (!uri) {
				return `${name} (N/A:URI_Missing)`;
			}

			let formattedPath = uri.fsPath; // Default to absolute path

			// Heuristically try to make path relative if within the assumed workspace
			if (editorContext) {
				const editorPathSegments = editorContext.documentUri.fsPath.split(
					path.sep
				);
				let commonRootIndex = -1;
				for (let i = editorPathSegments.length - 1; i >= 0; i--) {
					const segment = editorPathSegments[i].toLowerCase();
					if (["src", "pages", "app"].includes(segment) && i > 0) {
						commonRootIndex = i - 1;
						break;
					}
				}
				let inferredRootPath = "";
				if (commonRootIndex !== -1) {
					inferredRootPath = editorPathSegments
						.slice(0, commonRootIndex + 1)
						.join(path.sep);
				} else {
					if (
						vscode.workspace.workspaceFolders &&
						vscode.workspace.workspaceFolders.length > 0
					) {
						inferredRootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
					}
				}

				if (inferredRootPath && uri.fsPath.startsWith(inferredRootPath)) {
					formattedPath = path
						.relative(inferredRootPath, uri.fsPath)
						.replace(/\\/g, "/");
				} else {
					formattedPath = uri.fsPath;
				}
			}

			const lineInfo = rangeStartLine ? `:${rangeStartLine}` : "";
			const detailInfo = detail ? ` (Detail: ${detail})` : "";
			return `${name} (${formattedPath}${lineInfo})${detailInfo}`;
		})
		.join("\n    - ");
	const more =
		calls.length > limit ? `\n    ... (${calls.length - limit} more)` : "";
	return `    - ${formatted}${more}`;
};

// Helper for formatting CodeIssue arrays.
const formatCodeIssues = (
	issues: CodeIssue[] | undefined,
	limit: number = 3
): string => {
	if (!issues || issues.length === 0) {
		return "None";
	}
	const limited = issues.slice(0, limit);
	const formatted = limited
		.map(
			(issue) =>
				`  - [${issue.severity.toUpperCase()}] ${
					issue.type
				}: "${escapeForJsonValue(issue.message)}" at line ${issue.line}${
					issue.code ? ` (Code: ${issue.code})` : ""
				}`
		)
		.join("\n");
	return issues.length > limit
		? `${formatted}\n  ... (${issues.length - limit} more issues)`
		: formatted;
};

export function createCorrectionPlanPrompt(
	originalUserInstruction: string,
	projectContext: string,
	editorContext: sidebarTypes.EditorContext | undefined,
	chatHistory: sidebarTypes.HistoryEntry[],
	relevantSnippets: string,
	aggregatedFormattedDiagnostics: string,
	formattedRecentChanges: string,
	correctionFeedback?: CorrectionFeedback, // MODIFIED: Replaced retryReason with correctionFeedback
	activeSymbolDetailedInfo?: ActiveSymbolDetailedInfo,
	jsonEscapingInstructions: string = ""
): string {
	const chatHistoryForPrompt =
		chatHistory && chatHistory.length > 0
			? `
        --- Recent Chat History (for additional context on my train of thought and previous conversations with a AI model) ---
        ${chatHistory
					.map(
						(entry) =>
							`Role: ${entry.role}\nContent:\n${entry.parts
								.filter(
									(p): p is HistoryEntryPart & { text: string } => "text" in p
								) // Apply type guard
								.map((p) => p.text)
								.join("\n")}`
					)
					.join("\n---\n")}
        --- End Recent Chat History ---`
			: "";

	const editorContextForPrompt = editorContext
		? `
    --- Editor Context ---
    File Path: ${editorContext.filePath}
    Language: ${editorContext.languageId}
    Selected Text:
    \`\`\`${editorContext.languageId}
    ${editorContext.selectedText}
    \`\`\`
    Full Text of Affected File:
    \`\`\`${editorContext.languageId}
    ${editorContext.fullText}
    \`\`\`
    --- End Editor Context ---`
		: "";

	// MODIFIED: Replaced retryReasonSection with correctionFeedbackSection
	const correctionFeedbackSection = correctionFeedback
		? `
    --- Previous Correction Attempt Feedback ---
    Correction Type: ${correctionFeedback.type}
    Feedback Message: ${escapeForJsonValue(correctionFeedback.message)}
    ${
			correctionFeedback.details?.parsingError
				? `Parsing Error: ${escapeForJsonValue(
						correctionFeedback.details.parsingError
				  )}\n`
				: ""
		}${
				correctionFeedback.details?.failedJson
					? `Failed JSON Output (if applicable):\n\`\`\`json\n${escapeForJsonValue(
							correctionFeedback.details.failedJson
					  )}\n\`\`\`\n`
					: ""
		  }${
				correctionFeedback.details?.stdout
					? `STDOUT:\n\`\`\`\n${escapeForJsonValue(
							correctionFeedback.details.stdout
					  )}\n\`\`\`\n`
					: ""
		  }${
				correctionFeedback.details?.stderr
					? `STDERR:\n\`\`\`\n${escapeForJsonValue(
							correctionFeedback.details.stderr
					  )}\n\`\`\`\n`
					: ""
		  }Issues Remaining (after previous attempt):\n${formatCodeIssues(
				correctionFeedback.issuesRemaining
		  )}
    Issues Introduced (by previous attempt):\n${formatCodeIssues(
			correctionFeedback.issuesIntroduced
		)}
    ${
			correctionFeedback.relevantDiff
				? `Relevant Diff (from previous attempt):\n\`\`\`diff\n${escapeForJsonValue(
						correctionFeedback.relevantDiff
				  )}\n\`\`\`\n`
				: ""
		}
    --- End Previous Correction Attempt Feedback ---`
		: "";

	const activeSymbolInfoSection = activeSymbolDetailedInfo
		? `
--- Active Symbol Detailed Information ---
Name: ${activeSymbolDetailedInfo.name || "N/A"}
Kind: ${activeSymbolDetailedInfo.kind || "N/A"}
Detail: ${activeSymbolDetailedInfo.detail || "N/A"}
File Path: ${activeSymbolDetailedInfo.filePath || "N/A"}
Full Range: ${
				activeSymbolDetailedInfo.fullRange
					? `Lines ${activeSymbolDetailedInfo.fullRange.start.line + 1}-${
							activeSymbolDetailedInfo.fullRange.end.line + 1
					  }`
					: "N/A"
		  }
Children Hierarchy:
\`\`\`
${activeSymbolDetailedInfo.childrenHierarchy || "N/A"}
\`\`\`
Definition: ${formatLocation(
				activeSymbolDetailedInfo.definition,
				editorContext
		  )}
Implementations: ${formatLocations(
				activeSymbolDetailedInfo.implementations,
				undefined,
				editorContext
		  )}
Type Definition: ${formatLocation(
				activeSymbolDetailedInfo.typeDefinition,
				editorContext
		  )}
Referenced Type Definitions:
${
	activeSymbolDetailedInfo.referencedTypeDefinitions &&
	activeSymbolDetailedInfo.referencedTypeDefinitions.size > 0
		? Array.from(activeSymbolDetailedInfo.referencedTypeDefinitions.entries())
				.slice(0, MAX_REFERENCED_TYPES_TO_INCLUDE_PROMPT)
				.map(([filePath, originalContentLines]) => {
					const joinedContent = originalContentLines.join("\n");
					let processedContent: string;
					if (joinedContent.length > MAX_REFERENCED_TYPE_CONTENT_CHARS_PROMPT) {
						processedContent =
							joinedContent.substring(
								0,
								MAX_REFERENCED_TYPE_CONTENT_CHARS_PROMPT
							) + "\n// ... (content truncated)";
					} else {
						processedContent = joinedContent;
					}
					return `  - File: ${filePath}\n    Content:\n\`\`\`\n${processedContent}\n\`\`\``;
				})
				.join("\n") +
		  (activeSymbolDetailedInfo.referencedTypeDefinitions.size >
		  MAX_REFERENCED_TYPES_TO_INCLUDE_PROMPT
				? `\n  ... (${
						activeSymbolDetailedInfo.referencedTypeDefinitions.size -
						MAX_REFERENCED_TYPES_TO_INCLUDE_PROMPT
				  } more)`
				: "")
		: "None"
}
Incoming Calls:
${formatCallHierarchy(
	activeSymbolDetailedInfo.incomingCalls,
	undefined,
	editorContext
)}
Outgoing Calls:
${formatCallHierarchy(
	activeSymbolDetailedInfo.outgoingCalls,
	undefined,
	editorContext
)}
--- End Active Symbol Detailed Information ---
`
		: "";

	return `
        You are the expert software engineer for me. Your ONLY task is to generate a JSON *correction plan* (ExecutionPlan) detailing the steps needed to fix reported diagnostics, rather than outputting final corrected code directly.

        The previous code generation/modification resulted in issues. Your plan MUST resolve ALL "Error" diagnostics, and address "Warning" and "Information" diagnostics where appropriate without introducing new errors. DO NOT revert changes already completed, unless explicitly required to fix a regression or an issue caused by previous changes.
        *   **Focus on Diagnostics**: Your plan MUST directly address and resolve all provided "Error" diagnostics. Address "Warning" and "Information" diagnostics only if they are directly related or can be fixed without introducing new issues.
        *   **Surgical Modifications**: Limit modifications strictly to code segments directly responsible for the reported issues. Avoid unrelated refactoring, code style changes, or adding new features unless explicitly necessary to fix a bug or resolve a diagnostic.
        *   **Location Awareness**: Pay close attention to file paths and line numbers provided in diagnostics and \`editorContext\`. Target your modifications precisely to these locations.
        *   **JSON Output**: Provide ONLY a valid JSON object strictly following the 'ExecutionPlan' schema. NO markdown fences (e.g., \`\`\`), conversational text, or explanations outside the JSON.
        *   **Maintain Context**: Preserve original code style, structure, formatting (indentation, spacing, line breaks), comments, and project conventions (e.g., import order).
        *   **Production Readiness**: All generated/modified code MUST be robust, maintainable, efficient, and adhere to industry best practices, prioritizing modularity and readability.
        *   **Detailed Descriptions**: Provide clear, concise 'description' for each step, explaining *why* it's necessary and *how* it specifically addresses diagnostics.
        *   **Single Modify Per File**: For any given file path, at most **one** \`modify_file\` step. Combine all logical changes for that file into a single, comprehensive \`modification_prompt\`.
        *   **Learn from Feedback**: If 'Previous Correction Attempt Feedback' is provided, carefully analyze its \`type\` and \`message\` (especially \`parsing_failed\` or \`no_improvement\`/oscillation). Understand why the last attempt failed (e.g., malformed JSON, no issue reduction, or oscillation detected) and incorporate this learning into the new plan. Avoid repeating past mistakes, particularly oscillation patterns, and ensure your JSON is syntactically correct and complete.

        --- Json Escaping Instructions ---
        ${jsonEscapingInstructions}
        --- Json Escaping Instructions ---

        --- Original Request ---
        ${originalUserInstruction}
        --- End Original Request ---

        --- Broader Project Context ---
        ${projectContext}
        --- End Broader Project Context ---
        ${editorContextForPrompt}
        ${chatHistoryForPrompt}

        --- Active Symbol Info Section ---
        ${activeSymbolInfoSection}
        --- Active Symbol Info Section ---

        --- Relevant Project Snippets (for additional context) ---
        ${relevantSnippets}
        --- End Relevant Project Snippets ---

        --- Recent Project Changes (During Current Workflow) ---
        ${formattedRecentChanges}
        --- End Recent Project Changes ---

        --- Diagnostics to Address (Errors & Warnings) ---
        ${aggregatedFormattedDiagnostics}
        --- End Diagnostics to Address ---
        
        --- Previous Correction Attempt Feedback ---
        ${correctionFeedbackSection}
        --- End Previous Correction Attempt Feedback ---

        --- Required JSON Schema Reference ---
        Your output MUST strictly adhere to the following TypeScript interfaces for \`ExecutionPlan\` and \`PlanStep\` types. Pay special attention to the 'path' field for file operations.

        --- End Required JSON Schema Reference ---

        --- Few Shot Correction Examples ---
        ${fewShotCorrectionExamples}
        --- Few Shot Correction Examples ---

        ExecutionPlan (ONLY JSON):
`;
}

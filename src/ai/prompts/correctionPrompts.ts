import * as vscode from "vscode";
import * as path from "path";
import { AIRequestService } from "../../services/aiRequestService";
import { ActiveSymbolDetailedInfo } from "../../services/contextService";
import { HistoryEntryPart } from "../../sidebar/common/sidebarTypes";
import * as sidebarTypes from "../../sidebar/common/sidebarTypes";
import { ERROR_OPERATION_CANCELLED } from "../gemini";
import { CodeIssue } from "../../ai/enhancedCodeGeneration"; // NEW: Import CodeIssue

const MAX_REFERENCED_TYPE_CONTENT_CHARS_PROMPT = 1000;
const MAX_REFERENCED_TYPES_TO_INCLUDE_PROMPT = 3;

const jsonSchemaReference = `
        interface ExecutionPlan {
          planDescription: string;
          steps: PlanStep[];
        }

        interface PlanStep {
          step: number; // 1-indexed, sequential
          action: "create_directory" | "create_file" | "modify_file" | "run_command";
          description: string;
          // File/Directory Operations:
          path?: string; // REQUIRED for 'create_directory', 'create_file', 'modify_file'. Must be a non-empty, relative string (e.g., 'src/components/button.ts'). DO NOT leave this empty, null, or undefined.
          // 'create_file' specific:
          content?: string; // Exclusive with 'generate_prompt'. Full content of the new file.
          generate_prompt?: string; // Exclusive with 'content'. A prompt to generate file content.
          // 'modify_file' specific:
          modification_prompt?: string; // REQUIRED for 'modify_file'. Instructions on how to modify the file's content.
          // 'run_command' specific:
          command?: string; // REQUIRED for 'run_command'. The command string to execute.
        }`;

const fewShotCorrectionExamples = `
        --- Valid Correction Plan Examples ---
        Example 1: Simple syntax fix in an existing file
        {
            \"planDescription\": \"Fix a syntax error in utils.ts\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"modify_file\",
                    \"description\": \"Correct missing semicolon and adjust function call in utils.ts as per diagnostic.\",
                    \"path\": \"src/utils.ts\",
                    \"modification_prompt\": \"The file src/utils.ts has a syntax error: 'Expected ;'. Add a semicolon at the end of line 10. Also, ensure the 'calculateSum' function call on line 15 passes the correct number of arguments as indicated by the 'Expected 2 arguments, but got 1.' diagnostic.\"
                }
            ]
        }

        Example 2: Adding a missing import
        {
            \"planDescription\": \"Add missing 'useState' import to MyComponent.tsx\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"modify_file\",
                    \"description\": \"Add missing 'useState' import from 'react' to MyComponent.tsx to resolve 'useState is not defined' error.\",
                    \"path\": \"src/components/MyComponent.tsx\",
                    \"modification_prompt\": \"Add 'useState' to the React import statement in src/components/MyComponent.tsx so it becomes 'import React, { useState } from 'react';' to resolve the 'useState is not defined' error.\"
                }
            ]
        }

        Example 3: Resolving a type error in TypeScript
        {
            \"planDescription\": \"Correct type mismatch in userSlice.ts\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"modify_file\",
                    \"description\": \"Adjust the type definition for 'user' state in userSlice.ts from 'string' to 'UserInterface' to match expected object structure.\",
                    \"path\": \"src/store/userSlice.ts\",
                    \"modification_prompt\": \"In src/store/userSlice.ts, change the type of the 'user' property in the initial state from 'string' to 'UserInterface' (assuming UserInterface is already defined or will be imported). Ensure the default value for 'user' is a valid UserInterface object or null as appropriate.\"
                }
            ]
        }

        Example 4: Creating a new file to fix a missing module error
        {
            \"planDescription\": \"Create a new utility file for common functions\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"create_file\",
                    \"description\": \"Create 'src/utils/mathUtils.ts' as it is missing, which causes 'Module not found' error.\",
                    \"path\": \"src/utils/mathUtils.ts\",
                    \"generate_prompt\": \"Generate a TypeScript file 'src/utils/mathUtils.ts' that exports a function named 'add' which takes two numbers and returns their sum, and a function named 'subtract' which takes two numbers and returns their difference.\"
                }
            ]
        }
        --- End Valid Correction Plan Examples ---
    `;

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
		| "unknown"; // Other or uncategorized failure
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
	issuesRemaining?: CodeIssue[]; // List of issues that still persist after the attempt
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
				`  - [${issue.severity.toUpperCase()}] ${issue.type}: "${
					issue.message
				}" at line ${issue.line}${issue.code ? ` (Code: ${issue.code})` : ""}`
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
        --- Recent Chat History (for additional context on user's train of thought and previous conversations with a AI model) ---
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
    Feedback Message: ${correctionFeedback.message}
    ${
			correctionFeedback.details?.parsingError
				? `Parsing Error: ${correctionFeedback.details.parsingError}\n`
				: ""
		}${
				correctionFeedback.details?.failedJson
					? `Failed JSON Output (if applicable):\n\`\`\`json\n${correctionFeedback.details.failedJson}\n\`\`\`\n`
					: ""
		  }${
				correctionFeedback.details?.stdout
					? `STDOUT:\n\`\`\`\n${correctionFeedback.details.stdout}\n\`\`\`\n`
					: ""
		  }${
				correctionFeedback.details?.stderr
					? `STDERR:\n\`\`\`\n${correctionFeedback.details.stderr}\n\`\`\`\n`
					: ""
		  }Issues Remaining (after previous attempt):\n${formatCodeIssues(
				correctionFeedback.issuesRemaining
		  )}
    Issues Introduced (by previous attempt):\n${formatCodeIssues(
			correctionFeedback.issuesIntroduced
		)}
    ${
			correctionFeedback.relevantDiff
				? `Relevant Diff (from previous attempt):\n\`\`\`diff\n${correctionFeedback.relevantDiff}\n\`\`\`\n`
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
        You are an expert software engineer. Your ONLY task is to generate a JSON ExecutionPlan to resolve all reported diagnostics.

        The previous code generation/modification resulted in issues. Your plan MUST resolve ALL "Error" diagnostics, and address "Warning" and "Information" diagnostics where appropriate without new errors. DO NOT revert changes already completed, unless explicitly required to fix a new regression.

        **CRITICAL DIRECTIVES:**
        *   **Single-Shot Correction**: Resolve ALL reported issues in this single plan. The resulting code MUST compile and run without errors or warnings.
        *   **JSON Output**: Provide ONLY a valid JSON object strictly following the 'ExecutionPlan' schema. No markdown fences or extra text.
        *   **Maintain Context**: Preserve original code style, structure, formatting (indentation, spacing, line breaks), comments, and project conventions (e.g., import order).
        *   **Production Readiness**: All generated/modified code MUST be robust, maintainable, efficient, and adhere to industry best practices, prioritizing modularity and readability.
        *   **Valid File Operations**: Use 'modify_file', 'create_file', 'create_directory', or 'run_command'. Ensure 'path' is non-empty, relative to workspace root, and safe (no '..' or absolute paths).
        *   **Detailed Descriptions**: Provide clear, concise 'description' for each step, explaining *why* it's necessary and *how* it specifically addresses diagnostics.
        *   **Single Modify Per File**: For any given file path, at most **one** \`modify_file\` step. Combine all logical changes for that file into a single, comprehensive \`modification_prompt\`.

        --- Json Escaping Instructions ---
        ${jsonEscapingInstructions}
        --- Json Escaping Instructions ---

        --- Original User Request ---
        ${originalUserInstruction}
        --- End Original User Request ---

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

        ${jsonSchemaReference}
        --- End Required JSON Schema Reference ---

        --- Few Shot Correction Examples ---
        ${fewShotCorrectionExamples}
        --- Few Shot Correction Examples ---

								--- Required JSON Schema Reference ---
        Your output MUST strictly adhere to the following TypeScript interfaces for \`ExecutionPlan\` and \`PlanStep\` types. Pay special attention to the 'path' field for file operations.
        
        ExecutionPlan (ONLY JSON):
`;
}

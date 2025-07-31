// src/utils/issueProcessingUtils.ts
import { CodeIssue } from "../types/codeGenerationTypes";
import { getCodeSnippet } from "./codeAnalysisUtils";
import { getIssueIdentifier } from "./aiUtils";

export const issueTypeOrder: CodeIssue["type"][] = [
	"format_error",
	"syntax",
	"unused_import",
	"security",
	"best_practice",
	"other",
];
export const severityOrder: CodeIssue["severity"][] = [
	"error",
	"warning",
	"info",
];

/**
 * Groups and prioritizes code issues for prompt generation.
 */
export function groupAndPrioritizeIssues(
	issues: CodeIssue[]
): Map<string, CodeIssue[]> {
	const groupedIssues = new Map<string, CodeIssue[]>();

	issues.sort((a, b) => {
		const typeOrderA = issueTypeOrder.indexOf(a.type);
		const typeOrderB = issueTypeOrder.indexOf(b.type);
		if (typeOrderA !== typeOrderB) {
			return typeOrderA - typeOrderB;
		}

		const severityOrderA = severityOrder.indexOf(a.severity);
		const severityOrderB = severityOrder.indexOf(b.severity);
		if (severityOrderA !== severityOrderB) {
			return severityOrderA - severityOrderB;
		}

		return a.line - b.line;
	});

	for (const issue of issues) {
		let groupKey = `TYPE: ${issue.type.toUpperCase()} / SEVERITY: ${issue.severity.toUpperCase()}${
			issue.code ? ` / CODE: ${issue.code}` : ""
		}`;
		if (issue.message.includes("Cannot find name") && issue.type === "syntax") {
			const match = issue.message.match(/Cannot find name '([^']*)'/);
			const missingName = match ? match[1] : "unknown_identifier";
			groupKey = `TYPE: ${issue.type.toUpperCase()} / SEVERITY: ${issue.severity.toUpperCase()} / ISSUE: Missing Identifier '${missingName}'`;
		}

		if (!groupedIssues.has(groupKey)) {
			groupedIssues.set(groupKey, []);
		}
		groupedIssues.get(groupKey)!.push(issue);
	}

	return groupedIssues;
}

/**
 * Formats grouped and prioritized issues into a Markdown string for AI prompts.
 */
export function formatGroupedIssuesForPrompt(
	groupedIssues: Map<string, CodeIssue[]>,
	languageId: string,
	content: string
): string {
	let formattedString = "";

	const sortedGroupKeys = Array.from(groupedIssues.keys()).sort(
		(keyA, keyB) => {
			const issueTypeA =
				issueTypeOrder.find((type) =>
					keyA.includes(`TYPE: ${type.toUpperCase()}`)
				) || "other";
			const issueTypeB =
				issueTypeOrder.find((type) =>
					keyB.includes(`TYPE: ${type.toUpperCase()}`)
				) || "other";
			const typeOrderResult =
				issueTypeOrder.indexOf(issueTypeA) - issueTypeOrder.indexOf(issueTypeB);
			if (typeOrderResult !== 0) {
				return typeOrderResult;
			}

			const severityA =
				severityOrder.find((severity) =>
					keyA.includes(`SEVERITY: ${severity.toUpperCase()}`)
				) || "info";
			const severityB =
				severityOrder.find((severity) =>
					keyB.includes(`SEVERITY: ${severity.toUpperCase()}`)
				) || "info";
			return (
				severityOrder.indexOf(severityA) - severityOrder.indexOf(severityB)
			);
		}
	);

	for (const groupKey of sortedGroupKeys) {
		const issuesInGroup = groupedIssues.get(groupKey)!;
		formattedString += `--- Issue Group: ${groupKey} ---\n`;
		// ... logic for suggested strategies based on groupKey
		for (const issue of issuesInGroup) {
			formattedString += `--- Individual Issue Details ---\n`;
			formattedString += `Severity: ${issue.severity.toUpperCase()}\n`;
			formattedString += `Type: ${issue.type}\nLine: ${issue.line}\nMessage: ${issue.message}\n`;
			if (issue.code) {
				formattedString += `Issue Code: ${issue.code}\n`;
			}
			formattedString += `Problematic Code Snippet:\n\`\`\`${languageId}\n${getCodeSnippet(
				content,
				issue.line
			)}\n\`\`\`\n`;
			formattedString += `--- End Individual Issue Details ---\n\n`;
		}
		formattedString += "\n";
	}

	return formattedString;
}

/**
 * Identifies issues present in `newIssues` that were not in `originalIssues`.
 */
export function getIssuesIntroduced(
	originalIssues: CodeIssue[],
	newIssues: CodeIssue[]
): CodeIssue[] {
	const originalIssueSet = new Set<string>(
		originalIssues.map(getIssueIdentifier)
	);
	return newIssues.filter(
		(issue) => !originalIssueSet.has(getIssueIdentifier(issue))
	);
}

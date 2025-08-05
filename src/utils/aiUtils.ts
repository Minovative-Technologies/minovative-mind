import { CodeIssue } from "../ai/enhancedCodeGeneration";

export function getIssueIdentifier(issue: CodeIssue): string {
	return `${issue.message}|${issue.line}|${issue.type}|${issue.severity}|${
		issue.code ?? ""
	}`;
}

export function areIssuesSimilar(
	issues1: CodeIssue[],
	issues2: CodeIssue[]
): boolean {
	if (issues1.length !== issues2.length) {
		return false;
	}
	if (issues1.length === 0 && issues2.length === 0) {
		return true;
	}

	const set1 = new Set<string>(issues1.map(getIssueIdentifier));
	const set2 = new Set<string>(issues2.map(getIssueIdentifier));

	if (set1.size !== set2.size) {
		return false;
	}
	for (const id of set1) {
		if (!set2.has(id)) {
			return false;
		}
	}
	return true;
}

/**
 * Escapes special characters in a string for safe embedding within a larger string
 * that will be processed by an AI, ensuring it doesn't break JSON-like structures
 * or introduce unintended characters when the AI parses it.
 * @param str The string to escape.
 * @returns A string with JSON-specific special characters escaped, ready for embedding.
 */
export function escapeForJsonValue(str: string | undefined): string {
	if (str === undefined || str === null) {
		return "";
	}
	// JSON.stringify correctly escapes all necessary characters like ", \, \n, \r, \t, etc.
	// It returns a string enclosed in double quotes (e.g., \"\\"hello\\\\nworld\\\").
	// We need the content *inside* the quotes to be safe for embedding directly.
	const jsonString = JSON.stringify(str); // Using the standard JSON.stringify
	// Remove the leading and trailing quotes to get the properly escaped content.
	return jsonString.slice(1, -1);
}

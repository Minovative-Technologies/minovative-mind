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

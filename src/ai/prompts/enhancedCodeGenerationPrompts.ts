import * as path from "path";
import {
	CodeIssue,
	FileAnalysis,
	FileStructureAnalysis,
	CorrectionAttemptOutcome,
	EnhancedGenerationContext,
} from "../enhancedCodeGeneration";
import { ActiveSymbolDetailedInfo } from "../../services/contextService";
import { generateFileChangeSummary } from "../../utils/diffingUtils";

// --- Helper Functions (moved from EnhancedCodeGenerator and adapted) ---

/**
 * Define issue ordering constants locally for prompt formatting.
 * These were originally private members of EnhancedCodeGenerator.
 */
const issueTypeOrder: CodeIssue["type"][] = [
	"syntax",
	"unused_import",
	"security",
	"best_practice",
	"other",
];
const severityOrder: CodeIssue["severity"][] = ["error", "warning", "info"];

/**
 * Analyzes a file path for framework and structure information.
 * This was originally `_analyzeFilePath` in `EnhancedCodeGenerator`.
 */
function _analyzeFilePath(filePath: string): FileAnalysis {
	const segments = filePath.split(path.sep); // Use path.sep for OS compatibility
	const fileName = path.basename(filePath);
	const extension = path.extname(filePath);

	let framework = "unknown";
	let projectStructure = "unknown";
	let expectedPatterns = "standard";

	// Detect framework based on path structure
	if (segments.includes("pages") || segments.includes("app")) {
		framework = "Next.js";
		projectStructure = "pages/app router";
	} else if (segments.includes("src") && segments.includes("components")) {
		framework = "React";
		projectStructure = "src-based";
	} else if (segments.includes("src") && segments.includes("services")) {
		framework = "Node.js/Express";
		projectStructure = "service-oriented";
	}

	// Detect patterns based on file location
	if (segments.includes("components")) {
		expectedPatterns = "React component patterns";
	} else if (segments.includes("utils") || segments.includes("helpers")) {
		expectedPatterns = "utility function patterns";
	} else if (segments.includes("services")) {
		expectedPatterns = "service layer patterns";
	}

	return {
		framework,
		projectStructure,
		expectedPatterns,
		fileName,
		extension,
	};
}

/**
 * Get language ID from file extension.
 * This was originally `_getLanguageId` in `EnhancedCodeGenerator`.
 */
function _getLanguageId(extension: string): string {
	const languageMap: Record<string, string> = {
		".ts": "typescript",
		".tsx": "typescript",
		".js": "javascript",
		".jsx": "javascript",
		".py": "python",
		".java": "java",
		".cs": "csharp",
		".cpp": "cpp",
		".c": "c",
		".go": "go",
		".rs": "rust",
		".php": "php",
		".rb": "ruby",
		".swift": "swift",
		".kt": "kotlin",
	};

	return languageMap[extension] || "text";
}

/**
 * Extracts a code snippet around a given line number.
 * This was originally `_getCodeSnippet` in `EnhancedCodeGenerator`.
 */
function _getCodeSnippet(
	fullContent: string,
	lineNumber: number,
	linesBefore: number = 2,
	linesAfter: number = 2
): string {
	const lines = fullContent.split("\n");
	const zeroBasedLineNumber = lineNumber - 1; // Convert to 0-indexed

	const start = Math.max(0, zeroBasedLineNumber - linesBefore);
	const end = Math.min(lines.length - 1, zeroBasedLineNumber + linesAfter);

	const snippetLines: string[] = [];
	const maxLineNumLength = String(end + 1).length; // For padding

	for (let i = start; i <= end; i++) {
		const currentLineNum = i + 1; // Convert back to 1-indexed for display
		const paddedLineNum = String(currentLineNum).padStart(
			maxLineNumLength,
			" "
		);
		snippetLines.push(`${paddedLineNum}: ${lines[i]}`);
	}

	return snippetLines.join("\n");
}

/**
 * Create Helper for Formatting `FileStructureAnalysis`
 * This was originally `_formatFileStructureAnalysis` in `EnhancedCodeGenerator`.
 */
function _formatFileStructureAnalysis(
	analysis?: FileStructureAnalysis
): string {
	if (!analysis) {
		return "";
	}

	let formatted = "**File Structure Analysis:**\n";
	if (analysis.imports.length > 0) {
		formatted += `- Imports: ${analysis.imports.length} lines\n`;
	}
	if (analysis.exports.length > 0) {
		formatted += `- Exports: ${analysis.exports.length} lines\n`;
	}
	if (analysis.functions.length > 0) {
		formatted += `- Functions: ${analysis.functions.length} functions\n`;
	}
	if (analysis.classes.length > 0) {
		formatted += `- Classes: ${analysis.classes.length} classes\n`;
	}
	if (analysis.variables.length > 0) {
		formatted += `- Variables: ${analysis.variables.length} variables\n`;
	}
	if (analysis.comments.length > 0) {
		formatted += `- Comments: ${analysis.comments.length} lines\n`;
	}
	formatted +=
		"Analyze this structure to understand the file's organization and apply changes consistently.";
	return formatted;
}

/**
 * Groups and prioritizes code issues for prompt generation.
 * Issues are grouped by a combination of type, severity, and specific code (if applicable).
 * Priorities are based on predefined orders (`issueTypeOrder`, `severityOrder`).
 * Special handling for 'cannot find name' errors by grouping them by the missing identifier.
 * This was originally `_groupAndPrioritizeIssues` in `EnhancedCodeGenerator`.
 */
function _groupAndPrioritizeIssues(
	issues: CodeIssue[]
): Map<string, CodeIssue[]> {
	const groupedIssues = new Map<string, CodeIssue[]>();

	// Sort issues initially based on predefined order and then line number
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
		let groupKey = "";
		// Special grouping for 'cannot find name' errors
		if (
			issue.message.includes("Cannot find name") &&
			issue.type === "syntax" &&
			issue.severity === "error"
		) {
			const match = issue.message.match(/Cannot find name '([^']*)'/);
			const missingName = match ? match[1] : "unknown_identifier"; // Use "unknown_identifier" for clarity
			groupKey = `TYPE: ${issue.type.toUpperCase()} / SEVERITY: ${issue.severity.toUpperCase()} / ISSUE: Missing Identifier '${missingName}'`;
		} else {
			groupKey = `TYPE: ${issue.type.toUpperCase()} / SEVERITY: ${issue.severity.toUpperCase()}${
				issue.code ? ` / CODE: ${issue.code}` : ""
			}`;
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
 * This was originally `_formatGroupedIssuesForPrompt` in `EnhancedCodeGenerator`.
 */
function _formatGroupedIssuesForPrompt(
	groupedIssues: Map<string, CodeIssue[]>,
	languageId: string,
	content: string
): string {
	let formattedString = "";

	// Sort group keys based on issue type and severity order
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
				issueTypeOrder.indexOf(issueTypeA as CodeIssue["type"]) -
				issueTypeOrder.indexOf(issueTypeB as CodeIssue["type"]);
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
				severityOrder.indexOf(severityA as CodeIssue["severity"]) -
				severityOrder.indexOf(severityB as CodeIssue["severity"])
			);
		}
	);

	for (const groupKey of sortedGroupKeys) {
		const issuesInGroup = groupedIssues.get(groupKey)!;
		formattedString += `--- Issue Group: ${groupKey} ---\n`;

		// Add suggested strategy for the group
		let suggestedStrategy =
			"------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------ Review the provided code snippet and diagnostic message. Apply the most targeted fix to resolve this specific issue while adhering to all critical requirements. ------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------";
		if (groupKey.includes("ISSUE: Missing Identifier")) {
			suggestedStrategy =
				"------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------ Suggested Strategy: This group contains 'Cannot find name' errors, indicating a missing identifier. This almost always means a missing import statement, a typo in a variable/function/type name, or an undeclared variable/constant. Your specific action should be: 1. **Check Imports**: Verify if the missing identifier is an external dependency or a local module export; add the necessary import statement if it's missing. 2. **Check Typos**: Meticulously review the spelling of the identifier in both its usage and declaration. 3. **Check Scope/Declaration**: Ensure the identifier is declared and accessible within the current scope. If it's an undeclared variable, declare it with the correct type. Pay close attention to case sensitivity. ------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------";
		} else if (groupKey.includes("TYPE: UNUSED_IMPORT")) {
			suggestedStrategy =
				"------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------ Suggested Strategy: This group contains unused import warnings. This indicates an an import statement that is no longer being used by any code within the file. Your specific action should be: 1. **Remove Statement**: Delete the entire unused import statement. 2. **Verify No Reliance**: Before removal, quickly scan the file to ensure no other code unexpectedly relies on this import (e.g., dynamic usage not caught by static analysis). ------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------";
		} else if (groupKey.includes("TYPE: SECURITY")) {
			suggestedStrategy =
				"------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------ Suggested Strategy: This group contains security issues or vulnerabilities. Your specific action should be: 1. **Implement Secure Practices**: Apply standard secure coding practices relevant to the language and context (e.g., input validation, output encoding, proper authentication/authorization, secure data handling). 2. **Mitigate Vulnerability**: Directly address the vulnerability described in the message (e.g., prevent XSS, SQL injection, path traversal). ------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------";
		} else if (groupKey.includes("TYPE: BEST_PRACTICE")) {
			suggestedStrategy =
				"------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------ Suggested Strategy: This group contains best practice issues. These are typically suggestions for improving code quality, readability, maintainability, or performance, rather than critical errors. Your specific action should be: 1. **Refine Code**: Refactor small sections to align with established coding patterns, improve naming conventions, or use more idiomatic language features. 2. **Enhance Readability/Maintainability**: Focus on clarity, simplicity, and consistency without introducing new bugs. ------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------";
		} else if (
			groupKey.includes("TYPE: SYNTAX") &&
			groupKey.includes("ERROR")
		) {
			suggestedStrategy =
				"------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------ Suggested Strategy: This group contains critical syntax errors that prevent the code from compiling or parsing correctly. Your specific action should be: 1. **Correct Exact Mistake**: Focus solely on fixing the precise syntax mistake indicated by the diagnostic message (e.g., missing semicolon, incorrect keyword usage, mismatched parentheses/braces, incorrect function signature). 2. **Minimal Changes**: Ensure changes are localized and do not affect surrounding correct code. ------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------";
		} else if (groupKey.includes("TYPE: OTHER")) {
			suggestedStrategy =
				"------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------ Suggested Strategy: This group contains general or uncategorized issues. While not falling into specific categories, they still require attention. Your specific action should be: 1. **Analyze Message**: Carefully read the diagnostic message and examine the problematic code snippet. 2. **Precise Fix**: Apply a targeted and precise fix that directly resolves the issue without introducing unnecessary changes or side effects. ------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------";
		}
		formattedString += `Suggested Strategy: ${suggestedStrategy}\n`;

		for (const issue of issuesInGroup) {
			formattedString += `--- Individual Issue Details ---\n`;
			formattedString += `Severity: ${issue.severity.toUpperCase()}\n`;
			formattedString += `Type: ${issue.type}\n`;
			formattedString += `Line: ${issue.line}\n`;
			formattedString += `Message: ${issue.message}\n`;
			if (issue.code) {
				formattedString += `Issue Code: ${issue.code}\n`;
			}
			formattedString += `Problematic Code Snippet:\n`;
			formattedString += `\`\`\`${languageId}\n`;
			formattedString += `${_getCodeSnippet(content, issue.line)}\n`;
			formattedString += `\`\`\`\n`;
			formattedString += `--- End Individual Issue Details ---\n\n`;
		}
		formattedString += "\n"; // Add extra newline between groups
	}

	return formattedString;
}

// --- Exported Prompt Generation Functions ---

/**
 * Creates the enhanced generation prompt used for initial content generation.
 * Originally extracted from `EnhancedCodeGenerator._createEnhancedGenerationPrompt`.
 */
export function createEnhancedGenerationPrompt(
	filePath: string,
	generatePrompt: string,
	context: EnhancedGenerationContext
): string {
	const fileAnalysis = _analyzeFilePath(filePath);
	const languageId = _getLanguageId(fileAnalysis.extension); // Derive languageId from fileAnalysis
	const isRewrite = context.isRewriteOperation ?? false;

	const requirementsList: string[] = [];

	if (isRewrite) {
		requirementsList.push(
			"**Prioritize New Structure/Content**: You are tasked with generating the new code as specified in the instructions. Prioritize generating the new code structure and content precisely as specified, even if it requires significant deviations from typical patterns or implies a complete overhaul of an existing conceptual file. You have full autonomy to innovate and introduce new patterns/structures if they best fulfill the request."
		);
	}

	requirementsList.push(
		"**Accuracy First**: Ensure all imports, types, and dependencies are *absolutely* correct and precisely specified. Verify module paths, type definitions, and API usage."
	);
	requirementsList.push(
		"**Style Consistency**: Adhere *rigorously* to the project's existing coding patterns, conventions, and formatting. Maintain current indentation, naming, and structural choices."
	);
	requirementsList.push(
		"**Error Prevention**: Generate code that will compile and run *without any errors or warnings*. Proactively anticipate and guard against common pitfalls beyond just the immediate task, such as null/undefined checks, any types in typescript, input validations, edge cases, or off-by-one errors."
	);
	requirementsList.push(
		"**Best Practices**: Employ modern language features, established design patterns, and industry best practices to ensure high-quality, efficient, and robust code that is production-ready, maintainable, and clean."
	);
	requirementsList.push(
		"**Production Readiness**: Stress robustness, maintainability, and adherence to best practices for the generated code."
	);
	requirementsList.push(
		"**Security**: Implement secure coding practices meticulously, identifying and addressing potential vulnerabilities relevant to the language and context."
	);

	const formattedRequirements = requirementsList
		.map((req, idx) => `${idx + 1}. ${req}`)
		.join("\n");

	return `
	------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------
	You are an expert software engineer specializing in ${languageId} development. Your task is to generate production-ready, accurate code. ONLY focus on generating code.

**CRITICAL REQUIREMENTS:**
${formattedRequirements}

${
	context.isOscillating
		? `--- DETECTED CORRECTION OSCILLATION ---
**WARNING**: It appears the AI is stuck in a repetitive correction cycle, unable to resolve or continually re-introducing the same set of issues across recent attempts. This often happens when the AI tries similar fixes repeatedly without understanding the underlying cause or when changes conflict with other parts of the code.
**CRITICAL DIRECTIVE**: You MUST adopt a completely different, fundamentally new approach to break this cycle. Do NOT repeat similar failed attempts or minor adjustments. Analyze the historical outcomes from 'Recent Correction Attempt Outcomes' for patterns and propose a genuinely new correction strategy that tackles the problem from a different angle. This might involve:
-   Re-evaluating fundamental assumptions about the code or problem.
-   Considering alternative architectural patterns.
-   Breaking down the problem into smaller, more manageable sub-problems.
-   Searching for external documentation or examples if a common pattern is being misapplied.
-   Introducing new helper functions or refactoring a larger section if the existing structure is hostile to the fix.
--- END DETECTED CORRECTION OSCILLATION ---
`
		: ""
}
${
	context.lastCorrectionAttemptOutcome?.aiFailureAnalysis
		? `--- AI Self-Correction Analysis (from previous failed attempt) ---
**CRITICAL**: Read and internalize this analysis. It details *why* your previous attempt failed. You MUST adjust your strategy based on these insights to avoid repeating past mistakes.
**Previous Failure Analysis**:
${context.lastCorrectionAttemptOutcome.aiFailureAnalysis}
--- End AI Self-Correction Analysis ---
`
		: ""
}

**File Analysis:**
- Path: ${filePath}
- Language: ${languageId}
- Framework: ${fileAnalysis.framework}
- Project Structure: ${fileAnalysis.projectStructure}
- Expected Patterns: ${fileAnalysis.expectedPatterns}

**Instructions:**
${generatePrompt}

**Project Context:**
${context.projectContext}

**Relevant Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Info:**
- **Contextual Accuracy**: Use this info for correct integration, signatures, types, and naming for code interacting with these symbols.
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

${
	context.fileStructureAnalysis
		? _formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}
${
	context.successfulChangeHistory
		? `
**Change History:**
Analyze past successful patterns and apply effective solution strategies.
${context.successfulChangeHistory}
`
		: ""
}

BEGIN_CODE
// Your task: Generate the complete and correct code for the target file here.
// Start your code immediately below this line.
// Ensure the code is valid, production-ready, and adheres to modern best practices for that code.
END_CODE

**CRITICAL NEGATIVE CONSTRAINT**:
- Your response MUST include the \`BEGIN_CODE\` and \`END_CODE\` delimiters.
- The system will ONLY extract content strictly located between these delimiters.
- Therefore, your response MUST contain **ABSOLUTELY NOTHING ELSE** outside of these markers.
- This means: **NO** conversational text, **NO** explanations, **NO** apologies, **NO** comments (even inside the code block itself, unless they are part of the original/expected code logic), **NO** markdown formatting (e.g., \`\`\`language), **NO** meta-headers, and **NO** other extraneous characters or elements.
- Your output must start IMMEDIATELY with \`BEGIN_CODE\` and end IMMEDIATELY with \`END_CODE\`, with pure code in between.
- **PURE CODE ONLY. NOTHING ELSE. ONLY CODE.
------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------`;
}

/**
 * Creates the refinement prompt used when initial generation fails validation.
 * Originally extracted from `EnhancedCodeGenerator._refineContent`.
 */
export function createRefinementPrompt(
	filePath: string,
	content: string,
	issues: CodeIssue[],
	context: EnhancedGenerationContext
): string {
	const languageId = _getLanguageId(path.extname(filePath));
	const groupedAndPrioritizedIssues = _groupAndPrioritizeIssues(issues);
	const formattedIssues = _formatGroupedIssuesForPrompt(
		groupedAndPrioritizedIssues,
		languageId,
		content
	);

	return `
	------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------
	The generated code has the following **VS Code-reported compilation/linting issues** that need to be fixed:

**Issues to Address:**
${formattedIssues}

**Original Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Refinement Instructions:**
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- **Comprehensive Issue Resolution:** Fix *every single identified issue* meticulously, ensuring perfectly valid, error-free code.
- **Imports Correctness:** Verify and correct all imports. Ensure all necessary imports are present, and eliminate any unused or redundant ones.
- **Variable/Type Usage:** Reinforce correct variable declarations, scope, and accurate TypeScript types.
- **Code Style/Formatting:** Stricter adherence to existing project coding style and formatting conventions (indentation, spacing, line breaks, bracket placement, naming conventions), ensuring seamless integration.
- **Modularity/Maintainability:** Ensure code is modular with clear separation of concerns, easy to read, understand, and maintain.
- **Production Readiness:** Make sure the final code is production-ready, robust, and clean.

**Context:**
${context.projectContext}

**Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Info (for context/impact):**
- **Contextual Accuracy**: Use this info for correct integration, signatures, types, and naming for code interacting with these symbols.
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

${
	context.fileStructureAnalysis
		? _formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Change History:**
Analyze past successful patterns and apply effective solution strategies.
${context.successfulChangeHistory}
`
		: ""
}
${
	context.isOscillating
		? `--- DETECTED CORRECTION OSCILLATION ---
**WARNING**: It appears the AI is stuck in a repetitive correction cycle, unable to resolve or continually re-introducing the same set of issues across recent attempts. This often happens when the AI tries similar fixes repeatedly without understanding the underlying cause or when changes conflict with other parts of the code.
**CRITICAL DIRECTIVE**: You MUST adopt a completely different, fundamentally new approach to break this cycle. Do NOT repeat similar failed attempts or minor adjustments. Analyze the historical outcomes from 'Recent Correction Attempt Outcomes' for patterns and propose a genuinely new correction strategy that tackles the problem from a different angle. This might involve:
-   Re-evaluating fundamental assumptions about the code or problem.
-   Considering alternative architectural patterns.
-   Breaking down the problem into smaller, more manageable sub-problems.
-   Searching for external documentation or examples if a common pattern is being misapplied.
-   Introducing new helper functions or refactoring a larger section if the existing structure is hostile to the fix.
--- END DETECTED CORRECTION OSCILLATION ---
`
		: ""
}
${
	context.lastCorrectionAttemptOutcome?.aiFailureAnalysis
		? `--- AI Self-Correction Analysis (from previous failed attempt) ---
**CRITICAL**: Read and internalize this analysis. It details *why* your previous attempt failed. You MUST adjust your strategy based on these insights to avoid repeating past mistakes.
**Previous Failure Analysis**:
${context.lastCorrectionAttemptOutcome.aiFailureAnalysis}
--- End AI Self-Correction Analysis ---
`
		: ""
}

BEGIN_CODE
// Your task: Generate the complete and correct code for the target file here.
// Start your code immediately below this line.
// Ensure the code is valid, production-ready, and adheres to modern best practices for that code.
END_CODE

**CRITICAL NEGATIVE CONSTRAINT**:
- Your response MUST include the \`BEGIN_CODE\` and \`END_CODE\` delimiters.
- The system will ONLY extract content strictly located between these delimiters.
- Therefore, your response MUST contain **ABSOLUTELY NOTHING ELSE** outside of these markers.
- This means: **NO** conversational text, **NO** explanations, **NO** apologies, **NO** comments (even inside the code block itself, unless they are part of the original/expected code logic), **NO** markdown formatting (e.g., \`\`\`language), **NO** meta-headers, and **NO** other extraneous characters or elements.
- Your output must start IMMEDIATELY with \`BEGIN_CODE\` and end IMMEDIATELY with \`END_CODE\`, with pure code in between.
- **PURE CODE ONLY. NOTHING ELSE. ONLY CODE.
------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------`;
}

/**
 * Creates the enhanced modification prompt.
 * Originally extracted from `EnhancedCodeGenerator._createEnhancedModificationPrompt`.
 */
export function createEnhancedModificationPrompt(
	filePath: string,
	modificationPrompt: string,
	currentContent: string,
	context: EnhancedGenerationContext
): string {
	const languageId = _getLanguageId(path.extname(filePath));
	const fileAnalysis = context.fileStructureAnalysis; // From context, not _analyzeFilePath
	const isRewrite = context.isRewriteOperation ?? false;

	const requirementsList: string[] = [];

	if (isRewrite) {
		requirementsList.push(
			"**Prioritize New Structure/Content**: You are tasked with a significant rewrite or overhaul of the existing file. Prioritize generating the new code structure and content precisely as specified in the instructions, even if it requires significant deviations from the existing structure or content. Treat the 'Current Content' as a reference to be completely overhauled, not strictly adhered to for incremental changes. You have full autonomy to innovate and introduce new patterns/structures if they best fulfill the request."
		);
		requirementsList.push(
			"**Drastic Changes Allowed**: This request implies a major overhaul. You are explicitly permitted to make substantial changes to the existing structure, organization, and content. Extensive refactoring or re-implementation is permissible if it supports the requested overhaul."
		);
		requirementsList.push(
			"**Flexible Imports**: You may update, remove, or add imports as necessary to support the new structure and content, prioritizing correctness and functionality over strict preservation of existing import order or exact set."
		);
		requirementsList.push(
			"**Consistent Style (New Code)**: Maintain internal code style (indentation, naming, formatting) for consistency within the *newly generated* sections, following modern best practices for the language."
		);
	} else {
		requirementsList.push(
			"**Preserve Existing Structure**: Maintain the current file organization, structural patterns, and architectural design without unrelated refactoring. This is paramount for seamless integration."
		);
		requirementsList.push(
			"**No Cosmetic-Only Changes**: Your output must represent a *functional or structural change*, strictly avoiding changes that are solely whitespace, comments, or minor formatting."
		);
		requirementsList.push(
			"**Maintain Imports**: Maintain all *necessary* existing imports and add *only* strictly required new ones. Ensure import order is preserved unless a new logical grouping is absolutely essential for the requested modification."
		);
		requirementsList.push(
			"**Consistent Style (Existing Code)**: Strictly follow the existing code style, formatting, and conventions of the current file."
		);
	}

	// Universal critical requirements (always strictly enforced, regardless of rewrite intent)
	requirementsList.push(
		"**Accuracy First**: Ensure all imports, types, and dependencies are *absolutely* correct and precisely specified. Verify module paths, type definitions, and API usage."
	);
	requirementsList.push(
		"**Error Prevention**: Generate code that will compile and run *without any errors or warnings*. Proactively anticipate and guard against common pitfalls beyond just the immediate task, such as null/undefined checks, any types in typescript, input validations, edge cases, or off-by-one errors."
	);
	requirementsList.push(
		"**Best Practices**: Employ modern language features, established design patterns, and industry best practices to ensure high-quality, efficient, and robust code that is production-ready, maintainable, and clean."
	);
	requirementsList.push(
		"**Security**: Implement secure coding practices meticulously, identifying and addressing potential vulnerabilities relevant to the language and context."
	);
	requirementsList.push(
		"**Production Readiness**: Stress robustness, maintainability, and adherence to best practices for all modifications."
	);

	const formattedRequirements = requirementsList
		.map((req, idx) => `${idx + 1}. ${req}`)
		.join("\n");

	return `
	------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------
	You are an expert software engineer. Your task is to modify the existing file according to the provided instructions. ONLY focus on generating code.

**CRITICAL REQUIREMENTS:**
${formattedRequirements}

Path: ${filePath}
Language: ${languageId}

${_formatFileStructureAnalysis(fileAnalysis)}

**Instructions:**
${modificationPrompt}

**Current Content:**
\`\`\`${languageId}
${currentContent}
\`\`\`

**Context:**
${context.projectContext}

**Relevant Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Info:**
- **Contextual Accuracy**: Use this info for correct integration, signatures, types, and naming for code interacting with these symbols.
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

${
	context.successfulChangeHistory
		? `
**Change History:**
Analyze past effective patterns and solution strategies.
${context.successfulChangeHistory}
`
		: ""
}
${
	context.isOscillating
		? `--- DETECTED CORRECTION OSCILLATION ---
**WARNING**: It appears the AI is stuck in a repetitive correction cycle, unable to resolve or continually re-introducing the same set of issues across recent attempts. This often happens when the AI tries similar fixes repeatedly without understanding the underlying cause or when changes conflict with other parts of the code.
**CRITICAL DIRECTIVE**: You MUST adopt a completely different, fundamentally new approach to break this cycle. Do NOT repeat similar failed attempts or minor adjustments. Analyze the historical outcomes from 'Recent Correction Attempt Outcomes' for patterns and propose a genuinely new correction strategy that tackles the problem from a different angle. This might involve:
-   Re-evaluating fundamental assumptions about the code or problem.
-   Considering alternative architectural patterns.
-   Breaking down the problem into smaller, more manageable sub-problems.
-   Searching for external documentation or examples if a common pattern is being misapplied.
-   Introducing new helper functions or refactoring a larger section if the existing structure is hostile to the fix.
--- END DETECTED CORRECTION OSCILLATION ---
`
		: ""
}
${
	context.lastCorrectionAttemptOutcome?.aiFailureAnalysis
		? `--- AI Self-Correction Analysis (from previous failed attempt) ---
**CRITICAL**: Read and internalize this analysis. It details *why* your previous attempt failed. You MUST adjust your strategy based on these insights to avoid repeating past mistakes.
**Previous Failure Analysis**:
${context.lastCorrectionAttemptOutcome.aiFailureAnalysis}
--- End AI Self-Correction Analysis ---
`
		: ""
}

BEGIN_CODE
// Your task: Generate the complete and correct code for the target file here.
// Start your code immediately below this line.
// Ensure the code is valid, production-ready, and adheres to modern best practices for that code.
END_CODE

**CRITICAL NEGATIVE CONSTRAINT**:
- Your response MUST include the \`BEGIN_CODE\` and \`END_CODE\` delimiters.
- The system will ONLY extract content strictly located between these delimiters.
- Therefore, your response MUST contain **ABSOLUTELY NOTHING ELSE** outside of these markers.
- This means: **NO** conversational text, **NO** explanations, **NO** apologies, **NO** comments (even inside the code block itself, unless they are part of the original/expected code logic), **NO** markdown formatting (e.g., \`\`\`language), **NO** meta-headers, and **NO** other extraneous characters or elements.
- Your output must start IMMEDIATELY with \`BEGIN_CODE\` and end IMMEDIATELY with \`END_CODE\`, with pure code in between.
- **PURE CODE ONLY. NOTHING ELSE. ONLY CODE.

------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------`;
}

/**
 * Creates the refinement prompt for unreasonable modifications.
 * Originally extracted from `EnhancedCodeGenerator._refineModification`.
 */
export function createRefineModificationPrompt(
	filePath: string,
	originalContent: string,
	modifiedContent: string,
	diffIssues: string[], // Assumed to be already generated by _analyzeDiff
	context: EnhancedGenerationContext
): string {
	const languageId = _getLanguageId(path.extname(filePath));
	let initialFeedback =
		"The modification seems to have issues that need to be addressed:";

	// These checks should ideally be performed *before* calling this prompt function,
	// and the results (e.g., specific messages) passed in `diffIssues`.
	// The original _refineModification method's internal `_analyzeDiff` call
	// should be externalized to the calling `EnhancedCodeGenerator` logic.
	if (
		diffIssues.includes(
			"Modification seems too drastic - consider a more targeted approach"
		)
	) {
		initialFeedback +=
			"\n- **Drastic Change Detected**: The changes introduce a very high ratio of new/removed lines compared to the original content. This might indicate an unintended refactoring or deletion.";
	}
	if (diffIssues.includes("All imports were removed - this may be incorrect")) {
		initialFeedback +=
			"\n- **Import Integrity Compromised**: All imports appear to have been removed, which is highly likely to cause compilation errors.";
	}

	return `
	------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------
	${initialFeedback}\n\n**Issues with the modification:**\n${diffIssues
		.map((issue) => `- ${issue}`)
		.join(
			"\n"
		)}\n\n**Original Content:**\n\`\`\`${languageId}\n${originalContent}\n\`\`\`\n\n**Current Modification:**\n\`\`\`${languageId}\n${modifiedContent}\n\`\`\`\n\n**Refinement Instructions:**
- **PRIORITY: ZERO ERRORS/WARNINGS**: Your primary objective is to resolve ALL reported issues in this single refinement attempt. The resulting code MUST compile and run without any errors or warnings.
- **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
- **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- **Maintain Import Integrity**: Ensure all necessary imports are present and correct. Do not remove existing imports unless they are explicitly unused by the new, correct code. Add only strictly required new imports.
- **Strict Style Adherence:** Strictly adhere to the original file's existing code style, formatting (indentation, spacing, line breaks, bracket placement), and naming conventions.
- **Functionality and Correctness:** Ensure the modified code maintains all original functionality and is fully functional and error-free after correction.

**Context:**
${context.projectContext}

**Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Info:**
- **Contextual Accuracy**: Use this info for correct integration, signatures, types, and naming for code interacting with these symbols.
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

${
	context.fileStructureAnalysis
		? _formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Change History:**
Analyze past successful patterns and apply effective solution strategies.
${context.successfulChangeHistory}
`
		: ""
}
${
	context.isOscillating
		? `--- DETECTED CORRECTION OSCILLATION ---
**WARNING**: It appears the AI is stuck in a repetitive correction cycle, unable to resolve or continually re-introducing the same set of issues across recent attempts. This often happens when the AI tries similar fixes repeatedly without understanding the underlying cause or when changes conflict with other parts of the code.
**CRITICAL DIRECTIVE**: You MUST adopt a completely different, fundamentally new approach to break this cycle. Do NOT repeat similar failed attempts or minor adjustments. Analyze the historical outcomes from 'Recent Correction Attempt Outcomes' for patterns and propose a genuinely new correction strategy that tackles the problem from a different angle. This might involve:
-   Re-evaluating fundamental assumptions about the code or problem.
-   Considering alternative architectural patterns.
-   Breaking down the problem into smaller, more manageable sub-problems.
-   Searching for external documentation or examples if a common pattern is being misapplied.
-   Introducing new helper functions or refactoring a larger section if the existing structure is hostile to the fix.
--- END DETECTED CORRECTION OSCILLATION ---
`
		: ""
}
${
	context.lastCorrectionAttemptOutcome?.aiFailureAnalysis
		? `--- AI Self-Correction Analysis (from previous failed attempt) ---
**CRITICAL**: Read and internalize this analysis. It details *why* your previous attempt failed. You MUST adjust your strategy based on these insights to avoid repeating past mistakes.
**Previous Failure Analysis**:
${context.lastCorrectionAttemptOutcome.aiFailureAnalysis}
--- End AI Self-Correction Analysis ---
`
		: ""
}

BEGIN_CODE
// Your task: Generate the complete and correct code for the target file here.
// Start your code immediately below this line.
// Ensure the code is valid, production-ready, and adheres to modern best practices for that code.
END_CODE

**CRITICAL NEGATIVE CONSTRAINT**:
- Your response MUST include the \`BEGIN_CODE\` and \`END_CODE\` delimiters.
- The system will ONLY extract content strictly located between these delimiters.
- Therefore, your response MUST contain **ABSOLUTELY NOTHING ELSE** outside of these markers.
- This means: **NO** conversational text, **NO** explanations, **NO** apologies, **NO** comments (even inside the code block itself, unless they are part of the original/expected code logic), **NO** markdown formatting (e.g., \`\`\`language), **NO** meta-headers, and **NO** other extraneous characters or elements.
- Your output must start IMMEDIATELY with \`BEGIN_CODE\` and end IMMEDIATELY with \`END_CODE\`, with pure code in between.
- **PURE CODE ONLY. NOTHING ELSE. ONLY CODE.

------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------`;
}

/**
 * Creates the AI failure analysis prompt.
 * Originally extracted from `EnhancedCodeGenerator._generateAIFailureAnalysis`.
 */
export async function createAIFailureAnalysisPrompt(
	filePath: string,
	originalContent: string,
	attemptedContent: string,
	originalIssues: CodeIssue[],
	issuesAfterAttempt: CodeIssue[],
	iteration: number,
	recentCorrectionAttemptOutcomes: CorrectionAttemptOutcome[] | undefined,
	isOscillating: boolean | undefined
): Promise<string> {
	const languageId = _getLanguageId(path.extname(filePath));

	const { formattedDiff } = await generateFileChangeSummary(
		originalContent,
		attemptedContent,
		filePath
	);

	const formattedOriginalIssues = _formatGroupedIssuesForPrompt(
		_groupAndPrioritizeIssues(originalIssues),
		languageId,
		originalContent
	);
	const formattedIssuesAfterAttempt = _formatGroupedIssuesForPrompt(
		_groupAndPrioritizeIssues(issuesAfterAttempt),
		languageId,
		attemptedContent
	);

	let recentOutcomesSection = "";
	if (
		recentCorrectionAttemptOutcomes &&
		recentCorrectionAttemptOutcomes.length > 0
	) {
		// Limit to MAX_OSCILLATION_HISTORY_SIZE to prevent prompt bloat if many attempts
		const MAX_OSCILLATION_HISTORY_SIZE = 3; // Re-declare or import from a shared constant if available
		const relevantOutcomes = recentCorrectionAttemptOutcomes.slice(
			-MAX_OSCILLATION_HISTORY_SIZE
		);

		recentOutcomesSection = `
**Recent Correction Attempt Outcomes (for oscillation analysis):**
${relevantOutcomes
	.map(
		(outcome, index) => `
  --- Outcome ${index + 1} (Iteration ${outcome.iteration}) ---
  Success: ${outcome.success}
  Original Issues: ${outcome.originalIssuesCount}
  Issues After Attempt: ${outcome.issuesAfterAttemptCount}
  Failure Type: ${outcome.failureType}
  Relevant Diff Summary: ${outcome.relevantDiff.substring(
		0,
		Math.min(outcome.relevantDiff.length, 100)
	)}...
  Issues Remaining: ${outcome.issuesRemaining
		.map(
			(i) =>
				`- [${i.severity}] ${i.type} at line ${i.line}: ${i.message.substring(
					0,
					Math.min(i.message.length, 50)
				)}...`
		)
		.join("\n    ")}
  Issues Introduced: ${outcome.issuesIntroduced
		.map(
			(i) =>
				`- [${i.severity}] ${i.type} at line ${i.line}: ${i.message.substring(
					0,
					Math.min(i.message.length, 50)
				)}...`
		)
		.join("\n    ")}
  AI Failure Analysis (from that attempt): ${
		outcome.aiFailureAnalysis
			? outcome.aiFailureAnalysis.substring(
					0,
					Math.min(outcome.aiFailureAnalysis.length, 100)
			  ) + "..."
			: "N/A"
	}
  --- End Outcome ${index + 1} ---
`
	)
	.join("\n")}
`;
	}

	return `
	------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------
	You are an expert software engineer performing a root cause analysis on a failed code correction attempt.

Your primary goal is to diagnose WHY the previous attempt did not resolve issues or introduced new ones, and to provide actionable insights for the *next* correction.

**CRITICAL CONSTRAINT**: Your response MUST be ONLY plain text, summarizing the failure and strategy. ABSOLUTELY NO CODE BLOCKS (e.g., \`\`\`typescript), NO MARKDOWN FORMATTING (except basic bullet points if essential), NO CONVERSATIONAL FILLER (e.g., "I apologize", "Here is my analysis"), NO HEADERS, NO FOOTERS, NO GREETINGS, NO SIGNATURES. Start directly with the analysis.

**Analysis Context:**
- File path: ${filePath}
- Language: ${languageId}
- Current Iteration of Feedback Loop: ${iteration}

${
	isOscillating
		? `--- DETECTED CORRECTION OSCILLATION ---
**WARNING**: The system has detected that previous correction attempts are stuck in a repetitive cycle, repeatedly failing to resolve similar issues. This indicates a deeper problem or a fundamental misunderstanding of the fix required.
**CRITICAL DIRECTIVE**: Your analysis MUST identify the root cause of this oscillation and propose a **fundamentally different, breakthrough correction strategy** that avoids past mistakes and breaks the cycle. Do NOT suggest minor tweaks or repetitions of failed approaches.
--- END DETECTED CORRECTION OSCILLATION ---
`
		: ""
}

${recentOutcomesSection}

**Content BEFORE this Attempt:**
\`\`\`${languageId}
${originalContent}
\`\`\`

**Issues Identified BEFORE this Attempt (${originalIssues.length} issues):**
${formattedOriginalIssues}

**Content AFTER this Attempt:**
\`\`\`${languageId}
${attemptedContent}
\`\`\`

**Issues Identified AFTER this Attempt (${issuesAfterAttempt.length} issues):**
${formattedIssuesAfterAttempt}

**Relevant Diff (changes made in this attempt):**
\`\`\`diff
${formattedDiff}
\`\`\`

**Instructions for Your Analysis:**
1.  **Root Cause Diagnosis**: Based on the context provided (original code, attempted code, diff, and issue lists *before* and *after*, and especially 'Recent Correction Attempt Outcomes' if available), clearly state the precise root cause(s) of the failure. Focus on specific code changes (or lack thereof) that led to the issues persisting or new ones appearing. For an oscillation, explicitly diagnose *why* the cycle is occurring.
2.  **Actionable Strategy**: Propose a concrete, fundamentally different strategy for the *next* correction attempt. Explain *how* the AI should adjust its approach to successfully resolve the issues this time, explicitly addressing the identified root causes and aiming to break any detected oscillation patterns.
3.  **No Code**: Reiterate: Your output must be *only* the analysis text. Do not provide any code suggestions or snippets.
4. **Brevity**: Keep the analysis concise and to the point.

------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------`;
}

/**
 * Creates the alternative correction prompt when standard corrections fail.
 * Originally extracted from `EnhancedCodeGenerator._applyAlternativeCorrections`.
 */
export function createAlternativeCorrectionPrompt(
	filePath: string,
	content: string,
	issues: CodeIssue[],
	context: EnhancedGenerationContext
): string {
	const languageId = _getLanguageId(path.extname(filePath));
	const groupedAndPrioritizedIssues = _groupAndPrioritizeIssues(issues);
	const formattedIssues = _formatGroupedIssuesForPrompt(
		groupedAndPrioritizedIssues,
		languageId,
		content
	);

	return `
	------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------
	The code has the following **VS Code-reported compilation/linting issues** that need to be fixed using a different approach:

**Issues to Address:**
${formattedIssues}

**Current Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Alternative Correction Strategy:**
- **PRIORITY: ZERO ERRORS/WARNINGS**: Your primary objective is to resolve ALL reported issues in this single refinement attempt. The resulting code MUST compile and run without any errors or warnings.
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- Implement a genuinely different problem-solving approach to fix these issues, strictly avoiding re-attempting similar fixes that have failed or were unproductive.
- Consider architectural changes if needed
- Focus on the root cause rather than symptoms
- Ensure the solution is more robust and maintainable
- **Proactive Error Mitigation**: Anticipate and guard against common pitfalls, such as null/undefined checks, input validations, any types in typescript, edge cases, or off-by-one errors.
- **Production Readiness**: Ensure the solution is robust, maintainable, secure, clean, and efficient, adhering to industry best practices for production-ready code.

**Context:**
${context.projectContext}

**Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Info:**
- **Contextual Accuracy**: Use this info for correct integration, signatures, types, and naming for code interacting with these symbols.
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

${
	context.fileStructureAnalysis
		? _formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Change History:**
Analyze past successful patterns and apply effective solution strategies.
${context.successfulChangeHistory}
`
		: ""
}
${
	context.isOscillating
		? `--- DETECTED CORRECTION OSCILLATION ---
**WARNING**: It appears the AI is stuck in a repetitive correction cycle, unable to resolve or continually re-introducing the same set of issues across recent attempts. This often happens when the AI tries similar fixes repeatedly without understanding the underlying cause or when changes conflict with other parts of the code.
**CRITICAL DIRECTIVE**: You MUST adopt a completely different, fundamentally new approach to break this cycle. Do NOT repeat similar failed attempts or minor adjustments. Analyze the historical outcomes from 'Recent Correction Attempt Outcomes' for patterns and propose a genuinely new correction strategy that tackles the problem from a different angle. This might involve:
-   Re-evaluating fundamental assumptions about the code or problem.
-   Considering alternative architectural patterns.
-   Breaking down the problem into smaller, more manageable sub-problems.
-   Searching for external documentation or examples if a common pattern is being misapplied.
-   Introducing new helper functions or refactoring a larger section if the existing structure is hostile to the fix.
--- END DETECTED CORRECTION OSCILLATION ---
`
		: ""
}
${
	context.lastCorrectionAttemptOutcome?.aiFailureAnalysis
		? `--- AI Self-Correction Analysis (from previous failed attempt) ---
**CRITICAL**: Read and internalize this analysis. It details *why* your previous attempt failed. You MUST adjust your strategy based on these insights to avoid repeating past mistakes.
**Previous Failure Analysis**:
${context.lastCorrectionAttemptOutcome.aiFailureAnalysis}
--- End AI Self-Correction Analysis ---
`
		: ""
}

BEGIN_CODE
// Your task: Generate the complete and correct code for the target file here.
// Start your code immediately below this line.
// Ensure the code is valid, production-ready, and adheres to modern best practices for that code.
END_CODE

**CRITICAL NEGATIVE CONSTRAINT**:
- Your response MUST include the \`BEGIN_CODE\` and \`END_CODE\` delimiters.
- The system will ONLY extract content strictly located between these delimiters.
- Therefore, your response MUST contain **ABSOLUTELY NOTHING ELSE** outside of these markers.
- This means: **NO** conversational text, **NO** explanations, **NO** apologies, **NO** comments (even inside the code block itself, unless they are part of the original/expected code logic), **NO** markdown formatting (e.g., \`\`\`language), **NO** meta-headers, and **NO** other extraneous characters or elements.
- Your output must start IMMEDIATELY with \`BEGIN_CODE\` and end IMMEDIATELY with \`END_CODE\`, with pure code in between.
- **PURE CODE ONLY. NOTHING ELSE. ONLY CODE.

------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------`;
}

/**
 * Creates the syntax correction prompt.
 * Originally extracted from `EnhancedCodeGenerator._correctSyntaxIssues`.
 */
export function createSyntaxCorrectionPrompt(
	filePath: string,
	content: string,
	issues: CodeIssue[],
	context: EnhancedGenerationContext
): string {
	const languageId = _getLanguageId(path.extname(filePath));
	const groupedAndPrioritizedIssues = _groupAndPrioritizeIssues(issues);
	const formattedIssues = _formatGroupedIssuesForPrompt(
		groupedAndPrioritizedIssues,
		languageId,
		content
	);

	return `
	------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------
	Fix the following **VS Code-reported compilation/linting issues** (syntax errors) in the code:

**Syntax Issues:**
${formattedIssues}

**Current Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Correction Instructions:**
- **PRIORITY: ZERO ERRORS/WARNINGS**: Your primary objective is to resolve ALL reported issues in this single refinement attempt. The resulting code MUST compile and run without any errors or warnings.
- **Learn from History**: Analyze and learn from the provided Successful Change History to replicate effective solutions, and from the Failed Correction Diff to understand past failures and avoid repeating unproductive strategies.
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- **Proactive Error Mitigation**: Beyond fixing the immediate issues, proactively prevent future occurrences where applicable, such as robust type usage, proper import organization, secure data handling, and comprehensive null/undefined checks.
- Fix all syntax errors
- Ensure proper language syntax
- Maintain the original functionality
- Keep the code structure intact

**Context:**
${context.projectContext}

**Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Info:**
- **Contextual Accuracy**: Use this info for correct integration, signatures, types, and naming for code interacting with these symbols.
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

${
	context.fileStructureAnalysis
		? _formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Change History:**
Analyze past successful patterns and apply effective solution strategies.
${context.successfulChangeHistory}
`
		: ""
}
${
	context.isOscillating
		? `--- DETECTED CORRECTION OSCILLATION ---
**WARNING**: It appears the AI is stuck in a repetitive correction cycle, unable to resolve or continually re-introducing the same set of issues across recent attempts. This often happens when the AI tries similar fixes repeatedly without understanding the underlying cause or when changes conflict with other parts of the code.
**CRITICAL DIRECTIVE**: You MUST adopt a completely different, fundamentally new approach to break this cycle. Do NOT repeat similar failed attempts or minor adjustments. Analyze the historical outcomes from 'Recent Correction Attempt Outcomes' for patterns and propose a genuinely new correction strategy that tackles the problem from a different angle. This might involve:
-   Re-evaluating fundamental assumptions about the code or problem.
-   Considering alternative architectural patterns.
-   Breaking down the problem into smaller, more manageable sub-problems.
-   Searching for external documentation or examples if a common pattern is being misapplied.
-   Introducing new helper functions or refactoring a larger section if the existing structure is hostile to the fix.
--- END DETECTED CORRECTION OSCILLATION ---
`
		: ""
}
${
	context.lastCorrectionAttemptOutcome?.aiFailureAnalysis
		? `--- AI Self-Correction Analysis (from previous failed attempt) ---
**CRITICAL**: Read and internalize this analysis. It details *why* your previous attempt failed. You MUST adjust your strategy based on these insights to avoid repeating past mistakes.
**Previous Failure Analysis**:
${context.lastCorrectionAttemptOutcome.aiFailureAnalysis}
--- End AI Self-Correction Analysis ---
`
		: ""
}

BEGIN_CODE
// Your task: Generate the complete and correct code for the target file here.
// Start your code immediately below this line.
// Ensure the code is valid, production-ready, and adheres to modern best practices for that code.
END_CODE

**CRITICAL NEGATIVE CONSTRAINT**:
- Your response MUST include the \`BEGIN_CODE\` and \`END_CODE\` delimiters.
- The system will ONLY extract content strictly located between these delimiters.
- Therefore, your response MUST contain **ABSOLUTELY NOTHING ELSE** outside of these markers.
- This means: **NO** conversational text, **NO** explanations, **NO** apologies, **NO** comments (even inside the code block itself, unless they are part of the original/expected code logic), **NO** markdown formatting (e.g., \`\`\`language), **NO** meta-headers, and **NO** other extraneous characters or elements.
- Your output must start IMMEDIATELY with \`BEGIN_CODE\` and end IMMEDIATELY with \`END_CODE\`, with pure code in between.
- **PURE CODE ONLY. NOTHING ELSE. ONLY CODE.

------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------`;
}

/**
 * Creates the import correction prompt.
 * Originally extracted from `EnhancedCodeGenerator._correctImportIssues`.
 */
export function createImportCorrectionPrompt(
	filePath: string,
	content: string,
	issues: CodeIssue[],
	context: EnhancedGenerationContext
): string {
	const languageId = _getLanguageId(path.extname(filePath));
	const groupedAndPrioritizedIssues = _groupAndPrioritizeIssues(issues);
	const formattedIssues = _formatGroupedIssuesForPrompt(
		groupedAndPrioritizedIssues,
		languageId,
		content
	);

	return `
	------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------
	Fix the following **VS Code-reported compilation/linting issues** (import errors/warnings) in the code:

**Import Issues:**
${formattedIssues}

**Current Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Correction Instructions:**
- **PRIORITY: ZERO ERRORS/WARNINGS**: Your primary objective is to resolve ALL reported issues in this single refinement attempt. The resulting code MUST compile and run without any errors or warnings.
- **Learn from History**: Analyze and learn from the provided Successful Change History to replicate effective solutions, and from the Failed Correction Diff to understand past failures and avoid repeating unproductive strategies.
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- **Proactive Error Mitigation**: Beyond fixing the immediate issues, proactively prevent future occurrences where applicable, such as robust type usage, proper import organization, secure data handling, and comprehensive null/undefined checks.

**Context:**
${context.projectContext}

**Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Info:**
- **Contextual Accuracy**: Use this info for correct integration, signatures, types, and naming for code interacting with these symbols.
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

${
	context.fileStructureAnalysis
		? _formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Change History:**
Analyze past successful patterns and apply effective solution strategies.
${context.successfulChangeHistory}
`
		: ""
}
${
	context.isOscillating
		? `--- DETECTED CORRECTION OSCILLATION ---
**WARNING**: It appears the AI is stuck in a repetitive correction cycle, unable to resolve or continually re-introducing the same set of issues across recent attempts. This often happens when the AI tries similar fixes repeatedly without understanding the underlying cause or when changes conflict with other parts of the code.
**CRITICAL DIRECTIVE**: You MUST adopt a completely different, fundamentally new approach to break this cycle. Do NOT repeat similar failed attempts or minor adjustments. Analyze the historical outcomes from 'Recent Correction Attempt Outcomes' for patterns and propose a genuinely new correction strategy that tackles the problem from a different angle. This might involve:
-   Re-evaluating fundamental assumptions about the code or problem.
-   Considering alternative architectural patterns.
-   Breaking down the problem into smaller, more manageable sub-problems.
-   Searching for external documentation or examples if a common pattern is being misapplied.
-   Introducing new helper functions or refactoring a larger section if the existing structure is hostile to the fix.
--- END DETECTED CORRECTION OSCILLATION ---
`
		: ""
}
${
	context.lastCorrectionAttemptOutcome?.aiFailureAnalysis
		? `--- AI Self-Correction Analysis (from previous failed attempt) ---
**CRITICAL**: Read and internalize this analysis. It details *why* your previous attempt failed. You MUST adjust your strategy based on these insights to avoid repeating past mistakes.
**Previous Failure Analysis**:
${context.lastCorrectionAttemptOutcome.aiFailureAnalysis}
--- End AI Self-Correction Analysis ---
`
		: ""
}

BEGIN_CODE
// Your task: Generate the complete and correct code for the target file here.
// Start your code immediately below this line.
// Ensure the code is valid, production-ready, and adheres to modern best practices for that code.
END_CODE

**CRITICAL NEGATIVE CONSTRAINT**:
- Your response MUST include the \`BEGIN_CODE\` and \`END_CODE\` delimiters.
- The system will ONLY extract content strictly located between these delimiters.
- Therefore, your response MUST contain **ABSOLUTELY NOTHING ELSE** outside of these markers.
- This means: **NO** conversational text, **NO** explanations, **NO** apologies, **NO** comments (even inside the code block itself, unless they are part of the original/expected code logic), **NO** markdown formatting (e.g., \`\`\`language), **NO** meta-headers, and **NO** other extraneous characters or elements.
- Your output must start IMMEDIATELY with \`BEGIN_CODE\` and end IMMEDIATELY with \`END_CODE\`, with pure code in between.
- **PURE CODE ONLY. NOTHING ELSE. ONLY CODE.

------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------`;
}

/**
 * Creates the best practice and other issues correction prompt.
 * Originally extracted from `EnhancedCodeGenerator._correctPracticeIssues`.
 */
export function createPracticeCorrectionPrompt(
	filePath: string,
	content: string,
	issues: CodeIssue[],
	context: EnhancedGenerationContext
): string {
	const languageId = _getLanguageId(path.extname(filePath));
	const groupedAndPrioritizedIssues = _groupAndPrioritizeIssues(issues);
	const formattedIssues = _formatGroupedIssuesForPrompt(
		groupedAndPrioritizedIssues,
		languageId,
		content
	);

	return `
	------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------
	Fix the following **VS Code-reported compilation/linting issues** (best practice or other general issues) in the code:

**Issues to Address:**
${formattedIssues}

**Current Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Correction Instructions:**
- **PRIORITY: ZERO ERRORS/WARNINGS**: Your primary objective is to resolve ALL reported issues in this single refinement attempt. The resulting code MUST compile and run without any errors or warnings.
- **Learn from History**: Analyze and learn from the provided Successful Change History to replicate effective solutions, and from the Failed Correction Diff to understand past failures and avoid repeating unproductive strategies.
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- **Proactive Error Mitigation**: Beyond fixing the immediate issues, proactively prevent future occurrences where applicable, such as robust type usage, proper import organization, secure data handling, and comprehensive null/undefined checks.

**Context:**
${context.projectContext}

**Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Info:**
- **Contextual Accuracy**: Use this info for correct integration, signatures, types, and naming for code interacting with these symbols.
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

${
	context.fileStructureAnalysis
		? _formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Change History:**
Analyze past successful patterns and apply effective solution strategies.
${context.successfulChangeHistory}
`
		: ""
}
${
	context.isOscillating
		? `--- DETECTED CORRECTION OSCILLATION ---
**WARNING**: It appears the AI is stuck in a repetitive correction cycle, unable to resolve or continually re-introducing the same set of issues across recent attempts. This often happens when the AI tries similar fixes repeatedly without understanding the underlying cause or when changes conflict with other parts of the code.
**CRITICAL DIRECTIVE**: You MUST adopt a completely different, fundamentally new approach to break this cycle. Do NOT repeat similar failed attempts or minor adjustments. Analyze the historical outcomes from 'Recent Correction Attempt Outcomes' for patterns and propose a genuinely new correction strategy that tackles the problem from a different angle. This might involve:
-   Re-evaluating fundamental assumptions about the code or problem.
-   Considering alternative architectural patterns.
-   Breaking down the problem into smaller, more manageable sub-problems.
-   Searching for external documentation or examples if a common pattern is being misapplied.
-   Introducing new helper functions or refactoring a larger section if the existing structure is hostile to the fix.
--- END DETECTED CORRECTION OSCILLATION ---
`
		: ""
}
${
	context.lastCorrectionAttemptOutcome?.aiFailureAnalysis
		? `--- AI Self-Correction Analysis (from previous failed attempt) ---
**CRITICAL**: Read and internalize this analysis. It details *why* your previous attempt failed. You MUST adjust your strategy based on these insights to avoid repeating past mistakes.
**Previous Failure Analysis**:
${context.lastCorrectionAttemptOutcome.aiFailureAnalysis}
--- End AI Self-Correction Analysis ---
`
		: ""
}

BEGIN_CODE
// Your task: Generate the complete and correct code for the target file here.
// Start your code immediately below this line.
// Ensure the code is valid, production-ready, and adheres to modern best practices for that code.
END_CODE

**CRITICAL NEGATIVE CONSTRAINT**:
- Your response MUST include the \`BEGIN_CODE\` and \`END_CODE\` delimiters.
- The system will ONLY extract content strictly located between these delimiters.
- Therefore, your response MUST contain **ABSOLUTELY NOTHING ELSE** outside of these markers.
- This means: **NO** conversational text, **NO** explanations, **NO** apologies, **NO** comments (even inside the code block itself, unless they are part of the original/expected code logic), **NO** markdown formatting (e.g., \`\`\`language), **NO** meta-headers, and **NO** other extraneous characters or elements.
- Your output must start IMMEDIATELY with \`BEGIN_CODE\` and end IMMEDIATELY with \`END_CODE\`, with pure code in between.
- **PURE CODE ONLY. NOTHING ELSE. ONLY CODE.

------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------`;
}

/**
 * Creates the security issues correction prompt.
 * Originally extracted from `EnhancedCodeGenerator._correctSecurityIssues`.
 */
export function createSecurityCorrectionPrompt(
	filePath: string,
	content: string,
	issues: CodeIssue[],
	context: EnhancedGenerationContext
): string {
	const languageId = _getLanguageId(path.extname(filePath));
	const groupedAndPrioritizedIssues = _groupAndPrioritizeIssues(issues);
	const formattedIssues = _formatGroupedIssuesForPrompt(
		groupedAndPrioritizedIssues,
		languageId,
		content
	);

	return `
	------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------
	Fix the following **VS Code-reported compilation/linting issues** (security vulnerabilities) in the code:

**Security Issues:**
${formattedIssues}

**Current Content:**
\`\`\`${languageId}
${content}
\`\`\`

**Correction Instructions:**
- **Learn from History**: Analyze and learn from the provided Successful Change History to replicate effective solutions, and from the Failed Correction Diff to understand past failures and avoid repeating unproductive strategies.
-   **Preserve Surrounding Code**: Leave all code lines and blocks untouched if they are not directly involved in resolving an identified diagnostic.
-   **Maintain Indentation/Formatting**: Strictly adhere to the existing indentation, spacing, and formatting conventions of the original code.
- **Proactive Error Mitigation**: Beyond fixing the immediate issues, proactively prevent future occurrences where applicable, such as robust type usage, proper import organization, secure data handling, and comprehensive null/undefined checks.

**Context:**
${context.projectContext}

**Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Info:**
- **Contextual Accuracy**: Use this info for correct integration, signatures, types, and naming for code interacting with these symbols.
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

${
	context.fileStructureAnalysis
		? _formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Change History:**
Analyze past successful patterns and apply effective solution strategies.
${context.successfulChangeHistory}
`
		: ""
}
${
	context.isOscillating
		? `--- DETECTED CORRECTION OSCILLATION ---
**WARNING**: It appears the AI is stuck in a repetitive correction cycle, unable to resolve or continually re-introducing the same set of issues across recent attempts. This often happens when the AI tries similar fixes repeatedly without understanding the underlying cause or when changes conflict with other parts of the code.
**CRITICAL DIRECTIVE**: You MUST adopt a completely different, fundamentally new approach to break this cycle. Do NOT repeat similar failed attempts or minor adjustments. Analyze the historical outcomes from 'Recent Correction Attempt Outcomes' for patterns and propose a genuinely new correction strategy that tackles the problem from a different angle. This might involve:
-   Re-evaluating fundamental assumptions about the code or problem.
-   Considering alternative architectural patterns.
-   Breaking down the problem into smaller, more manageable sub-problems.
-   Searching for external documentation or examples if a common pattern is being misapplied.
-   Introducing new helper functions or refactoring a larger section if the existing structure is hostile to the fix.
--- END DETECTED CORRECTION OSCILLATION ---
`
		: ""
}
${
	context.lastCorrectionAttemptOutcome?.aiFailureAnalysis
		? `--- AI Self-Correction Analysis (from previous failed attempt) ---
**CRITICAL**: Read and internalize this analysis. It details *why* your previous attempt failed. You MUST adjust your strategy based on these insights to avoid repeating past mistakes.
**Previous Failure Analysis**:
${context.lastCorrectionAttemptOutcome.aiFailureAnalysis}
--- End AI Self-Correction Analysis ---
`
		: ""
}

BEGIN_CODE
// Your task: Generate the complete and correct code for the target file here.
// Start your code immediately below this line.
// Ensure the code is valid, production-ready, and adheres to modern best practices for that code.
END_CODE

**CRITICAL NEGATIVE CONSTRAINT**:
- Your response MUST include the \`BEGIN_CODE\` and \`END_CODE\` delimiters.
- The system will ONLY extract content strictly located between these delimiters.
- Therefore, your response MUST contain **ABSOLUTELY NOTHING ELSE** outside of these markers.
- This means: **NO** conversational text, **NO** explanations, **NO** apologies, **NO** comments (even inside the code block itself, unless they are part of the original/expected code logic), **NO** markdown formatting (e.g., \`\`\`language), **NO** meta-headers, and **NO** other extraneous characters or elements.
- Your output must start IMMEDIATELY with \`BEGIN_CODE\` and end IMMEDIATELY with \`END_CODE\`, with pure code in between.
- **PURE CODE ONLY. NOTHING ELSE. ONLY CODE.

------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------`;
}

/**
 * Creates the pure code format correction prompt, specifically to enforce BEGIN_CODE/END_CODE delimiters.
 */
export function createPureCodeFormatCorrectionPrompt(
	filePath: string,
	content: string,
	context: EnhancedGenerationContext
): string {
	const languageId = _getLanguageId(path.extname(filePath));
	// When this prompt is called, the 'issues' typically passed would be from the format check itself.
	// We'll use the issues from the last correction attempt outcome if available and filter for format_error.
	const issues: CodeIssue[] =
		context.lastCorrectionAttemptOutcome?.issuesRemaining.filter(
			(i) => i.type === "format_error"
		) || [];

	const groupedAndPrioritizedIssues = _groupAndPrioritizeIssues(issues);
	const formattedIssues = _formatGroupedIssuesForPrompt(
		groupedAndPrioritizedIssues,
		languageId,
		content
	);

	return `
	------ ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO BELOW ------
	You are an expert software engineer. Your task is to correct the format of the previously generated code. ONLY focus on generating code.

**CRITICAL REQUIREMENTS:**
1. **Strict Format Adherence**: Your response MUST contain ONLY the generated code enclosed STRICTLY within \`BEGIN_CODE\` and \`END_CODE\` delimiters. NO other text, explanations, or markdown fences (\`\`\`language) are allowed outside these delimiters.
2. **Pure Code Output**: The content between \`BEGIN_CODE\` and \`END_CODE\` must be valid, executable ${languageId} code.
3. **No Conversational Text**: ABSOLUTELY NO conversational text, apologies, explanations, comments, or meta-information outside the delimiters.
4. **Error Prevention**: Ensure the corrected code will compile and run *without any errors or warnings*.

**Context:**
- Path: ${filePath}
- Language: ${languageId}

**Issues to Address (primarily formatting, but other issues if present):**
${formattedIssues}

**Current Problematic Content (from previous AI attempt):**
\`\`\`${languageId}
${content}
\`\`\`

**Correction Instructions:**
-   **Enforce Delimiters**: Ensure all generated code is ONLY between \`BEGIN_CODE\` and \`END_CODE\` markers.
-   **Remove Extraneous Text**: Eliminate all conversational filler, explanations, markdown formatting (triple backticks), or meta-headers outside the delimiters.
-   **Deliver Pure Code**: Focus solely on generating valid, executable code for the file.
-   **Maintain Functionality**: Ensure the corrected output accurately reflects the intended functionality and is production-ready.

**Project Context:**
${context.projectContext}

**Relevant Snippets:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**Active Symbol Info:**
- **Contextual Accuracy**: Use this info for correct integration, signatures, types, and naming for code interacting with these symbols.
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

${
	context.fileStructureAnalysis
		? _formatFileStructureAnalysis(context.fileStructureAnalysis) + "\n"
		: ""
}

${
	context.successfulChangeHistory
		? `
**Change History:**
Analyze past successful patterns and apply effective solution strategies.
${context.successfulChangeHistory}
`
		: ""
}
${
	context.isOscillating
		? `--- DETECTED CORRECTION OSCILLATION ---
**WARNING**: It appears the AI is stuck in a repetitive correction cycle, unable to resolve or continually re-introducing the same set of issues across recent attempts. This often happens when the AI tries similar fixes repeatedly without understanding the underlying cause or when changes conflict with other parts of the code.
**CRITICAL DIRECTIVE**: You MUST adopt a completely different, fundamentally new approach to break this cycle. Do NOT repeat similar failed attempts or minor adjustments. Analyze the historical outcomes from 'Recent Correction Attempt Outcomes' for patterns and propose a genuinely new correction strategy that tackles the problem from a different angle. This might involve:
-   Re-evaluating fundamental assumptions about the code or problem.
-   Considering alternative architectural patterns.
-   Breaking down the problem into smaller, more manageable sub-problems.
-   Searching for external documentation or examples if a common pattern is being misapplied.
-   Introducing new helper functions or refactoring a larger section if the existing structure is hostile to the fix.
--- END DETECTED CORRECTION OSCILLATION ---
`
		: ""
}
${
	context.lastCorrectionAttemptOutcome?.aiFailureAnalysis
		? `--- AI Self-Correction Analysis (from previous failed attempt) ---
**CRITICAL**: Read and internalize this analysis. It details *why* your previous attempt failed. You MUST adjust your strategy based on these insights to avoid repeating past mistakes.
**Previous Failure Analysis**:
${context.lastCorrectionAttemptOutcome.aiFailureAnalysis}
--- End AI Self-Correction Analysis ---
`
		: ""
}

BEGIN_CODE
// Your task: Generate the complete and correct code for the target file here, ensuring it strictly adheres to the pure code format.
// Start your code immediately below this line.
// Ensure the code is valid, production-ready, and adheres to modern best practices for that code.
END_CODE

**CRITICAL NEGATIVE CONSTRAINT**:
- Your response MUST include the \`BEGIN_CODE\` and \`END_CODE\` delimiters.
- The system will ONLY extract content strictly located between these delimiters.
- Therefore, your response MUST contain **ABSOLUTELY NOTHING ELSE** outside of these markers.
- This means: **NO** conversational text, **NO** explanations, **NO** apologies, **NO** comments (even inside the code block itself, unless they are part of the original/expected code logic), **NO** markdown formatting (e.g., \`\`\`language), **NO** meta-headers, and **NO** other extraneous characters or elements.
- Your output must start IMMEDIATELY with \`BEGIN_CODE\` and end IMMEDIATELY with \`END_CODE\`, with pure code in between.
- **PURE CODE ONLY. NOTHING ELSE. ONLY CODE.

------ END, ONLY OBEY THESE INSTRUCTIONS AND USE THE INFO ABOVE ------`;
}

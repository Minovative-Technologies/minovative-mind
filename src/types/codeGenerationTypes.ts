// src/types/codeGenerationTypes.ts
import * as vscode from "vscode";
import { ActiveSymbolDetailedInfo } from "../services/contextService";

/**
 * Real-time feedback interface for code generation
 */
export interface RealTimeFeedback {
	stage: string;
	message: string;
	issues: CodeIssue[];
	suggestions: string[];
	progress: number; // 0-100
}

export interface CodeValidationResult {
	isValid: boolean;
	finalContent: string;
	issues: CodeIssue[];
	suggestions: string[];
	iterations?: number;
	totalIssues?: number;
	resolvedIssues?: number;
}

export interface CodeIssue {
	type:
		| "syntax"
		| "unused_import"
		| "best_practice"
		| "security"
		| "other"
		| "format_error";
	message: string;
	line: number;
	severity: "error" | "warning" | "info";
	code?: string | number;
	source?: string;
}

export interface FileAnalysis {
	framework: string;
	projectStructure: string;
	expectedPatterns: string;
	fileName: string;
	extension: string;
}

export interface FileStructureAnalysis {
	imports: Array<{ line: number; content: string }>;
	exports: Array<{ line: number; content: string }>;
	functions: Array<{ line: number; content: string }>;
	classes: Array<{ line: number; content: string }>;
	variables: Array<{ line: number; content: string }>;
	comments: Array<{ line: number; content: string }>;
}

export interface DiffAnalysis {
	isReasonable: boolean;
	issues: string[];
	changeRatio: number;
}

/**
 * Encapsulates details about a single correction attempt that did not yield the desired result.
 */
export interface CorrectionAttemptOutcome {
	type: string;
	success: boolean;
	iteration: number;
	originalIssuesCount: number;
	issuesAfterAttemptCount: number;
	issuesRemaining: CodeIssue[];
	issuesIntroduced?: CodeIssue[]; // Made optional as per instruction
	relevantDiff?: string; // Made optional as per instruction
	aiGeneratedContent: string; // Added as per instruction
	stdout?: string; // Added for richer context on failures
	stderr?: string; // Added for richer context on failures
	aiFailureAnalysis: string;
	failureType: // Modified to include enum-like values
	| "no_improvement"
		| "new_errors_introduced"
		| "parsing_failed"
		| "unreasonable_diff"
		| "command_failed"
		| "regression_detected" // Added
		| "oscillation_detected" // Added
		| "unknown";
	feedbackUsed?: CorrectionFeedback;
}

export interface EnhancedGenerationContext {
	projectContext: string;
	relevantSnippets: string;
	editorContext?: any;
	activeSymbolInfo?: ActiveSymbolDetailedInfo;
	fileStructureAnalysis?: FileStructureAnalysis;
	lastFailedCorrectionDiff?: string;
	successfulChangeHistory?: string;
	lastCorrectionAttemptOutcome?: CorrectionAttemptOutcome;
	recentCorrectionAttemptOutcomes?: CorrectionAttemptOutcome[];
	isOscillating?: boolean;
	relevantFiles?: string;
	isRewriteOperation?: boolean;
}

// NOTE: The CorrectionFeedback interface was not found in the provided current content for this file.
// Based on its usage context in src/ai/enhancedCodeGeneration.ts and common patterns,
// if it were present, it would likely look like this:
export interface CorrectionFeedback {
	type:
		| "no_improvement"
		| "new_errors_introduced"
		| "parsing_failed"
		| "unreasonable_diff"
		| "command_failed"
		| "unknown"
		| "oscillation_detected"; // Added based on enhancedCodeGeneration.ts usage
	message: string;
	details?: {
		previousIssues?: CodeIssue[];
		currentIssues?: CodeIssue[];
		parsingError?: string;
		failedJson?: string;
		issuesIntroduced?: CodeIssue[]; // Added as per instruction
		relevantDiff?: string; // Added as per instruction
		stdout?: string; // Potentially useful for command_failed
		stderr?: string; // Potentially useful for command_failed
	};
	issuesRemaining: CodeIssue[];
	issuesIntroduced?: CodeIssue[]; // Added as per instruction
	relevantDiff?: string; // Added as per instruction
}

export interface EditorContext {
	instruction: string;
	selectedText: string;
	fullText: string;
	languageId: string;
	filePath: string;
	documentUri: import("vscode").Uri;
	selection: import("vscode").Range;
}

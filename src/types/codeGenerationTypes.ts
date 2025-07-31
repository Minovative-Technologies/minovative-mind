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
	success: boolean;
	iteration: number;
	originalIssuesCount: number;
	issuesAfterAttemptCount: number;
	issuesRemaining: CodeIssue[];
	issuesIntroduced: CodeIssue[];
	relevantDiff: string;
	aiFailureAnalysis: string;
	failureType:
		| "no_improvement"
		| "new_errors_introduced"
		| "parsing_failed"
		| "unreasonable_diff"
		| "command_failed"
		| "unknown";
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

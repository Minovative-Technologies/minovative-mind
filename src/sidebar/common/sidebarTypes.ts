// src/sidebar/common/sidebarTypes.ts
import * as vscode from "vscode";
import { Content } from "@google/generative-ai"; // Assuming History might be needed if HistoryEntry evolves

// Re-export or define as needed. If HistoryEntry is just Content, you can use Content directly.
export type HistoryEntry = Content; // Or export type HistoryEntry = History; if more appropriate

export interface ApiKeyInfo {
	maskedKey: string;
	index: number;
	isActive: boolean;
}

export interface KeyUpdateData {
	keys: ApiKeyInfo[];
	activeIndex: number;
	totalKeys: number;
}

export interface ChatMessage {
	sender: "User" | "Model" | "System";
	text: string;
	className: string;
}

export interface PlanGenerationContext {
	type: "chat" | "editor";
	originalUserRequest?: string;
	editorContext?: {
		instruction: string;
		selectedText: string;
		fullText: string;
		languageId: string;
		filePath: string;
		documentUri: vscode.Uri;
		selection: vscode.Range;
	};
	projectContext: string;
	diagnosticsString?: string;
	initialApiKey: string;
	modelName: string;
	chatHistory?: HistoryEntry[];
	textualPlanExplanation: string;
}

export type ExecutionOutcome = "success" | "cancelled" | "failed";

// If you need ParsedPlanResult or CreateFileStep types here from workflowPlanner,
// it's better to import them directly from "../ai/workflowPlanner" in files that need them,
// rather than re-exporting them through sidebarTypes.ts, to keep dependencies clear.

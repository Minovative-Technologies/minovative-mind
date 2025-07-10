// src/sidebar/common/sidebarTypes.ts
import * as vscode from "vscode";
import { Content } from "@google/generative-ai"; // Assuming History might be needed if HistoryEntry evolves

// Define the specific structure for parts within HistoryEntry
export interface HistoryEntryPart {
	text: string;
}

// HistoryEntry should align with Gemini API's TextPart expectation for its content parts
// by explicitly defining its parts property, overriding the general 'Part[]' from 'Content'.
// Omit 'parts' from the original Content interface to enforce our stricter definition.
export interface HistoryEntry extends Omit<Content, "parts"> {
	parts: HistoryEntryPart[];
	diffContent?: string;
	relevantFiles?: string[];
	isRelevantFilesExpanded?: boolean;
}

export interface ToggleRelevantFilesDisplayMessage {
	type: "toggleRelevantFilesDisplay";
	messageIndex: number;
	isExpanded: boolean;
}

export interface UpdateRelevantFilesDisplayMessage {
	type: "updateRelevantFilesDisplay";
	messageIndex: number;
	isExpanded: boolean;
}

export interface OpenUrlMessage {
	command: "openUrl";
	url: string;
}

export interface FirebaseConfigPayload {
	apiKey: string;
	authDomain: string;
	projectId: string;
	storageBucket: string;
	messagingSenderId: string;
	appId: string;
	measurementId?: string;
}

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
	diffContent?: string;
	relevantFiles?: string[];
}

export interface EditChatMessage {
	type: "editChatMessage";
	messageIndex: number; // The index of the message in the chat history array
	newContent: string; // The new, edited content of the message
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
	workspaceRootUri: vscode.Uri;
	relevantFiles?: string[];
	isMergeOperation?: boolean; // New optional property for merge conflict resolution
}

export interface PlanGenerationResult {
	success: boolean;
	textualPlanExplanation?: string;
	context?: PlanGenerationContext;
	error?: string;
}

export interface PersistedPlanData {
	type: "chat" | "editor"; // Indicates if the plan originated from chat or editor context
	originalUserRequest?: string; // Original request for chat-based plans
	originalInstruction?: string; // Original instruction for editor-based plans
	relevantFiles?: string[]; // Files relevant to the plan
	textualPlanExplanation: string; // The full text of the generated plan (crucial for re-display)
}

export type ExecutionOutcome = "success" | "cancelled" | "failed";

export interface EditorContext {
	instruction: string;
	selectedText: string;
	fullText: string;
	languageId: string;
	filePath: string;
	documentUri: import("vscode").Uri;
	selection: import("vscode").Range;
}

export interface AiStreamingState {
	content: string;
	relevantFiles?: string[];
	isComplete: boolean;
	isError: boolean;
}

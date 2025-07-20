// src/sidebar/common/sidebarTypes.ts
import * as vscode from "vscode";
import { Content } from "@google/generative-ai"; // Assuming History might be needed if HistoryEntry evolves
import { ActiveSymbolDetailedInfo } from "../../services/contextService"; // NEW: Required for PlanGenerationContext

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
	isPlanExplanation?: boolean;
	isPlanStepUpdate?: boolean;
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
	isPlanExplanation?: boolean;
	isPlanStepUpdate?: boolean;
}

export interface EditChatMessage {
	type: "editChatMessage";
	messageIndex: number; // The index of the message in the chat history array
	newContent: string; // The new, edited content of the message
}

// New message type: Webview to Extension for generating plan prompt from AI message
export interface GeneratePlanPromptFromAIMessage {
	type: "generatePlanPromptFromAIMessage";
	payload: { messageIndex: number };
}

export interface RevertRequestMessage {
	type: "revertRequest";
}

/**
 * Union type for all messages sent from the Webview to the Extension.
 * Each member should have a distinct 'type' literal property.
 */
export type WebviewToExtensionMessages =
	| ToggleRelevantFilesDisplayMessage
	| UpdateRelevantFilesDisplayMessage
	| EditChatMessage
	| GeneratePlanPromptFromAIMessage
	| RevertRequestMessage; // Added RevertRequestMessage

// New message type: Extension to Webview for pre-filling chat input
export interface PrefillChatInput {
	type: "PrefillChatInput";
	payload: { text: string };
}

// Placeholder interfaces for other ExtensionToWebviewMessages inferred from usage
// These are not exhaustive but represent common message types.
interface StatusUpdateMessage {
	type: "statusUpdate";
	value: string;
	isError?: boolean;
}

interface AiResponseStartMessage {
	type: "aiResponseStart";
	value: { modelName: string; relevantFiles: string[] };
}

interface AiResponseChunkMessage {
	type: "aiResponseChunk";
	value: string;
}

interface AiResponseEndMessage {
	type: "aiResponseEnd";
	success: boolean;
	error?: string | null;
	isPlanResponse?: boolean;
	requiresConfirmation?: boolean;
	planData?: any;
	isCommitReviewPending?: boolean;
	commitReviewData?: { commitMessage: string; stagedFiles: string[] } | null;
	statusMessageOverride?: string;
}

interface UpdateLoadingStateMessage {
	type: "updateLoadingState";
	value: boolean;
}

interface ReenableInputMessage {
	type: "reenableInput";
}

interface ApiKeyStatusMessage {
	type: "apiKeyStatus";
	value: string;
}

interface UpdateModelListMessage {
	type: "updateModelList";
	value: { availableModels: string[]; selectedModel: string };
}

interface UpdateOptimizationSettingsMessage {
	type: "updateOptimizationSettings";
	value: any;
}

export interface AppendRealtimeModelMessage {
	type: "appendRealtimeModelMessage";
	value: { text: string; isError?: boolean };
	diffContent?: string;
	relevantFiles?: string[];
	isPlanStepUpdate?: boolean; // New property
}

interface RestorePendingPlanConfirmationMessage {
	type: "restorePendingPlanConfirmation";
	value: PersistedPlanData;
}

interface StructuredPlanParseFailedMessage {
	type: "structuredPlanParseFailed";
	value: { error: string; failedJson: string };
}

interface PlanExecutionStartedMessage {
	type: "planExecutionStarted";
}

interface PlanExecutionEndedMessage {
	type: "planExecutionEnded";
}

export interface PlanExecutionFinishedMessage {
	type: "planExecutionFinished";
	hasRevertibleChanges: boolean;
}

export interface RevertCompletedMessage {
	type: "revertCompleted";
}

/**
 * Message type for updating token statistics.
 */
export interface UpdateTokenStatisticsMessage {
	type: "updateTokenStatistics";
	value: {
		totalInput: string;
		totalOutput: string;
		total: string;
		requestCount: string;
		averageInput: string;
		averageOutput: string;
	};
}

/**
 * Message type for dynamically updating the relevant files list
 * for a currently streaming AI response in the webview.
 */
export interface UpdateStreamingRelevantFilesMessage {
	type: "updateStreamingRelevantFiles";
	value: string[]; // Array of relative file paths (e.g., "src/foo/bar.ts")
}

// NEW: Add RestoreStreamingProgressMessage
export interface RestoreStreamingProgressMessage {
	type: "restoreStreamingProgress";
	value: AiStreamingState | null;
}

// NEW: Add RestorePendingCommitReviewMessage
export interface RestorePendingCommitReviewMessage {
	type: "restorePendingCommitReview";
	value: { commitMessage: string; stagedFiles: string[] } | null;
}

// NEW: Define GitProcessUpdateMessage
export interface GitProcessUpdateMessage {
	type: "gitProcessUpdate";
	value: {
		type: "stdout" | "stderr" | "status";
		data: string;
		isError?: boolean;
	};
}

// NEW: Define UpdateCurrentTokenEstimatesMessage
export interface UpdateCurrentTokenEstimatesMessage {
	type: "updateCurrentTokenEstimates";
	value: {
		inputTokens: string;
		outputTokens: string;
		totalTokens: string;
	};
}

// NEW: Define RequestClearChatConfirmationMessage
export interface RequestClearChatConfirmationMessage {
	type: "requestClearChatConfirmation";
}

// NEW: Define ChatClearedMessage
export interface ChatClearedMessage {
	type: "chatCleared";
}

/**
 * Union type for all messages sent from the Extension to the Webview.
 * Each member should have a distinct 'type' literal property.
 */
export type ExtensionToWebviewMessages =
	| StatusUpdateMessage
	| AiResponseStartMessage
	| AiResponseChunkMessage
	| AiResponseEndMessage
	| ChatClearedMessage // NEW
	| GitProcessUpdateMessage // NEW
	| RequestClearChatConfirmationMessage // NEW
	| UpdateLoadingStateMessage
	| ReenableInputMessage
	| ApiKeyStatusMessage
	| UpdateModelListMessage
	| UpdateOptimizationSettingsMessage
	| RestorePendingPlanConfirmationMessage
	| StructuredPlanParseFailedMessage
	| PlanExecutionStartedMessage
	| PlanExecutionEndedMessage
	| PrefillChatInput
	| UpdateStreamingRelevantFilesMessage
	| PlanExecutionFinishedMessage // Added PlanExecutionFinishedMessage
	| RevertCompletedMessage
	| AppendRealtimeModelMessage
	| UpdateTokenStatisticsMessage // Added UpdateTokenStatisticsMessage
	| UpdateCurrentTokenEstimatesMessage // NEW
	| RestoreStreamingProgressMessage // NEW: Added RestoreStreamingProgressMessage
	| RestorePendingCommitReviewMessage; // NEW: Added RestorePendingCommitReviewMessage

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
	activeSymbolDetailedInfo?: ActiveSymbolDetailedInfo; // NEW: Added optional property for detailed symbol information
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

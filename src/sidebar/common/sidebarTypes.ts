// src/sidebar/common/sidebarTypes.ts
import * as vscode from "vscode";
import { Content } from "@google/generative-ai"; // Assuming History might be needed if HistoryEntry evolves

// Re-export or define as needed. If HistoryEntry is just Content, you can use Content directly.
export type HistoryEntry = Content; // Or export type HistoryEntry = History; if more appropriate

// For Firebase User data from Firestore
export interface UserSubscriptionData {
	stripeSubscriptionId?: string;
	stripeCustomerId?: string;
	subscriptionStatus?:
		| "active"
		| "past_due"
		| "canceled"
		| "unpaid"
		| "free"
		| "incomplete"; // Added "free" & "incomplete"
	subscriptionPeriodStart?: import("firebase/firestore").Timestamp; // For Firestore Timestamps
	subscriptionPeriodEnd?: import("firebase/firestore").Timestamp;
	subscribedTierPriceId?: string;
	email: string; // User's email
	uid: string; // User's email
}

export type UserTier = "free" | "paid" | "pro";

// Message from Settings Webview to Extension
export interface AuthStateUpdatePayload {
	isSignedIn: boolean;
	uid?: string;
	email?: string;
	tier: UserTier;
	isSubscriptionActive: boolean; // Derived from subscriptionStatus
	// You can add more subscription details if the SidebarProvider needs them
}

export interface AuthStateUpdateMessage {
	command: "authStateUpdated";
	payload: AuthStateUpdatePayload;
}

export interface OpenUrlMessage {
	command: "openUrl";
	url: string;
}

// New interface for webview readiness (from Webview to Extension)
export interface SettingsWebviewReadyMessage {
	command: "settingsWebviewReady";
}

// Message from Extension to Settings Webview (e.g., for Firebase config)
export interface FirebaseConfigPayload {
	apiKey: string;
	authDomain: string;
	projectId: string;
	storageBucket: string;
	messagingSenderId: string;
	appId: string;
	measurementId?: string;
}

export interface InitializeSettingsViewMessage {
	command: "initialize";
	firebaseConfig: FirebaseConfigPayload;
	// Add other initial data if needed
}

// Union type for all messages exchanged with the settings webview (bi-directional)
export type SettingsWebviewMessage =
	| AuthStateUpdateMessage
	| OpenUrlMessage
	| SettingsWebviewReadyMessage // Added as per instruction
	| InitializeSettingsViewMessage;

// Union type for messages *from* the Settings Webview *to* the Extension
export type SettingsWebviewIncomingMessage =
	| AuthStateUpdateMessage
	| OpenUrlMessage
	| SettingsWebviewReadyMessage // Logically incoming
	| InitializeSettingsViewMessage; // Added as per instruction, despite original intent as outgoing

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

export interface EditorContext {
	instruction: string;
	selectedText: string;
	fullText: string;
	languageId: string;
	filePath: string;
	documentUri: import("vscode").Uri;
	selection: import("vscode").Range;
}

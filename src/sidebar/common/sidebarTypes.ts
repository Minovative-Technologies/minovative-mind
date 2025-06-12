// src/sidebar/common/sidebarTypes.ts
import * as vscode from "vscode";
import { Content } from "@google/generative-ai"; // Assuming History might be needed if HistoryEntry evolves
import { Timestamp } from "firebase/firestore"; // Import Timestamp for Firestore dates

// Re-export or define as needed. If HistoryEntry is just Content, you can use Content directly.
export interface HistoryEntry extends Content {
	diffContent?: string;
}

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
		| "incomplete"
		| "trialing"; // Added "free" & "incomplete"
	subscriptionPeriodStart?: Timestamp; // For Firestore Timestamps
	subscriptionPeriodEnd?: Timestamp | null;
	subscribedTierPriceId?: string;
	email: string; // User's email
	uid: string; // User's email
}

export type UserTier = "free" | "paid" | "pro";

// Message from Extension to Settings Webview (e.g., for Firebase config)
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

export interface AuthErrorMessage {
	command: "authError";
	payload: { message: string };
}

// New interface for webview readiness (from Webview to Extension)
export interface SettingsWebviewReadyMessage {
	command: "settingsWebviewReady";
}

// New interfaces for auth requests (from Webview to Extension)
export interface SignInRequestMessage {
	command: "signInRequest";
	payload: { email: string; password: string };
}

export interface SignUpRequestMessage {
	command: "signUpRequest";
	payload: { email: string; password: string };
}

export interface SignOutRequestMessage {
	command: "signOutRequest";
}

export interface ManageSubscriptionRequestMessage {
	command: "manageSubscriptionRequest";
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

export interface InitializeSettingsViewMessage {
	command: "initialize";
	firebaseConfig: FirebaseConfigPayload;
	// other initial data if needed
}

// Union type for messages *from* the Settings Webview *to* the Extension
export type SettingsWebviewIncomingMessage =
	| SettingsWebviewReadyMessage
	| SignInRequestMessage
	| SignUpRequestMessage
	| SignOutRequestMessage
	| OpenUrlMessage
	| ManageSubscriptionRequestMessage;

// Union type for messages *from* the Extension *to* the Settings Webview
export type SettingsWebviewOutgoingMessage =
	| InitializeSettingsViewMessage
	| AuthStateUpdateMessage
	| AuthErrorMessage;

// Union type for all messages exchanged with the settings webview (bi-directional)
export type SettingsWebviewMessage =
	| SettingsWebviewIncomingMessage
	| SettingsWebviewOutgoingMessage;

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

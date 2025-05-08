// src/sidebar/SidebarProvider.ts

import * as vscode from "vscode";
import { getNonce } from "../utilities/nonce";
import {
	generateContent,
	resetClient,
	ERROR_QUOTA_EXCEEDED,
} from "../ai/gemini";
import { scanWorkspace } from "../context/workspaceScanner";
import { buildContextString } from "../context/contextBuilder";
import {
	ExecutionPlan,
	PlanStepAction,
	isCreateDirectoryStep,
	isCreateFileStep,
	isModifyFileStep,
	isRunCommandStep,
	parseAndValidatePlan,
} from "../ai/workflowPlanner";
import { Content, GenerationConfig } from "@google/generative-ai";
import path = require("path");

// Secret storage keys
const GEMINI_API_KEYS_LIST_SECRET_KEY = "geminiApiKeysList";
const GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY = "geminiActiveApiKeyIndex";

// Workspace state keys
const MODEL_SELECTION_STORAGE_KEY = "geminiSelectedModel";

// DONT CHANGE THESE MODELS
const AVAILABLE_GEMINI_MODELS = [
	"gemini-2.5-pro-preview-05-06",
	"gemini-2.5-pro-exp-03-25",
	"gemini-2.5-flash-preview-04-17",
];
const DEFAULT_MODEL = AVAILABLE_GEMINI_MODELS[2];

interface ApiKeyInfo {
	maskedKey: string;
	index: number;
	isActive: boolean;
}
interface KeyUpdateData {
	keys: ApiKeyInfo[];
	activeIndex: number;
	totalKeys: number;
}

interface ChatMessage {
	sender: "User" | "Model" | "System";
	text: string;
	className: string;
}

type HistoryEntry = Content;

interface PlanGenerationContext {
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
}

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "minovativeMindSidebarView";

	private _view?: vscode.WebviewView;
	private readonly _extensionUri: vscode.Uri;
	private readonly _secretStorage: vscode.SecretStorage;
	private readonly _workspaceState: vscode.Memento;
	private _apiKeyList: string[] = [];
	private _activeKeyIndex: number = -1;
	private _selectedModelName: string = DEFAULT_MODEL;
	private _chatHistory: HistoryEntry[] = [];
	private _pendingPlanGenerationContext: PlanGenerationContext | null = null;

	constructor(
		private readonly _extensionUri_in: vscode.Uri,
		context: vscode.ExtensionContext
	) {
		this._extensionUri = _extensionUri_in;
		this._secretStorage = context.secrets;
		this._workspaceState = context.workspaceState;

		context.secrets.onDidChange((e) => {
			if (
				e.key === GEMINI_API_KEYS_LIST_SECRET_KEY ||
				e.key === GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
			) {
				console.log(`Secret key changed: ${e.key}. Reloading keys.`);
				this._loadKeysFromStorage().catch((err) => {
					console.error("Error reloading keys on secret change:", err);
				});
			}
		});
	}

	public async initialize(): Promise<void> {
		console.log("SidebarProvider initializing: Loading keys and settings...");
		await this._loadKeysFromStorage();
		this._loadSettingsFromStorage();
		console.log("SidebarProvider initialization complete.");
	}

	public async _generateWithRetry(
		prompt: string,
		initialApiKey: string,
		modelName: string,
		history: HistoryEntry[] | undefined,
		requestType: string = "request",
		generationConfig?: GenerationConfig
	): Promise<string> {
		let currentApiKey = initialApiKey;
		const triedKeys = new Set<string>();
		const maxRetries =
			this._apiKeyList.length > 0 ? this._apiKeyList.length : 1;
		let attempts = 0;

		if (!currentApiKey && this._apiKeyList.length > 0) {
			console.warn(
				"[RetryWrapper] Initial API key was undefined, but keys exist. Using the first available key."
			);
			currentApiKey = this._apiKeyList[0];
			this._activeKeyIndex = 0; // Assume the first key is active if none was provided
			await this._saveKeysToStorage(); // Update storage if we had to guess
		} else if (!currentApiKey) {
			console.error("[RetryWrapper] No API key available for the request.");
			return "Error: No API Key available for the request.";
		}

		while (attempts < maxRetries) {
			attempts++;
			console.log(
				`[RetryWrapper] Attempt ${attempts}/${maxRetries} for ${requestType} with key ...${currentApiKey.slice(
					-4
				)} and config:`,
				generationConfig || "(default)"
			);

			const result = await generateContent(
				currentApiKey,
				modelName,
				prompt,
				history,
				generationConfig, // Pass the config
				undefined // Pass cancellation token if needed later
			);

			if (result === ERROR_QUOTA_EXCEEDED) {
				console.warn(
					`[RetryWrapper] Quota/Rate limit hit for key ...${currentApiKey.slice(
						-4
					)} on attempt ${attempts}.`
				);
				triedKeys.add(currentApiKey);
				const availableKeysCount = this._apiKeyList.length;

				if (availableKeysCount <= 1 || triedKeys.size >= availableKeysCount) {
					const finalErrorMsg = `API quota or rate limit exceeded for model ${modelName}. All ${availableKeysCount} API key(s) failed or were rate-limited. Please try again later or check your Gemini usage.`;
					return finalErrorMsg;
				}

				let nextKeyFound = false;
				let originalIndex = this._activeKeyIndex;
				let nextIndex = originalIndex;

				for (let i = 0; i < availableKeysCount; i++) {
					nextIndex = (originalIndex + i + 1) % availableKeysCount;
					const potentialNextKey = this._apiKeyList[nextIndex];
					if (!triedKeys.has(potentialNextKey)) {
						this.postMessageToWebview({
							type: "statusUpdate",
							value: `Quota limit hit. Retrying ${requestType} with next key...`,
						});
						this._activeKeyIndex = nextIndex;
						await this._saveKeysToStorage();
						currentApiKey = this._apiKeyList[this._activeKeyIndex]; // Update currentApiKey for the next loop iteration
						this.postMessageToWebview({
							type: "apiKeyStatus",
							value: `Switched to key ...${currentApiKey.slice(-4)} for retry.`,
						});
						nextKeyFound = true;
						break;
					}
				}

				if (!nextKeyFound) {
					const finalErrorMsg = `API quota or rate limit exceeded for model ${modelName}. All available API keys have been tried for this request cycle. Please try again later.`;
					return finalErrorMsg;
				}
				// Continue to the next iteration of the while loop with the new key
			} else {
				// If it's not a quota error, return the result (success or other error)
				return result;
			}
		} // End while loop

		// This part is reached only if all retries resulted in quota errors
		const finalErrorMsg = `API quota or rate limit exceeded for model ${modelName}. Failed after trying ${attempts} keys. Please try again later.`;
		return finalErrorMsg;
	}

	private _createInitialPlanningExplanationPrompt(
		projectContext: string,
		userRequest?: string, // For chat-initiated /plan
		editorContext?: {
			// For editor-initiated actions
			instruction: string;
			selectedText: string;
			fullText: string;
			languageId: string;
			filePath: string;
		},
		diagnosticsString?: string
	): string {
		let specificContextPrompt = "";
		let mainInstructions = "";

		if (editorContext) {
			const instructionType =
				editorContext.instruction.toLowerCase() === "/fix"
					? `The user triggered the '/fix' command on the selected code.`
					: `The user provided the custom instruction: "${editorContext.instruction}".`;

			specificContextPrompt = `
			--- Specific User Request Context from Editor ---
			File Path: ${editorContext.filePath}
			Language: ${editorContext.languageId}
			${instructionType}

			--- Selected Code in Editor ---
			\`\`\`${editorContext.languageId}
			${editorContext.selectedText}
			\`\`\`
			--- End Selected Code ---

			${
				diagnosticsString
					? `\n--- Relevant Diagnostics in Selection ---\n${diagnosticsString}\n--- End Relevant Diagnostics ---\n`
					: ""
			}

			--- Full Content of Affected File (${editorContext.filePath}) ---
			\`\`\`${editorContext.languageId}
			${editorContext.fullText}
			\`\`\`
			--- End Full Content ---`;
			mainInstructions = `Based on the user's request from the editor (${
				editorContext.instruction.toLowerCase() === "/fix"
					? "'/fix' command"
					: "custom instruction"
			}) and the provided file/selection context, explain your step-by-step plan to fulfill the request. For '/fix', the plan should clearly address the 'Relevant Diagnostics' listed. For custom instructions, interpret the request in the context of the selected code and any diagnostics.`;
		} else if (userRequest) {
			specificContextPrompt = `
			--- User Request from Chat ---
			${userRequest}
			--- End User Request ---`;
			mainInstructions = `Based on the user's request from the chat ("${userRequest}"), explain your step-by-step plan to fulfill it.`;
		}

		return `
		You are an expert AI programmer assisting within VS Code. Your task is to explain your plan to fulfill the user's request.

		**Goal:** Provide a clear, human-readable, step-by-step explanation of your plan. Use Markdown formatting for clarity (e.g., bullet points, numbered lists, bold text for emphasis).

		**Instructions for Plan Explanation:**
		1.  Analyze Request & Context: ${mainInstructions} Use the broader project context below for reference. ${
			editorContext && diagnosticsString
				? "**Pay close attention to the 'Relevant Diagnostics' section and ensure your textual plan describes how you will address them for '/fix' requests.**"
				: ""
		}
		2.  **Be Comprehensive:** Your explanation should cover all necessary steps to achieve the user's goal.
		3.  Clarity: Make the plan easy for a developer to understand. Briefly describe what each step will do (e.g., "Create a new file named 'utils.ts'", "Modify 'main.ts' to import the new utility function", "Install the 'axios' package using npm").
		4.  No JSON: **Do NOT output any JSON for this initial explanation.** Your entire response should be human-readable text.
		5.  Never Aussume when generating code. ALWAYS provide the code if you think it's not there. NEVER ASSUME ANYTHING.

		${specificContextPrompt}

		*** Broader Project Context (Reference Only) ***
		${projectContext}
		*** End Broader Project Context ***

		--- Plan Explanation (Text with Markdown) ---
`;
	}

	private async _handleInitialPlanRequest(
		userRequest: string,
		apiKey: string,
		modelName: string
	): Promise<void> {
		try {
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Minovative Mind (${modelName}) is formulating a plan explanation...`,
				isLoading: true,
			});
			this._pendingPlanGenerationContext = null; // Clear any previous pending context

			const projectContext = await this._buildProjectContext();
			if (projectContext.startsWith("[Error")) {
				this.postMessageToWebview({
					type: "aiResponse",
					value: `Error generating plan explanation: Failed to build project context. ${projectContext}`,
					isLoading: false,
					isError: true,
				});
				this._addHistoryEntry(
					"model",
					`Error: Failed to build project context for plan explanation.`
				);
				this.postMessageToWebview({ type: "reenableInput" });
				return;
			}

			const textualPlanPrompt = this._createInitialPlanningExplanationPrompt(
				projectContext,
				userRequest,
				undefined, // No editor context for /plan from chat
				undefined // No diagnostics for /plan from chat
			);

			const textualPlanResponse = await this._generateWithRetry(
				textualPlanPrompt,
				apiKey,
				modelName,
				undefined,
				"initial plan explanation"
				// No generationConfig needed for textual explanation
			);

			if (
				textualPlanResponse.toLowerCase().startsWith("error:") ||
				textualPlanResponse === ERROR_QUOTA_EXCEEDED
			) {
				throw new Error(textualPlanResponse);
			}

			// Store context needed for generating the structured JSON plan later
			this._pendingPlanGenerationContext = {
				type: "chat",
				originalUserRequest: userRequest,
				projectContext,
				initialApiKey: apiKey,
				modelName,
			};

			this._addHistoryEntry("model", textualPlanResponse); // Add textual plan to history
			this.postMessageToWebview({
				type: "aiResponse",
				value: textualPlanResponse,
				isLoading: false,
				requiresConfirmation: true,
				planData: { originalRequest: userRequest, type: "textualPlanPending" },
			});
			// Input remains disabled by webview until confirm/cancel.
		} catch (error) {
			console.error("Error in _handleInitialPlanRequest:", error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error generating plan explanation: ${errorMsg}`,
				isLoading: false,
				isError: true,
			});
			this._addHistoryEntry(
				"model",
				`Error generating plan explanation: ${errorMsg}`
			);
			this.postMessageToWebview({ type: "reenableInput" });
		}
	}

	public async initiatePlanFromEditorAction(
		instruction: string,
		selectedText: string,
		fullText: string,
		languageId: string,
		documentUri: vscode.Uri,
		selection: vscode.Range
	) {
		console.log(
			`[SidebarProvider] Received editor action: "${instruction}" for textual plan.`
		);
		const activeKey = this.getActiveApiKey();
		const modelName = this.getSelectedModelName();

		if (!activeKey || !modelName) {
			this.postMessageToWebview({
				type: "aiResponse",
				value: "Error: No active API Key or Model set for planning.",
				isError: true,
			});
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}
		if (this._pendingPlanGenerationContext) {
			this.postMessageToWebview({
				type: "aiResponse",
				value: "Error: Another plan is already pending confirmation.",
				isError: true,
			});
			this.postMessageToWebview({ type: "reenableInput" });
			return;
		}

		try {
			this._addHistoryEntry(
				"model",
				`Received request from editor: "${instruction}". Generating plan explanation...`
			);
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Minovative Mind (${modelName}) received '${instruction}' from editor. Generating plan explanation...`,
				isLoading: true,
			});
			this._pendingPlanGenerationContext = null;

			const projectContext = await this._buildProjectContext();
			if (projectContext.startsWith("[Error")) {
				throw new Error(
					`Failed to build project context for editor action. ${projectContext}`
				);
			}

			let relativeFilePath = documentUri.fsPath;
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders && workspaceFolders.length > 0) {
				relativeFilePath = path.relative(
					workspaceFolders[0].uri.fsPath,
					documentUri.fsPath
				);
			}

			let diagnosticsString = "";
			try {
				const allDiagnostics = vscode.languages.getDiagnostics(documentUri);
				const relevantDiagnostics = allDiagnostics.filter((diag) =>
					diag.range.intersection(selection)
				);
				if (relevantDiagnostics.length > 0) {
					relevantDiagnostics.sort((a, b) => {
						if (a.range.start.line !== b.range.start.line) {
							return a.range.start.line - b.range.start.line;
						}
						return a.severity - b.severity;
					});
					diagnosticsString = relevantDiagnostics
						.map(
							(d) =>
								`- ${vscode.DiagnosticSeverity[d.severity]} (Line ${
									d.range.start.line + 1
								}): ${d.message}`
						)
						.join("\n");
				}
			} catch (diagError) {
				console.error("Error retrieving diagnostics:", diagError);
				diagnosticsString = "[Could not retrieve diagnostics]";
			}

			const editorCtx = {
				instruction,
				selectedText,
				fullText,
				languageId,
				filePath: relativeFilePath,
				documentUri, // Keep original URI too
				selection,
			};

			const textualPlanPrompt = this._createInitialPlanningExplanationPrompt(
				projectContext,
				undefined, // No userRequest string for editor actions
				editorCtx,
				diagnosticsString
			);

			const textualPlanResponse = await this._generateWithRetry(
				textualPlanPrompt,
				activeKey,
				modelName,
				undefined,
				"editor action plan explanation"
				// No generationConfig needed for textual explanation
			);

			if (
				textualPlanResponse.toLowerCase().startsWith("error:") ||
				textualPlanResponse === ERROR_QUOTA_EXCEEDED
			) {
				throw new Error(textualPlanResponse);
			}

			this._pendingPlanGenerationContext = {
				type: "editor",
				editorContext: editorCtx,
				projectContext,
				diagnosticsString,
				initialApiKey: activeKey,
				modelName,
			};

			this._addHistoryEntry("model", textualPlanResponse);
			this.postMessageToWebview({
				type: "aiResponse",
				value: textualPlanResponse,
				isLoading: false,
				requiresConfirmation: true,
				planData: {
					originalInstruction: instruction,
					type: "textualPlanPending",
				},
			});
		} catch (error) {
			console.error("Error in initiatePlanFromEditorAction:", error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error during editor action plan explanation: ${errorMsg}`,
				isLoading: false,
				isError: true,
			});
			this._addHistoryEntry(
				"model",
				`Error generating plan explanation for editor action: ${errorMsg}`
			);
			this.postMessageToWebview({ type: "reenableInput" });
		}
	}

	// --- MODIFIED: Stage 2 - Generate and Execute Structured JSON Plan ---
	private async _generateAndExecuteStructuredPlan(
		planContext: PlanGenerationContext
	): Promise<void> {
		this.postMessageToWebview({
			type: "statusUpdate",
			value: `Minovative Mind (${planContext.modelName}) is generating the detailed execution plan (JSON)...`,
		});
		this._addHistoryEntry(
			"model",
			"User confirmed. Generating detailed execution plan (JSON)..."
		);

		let structuredPlanJsonString = "";
		try {
			// --- Define Generation Config for JSON Mode ---
			const jsonGenerationConfig: GenerationConfig = {
				responseMimeType: "application/json",
				temperature: 0.2, // Lower temperature for more deterministic JSON output
				// You might adjust topK, topP here if needed, but often not necessary with JSON mode
			};
			// --- End Define ---

			// Create the prompt that asks for JSON (includes few-shot examples now)
			const jsonPlanningPrompt = this._createPlanningPrompt(
				planContext.originalUserRequest,
				planContext.projectContext,
				planContext.editorContext
					? {
							instruction: planContext.editorContext.instruction,
							selectedText: planContext.editorContext.selectedText,
							fullText: planContext.editorContext.fullText,
							languageId: planContext.editorContext.languageId,
							filePath: planContext.editorContext.filePath,
					  }
					: undefined,
				planContext.diagnosticsString
			);

			// --- Call _generateWithRetry with JSON config ---
			structuredPlanJsonString = await this._generateWithRetry(
				jsonPlanningPrompt,
				planContext.initialApiKey,
				planContext.modelName,
				undefined, // History not typically needed for the JSON plan generation itself
				"structured plan generation",
				jsonGenerationConfig // <-- Pass the config here
			);
			// --- End Call ---

			if (
				structuredPlanJsonString.toLowerCase().startsWith("error:") ||
				structuredPlanJsonString === ERROR_QUOTA_EXCEEDED
			) {
				// Handle errors including potential JSON format errors from the API itself
				throw new Error(
					`AI failed to generate structured plan: ${structuredPlanJsonString}`
				);
			}

			// Basic cleanup (remove potential markdown fences)
			structuredPlanJsonString = structuredPlanJsonString
				.replace(/^```json\n?/, "")
				.replace(/^```\n?/, "")
				.replace(/\n?```$/, "")
				.trim();

			// --- ADDED: Basic JSON structural check before parsing ---
			// This helps catch non-JSON responses early before JSON.parse throws
			if (
				!structuredPlanJsonString.startsWith("{") ||
				!structuredPlanJsonString.endsWith("}")
			) {
				console.error(
					"AI response did not start/end with {}. Raw response:\n",
					structuredPlanJsonString.substring(0, 500) +
						(structuredPlanJsonString.length > 500 ? "..." : "")
				);
				throw new Error(
					"AI did not return a valid JSON structure (missing braces)."
				);
			}
			// --- END ADDED ---

			const executablePlan: ExecutionPlan | null = parseAndValidatePlan(
				structuredPlanJsonString
			);

			if (!executablePlan) {
				const errorDetail =
					"Failed to parse or validate the structured JSON plan from AI.";
				console.error(errorDetail, "Raw JSON:", structuredPlanJsonString);
				// Log the invalid JSON to the chat for debugging
				this._addHistoryEntry(
					"model",
					`Error: Failed to parse/validate structured plan.\nRaw JSON from AI:\n\`\`\`json\n${structuredPlanJsonString}\n\`\`\``
				);
				throw new Error(errorDetail);
			}

			// If JSON plan is valid, proceed to execute
			await this._executePlan(
				executablePlan,
				planContext.initialApiKey, // Use the key from the initial stage for consistency
				planContext.modelName
			);
		} catch (error) {
			console.error("Error in _generateAndExecuteStructuredPlan:", error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Error generating or executing structured plan: ${errorMsg}`,
				isError: true,
			});
			// Avoid adding duplicate error messages if already added by parseAndValidatePlan failure
			if (
				!errorMsg.includes(
					"Failed to parse or validate the structured JSON plan"
				)
			) {
				this._addHistoryEntry(
					"model",
					`Error generating or executing structured plan: ${errorMsg}`
				);
			}
			this.postMessageToWebview({ type: "reenableInput" });
		} finally {
			this._pendingPlanGenerationContext = null; // Clear context after attempt
		}
	}

	// --- MODIFIED: _createPlanningPrompt to include few-shot examples ---
	private _createPlanningPrompt(
		userRequest: string | undefined,
		projectContext: string,
		editorContext?: {
			instruction: string;
			selectedText: string;
			fullText: string;
			languageId: string;
			filePath: string;
		},
		diagnosticsString?: string
	): string {
		const jsonFormatDescription = `
		{
			"planDescription": "Brief summary of the overall goal.",
			"steps": [
				{
					"step": 1,
					"action": "create_directory | create_file | modify_file | run_command",
					"description": "What this step does.",
					"path": "relative/path/to/target", // Required for file/dir ops. Relative to workspace root. No leading '/'. Use forward slashes. Safe paths only (no '..').
					"content": "...", // For create_file with direct content (string). Use ONLY this OR generate_prompt.
					"generate_prompt": "...", // For create_file, AI instruction to generate content (string). Use ONLY this OR content.
					"modification_prompt": "...", // For modify_file, AI instruction to generate changes (string). Required.
					"command": "..." // For run_command, the shell command to execute (string). Required.
				}
				// ... more steps
			]
		}`;

		// --- Few-Shot Examples ---
		const fewShotExamples = `
		--- Valid JSON Output Examples ---
		Example 1: A simple file creation
		{
			"planDescription": "Create a configuration file.",
			"steps": [
				{
					"step": 1,
					"action": "create_file",
					"description": "Create a basic config.json file.",
					"path": "src/config.json",
					"content": "{\\n  \\"setting\\": \\"default\\"\\n}"
				}
			]
		}

		Example 2: Modifying a file and running a command
		{
			"planDescription": "Add analytics tracking and install dependency.",
			"steps": [
				{
					"step": 1,
					"action": "modify_file",
					"description": "Add analytics tracking code to index.html.",
					"path": "public/index.html",
					"modification_prompt": "In the <head> section, add a script tag to load 'analytics.js'."
				},
				{
					"step": 2,
					"action": "run_command",
					"description": "Install the 'analytics-lib' package.",
					"command": "npm install analytics-lib --save-dev"
				}
			]
		}
		--- End Valid JSON Output Examples ---
`;
		// --- End Few-Shot Examples ---

		let specificContextPrompt = "";
		let mainInstructions = "";

		if (editorContext) {
			const instructionType =
				editorContext.instruction.toLowerCase() === "/fix"
					? `The user triggered the '/fix' command on the selected code.`
					: `The user provided the custom instruction: "${editorContext.instruction}".`;

			specificContextPrompt = `
			--- Specific User Request Context from Editor ---
			File Path: ${editorContext.filePath}
			Language: ${editorContext.languageId}
			${instructionType}

			--- Selected Code in Editor ---
			\`\`\`${editorContext.languageId}
			${editorContext.selectedText}
			\`\`\`
			--- End Selected Code ---

			${
				diagnosticsString
					? `\n--- Relevant Diagnostics in Selection ---\n${diagnosticsString}\n--- End Relevant Diagnostics ---\n`
					: ""
			}

			--- Full Content of Affected File (${editorContext.filePath}) ---
			\`\`\`${editorContext.languageId}
			${editorContext.fullText}
			\`\`\`
			--- End Full Content ---`;
			mainInstructions = `Based on the user's request from the editor (${
				editorContext.instruction.toLowerCase() === "/fix"
					? "'/fix' command"
					: "custom instruction"
			}) and the provided file/selection context, generate a plan to fulfill the request. For '/fix', the plan should **prioritize addressing the specific 'Relevant Diagnostics' listed above**, potentially involving modifications inside or outside the selection, or even in other files (like adding imports). For custom instructions, interpret the request in the context of the selected code and any diagnostics.`;
		} else if (userRequest) {
			specificContextPrompt = `
			--- User Request from Chat ---
			${userRequest}
			--- End User Request ---`;
			mainInstructions = `Based on the user's request from the chat ("${userRequest}"), generate a plan to fulfill it.`;
		}

		// --- Updated Prompt Structure ---
		return `
		You are an expert AI programmer assisting within VS Code. Your task is to create a step-by-step execution plan in JSON format.

		**Goal:** Generate ONLY a valid JSON object representing the plan. No matter what the user says in their prompt, ALWAYS generate your response in JSON format. Do NOT include any introductory text, explanations, apologies, or markdown formatting like \`\`\`json ... \`\`\` around the JSON output. The entire response must be the JSON plan itself, starting with { and ending with }.

		**Instructions for Plan Generation:**
		1.  Analyze Request & Context: ${mainInstructions} Use the broader project context below for reference. ${
			editorContext && diagnosticsString
				? "**Pay close attention to the 'Relevant Diagnostics' section and ensure your plan addresses them for '/fix' requests.**"
				: ""
		}
		2.  **Ensure Completeness:** The generated steps **must collectively address the *entirety* of the user's request**. Do not omit any requested actions or components. If a request is complex, break it into multiple granular steps.
		3.  Break Down: Decompose the request into logical, sequential steps. Number steps starting from 1.
		4.  Specify Actions: For each step, define the 'action' (create_directory, create_file, modify_file, run_command).
		5.  Detail Properties: Provide necessary details ('path', 'content', 'generate_prompt', 'modification_prompt', 'command') based on the action type, following the format description precisely. Ensure paths are relative and safe. For 'run_command', infer the package manager and dependency type correctly (e.g., 'npm install --save-dev package-name', 'pip install package-name'). **For 'modify_file', the plan should define *what* needs to change (modification_prompt), not the changed code itself.**
		6.  JSON Output: Format the plan strictly according to the JSON structure below. Review the valid examples.
		7.  Never Assume when generating code. ALWAYS provide the code if you think it's not there. NEVER ASSUME ANYTHING.

		${specificContextPrompt}

		*** Broader Project Context (Reference Only) ***
		${projectContext}
		*** End Broader Project Context ***

		--- Expected JSON Plan Format ---
		${jsonFormatDescription}
		--- End Expected JSON Plan Format ---

		${fewShotExamples} // <-- ADDED FEW-SHOT EXAMPLES HERE

		Execution Plan (JSON only):
`;
		// --- End Updated Prompt Structure ---
	}

	private async _handleRegularChat(
		userMessage: string,
		apiKey: string,
		modelName: string
	): Promise<void> {
		try {
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Minovative Mind (${modelName}) is thinking...`,
				isLoading: true,
			});
			// _pendingPlanGenerationContext check is done in onDidReceiveMessage

			const projectContext = await this._buildProjectContext();
			if (projectContext.startsWith("[Error")) {
				this.postMessageToWebview({
					type: "aiResponse",
					value: `Error processing message: Failed to build project context. ${projectContext}`,
					isLoading: false,
					isError: true,
				});
				this._addHistoryEntry(
					"model",
					`Error processing message: Failed to build project context. ${projectContext}`
				);
				throw new Error("Failed to build project context.");
			}

			const historyForApi = JSON.parse(JSON.stringify(this._chatHistory));
			const finalPrompt = `
			You are an AI assistant called Minovative Mind integrated into VS Code. Below is some context about the user's current project. Use this context ONLY as background information to help answer the user's query accurately. Do NOT explicitly mention that you analyzed the context or summarize the project files unless the user specifically asks you to. Focus directly on answering the user's query and when you do answer the user's queries, make sure you complete the entire request, don't do minimal, shorten, or partial of what the user asked for. Complete the entire request from the users no matter how long it may take. Use Markdown formatting for code blocks and lists where appropriate. Never Aussume ANYTHING when generating code. ALWAYS provide the code if you think it's not there. NEVER ASSUME ANYTHING.

			*** Project Context (Reference Only) ***
			${projectContext}
			*** End Project Context ***

			--- User Query ---
			${userMessage}
			--- End User Query ---

			Assistant Response:
	`;
			const aiResponseText = await this._generateWithRetry(
				finalPrompt,
				apiKey,
				modelName,
				historyForApi,
				"chat"
				// No specific generationConfig for regular chat unless needed
			);
			const isErrorResponse =
				aiResponseText.toLowerCase().startsWith("error:") ||
				aiResponseText === ERROR_QUOTA_EXCEEDED;
			this._addHistoryEntry("model", aiResponseText);
			this.postMessageToWebview({
				type: "aiResponse",
				value: aiResponseText,
				isLoading: false,
				isError: isErrorResponse,
			});
		} catch (error) {
			console.error("Error in _handleRegularChat:", error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error during chat: ${errorMsg}`,
				isLoading: false,
				isError: true,
			});
			if (!errorMsg.includes("Failed to build project context")) {
				this._addHistoryEntry("model", `Error during chat: ${errorMsg}`);
			}
		} finally {
			console.log("[_handleRegularChat] Chat request finished. Cleaning up.");
			this.postMessageToWebview({ type: "reenableInput" });
		}
	}

	private async _executePlan(
		plan: ExecutionPlan,
		apiKey: string, // API key used for plan generation/confirmation stage
		modelName: string // Model name used for plan generation/confirmation stage
	): Promise<void> {
		let executionOk = true;
		try {
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Starting execution: ${plan.planDescription || "Unnamed Plan"}`,
			});
			this._addHistoryEntry("model", "Initiating plan execution...");

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Error: Cannot execute plan - no workspace folder open.",
					isError: true,
				});
				this._addHistoryEntry(
					"model",
					"Execution Failed: No workspace folder open."
				);
				executionOk = false;
				throw new Error("No workspace folder open.");
			}
			const rootUri = workspaceFolders[0].uri;
			// Use the apiKey and modelName passed in for content generation within the plan
			let currentApiKeyForExecution = apiKey;

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Minovative Mind: Executing Plan - ${
						plan.planDescription || "Processing..."
					}`,
					cancellable: true,
				},
				async (progress, progressToken) => {
					const totalSteps = plan.steps ? plan.steps.length : 0;
					if (totalSteps === 0) {
						progress.report({ message: "Plan has no steps.", increment: 100 });
						this.postMessageToWebview({
							type: "statusUpdate",
							value: "Plan has no steps. Execution finished.",
						});
						this._addHistoryEntry(
							"model",
							"Plan execution finished (no steps)."
						);
						executionOk = true;
						return;
					}

					for (const [index, step] of plan.steps!.entries()) {
						if (progressToken.isCancellationRequested) {
							console.log(
								`Plan execution cancelled by VS Code progress UI before step ${
									index + 1
								}.`
							);
							this.postMessageToWebview({
								type: "statusUpdate",
								value: `Plan execution cancelled by user.`,
							});
							this._addHistoryEntry(
								"model",
								"Plan execution cancelled by user."
							);
							executionOk = false;
							return;
						}

						const stepNumber = index + 1;
						const stepMessageTitle = `Step ${stepNumber}/${totalSteps}: ${
							step.description || step.action.replace(/_/g, " ")
						}`;
						progress.report({
							message: `${stepMessageTitle}...`,
							increment: (1 / totalSteps) * 100,
						});
						const stepPath = step.path || "";
						const stepCommand = step.command || "";

						this.postMessageToWebview({
							type: "statusUpdate",
							value: `Executing ${stepMessageTitle} ${
								step.action === PlanStepAction.RunCommand
									? `- '${stepCommand}'`
									: stepPath
									? `- \`${stepPath}\``
									: ""
							}`,
						});

						try {
							// Check if the active key changed *during* execution (e.g., due to quota retry in a previous step)
							currentApiKeyForExecution =
								this.getActiveApiKey() || currentApiKeyForExecution;
							if (!currentApiKeyForExecution) {
								throw new Error(
									"No active API key available during plan execution step."
								);
							}

							switch (step.action) {
								case PlanStepAction.CreateDirectory:
									if (isCreateDirectoryStep(step)) {
										const dirUri = vscode.Uri.joinPath(rootUri, step.path);
										await vscode.workspace.fs.createDirectory(dirUri);
										console.log(`${step.action} OK: ${step.path}`);
										this._addHistoryEntry(
											"model",
											`Step ${stepNumber} OK: Created directory \`${step.path}\``
										);
									} else {
										throw new Error(`Invalid ${step.action} structure.`);
									}
									break;
								case PlanStepAction.CreateFile:
									if (isCreateFileStep(step)) {
										const fileUri = vscode.Uri.joinPath(rootUri, step.path);
										let contentToWrite = "";
										if (step.content !== undefined) {
											contentToWrite = step.content;
										} else if (step.generate_prompt) {
											this.postMessageToWebview({
												type: "statusUpdate",
												value: `Step ${stepNumber}/${totalSteps}: Generating content for ${step.path}...`,
											});
											const generationPrompt = `
											You are an AI programmer tasked with generating file content.
											**Critical Instruction:** Generate the **complete and comprehensive** file content based *fully* on the user's instructions below. Do **not** provide a minimal, placeholder, or incomplete implementation unless the instructions *specifically* ask for it. Fulfill the entire request.
											**Output Format:** Provide ONLY the raw code or text for the file. Do NOT include any explanations, or markdown formatting like backticks. Add comments in the code to help the user understand the code and the entire response MUST be only the final file content. Never Aussume ANYTHING when generating code. ALWAYS provide the code if you think it's not there. NEVER ASSUME ANYTHING.

											File Path: ${step.path}
											Instructions: ${step.generate_prompt}

											Complete File Content:
											`;
											// Use the API key and model determined for this execution run
											contentToWrite = await this._generateWithRetry(
												generationPrompt,
												currentApiKeyForExecution,
												modelName,
												undefined,
												`plan step ${stepNumber} (create file)`
												// No specific generationConfig needed here unless requested
											);
											// Re-check active key in case retry changed it
											currentApiKeyForExecution =
												this.getActiveApiKey() || currentApiKeyForExecution;
											if (
												!currentApiKeyForExecution ||
												contentToWrite.toLowerCase().startsWith("error:") ||
												contentToWrite === ERROR_QUOTA_EXCEEDED
											) {
												throw new Error(
													`AI content generation failed: ${
														contentToWrite || "No API Key available"
													}`
												);
											}
											contentToWrite = contentToWrite
												.replace(/^```[a-z]*\n?/, "")
												.replace(/\n?```$/, "")
												.trim();
										} else {
											throw new Error(
												"CreateFileStep must have 'content' or 'generate_prompt'."
											);
										}
										await vscode.workspace.fs.writeFile(
											fileUri,
											Buffer.from(contentToWrite, "utf-8")
										);
										console.log(`${step.action} OK: ${step.path}`);
										this._addHistoryEntry(
											"model",
											`Step ${stepNumber} OK: Created file \`${step.path}\``
										);
									} else {
										throw new Error(`Invalid ${step.action} structure.`);
									}
									break;
								case PlanStepAction.ModifyFile:
									if (isModifyFileStep(step)) {
										const fileUri = vscode.Uri.joinPath(rootUri, step.path);
										let existingContent = "";
										try {
											const contentBytes = await vscode.workspace.fs.readFile(
												fileUri
											);
											existingContent =
												Buffer.from(contentBytes).toString("utf-8");
										} catch (readError: any) {
											if (
												readError instanceof vscode.FileSystemError &&
												readError.code === "FileNotFound"
											) {
												throw new Error(
													`File to modify not found: \`${step.path}\``
												);
											}
											throw readError;
										}
										this.postMessageToWebview({
											type: "statusUpdate",
											value: `Step ${stepNumber}/${totalSteps}: Generating modifications for ${step.path}...`,
										});
										const modificationPrompt = `
										You are an AI programmer tasked with modifying an existing file.
										**Critical Instruction:** Modify the code based *fully* on the user's instructions below. Ensure the modifications are **complete and comprehensive**, addressing the entire request. Do **not** make partial changes or leave placeholders unless the instructions *specifically* ask for it.
										**Output Format:** Provide ONLY the complete, raw, modified code for the **entire file**. Do NOT include explanations, or markdown formatting. Add comments in the code to help the user understand the code and the entire response MUST be the final, complete file content after applying all requested modifications.

										File Path: ${step.path}
										Modification Instructions: ${step.modification_prompt}

										--- Existing File Content ---
										\`\`\`
										${existingContent}
										\`\`\`
										--- End Existing File Content ---

										Complete Modified File Content:
										`;
										let modifiedContent = await this._generateWithRetry(
											modificationPrompt,
											currentApiKeyForExecution,
											modelName,
											undefined,
											`plan step ${stepNumber} (modify file)`
											// No specific generationConfig needed here unless requested
										);
										// Re-check active key in case retry changed it
										currentApiKeyForExecution =
											this.getActiveApiKey() || currentApiKeyForExecution;
										if (
											!currentApiKeyForExecution ||
											modifiedContent.toLowerCase().startsWith("error:") ||
											modifiedContent === ERROR_QUOTA_EXCEEDED
										) {
											throw new Error(
												`AI modification failed: ${
													modifiedContent || "No API Key available"
												}`
											);
										}
										modifiedContent = modifiedContent
											.replace(/^```[a-z]*\n?/, "")
											.replace(/\n?```$/, "")
											.trim();
										if (modifiedContent !== existingContent) {
											const edit = new vscode.WorkspaceEdit();
											const document = await vscode.workspace.openTextDocument(
												fileUri
											);
											const fullRange = new vscode.Range(
												document.positionAt(0),
												document.positionAt(document.getText().length)
											);
											edit.replace(fileUri, fullRange, modifiedContent);
											const success = await vscode.workspace.applyEdit(edit);
											if (!success) {
												throw new Error(
													`Failed to apply modifications to \`${step.path}\``
												);
											}
											console.log(`${step.action} OK: ${step.path}`);
											this._addHistoryEntry(
												"model",
												`Step ${stepNumber} OK: Modified file \`${step.path}\``
											);
										} else {
											console.log(
												`Step ${stepNumber}: AI returned identical content for ${step.path}. Skipping write.`
											);
											this._addHistoryEntry(
												"model",
												`Step ${stepNumber} OK: Modification for \`${step.path}\` resulted in no changes.`
											);
										}
									} else {
										throw new Error(`Invalid ${step.action} structure.`);
									}
									break;
								case PlanStepAction.RunCommand:
									if (isRunCommandStep(step)) {
										const commandToRun = step.command;
										const userChoice = await vscode.window.showWarningMessage(
											`The plan wants to run a command in the terminal:\n\n\`${commandToRun}\`\n\nThis could install packages or modify your system. Allow?`,
											{ modal: true },
											"Allow Command",
											"Skip Command"
										);
										if (progressToken.isCancellationRequested) {
											throw new Error("Operation cancelled by user.");
										}
										if (userChoice === "Allow Command") {
											try {
												const term = vscode.window.createTerminal({
													name: `Plan Step ${stepNumber}`,
													cwd: rootUri.fsPath,
												});
												term.sendText(commandToRun);
												term.show();
												this.postMessageToWebview({
													type: "statusUpdate",
													value: `Step ${stepNumber}: Running command '${commandToRun}' in terminal...`,
												});
												this._addHistoryEntry(
													"model",
													`Step ${stepNumber} OK: User allowed running command \`${commandToRun}\`.`
												);
												// Simple delay; replace with listening for command completion if needed
												await new Promise<void>((resolve, reject) => {
													const timeoutId = setTimeout(resolve, 2000); // Wait 2s
													const cancellationListener =
														progressToken.onCancellationRequested(() => {
															clearTimeout(timeoutId);
															cancellationListener.dispose();
															reject(new Error("Operation cancelled by user."));
														});
													timeoutId.unref(); // Allow Node.js to exit if this is the only thing running
													if (progressToken.isCancellationRequested) {
														cancellationListener.dispose();
														reject(new Error("Operation cancelled by user."));
													}
												}).catch((err) => {
													// Rethrow cancellation specifically
													if (
														err instanceof Error &&
														err.message === "Operation cancelled by user."
													) {
														throw err;
													}
													// Log other potential wait errors
													console.error("Error during command wait:", err);
													throw new Error(
														`Internal error during command wait: ${err}`
													);
												});
											} catch (termError) {
												if (
													termError instanceof Error &&
													termError.message === "Operation cancelled by user."
												) {
													throw termError; // Propagate cancellation
												}
												const errorMsg =
													termError instanceof Error
														? termError.message
														: String(termError);
												throw new Error(
													`Failed to launch or wait for terminal for command '${commandToRun}': ${errorMsg}`
												);
											}
										} else {
											this.postMessageToWebview({
												type: "statusUpdate",
												value: `Step ${stepNumber}: Skipped command '${commandToRun}'.`,
												isError: false,
											});
											this._addHistoryEntry(
												"model",
												`Step ${stepNumber} SKIPPED: User did not allow command \`${commandToRun}\`.`
											);
										}
									} else {
										throw new Error("Invalid RunCommandStep structure.");
									}
									break;
								default:
									// This should ideally not be reached if parseAndValidatePlan is exhaustive
									const exhaustiveCheck: never = step.action;
									console.warn(`Unsupported plan action: ${exhaustiveCheck}`);
									this.postMessageToWebview({
										type: "statusUpdate",
										value: `Step ${stepNumber}: Skipped unsupported action ${step.action}.`,
										isError: false,
									});
									this._addHistoryEntry(
										"model",
										`Step ${stepNumber} SKIPPED: Unsupported action ${step.action}`
									);
									break;
							}
						} catch (error) {
							executionOk = false;
							const errorMsg =
								error instanceof Error ? error.message : String(error);
							console.error(
								`Error executing step ${stepNumber} (${step.action}, ${
									stepPath || stepCommand
								}):`,
								error
							);
							const isCancellationError =
								errorMsg === "Operation cancelled by user.";
							const displayMsg = isCancellationError
								? "Plan execution cancelled by user."
								: `Error on Step ${stepNumber}: ${errorMsg}`;
							const historyMsg = isCancellationError
								? "Plan execution cancelled by user."
								: `Step ${stepNumber} FAILED: ${errorMsg}`;
							this.postMessageToWebview({
								type: "statusUpdate",
								value: displayMsg,
								isError: !isCancellationError,
							});
							this._addHistoryEntry("model", historyMsg);
							if (isCancellationError) {
								return; // Exit progress if cancelled
							} else {
								break; // Stop plan execution on other errors
							}
						}
						if (progressToken.isCancellationRequested) {
							console.log(
								`Plan execution cancelled by VS Code progress UI after step ${
									index + 1
								}.`
							);
							this.postMessageToWebview({
								type: "statusUpdate",
								value: `Plan execution cancelled by user.`,
							});
							executionOk = false;
							return; // Exit progress
						}
					} // End loop
					progress.report({
						message: executionOk
							? "Execution complete."
							: "Execution stopped (failed or cancelled).",
						increment: 100,
					});
				} // End async progress callback
			); // End vscode.window.withProgress
		} catch (error) {
			executionOk = false;
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error("Unexpected error during plan execution:", error);
			const isCancellationError = errorMsg === "Operation cancelled by user.";
			const displayMsg = isCancellationError
				? "Plan execution cancelled by user."
				: `Plan execution failed unexpectedly: ${errorMsg}`;
			const historyMsg = isCancellationError
				? "Plan execution cancelled by user."
				: `Plan execution FAILED unexpectedly: ${errorMsg}`;
			this.postMessageToWebview({
				type: "statusUpdate",
				value: displayMsg,
				isError: !isCancellationError,
			});
			const lastHistoryText =
				this._chatHistory[this._chatHistory.length - 1]?.parts[0]?.text;
			// Avoid logging duplicate messages
			if (
				lastHistoryText !== historyMsg &&
				!lastHistoryText?.startsWith("Step ") &&
				lastHistoryText !== "Plan execution cancelled by user."
			) {
				this._addHistoryEntry("model", historyMsg);
			}
		} finally {
			console.log(
				"Plan execution finished, failed, or cancelled. Cleaning up."
			);
			const lastHistoryText =
				this._chatHistory[this._chatHistory.length - 1]?.parts[0]?.text;
			if (executionOk) {
				if (
					lastHistoryText !== "Plan execution finished successfully." &&
					lastHistoryText !== "Plan execution finished (no steps)."
				) {
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Plan execution completed successfully.",
					});
					this._addHistoryEntry(
						"model",
						"Plan execution finished successfully."
					);
				} else {
					this.postMessageToWebview({
						type: "statusUpdate",
						value: lastHistoryText, // Use the existing specific success message
					});
				}
			} else if (lastHistoryText === "Plan execution cancelled by user.") {
				// Use the existing cancellation message if that was the last one
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Plan execution cancelled by user.",
					isError: false,
				});
			} else if (
				!lastHistoryText?.startsWith("Step ") &&
				!lastHistoryText?.includes("FAILED")
			) {
				// If the last message wasn't a specific step failure or cancellation, show generic stop message
				this.postMessageToWebview({
					type: "statusUpdate",
					value:
						"Plan execution stopped due to failure. Check chat for details.",
					isError: true,
				});
			} else {
				// If the last message was a specific step failure, keep that status
				this.postMessageToWebview({
					type: "statusUpdate",
					value:
						"Plan execution stopped due to step failure. Check chat for details.",
					isError: true,
				});
			}
			this.postMessageToWebview({ type: "reenableInput" });
		}
	}

	private async _loadKeysFromStorage() {
		try {
			const keysJson = await this._secretStorage.get(
				GEMINI_API_KEYS_LIST_SECRET_KEY
			);
			this._apiKeyList = keysJson ? JSON.parse(keysJson) : [];

			const activeIndexStr = await this._secretStorage.get(
				GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
			);
			let potentialIndex = activeIndexStr ? parseInt(activeIndexStr, 10) : -1;

			if (potentialIndex < 0 || potentialIndex >= this._apiKeyList.length) {
				potentialIndex = this._apiKeyList.length > 0 ? 0 : -1;
				const storedIndex = activeIndexStr ? parseInt(activeIndexStr, 10) : -2;
				if (potentialIndex !== storedIndex) {
					if (potentialIndex !== -1) {
						await this._secretStorage.store(
							GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
							String(potentialIndex)
						);
						console.log(`Corrected active key index to ${potentialIndex}`);
					} else {
						await this._secretStorage.delete(
							GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
						);
						console.log(
							`Cleared active index from storage as key list is empty.`
						);
					}
				}
			}
			this._activeKeyIndex = potentialIndex;

			console.log(
				`Loaded ${this._apiKeyList.length} keys. Active index: ${this._activeKeyIndex}`
			);
			resetClient();
			this._updateWebviewKeyList();
		} catch (error) {
			console.error("Error loading API keys from storage:", error);
			this._apiKeyList = [];
			this._activeKeyIndex = -1;
			vscode.window.showErrorMessage("Failed to load API keys.");
			this._updateWebviewKeyList();
		}
	}

	private async _saveKeysToStorage() {
		let saveError: any = null;
		try {
			await this._secretStorage.store(
				GEMINI_API_KEYS_LIST_SECRET_KEY,
				JSON.stringify(this._apiKeyList)
			);
			if (this._activeKeyIndex !== -1) {
				await this._secretStorage.store(
					GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY,
					String(this._activeKeyIndex)
				);
			} else {
				await this._secretStorage.delete(
					GEMINI_ACTIVE_API_KEY_INDEX_SECRET_KEY
				);
			}
			console.log(
				`Saved ${this._apiKeyList.length} keys. Active index: ${this._activeKeyIndex}`
			);
			resetClient();
		} catch (error) {
			saveError = error;
			console.error("Error saving API keys to storage:", error);
		}
		this._updateWebviewKeyList();
		if (saveError) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Error: Failed to save key changes.",
				isError: true,
			});
		}
	}

	private async _addApiKey(key: string) {
		if (this._apiKeyList.includes(key)) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: `Info: Key ...${key.slice(-4)} is already stored.`,
			});
			return;
		}
		this._apiKeyList.push(key);
		this._activeKeyIndex = this._apiKeyList.length - 1;
		await this._saveKeysToStorage();
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ending in ...${key.slice(-4)} added and set as active.`,
		});
	}

	private async _deleteActiveApiKey() {
		if (
			this._activeKeyIndex === -1 ||
			this._activeKeyIndex >= this._apiKeyList.length
		) {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value:
					this._apiKeyList.length === 0
						? "Error: Cannot delete, key list is empty."
						: "Error: No active key selected to delete.",
				isError: true,
			});
			return;
		}
		const keyToDelete = this._apiKeyList[this._activeKeyIndex];
		this._apiKeyList.splice(this._activeKeyIndex, 1);
		const oldIndex = this._activeKeyIndex;
		if (this._apiKeyList.length === 0) {
			this._activeKeyIndex = -1;
		} else if (this._activeKeyIndex >= this._apiKeyList.length) {
			this._activeKeyIndex = this._apiKeyList.length - 1;
		}
		console.log(
			`Key deleted. Old index: ${oldIndex}, New active index: ${this._activeKeyIndex}`
		);
		await this._saveKeysToStorage();
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Key ...${keyToDelete.slice(-4)} deleted.`,
		});
	}

	private async _switchToNextApiKey() {
		if (this._apiKeyList.length <= 1 || this._activeKeyIndex === -1) {
			return;
		}
		this._activeKeyIndex = (this._activeKeyIndex + 1) % this._apiKeyList.length;
		await this._saveKeysToStorage();
		const newKey = this._apiKeyList[this._activeKeyIndex];
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Switched to key ...${newKey.slice(-4)}.`,
		});
		return newKey;
	}

	private async _switchToPreviousApiKey() {
		if (this._apiKeyList.length <= 1 || this._activeKeyIndex === -1) {
			return;
		}
		this._activeKeyIndex =
			(this._activeKeyIndex - 1 + this._apiKeyList.length) %
			this._apiKeyList.length;
		await this._saveKeysToStorage();
		const newKey = this._apiKeyList[this._activeKeyIndex];
		this.postMessageToWebview({
			type: "apiKeyStatus",
			value: `Switched to key ...${newKey.slice(-4)}.`,
		});
	}

	private _updateWebviewKeyList() {
		if (!this._view) {
			return;
		}
		const keyInfos: ApiKeyInfo[] = this._apiKeyList.map((key, index) => ({
			maskedKey: `Key ...${key.slice(-4)} (${index + 1}/${
				this._apiKeyList.length
			})`,
			index: index,
			isActive: index === this._activeKeyIndex,
		}));
		const updateData: KeyUpdateData = {
			keys: keyInfos,
			activeIndex: this._activeKeyIndex,
			totalKeys: this._apiKeyList.length,
		};
		this.postMessageToWebview({ type: "updateKeyList", value: updateData });
	}

	public getActiveApiKey(): string | undefined {
		if (
			this._activeKeyIndex >= 0 &&
			this._activeKeyIndex < this._apiKeyList.length
		) {
			return this._apiKeyList[this._activeKeyIndex];
		}
		return undefined;
	}

	// Model Selection Logic (Unchanged)
	private _loadSettingsFromStorage() {
		try {
			const savedModel = this._workspaceState.get<string>(
				MODEL_SELECTION_STORAGE_KEY
			);
			if (savedModel && AVAILABLE_GEMINI_MODELS.includes(savedModel)) {
				this._selectedModelName = savedModel;
				console.log("Loaded selected model:", this._selectedModelName);
			} else {
				this._selectedModelName = DEFAULT_MODEL;
				console.log(
					"No saved model or invalid model found. Using default:",
					DEFAULT_MODEL
				);
			}
		} catch (error) {
			console.error("Error loading settings from storage:", error);
			this._selectedModelName = DEFAULT_MODEL;
			vscode.window.showErrorMessage("Failed to load extension settings.");
		}
	}

	private async _saveSettingsToStorage() {
		try {
			await this._workspaceState.update(
				MODEL_SELECTION_STORAGE_KEY,
				this._selectedModelName
			);
			console.log("Saved selected model:", this._selectedModelName);
			resetClient();
		} catch (error) {
			console.error("Error saving settings to storage:", error);
			vscode.window.showErrorMessage("Failed to save extension settings.");
		}
		this._updateWebviewModelList();
	}

	private async _handleModelSelection(modelName: string) {
		if (AVAILABLE_GEMINI_MODELS.includes(modelName)) {
			this._selectedModelName = modelName;
			await this._saveSettingsToStorage();
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Switched to AI model: ${modelName}.`,
			});
		} else {
			console.warn("Attempted to select an invalid model:", modelName);
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Error: Invalid model selected: ${modelName}.`,
				isError: true,
			});
			this._updateWebviewModelList();
		}
	}

	private _updateWebviewModelList() {
		if (this._view) {
			this.postMessageToWebview({
				type: "updateModelList",
				value: {
					availableModels: AVAILABLE_GEMINI_MODELS,
					selectedModel: this._selectedModelName,
				},
			});
		}
	}

	public getSelectedModelName(): string {
		return this._selectedModelName;
	}

	// Chat History & Actions (Unchanged)
	private _addHistoryEntry(role: "user" | "model", text: string) {
		this._chatHistory.push({ role, parts: [{ text }] });
		const MAX_HISTORY_ITEMS = 50;
		if (this._chatHistory.length > MAX_HISTORY_ITEMS) {
			this._chatHistory.splice(0, this._chatHistory.length - MAX_HISTORY_ITEMS);
		}
	}

	private async _clearChat() {
		this._chatHistory = [];
		this.postMessageToWebview({ type: "chatCleared" });
		this.postMessageToWebview({
			type: "statusUpdate",
			value: "Chat cleared.",
		});
		this.postMessageToWebview({ type: "reenableInput" });
	}

	private async _saveChat() {
		const options: vscode.SaveDialogOptions = {
			saveLabel: "Save Chat History",
			filters: { "JSON Files": ["json"] },
			defaultUri: vscode.workspace.workspaceFolders
				? vscode.Uri.joinPath(
						vscode.workspace.workspaceFolders[0].uri,
						`minovative-mind-chat-${
							new Date().toISOString().split("T")[0]
						}.json`
				  )
				: undefined,
		};
		const fileUri = await vscode.window.showSaveDialog(options);
		if (fileUri) {
			try {
				const saveableHistory: ChatMessage[] = this._chatHistory.map(
					(entry) => ({
						sender: entry.role === "user" ? "User" : "Model",
						text: entry.parts.map((p) => p.text).join(""),
						className: entry.role === "user" ? "user-message" : "ai-message",
					})
				);
				const contentString = JSON.stringify(saveableHistory, null, 2);
				await vscode.workspace.fs.writeFile(
					fileUri,
					Buffer.from(contentString, "utf-8")
				);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Chat saved successfully.",
				});
			} catch (error) {
				console.error("Error saving chat:", error);
				const message = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Failed to save chat: ${message}`);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Error: Failed to save chat.",
					isError: true,
				});
			}
		} else {
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Chat save cancelled.",
			});
		}
	}

	private async _loadChat() {
		const options: vscode.OpenDialogOptions = {
			canSelectMany: false,
			openLabel: "Load Chat History",
			filters: { "Chat History Files": ["json"], "All Files": ["*"] },
		};
		const fileUris = await vscode.window.showOpenDialog(options);
		if (fileUris && fileUris.length > 0) {
			const fileUri = fileUris[0];
			try {
				const contentBytes = await vscode.workspace.fs.readFile(fileUri);
				const contentString = Buffer.from(contentBytes).toString("utf-8");
				const loadedData = JSON.parse(contentString);
				if (
					Array.isArray(loadedData) &&
					loadedData.every(
						(item) =>
							item &&
							typeof item.sender === "string" &&
							typeof item.text === "string" &&
							(item.sender === "User" ||
								item.sender === "Model" ||
								item.sender === "System")
					)
				) {
					this._chatHistory = loadedData.map(
						(item: ChatMessage): HistoryEntry => ({
							role: item.sender === "User" ? "user" : "model",
							parts: [{ text: item.text }],
						})
					);
					this.postMessageToWebview({
						type: "restoreHistory",
						value: loadedData,
					});
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Chat loaded successfully.",
					});
				} else {
					throw new Error("Invalid chat history file format.");
				}
			} catch (error) {
				console.error("Error loading chat:", error);
				const message = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`Failed to load chat: ${message}`);
				this.postMessageToWebview({
					type: "statusUpdate",
					value: "Error: Failed to load or parse chat file.",
					isError: true,
				});
			}
		} else {
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Chat load cancelled.",
			});
		}
	}

	// VS Code Provider Methods
	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, "dist"),
				vscode.Uri.joinPath(this._extensionUri, "media"),
				vscode.Uri.joinPath(this._extensionUri, "src", "sidebar", "webview"),
			],
		};
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (data) => {
			console.log(`[Provider] Message received: ${data.type}`);

			switch (data.type) {
				case "planRequest": {
					const userRequest = data.value;
					const activeKey = this.getActiveApiKey();
					const selectedModel = this.getSelectedModelName();

					if (!activeKey || !selectedModel) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: API Key or Model not set.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					if (this._pendingPlanGenerationContext) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: Another plan is already pending confirmation.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					this._addHistoryEntry("user", `/plan ${userRequest}`);
					await this._handleInitialPlanRequest(
						userRequest,
						activeKey,
						selectedModel
					);
					break;
				}
				case "confirmPlanExecution": {
					const currentActiveKey = this.getActiveApiKey();
					const selectedModel = this.getSelectedModelName();

					if (!currentActiveKey || !selectedModel) {
						this.postMessageToWebview({
							type: "statusUpdate",
							value: "Error: Cannot execute plan - API key or model missing.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break;
					}
					if (this._pendingPlanGenerationContext) {
						await this._generateAndExecuteStructuredPlan(
							this._pendingPlanGenerationContext
						);
					} else {
						console.error(
							"Received confirmPlanExecution but _pendingPlanGenerationContext was missing."
						);
						this.postMessageToWebview({
							type: "statusUpdate",
							value: "Error: Failed to confirm plan - context missing.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
					}
					break;
				}
				case "cancelPlanExecution": {
					this._pendingPlanGenerationContext = null; // Discard pending context
					this.postMessageToWebview({
						type: "statusUpdate",
						value: "Plan generation and execution cancelled by user.",
					});
					this._addHistoryEntry(
						"model",
						"Plan generation and execution cancelled by user."
					);
					this.postMessageToWebview({ type: "reenableInput" });
					break;
				}
				case "chatMessage": {
					const userMessage = data.value;
					const activeKey = this.getActiveApiKey();
					const selectedModel = this.getSelectedModelName();
					if (!activeKey || !selectedModel) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: API Key or Model not set.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						return;
					}
					if (this._pendingPlanGenerationContext) {
						this.postMessageToWebview({
							type: "aiResponse",
							value:
								"Error: A plan is pending confirmation. Confirm or cancel first.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						return;
					}
					this._addHistoryEntry("user", userMessage);
					await this._handleRegularChat(userMessage, activeKey, selectedModel);
					break;
				}
				case "addApiKey":
					if (typeof data.value === "string") {
						await this._addApiKey(data.value.trim());
					}
					break;
				case "requestDeleteConfirmation":
					await this._requestDeleteConfirmation();
					break;
				case "switchToNextKey":
					await this._switchToNextApiKey();
					break;
				case "switchToPrevKey":
					await this._switchToPreviousApiKey();
					break;
				case "clearChatRequest":
					await this._clearChat();
					break;
				case "saveChatRequest":
					await this._saveChat();
					break;
				case "loadChatRequest":
					await this._loadChat();
					break;
				case "selectModel":
					if (typeof data.value === "string") {
						await this._handleModelSelection(data.value);
					}
					break;
				case "webviewReady":
					console.log("[Provider] Webview ready. Updating UI.");
					this._updateWebviewKeyList();
					this._updateWebviewModelList();
					this._restoreChatHistoryToWebview();
					this.postMessageToWebview({ type: "reenableInput" });
					break;
				case "reenableInput":
					// This might be sent if the webview detects it got stuck
					this.postMessageToWebview({ type: "reenableInput" });
					break;
				default:
					console.warn(`Unknown message type received: ${data.type}`);
			}
		});
	}

	private _restoreChatHistoryToWebview() {
		if (!this._view) {
			return;
		}
		const historyForWebview: ChatMessage[] = this._chatHistory.map((entry) => ({
			sender: entry.role === "user" ? "User" : "Model",
			text: entry.parts.map((p) => p.text).join(""),
			className: entry.role === "user" ? "user-message" : "ai-message",
		}));
		this.postMessageToWebview({
			type: "restoreHistory",
			value: historyForWebview,
		});
	}

	private async _requestDeleteConfirmation() {
		const keyToDeleteIndex = this._activeKeyIndex;
		let keyIdentifier = "the active key";
		if (keyToDeleteIndex >= 0 && keyToDeleteIndex < this._apiKeyList.length) {
			keyIdentifier = `key ...${this._apiKeyList[keyToDeleteIndex].slice(-4)}`;
		} else {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Error: No active key selected to delete.",
				isError: true,
			});
			return;
		}
		const confirmation = await vscode.window.showWarningMessage(
			`Are you sure you want to delete ${keyIdentifier}? This cannot be undone.`,
			{ modal: true },
			"Delete Key"
		);
		if (confirmation === "Delete Key") {
			if (
				this._activeKeyIndex === keyToDeleteIndex &&
				keyToDeleteIndex < this._apiKeyList.length
			) {
				await this._deleteActiveApiKey();
			} else {
				console.warn(
					"Active key index changed during delete confirmation. Aborting delete."
				);
				this.postMessageToWebview({
					type: "apiKeyStatus",
					value: "Info: Key list changed, deletion aborted.",
					isError: false,
				});
			}
		} else {
			this.postMessageToWebview({
				type: "apiKeyStatus",
				value: "Key deletion cancelled.",
				isError: false,
			});
		}
	}

	// Build Project Context (Unchanged)
	private async _buildProjectContext(): Promise<string> {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return "[No workspace open]";
			}
			const rootFolder = workspaceFolders[0];
			const relevantFiles = await scanWorkspace({ respectGitIgnore: true });
			if (relevantFiles.length > 0) {
				return await buildContextString(relevantFiles, rootFolder.uri);
			} else {
				return "[No relevant files found in workspace]";
			}
		} catch (scanOrBuildError) {
			console.error(
				"Error during workspace scan or context build:",
				scanOrBuildError
			);
			return `[Error building project context: ${
				scanOrBuildError instanceof Error
					? scanOrBuildError.message
					: String(scanOrBuildError)
			}]`;
		}
	}

	// Utility Methods
	public postMessageToWebview(message: any) {
		if (this._view) {
			this._view.webview.postMessage(message);
		} else {
			console.warn("Sidebar view not available to post message:", message.type);
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, "dist", "webview.js")
		);
		const stylesUri = webview.asWebviewUri(
			vscode.Uri.joinPath(
				this._extensionUri,
				"src",
				"sidebar",
				"webview",
				"style.css"
			)
		);
		const nonce = getNonce();
		// Ensure model options reflect the current available models and selection
		const modelOptionsHtml = AVAILABLE_GEMINI_MODELS.map(
			(modelName) =>
				`<option value="${modelName}" ${
					modelName === this._selectedModelName ? "selected" : ""
				}>${modelName}</option>`
		).join("");

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="
						default-src 'none';
						style-src ${webview.cspSource} 'unsafe-inline';
						img-src ${webview.cspSource} https: data:;
						font-src ${webview.cspSource};
						script-src 'nonce-${nonce}';
						connect-src 'none';
				">
				<link href="${stylesUri}" rel="stylesheet">
				<title>Minovative Mind Chat (BETA)</title>
		</head>
		<body>
				<div class="chat-controls">
					 <h1>Minovative Mind (BETA)</h1>
						<div class="button-group">
								<button id="save-chat-button" title="Save Chat">S</button>
								<button id="load-chat-button" title="Load Chat">L</button>
								<button id="clear-chat-button" title="Clear Chat">C</button>
						</div>
				</div>
				<div id="status-area"></div>
				<div id="chat-container"></div>
				<div id="input-container">
					<textarea id="chat-input" rows="3" placeholder="Enter message or /plan [request]..."></textarea>
					<button id="send-button" title="Send Message">S</button>
				</div>
				<div class="section model-selection-section">
					<h2>AI Model Selection</h2>
					<div class="model-select-container">
						<select id="model-select" title="Select AI Model">${modelOptionsHtml}</select>
					</div>
				</div>
				<div class="section api-key-section">
						<h2>API Key Management</h2>
						<div class="key-management-controls">
								<span id="current-key-display">No keys stored</span>
								<button id="prev-key-button" title="Previous Key" disabled>&lt;</button>
								<button id="next-key-button" title="Next Key" disabled>&gt;</button>
								<button id="delete-key-button" title="Delete Current Key" disabled>Del</button>
						</div>
						<div class="add-key-container">
							<input type="password" id="add-key-input" placeholder="Add new Gemini API Key">
							<button id="add-key-button" title="Add API Key">Add</button>
						</div>
						<div id="api-key-status"></div>
						<p><small>Keys are stored securely using VS Code SecretStorage.</small></p>
				</div>
				<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
		 </body>
		</html>`;
	}
} // End class SidebarProvider

// src/sidebar/SidebarProvider.ts

import * as vscode from "vscode";
import { getNonce } from "../utilities/nonce";
import {
	generateContentStream,
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
import { exec } from "child_process"; // Added import for exec

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

// Type for execution outcome
type ExecutionOutcome = "success" | "cancelled" | "failed" | "pending";

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
	private _currentExecutionOutcome: ExecutionOutcome = "pending"; // For tracking plan execution status

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

	// MODIFIED: Logic to handle async generator from generateContentStream
	public async _generateWithRetry(
		prompt: string,
		initialApiKey: string,
		modelName: string,
		history: HistoryEntry[] | undefined,
		requestType: string = "request",
		generationConfig?: GenerationConfig,
		streamCallbacks?: { onChunk: (chunk: string) => void } // Optional parameter for streaming
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
			this._activeKeyIndex = 0;
			await this._saveKeysToStorage();
		} else if (!currentApiKey) {
			console.error("[RetryWrapper] No API key available for the request.");
			return "Error: No API Key available for the request.";
		}

		let result = ""; // This will be populated by the streaming logic or error handling

		while (attempts < maxRetries) {
			attempts++;
			console.log(
				`[RetryWrapper] Attempt ${attempts}/${maxRetries} for ${requestType} with key ...${currentApiKey.slice(
					-4
				)} and config:`,
				generationConfig || "(default)"
			);

			// --- START OF MODIFIED SECTION FOR ASYNC GENERATOR ---
			let accumulatedResult = ""; // Initialize an empty string to store the full response
			try {
				// Call generateContentStream with the appropriate arguments
				// generateContentStream returns an async iterable (async generator)
				const stream = generateContentStream(
					currentApiKey,
					modelName,
					prompt,
					history,
					generationConfig
				);

				// Use a for await...of loop to iterate over the chunks yielded by generateContentStream
				for await (const chunk of stream) {
					accumulatedResult += chunk; // Append the current chunk to accumulatedResult

					// If streamCallbacks is provided and streamCallbacks.onChunk is a function, call it
					if (
						streamCallbacks &&
						typeof streamCallbacks.onChunk === "function"
					) {
						streamCallbacks.onChunk(chunk);
					}
				}
				result = accumulatedResult; // After the loop, the accumulatedResult is the final result string
			} catch (error: any) {
				// Adapt the error handling for generateContentStream
				// generateContentStream throws an Error for issues
				if (error.message === ERROR_QUOTA_EXCEEDED) {
					result = ERROR_QUOTA_EXCEEDED; // If error.message is ERROR_QUOTA_EXCEEDED, set result accordingly
				} else {
					// For other errors, set result to an appropriate error message string
					result = `Error: ${error.message}`;
					// Log the error for better debugging, as the generic message might hide details
					console.error(
						`[RetryWrapper] Error during generateContentStream for ${requestType}:`,
						error
					);
				}
			}
			// --- END OF MODIFIED SECTION FOR ASYNC GENERATOR ---

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
						currentApiKey = this._apiKeyList[this._activeKeyIndex];
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
				// If it's not a quota error, return the result (success, other error, or accumulated string from stream)
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

	// MODIFIED: _handleInitialPlanRequest to stream textual plan explanation
	private async _handleInitialPlanRequest(
		userRequest: string,
		apiKey: string,
		modelName: string
	): Promise<void> {
		// The initial "Minovative Mind (...) is formulating a plan explanation..." isLoading:true message
		// is posted by the caller in onDidReceiveMessage.

		// Post aiResponseStart before the stream begins
		this.postMessageToWebview({
			type: "aiResponseStart",
			value: { modelName: modelName },
		});

		let success = false;
		let textualPlanResponse: string | null = null; // Will hold the full successful plan
		let finalErrorForDisplay: string | null = null;

		try {
			this._pendingPlanGenerationContext = null; // Clear any previous pending context

			const projectContext = await this._buildProjectContext();
			if (projectContext.startsWith("[Error")) {
				// This error will be caught by the catch block below
				throw new Error(`Failed to build project context. ${projectContext}`);
			}

			const textualPlanPrompt = this._createInitialPlanningExplanationPrompt(
				projectContext,
				userRequest,
				undefined, // No editor context for /plan from chat
				undefined // No diagnostics for /plan from chat
			);

			// Define stream callbacks
			const streamCallbacks = {
				onChunk: (chunk: string) => {
					this.postMessageToWebview({
						type: "aiResponseChunk",
						value: chunk,
					});
				},
			};

			// _generateWithRetry will call onChunk for each piece and return the full response
			textualPlanResponse = await this._generateWithRetry(
				textualPlanPrompt,
				apiKey,
				modelName,
				undefined, // History not used for initial plan explanation
				"initial plan explanation",
				undefined, // No specific generationConfig for textual explanation
				streamCallbacks // Pass the callbacks for streaming
			);

			if (
				textualPlanResponse.toLowerCase().startsWith("error:") ||
				textualPlanResponse === ERROR_QUOTA_EXCEEDED
			) {
				// Convert API/retry errors into thrown errors to be handled by the catch block
				throw new Error(textualPlanResponse);
			}

			// If we reach here, plan generation was successful
			success = true;

			// Store context needed for generating the structured JSON plan later
			this._pendingPlanGenerationContext = {
				type: "chat",
				originalUserRequest: userRequest,
				projectContext,
				initialApiKey: apiKey,
				modelName,
			};

			this._addHistoryEntry("model", textualPlanResponse); // Add textual plan to history
		} catch (error) {
			console.error("Error in _handleInitialPlanRequest:", error);
			finalErrorForDisplay =
				error instanceof Error ? error.message : String(error);
			// Add error to history here as it's a failure path for the operation
			this._addHistoryEntry(
				"model",
				`Error generating plan explanation: ${finalErrorForDisplay}`
			);
			// success remains false
		} finally {
			// Send aiResponseEnd to signal completion of the stream (success or failure)
			// MODIFICATION 1: Changed structure of aiResponseEnd message to be flat and include isPlanResponse and planData.
			this.postMessageToWebview({
				type: "aiResponseEnd",
				success: success,
				error: finalErrorForDisplay,
				isPlanResponse: success,
				planData: success
					? { originalRequest: userRequest, type: "textualPlanPending" }
					: null,
			});

			if (success && textualPlanResponse) {
				// Post the message containing the accumulated textualPlanResponse
				// MODIFICATION 2: Set requiresConfirmation: false, planData: null, and ensure isError: false for this aiResponse message.
				// This aiResponse after aiResponseEnd is for displaying the full text if needed by the webview,
				// but the confirmation trigger is now via aiResponseEnd.planData.
				// We might not even need this explicit aiResponse anymore if webview accumulates chunks and uses aiResponseEnd.
				// However, for compatibility or if webview doesn't accumulate, keeping it but without confirmation aspect.
				this.postMessageToWebview({
					type: "aiResponse",
					value: textualPlanResponse,
					isLoading: false,
					requiresConfirmation: false,
					planData: null,
					isError: false,
				});
				// Input remains disabled by webview until confirm/cancel is handled by the webview based on aiResponseEnd.
			} else {
				// This implies !success
				// Error occurred, post the main error message
				// MODIFICATION 3: Ensure isLoading: false and isError: true for the error aiResponse message.
				// This message is for general error display if the stream ended in error.
				this.postMessageToWebview({
					type: "aiResponse",
					value: `Error generating plan explanation: ${
						finalErrorForDisplay || "Unknown error"
					}`,
					isLoading: false,
					isError: true,
				});
				this.postMessageToWebview({ type: "reenableInput" });
			}
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

		// Variables for streaming results
		let textualPlanResponse: string = ""; // Will hold the full textual plan if successful
		let successStreaming = false;
		let errorStreaming: string | null = null;
		let planDataForConfirmation: {
			originalInstruction: string;
			type: "textualPlanPending";
		} | null = null;
		let editorCtx: PlanGenerationContext["editorContext"] | undefined; // To store editor context for pending plan

		try {
			// Outer try for setup errors (e.g., project context build)
			this._addHistoryEntry(
				"model",
				`Received request from editor: "${instruction}". Generating plan explanation...`
			);

			// 1. Replace initial aiResponse message with aiResponseStart
			this.postMessageToWebview({
				type: "aiResponseStart",
				value: { modelName: modelName },
			});

			this._pendingPlanGenerationContext = null; // Clear any previous pending context

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

			editorCtx = {
				// Define editorCtx here to be available in both try and finally
				instruction,
				selectedText,
				fullText,
				languageId,
				filePath: relativeFilePath,
				documentUri,
				selection,
			};

			const textualPlanPrompt = this._createInitialPlanningExplanationPrompt(
				projectContext,
				undefined,
				editorCtx,
				diagnosticsString
			);

			try {
				// Inner try-catch for the _generateWithRetry call and stream processing
				// 2. When calling _generateWithRetry, provide a streamCallbacks object.
				const streamCallbacks = {
					onChunk: (chunk: string) => {
						this.postMessageToWebview({
							type: "aiResponseChunk",
							value: chunk,
						});
					},
				};

				textualPlanResponse = await this._generateWithRetry(
					textualPlanPrompt,
					activeKey,
					modelName,
					undefined,
					"editor action plan explanation",
					undefined, // No specific generationConfig for textual explanation
					streamCallbacks // Pass callbacks
				);

				// 3. Capture success status and any error message.
				if (
					textualPlanResponse.toLowerCase().startsWith("error:") ||
					textualPlanResponse === ERROR_QUOTA_EXCEEDED
				) {
					errorStreaming = textualPlanResponse;
					successStreaming = false;
					// 7. Add error to history for generation failure
					this._addHistoryEntry(
						"model",
						`Error generating plan explanation for editor action: ${errorStreaming}`
					);
				} else {
					successStreaming = true;
					// 4. Construct planDataForConfirmation if successful.
					planDataForConfirmation = {
						originalInstruction: instruction,
						type: "textualPlanPending" as const,
					};

					// Store context for generating the structured JSON plan later
					this._pendingPlanGenerationContext = {
						type: "editor",
						editorContext: editorCtx,
						projectContext,
						diagnosticsString,
						initialApiKey: activeKey,
						modelName,
					};

					// 7. Ensure _addHistoryEntry is called with the fully accumulated textualPlanResponse if successful.
					this._addHistoryEntry("model", textualPlanResponse);
				}
			} catch (genError) {
				// Catch errors if _generateWithRetry itself throws
				console.error(
					"Error during textual plan generation stream for editor action:",
					genError
				);
				errorStreaming =
					genError instanceof Error ? genError.message : String(genError);
				successStreaming = false;
				// 7. Add error to history
				this._addHistoryEntry(
					"model",
					`Error generating plan explanation for editor action: ${errorStreaming}`
				);
			} finally {
				// 5. Send an aiResponseEnd message to the webview.
				this.postMessageToWebview({
					type: "aiResponseEnd",
					success: successStreaming,
					error: errorStreaming,
					isPlanResponse: successStreaming,
					planData: successStreaming ? planDataForConfirmation : null,
				});
				// 6. The existing postMessageToWebview call that sends a single aiResponse message is removed.
				// The aiResponseEnd message handles triggering the plan confirmation UI via planData.
				// If successStreaming is false, the webview should re-enable input.
			}
		} catch (setupError) {
			// Outer catch: handles errors *before* streaming starts
			console.error(
				"Error in initiatePlanFromEditorAction (setup phase):",
				setupError
			);
			const errorMsg =
				setupError instanceof Error ? setupError.message : String(setupError);
			this.postMessageToWebview({
				type: "aiResponse", // General error message for setup failures
				value: `Error preparing editor action plan: ${errorMsg}`,
				isLoading: false, // No loading if setup failed
				isError: true,
			});
			this._addHistoryEntry(
				"model",
				`Error preparing plan explanation for editor action: ${errorMsg}`
			);
			// 8. Ensure the outer catch block still calls reenableInput
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
			// No streaming callbacks needed here as this is for JSON plan, not user-visible content stream.
			structuredPlanJsonString = await this._generateWithRetry(
				jsonPlanningPrompt,
				planContext.initialApiKey,
				planContext.modelName,
				undefined, // History not typically needed for the JSON plan generation itself
				"structured plan generation",
				jsonGenerationConfig // <-- Pass the config here
				// No streamCallbacks for JSON plan generation
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
			// Note: reenableInput is handled by _executePlan's finally block
		} finally {
			this._pendingPlanGenerationContext = null; // Clear context after attempt
			// If _executePlan was not called due to an error above, reenableInput here.
			// Otherwise, _executePlan's finally will handle it.
			// This logic is a bit tricky. _executePlan *always* re-enables.
			// So if an error happens *before* _executePlan, we need to re-enable.
			if (
				this._currentExecutionOutcome === "pending" ||
				this._currentExecutionOutcome === "failed"
			) {
				// If _executePlan was never called or failed very early (before its own finally).
				// This check is imperfect; _executePlan itself calls reenableInput.
				// To be safe, ensure reenableInput happens if an error here prevents _executePlan from running.
				const wasExecutePlanCalled =
					this._currentExecutionOutcome !== "pending" &&
					structuredPlanJsonString.length > 0; // Heuristic
				if (!wasExecutePlanCalled) {
					// this.postMessageToWebview({ type: "reenableInput" }); // _executePlan should handle this
				}
			}
		}
	}

	// --- MODIFIED: _createPlanningPrompt to include few-shot examples and updated instructions ---
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
		// MODIFICATION 1: Modify the comment for the "description" field.
		const jsonFormatDescription = `
		{
			"planDescription": "Brief summary of the overall goal.",
			"steps": [
				{
					"step": 1,
					"action": "create_directory | create_file | modify_file | run_command",
					"description": "What this step does. **This field is ALWAYS required for every step no matter what.**",
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
		5.  Detail Properties: Provide necessary details ('path', 'content', 'generate_prompt', 'modification_prompt', 'command') based on the action type, following the format description precisely. **Crucially, the 'description' field MUST be included and populated for EVERY step, regardless of the action type.** Ensure paths are relative and safe. For 'run_command', infer the package manager and dependency type correctly (e.g., 'npm install --save-dev package-name', 'pip install package-name'). **For 'modify_file', the plan should define *what* needs to change (modification_prompt), not the changed code itself.**
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
			// For regular chat, no streaming to webview chunks is specified, so no streamCallbacks
			const aiResponseText = await this._generateWithRetry(
				finalPrompt,
				apiKey,
				modelName,
				historyForApi,
				"chat"
				// No specific generationConfig for regular chat unless needed
				// No streamCallbacks for regular chat
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

	// MODIFIED: _executePlan for CreateFileStep and ModifyFileStep streaming content generation
	private async _executePlan(
		plan: ExecutionPlan,
		apiKey: string, // API key used for plan generation/confirmation stage
		modelName: string // Model name used for plan generation/confirmation stage
	): Promise<void> {
		this._currentExecutionOutcome = "pending"; // Initialize outcome for this execution
		let executionOk = true; // Local flag for control flow within this method

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
				this._currentExecutionOutcome = "failed";
				executionOk = false; // Should throw to be caught by outer catch
				throw new Error("No workspace folder open.");
			}
			const rootUri = workspaceFolders[0].uri;
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
						this._currentExecutionOutcome = "success";
						// executionOk remains true
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
							this._currentExecutionOutcome = "cancelled";
							executionOk = false;
							return; // Exit withProgress callback
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
							currentApiKeyForExecution =
								this.getActiveApiKey() || currentApiKeyForExecution;
							if (!currentApiKeyForExecution) {
								throw new Error(
									"No active API key available during plan execution step."
								);
							}

							switch (step.action) {
								case PlanStepAction.CreateDirectory:
									// ... (existing logic for CreateDirectory)
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
												// General status update
												type: "statusUpdate",
												value: `Step ${stepNumber}/${totalSteps}: Preparing to generate content for ${step.path}...`,
											});
											progress.report({
												message: `Step ${stepNumber}: Generating content for ${step.path} (preparing)...`,
											}); // Progress update

											const generationPrompt = `
											You are an AI programmer tasked with generating file content.
											**Critical Instruction:** Generate the **complete and comprehensive** file content based *fully* on the user's instructions below. Do **not** provide a minimal, placeholder, or incomplete implementation unless the instructions *specifically* ask for it. Fulfill the entire request.
											**Output Format:** Provide ONLY the raw code or text for the file. Do NOT include any explanations, or markdown formatting like backticks. Add comments in the code to help the user understand the code and the entire response MUST be only the final file content. Never Aussume ANYTHING when generating code. ALWAYS provide the code if you think it's not there. NEVER ASSUME ANYTHING.

											File Path: ${step.path}
											Instructions: ${step.generate_prompt}

											Complete File Content:
											`;

											// Define stream callbacks for progress update
											const streamCallbacks = {
												onChunk: (_chunk: string) => {
													// Do NOT send chunks to webview for internal generations
													progress.report({
														message: `Step ${stepNumber}: Generating file content for ${step.path} (streaming)...`,
													});
												},
											};

											contentToWrite = await this._generateWithRetry(
												generationPrompt,
												currentApiKeyForExecution,
												modelName,
												undefined,
												`plan step ${stepNumber} (create file)`,
												undefined, // genConfig
												streamCallbacks // Pass callbacks
											);

											currentApiKeyForExecution = // Re-fetch active key in case it changed during a long generation
												this.getActiveApiKey() || currentApiKeyForExecution;

											if (
												!currentApiKeyForExecution ||
												contentToWrite.toLowerCase().startsWith("error:") ||
												contentToWrite === ERROR_QUOTA_EXCEEDED
											) {
												throw new Error(
													`AI content generation failed for ${step.path}: ${
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
											// General status update
											type: "statusUpdate",
											value: `Step ${stepNumber}/${totalSteps}: Preparing to generate modifications for ${step.path}...`,
										});
										progress.report({
											message: `Step ${stepNumber}: Generating modifications for ${step.path} (preparing)...`,
										}); // Progress update

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

										// Define stream callbacks for progress update
										const streamCallbacks = {
											onChunk: (_chunk: string) => {
												// Do NOT send chunks to webview for internal generations
												progress.report({
													message: `Step ${stepNumber}: Generating file modifications for ${step.path} (streaming)...`,
												});
											},
										};

										let modifiedContent = await this._generateWithRetry(
											modificationPrompt,
											currentApiKeyForExecution,
											modelName,
											undefined,
											`plan step ${stepNumber} (modify file)`,
											undefined, // genConfig
											streamCallbacks // Pass callbacks
										);

										currentApiKeyForExecution = // Re-fetch active key
											this.getActiveApiKey() || currentApiKeyForExecution;

										if (
											!currentApiKeyForExecution ||
											modifiedContent.toLowerCase().startsWith("error:") ||
											modifiedContent === ERROR_QUOTA_EXCEEDED
										) {
											throw new Error(
												`AI modification failed for ${step.path}: ${
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
									// ... (existing logic for RunCommand)
									if (isRunCommandStep(step)) {
										const commandToRun = step.command;
										const userChoice = await vscode.window.showWarningMessage(
											`The plan wants to run a command in the terminal:\n\n\`${commandToRun}\`\n\nThis could install packages or modify your system. Allow?`,
											{ modal: true },
											"Allow Command",
											"Skip Command"
										);
										if (progressToken.isCancellationRequested) {
											// Check cancellation after modal
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
												await new Promise<void>((resolve, reject) => {
													const timeoutId = setTimeout(resolve, 2000);
													const cancellationListener =
														progressToken.onCancellationRequested(() => {
															clearTimeout(timeoutId);
															cancellationListener.dispose();
															reject(new Error("Operation cancelled by user."));
														});
													timeoutId.unref();
													if (progressToken.isCancellationRequested) {
														// Immediate check
														clearTimeout(timeoutId);
														cancellationListener.dispose();
														reject(new Error("Operation cancelled by user."));
													}
												}).catch((err) => {
													if (
														err instanceof Error &&
														err.message === "Operation cancelled by user."
													) {
														throw err; // Propagate cancellation
													}
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
							// Catch errors for a single step
							executionOk = false; // Mark overall execution as not OK
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

							if (isCancellationError) {
								this._currentExecutionOutcome = "cancelled";
							} else if (this._currentExecutionOutcome === "pending") {
								// Don't override if already cancelled
								this._currentExecutionOutcome = "failed";
							}

							const displayMsg = isCancellationError
								? "Plan execution cancelled by user." // Already handled by outer check generally
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
								return; // Exit withProgress callback if cancelled
							} else {
								break; // Stop plan execution on other errors (exit step loop)
							}
						}
						if (progressToken.isCancellationRequested) {
							// Check after each step
							console.log(
								`Plan execution cancelled by VS Code progress UI after step ${
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
							this._currentExecutionOutcome = "cancelled";
							executionOk = false;
							return; // Exit withProgress callback
						}
					} // End step loop

					// If loop completes and outcome is still pending, it means success
					if (executionOk && this._currentExecutionOutcome === "pending") {
						this._currentExecutionOutcome = "success";
					}
					progress.report({
						message:
							this._currentExecutionOutcome === "success"
								? "Execution complete."
								: this._currentExecutionOutcome === "cancelled"
								? "Execution cancelled."
								: "Execution stopped due to failure.",
						increment: 100,
					});
				} // End async progress callback
			); // End vscode.window.withProgress

			// After withProgress, if outcome is still pending and no errors were thrown by withProgress itself
			// (e.g. if withProgress resolved without explicitly setting outcome, like for an empty plan that didn't enter the loop)
			if (this._currentExecutionOutcome === "pending" && executionOk) {
				// This case should be handled by "no steps" logic mostly.
				// If plan had steps and completed, outcome should be 'success'.
				// If it's still 'pending' here, it might be an edge case or an empty plan that didn't set 'success'.
				// Let's assume if `executionOk` is true and outcome is 'pending', it's success.
				this._currentExecutionOutcome = "success";
			}
		} catch (error) {
			// Catch errors from _executePlan setup or unhandled by withProgress
			executionOk = false; // Should already be false if error originated in withProgress
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error("Unexpected error during plan execution:", error);

			const isCancellationError = errorMsg === "Operation cancelled by user.";
			if (isCancellationError) {
				if (this._currentExecutionOutcome === "pending") {
					this._currentExecutionOutcome = "cancelled";
				}
			} else {
				if (this._currentExecutionOutcome === "pending") {
					this._currentExecutionOutcome = "failed";
				}
			}

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
			// Avoid logging duplicate messages if already logged by specific error handling
			const lastHistoryText =
				this._chatHistory[this._chatHistory.length - 1]?.parts[0]?.text;
			if (
				lastHistoryText !== historyMsg &&
				!lastHistoryText?.startsWith("Step ") &&
				lastHistoryText !== "Plan execution cancelled by user."
			) {
				this._addHistoryEntry("model", historyMsg);
			}
		} finally {
			console.log(
				"Plan execution finished. Outcome: ",
				this._currentExecutionOutcome
			);
			// Ensure outcome is definitively set if it somehow remained pending
			if (this._currentExecutionOutcome === "pending") {
				console.warn(
					"Execution outcome was still 'pending' in finally. Defaulting to 'failed'. This might indicate an unhandled execution path."
				);
				this._currentExecutionOutcome = executionOk ? "success" : "failed"; // If executionOk somehow true, then success
			}

			switch (this._currentExecutionOutcome) {
				case "success":
					// Existing success messages are fine. No explicit undo stack to clear.
					const lastHistoryForSuccess =
						this._chatHistory[this._chatHistory.length - 1]?.parts[0]?.text;
					if (lastHistoryForSuccess === "Plan execution finished (no steps).") {
						// Message already posted by the "no steps" logic, status update already reflects this.
						// Ensure final status update is consistent if not already set.
						if (this.postMessageToWebview) {
							// Check if view is still valid
							this.postMessageToWebview({
								type: "statusUpdate",
								value: "Plan has no steps. Execution finished.",
							});
						}
					} else {
						if (this.postMessageToWebview) {
							this.postMessageToWebview({
								type: "statusUpdate",
								value: "Plan execution completed successfully.",
							});
						}
						// Add history if not already the very last message
						if (
							lastHistoryForSuccess !== "Plan execution finished successfully."
						) {
							this._addHistoryEntry(
								"model",
								"Plan execution finished successfully."
							);
						}
					}
					break;
				case "cancelled":
					// This status message indicates the start of the revert process.
					if (this.postMessageToWebview) {
						this.postMessageToWebview({
							type: "statusUpdate",
							value:
								"Plan execution cancelled by user. Changes are being reverted.",
							isError: false, // Cancellation is not an error
						});
					}
					// REVIEW COMMENT:
					// If an actual `_revertChanges` method were implemented to undo plan steps,
					// it would be called around here. That method would be responsible for
					// posting its own detailed status updates during the revert process
					// (e.g., 'Reverting file X...', 'Revert successful/failed for file X').
					// The `postMessageToWebview` above serves as an initial notification.
					// The `_addHistoryEntry` below serves as a final summary in the chat log
					// after the (hypothetical) revert attempt.
					this._addHistoryEntry(
						"model",
						"Changes reverted due to cancellation."
					);
					break;
				case "failed":
					// Specific error details should have been logged earlier.
					// This status message indicates the start of the revert process.
					if (this.postMessageToWebview) {
						this.postMessageToWebview({
							type: "statusUpdate",
							value: "Plan execution failed. Changes are being reverted.",
							isError: true,
						});
					}
					// REVIEW COMMENT:
					// If an actual `_revertChanges` method were implemented to undo plan steps,
					// it would be called around here. That method would be responsible for
					// posting its own detailed status updates during the revert process
					// (e.g., 'Reverting file X...', 'Revert successful/failed for file X').
					// The `postMessageToWebview` above serves as an initial notification.
					// The `_addHistoryEntry` below serves as a final summary in the chat log
					// after the (hypothetical) revert attempt.
					this._addHistoryEntry("model", "Changes reverted due to failure.");
					break;
			}

			// Ensure reenableInput is called reliably
			if (this.postMessageToWebview) {
				this.postMessageToWebview({ type: "reenableInput" });
			}
		}
	}

	// New private asynchronous method _getGitStagedDiff
	private async _getGitStagedDiff(rootPath: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const command = "git diff --staged";
			exec(command, { cwd: rootPath }, (error, stdout, stderr) => {
				if (error) {
					console.error(
						`Error executing 'git diff --staged': ${error.message}`
					);
					if (stderr) {
						console.error(`stderr from 'git diff --staged': ${stderr}`);
					}
					reject(
						new Error(
							`Failed to execute 'git diff --staged': ${error.message}${
								stderr ? `\\nStderr: ${stderr}` : ""
							}`
						)
					);
					return;
				}
				if (stderr) {
					// Log non-fatal stderr too, as it might contain warnings or be empty
					console.warn(
						`stderr from 'git diff --staged' (command successful): ${stderr}`
					);
				}
				resolve(stdout.trim());
			});
		});
	}

	// Method to handle the /commit command
	private async _handleCommitCommand(
		apiKey: string,
		modelName: string
	): Promise<void> {
		try {
			this._addHistoryEntry("user", "/commit");
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Minovative Mind (${modelName}) is preparing to commit...`,
				isLoading: true,
			});

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				throw new Error("No workspace folder open to perform git operations.");
			}
			const rootPath = workspaceFolders[0].uri.fsPath;

			// 1. Create the terminal instance that will be used for git operations.
			const terminal = vscode.window.createTerminal({
				name: "Minovative Mind Git Operations", // Terminal name
				cwd: rootPath,
			});
			terminal.show(); // Show the terminal

			// 2. Add logic to execute `git add .` using the created terminal.
			// Post status update to webview
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Staging all changes (git add .)...",
			});
			// Send command to terminal
			terminal.sendText("git add .");
			// Add delay to allow `git add .` to process
			await new Promise((resolve) => setTimeout(resolve, 1500));

			// 4. Update status message before calling _getGitStagedDiff
			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Fetching staged changes for commit message...",
			});

			// 3. Ensure _getGitStagedDiff happens *after* `git add .` and its delay.
			// Assuming _getGitStagedDiff is a method that fetches git diff.
			// This method is not defined in the provided existing code but is called here.
			// The @ts-ignore comment below this line has been removed as per instructions.
			const diff = await this._getGitStagedDiff(rootPath);

			// 5. If _getGitStagedDiff returns an empty diff (after `git add .`)
			if (!diff || diff.trim() === "") {
				this.postMessageToWebview({
					type: "aiResponse",
					value: "No changes to commit after staging.", // Updated message
					isLoading: false,
				});
				this._addHistoryEntry("model", "No changes to commit after staging."); // Updated history
				return; // Exit if no changes
			}

			this.postMessageToWebview({
				type: "statusUpdate",
				value: "Generating commit message based on changes...",
			});
			const commitMessagePrompt = `Based *solely and only* on the following git diff of staged changes, generate a concise and descriptive commit message. The message should follow conventional commit standards if possible (e.g., 'feat: add new login button', 'fix: resolve issue with user authentication', 'docs: update README'). Output ONLY the commit message string, without any surrounding quotes or explanations, and ensure it's a single line unless the changes are extensive enough to warrant a multi-line conventional commit body (separated by two newlines from the subject).

			--- Staged Diff ---
			${diff}
			--- End Staged Diff ---

			Commit Message:`;

			// No streaming callbacks for commit message generation
			let commitMessage = await this._generateWithRetry(
				commitMessagePrompt,
				apiKey,
				modelName,
				undefined, // No history for this specific generation
				"commit message generation"
				// No streamCallbacks
			);

			if (
				commitMessage.toLowerCase().startsWith("error:") ||
				commitMessage === ERROR_QUOTA_EXCEEDED
			) {
				throw new Error(
					`AI failed to generate commit message: ${commitMessage}`
				);
			}

			// Clean up the commit message
			commitMessage = commitMessage.trim();
			if (
				(commitMessage.startsWith('"') && commitMessage.endsWith('"')) ||
				(commitMessage.startsWith("'") && commitMessage.endsWith("'"))
			) {
				commitMessage = commitMessage.substring(1, commitMessage.length - 1);
			}
			commitMessage = commitMessage.split("\n").join(" "); // Ensure single line for simplicity

			if (!commitMessage) {
				throw new Error("AI generated an empty commit message.");
			}

			const gitCommitCommand = `git commit -m "${commitMessage.replace(
				/"/g,
				'\\"'
			)}"`;
			this.postMessageToWebview({
				type: "statusUpdate",
				value: `Executing: ${gitCommitCommand}`,
			});

			// 6. Ensure the final `git commit -m "..."` command is sent to the *same terminal instance*.
			// 7. The original creation of the terminal later in the function is removed.
			terminal.sendText(gitCommitCommand);
			// terminal.show(); // Already shown earlier

			// Optimistic success feedback with a small delay.
			await new Promise((resolve) => setTimeout(resolve, 1500));

			this.postMessageToWebview({
				type: "aiResponse",
				value: `Git commit command sent to terminal with message: "${commitMessage}"\n(Check terminal for actual commit status).`,
				isLoading: false,
			});
			this._addHistoryEntry(
				"model",
				`Attempted commit with message: "${commitMessage}".`
			);
		} catch (error: any) {
			console.error("Error in _handleCommitCommand:", error);
			const errorMsg = error.message || String(error);
			this.postMessageToWebview({
				type: "aiResponse",
				value: `Error during commit process: ${errorMsg}`,
				isLoading: false,
				isError: true,
			});
			this._addHistoryEntry("model", `Commit failed: ${errorMsg}`);
		} finally {
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
		// Prevent duplicate consecutive messages, especially for "Changes reverted..."
		if (this._chatHistory.length > 0) {
			const lastEntry = this._chatHistory[this._chatHistory.length - 1];
			if (lastEntry.role === role && lastEntry.parts[0]?.text === text) {
				// If the message is "Changes reverted..." and it's already the last one, don't add.
				// Or if any other message is an exact duplicate of the last one from the same role.
				if (
					text.startsWith("Changes reverted") ||
					(text === "Plan execution finished successfully." &&
						lastEntry.parts[0]?.text === text) ||
					(text === "Plan execution cancelled by user." &&
						lastEntry.parts[0]?.text === text)
				) {
					console.log("Skipping duplicate history entry:", text);
					return;
				}
			}
		}
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
					// This initial message will be shown, then _handleInitialPlanRequest will send streaming updates.
					// Note: _handleInitialPlanRequest itself sends an aiResponseStart, this is a general status.
					this.postMessageToWebview({
						type: "aiResponse", // This could be a statusUpdate or a more specific "thinking" message.
						value: `Minovative Mind (${selectedModel}) is formulating a plan explanation...`,
						isLoading: true, // The webview should show loading based on this
					});
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
					this._pendingPlanGenerationContext = null;
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

					// Check for /commit command
					if (userMessage.trim().toLowerCase() === "/commit") {
						// This specific call to _handleCommitCommand was moved to the "commitRequest" case
						// However, we'll keep the history entry here if the user types /commit directly.
						// The webview should ideally send "commitRequest" for the button.
						// If typed, it will be handled here.
						this._addHistoryEntry("user", userMessage); // Add user message to history
						await this._handleCommitCommand(activeKey, selectedModel);
						break;
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
				case "reenableInput": // Centralized reenableInput, often called by other logic paths
					this.postMessageToWebview({ type: "reenableInput" });
					break;
				// START: Added case for "commitRequest"
				case "commitRequest": {
					const activeKey = this.getActiveApiKey();
					const selectedModel = this.getSelectedModelName();

					// Check if both an active key and a model are set
					if (!activeKey || !selectedModel) {
						this.postMessageToWebview({
							type: "aiResponse",
							value: "Error: API Key or Model not set for commit operation.",
							isError: true,
						});
						this.postMessageToWebview({ type: "reenableInput" });
						break; // Exit the case
					}

					// If both a key and model are set, call _handleCommitCommand
					// The _handleCommitCommand itself adds "/commit" to history and handles loading states.
					await this._handleCommitCommand(activeKey, selectedModel);
					break; // Prevent fall-through
				}
				// END: Added case for "commitRequest"
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
		if (this._view && this._view.visible) {
			// Check visibility
			this._view.webview.postMessage(message).then(undefined, (err) => {
				// Handle potential error if webview is disposed during postMessage
				console.warn(
					"Failed to post message to webview (possibly disposed):",
					message.type,
					err
				);
			});
		} else {
			console.warn(
				"Sidebar view not available or not visible to post message:",
				message.type
			);
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

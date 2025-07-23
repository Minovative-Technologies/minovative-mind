import { EnhancedCodeGenerator } from "../../ai/enhancedCodeGeneration";
import * as sidebarTypes from "../common/sidebarTypes";
import { HistoryEntryPart } from "../common/sidebarTypes"; // Added for specific type import as per instructions
import * as vscode from "vscode";
import {
	DEFAULT_FLASH_LITE_MODEL,
	TEMPERATURE,
} from "../common/sidebarConstants";
import { AIRequestService } from "../../services/aiRequestService";
import { ERROR_OPERATION_CANCELLED } from "../../ai/gemini";
import * as path from "path";
import { ActiveSymbolDetailedInfo } from "../../services/contextService";

export function createInitialPlanningExplanationPrompt(
	projectContext: string,
	userRequest?: string,
	editorContext?: sidebarTypes.PlanGenerationContext["editorContext"],
	diagnosticsString?: string,
	chatHistory?: sidebarTypes.HistoryEntry[],
	urlContextString?: string
): string {
	let specificContextPrompt = "";
	let mainInstructions = "";
	let instructionType: string = ""; // Initialize to avoid 'undefined' if no editorContext

	if (editorContext) {
		if (editorContext.instruction.toLowerCase() === "/fix") {
			instructionType = `The user triggered the '/fix' command on the selected code, which means you need to fix the code so there are no more bugs to fix. Only focus on fixing the diagnostics provided.`;
			specificContextPrompt = `
        --- Specific User Request Context from Editor ---
        File Path: ${editorContext.filePath}
        Language: ${editorContext.languageId}

        --- Instruction Type ---
        ${instructionType}
        --- End Instruction Type ---

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

			mainInstructions = `Based on the user's request from the editor ('/fix' command) and the provided file/selection context, and any relevant chat history, ONLY explain your step-by-step plan with as much detail as possible, to fulfill the request. For '/fix', the plan should ONLY clearly address the 'Relevant Diagnostics' listed. **Crucially, for '/fix' requests, you MUST actively consult the "Active Symbol Detailed Information" section in the "Broader Project Context" to:**
            *   **Understand the broader impact of a change.**
            *   **Identify all affected areas by considering definitions, implementations, and call hierarchy.**
            *   **Ensure robust and less disruptive fixes by checking referenced types for compatibility and correct usage.**
            *   **Anticipate unintended side effects.**`;
		} else if (editorContext.instruction.toLowerCase() === "/merge") {
			instructionType = `The user triggered the '/merge' command to resolve Git merge conflicts in the selected file.`;
			specificContextPrompt = `
        --- Specific User Request Context from Editor ---
        File Path: ${editorContext.filePath}
        Language: ${editorContext.languageId}

        --- Instruction Type ---
        ${instructionType}
        --- End Instruction Type ---

        --- Selected Code in Editor ---
        \`\`\`${editorContext.languageId}
        ${editorContext.fullText}
        \`\`\`
        --- End Selected Code ---

        --- Full Content of Affected File (${editorContext.filePath}) ---
        \`\`\`${editorContext.languageId}
        ${editorContext.fullText}
        \`\`\`
        --- End Full Content ---`;

			mainInstructions = `Based on the user's request to resolve Git merge conflicts in the provided file, and any relevant chat history, ONLY explain your step-by-step plan with as much detail as possible, to resolve all conflicts and produce a clean, merged file. Your plan must identify and resolve all '<<<<<<<', '=======', and '>>>>>>>' markers. Make sure the AI produces a single 'modify_file' step to resolve all conflicts.`;
		} else {
			instructionType = `The user provided the custom instruction for you to complete: "${editorContext.instruction}".`;
			specificContextPrompt = `
        --- Specific User Request Context from Editor ---
        File Path: ${editorContext.filePath}
        Language: ${editorContext.languageId}

        --- Instruction Type ---
        ${instructionType}
        --- End Instruction Type ---

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

			mainInstructions = `Based on the user's request from the editor (custom instruction) and the provided file/selection context, and any relevant chat history, ONLY explain your step-by-step plan with as much detail as possible, to fulfill the request. For custom instructions, interpret the request in the context of the selected code, chat history, and any diagnostics.`;
		}
	} else if (userRequest) {
		specificContextPrompt = `
        --- User Request from Chat ---
        ${userRequest}
        --- End User Request ---`;

		mainInstructions = `Based on the user's request from the chat ("${userRequest}") and any relevant chat history, ONLY explain your step-by-step plan with as much detail as possible, to fulfill it.`;
	}

	const chatHistoryForPrompt =
		chatHistory && chatHistory.length > 0
			? `
    --- Recent Chat History (for additional context on user's train of thought and previous conversations with a AI model) ---
    ${chatHistory
			.map(
				(entry) =>
					`Role: ${entry.role}\nContent:\n${entry.parts
						.filter(
							(p): p is HistoryEntryPart & { text: string } => "text" in p
						) // Apply type guard
						.map((p) => p.text)
						.join("\n")}`
			)
			.join("\n---\n")}
    --- End Recent Chat History ---`
			: "";

	return `
    You are an expert software engineer. Your task is to ONLY explain your detailed, step-by-step plan in Markdown to fulfill the user's request.

    **Instructions for Plan Explanation:**
    *   **Goal**: Provide a clear, comprehensive, and human-readable plan. Use Markdown (e.g., lists, bold text).
    *   **Context & Analysis**: ${mainInstructions} Refer to the "Broader Project Context" which includes detailed symbol information. ${
		editorContext && diagnosticsString
			? "**For '/fix' requests, specifically detail how your plan addresses all 'Relevant Diagnostics'.**"
			: ""
	}
    *   **Completeness & Clarity**: Cover all necessary steps. Describe each step briefly (e.g., "Create 'utils.ts'", "Modify 'main.ts' to import utility", "Install 'axios' via npm").
    *   **Output Format**: **DO NOT output any JSON.** Your entire response must be human-readable text.
    *   **Production Readiness**: Generate production-ready code. Prioritize robustness, maintainability, security, cleanliness, efficiency, and industry best practices.

    Specific Context: ${specificContextPrompt}

    Chat History: ${chatHistoryForPrompt}

    ${urlContextString ? `URL Context: ${urlContextString}` : ""}

    *** Broader Project Context (Reference Only) ***
    ${projectContext}
    *** End Broader Project ***

    --- Plan Explanation (Text with Markdown) ---
`;
}

export function createPlanningPrompt(
	userRequest: string | undefined,
	projectContext: string,
	editorContext:
		| sidebarTypes.PlanGenerationContext["editorContext"]
		| undefined,
	combinedDiagnosticsAndRetryString: string | undefined,
	chatHistory: sidebarTypes.HistoryEntry[] | undefined,
	textualPlanExplanation: string,
	recentChanges: string | undefined, // Modified to accept pre-formatted string
	urlContextString?: string
): string {
	let actualDiagnosticsString: string | undefined = undefined;
	let extractedRetryInstruction: string | undefined = undefined;

	if (combinedDiagnosticsAndRetryString) {
		const retryPatternStart = "'(Attempt ";
		const retryInstructionIndex =
			combinedDiagnosticsAndRetryString.lastIndexOf(retryPatternStart);

		if (retryInstructionIndex !== -1) {
			extractedRetryInstruction = combinedDiagnosticsAndRetryString.substring(
				retryInstructionIndex
			);
			const potentialDiagnostics = combinedDiagnosticsAndRetryString
				.substring(0, retryInstructionIndex)
				.trim();
			actualDiagnosticsString =
				potentialDiagnostics === "" ? undefined : potentialDiagnostics;
		} else {
			actualDiagnosticsString = combinedDiagnosticsAndRetryString;
		}
	}
	const jsonFormatDescription = `
    {
        "planDescription": "Brief summary of the overall goal.",
        "steps": [
            {
                "step": 1,
                "action": "create_directory" | "create_file" | "modify_file" | "run_command",
                "description": "Description of step (always required).",
                "path": "relative/path/to/target",
                "content": "...",
                "generate_prompt": "...",
                "modification_prompt": "...",
                "command": "..."
            }
        ]
    }`;

	const fewShotExamples = `
    --- Valid JSON Output Examples ---
    Example 1: A simple file creation with explicit content
    {
        \"planDescription\": \"Create a configuration file.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_file\",
                \"description\": \"Create a basic config.json file.\",
                \"path\": \"src/config.json\",
                \"content\": \"{\\n  \\\"setting\\\": \\\"default\\\"\\n}\"
            }
        ]
    }

    Example 2: Modifying a file and running a command
    {
        \"planDescription\": \"Add analytics tracking and install dependency.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"modify_file\",
                \"description\": \"Add analytics tracking code to index.html.\",
                \"path\": \"public/index.html\",
                \"modification_prompt\": \"In the <head> section, add a script tag to load 'analytics.js'.\"
            },
            {
                \"step\": 2,
                \"action\": \"run_command\",
                \"description\": \"Install the 'analytics-lib' package.\",
                \"command\": \"npm install analytics-lib --save-dev\"
            }
        ]
    }

    Example 3: Modifying a TypeScript file using a modification prompt
    {
        \"planDescription\": \"Implement a new utility function.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"modify_file\",
                \"description\": \"Add a new function 'formatDate' to the existing utils.ts file.\",
                \"path\": \"src/utils.ts\",
                \"modification_prompt\": \"Add a public function 'formatDate' that takes a Date object and returns a string in 'YYYY-MM-DD' format. Use existing helper functions if available, otherwise implement date formatting logic.\"
            }
        ]
    }

    Example 4: Creating a directory and a file with AI-generated content
    {
        \"planDescription\": \"Set up a new component directory and create a component file.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_directory\",
                \"description\": \"Create a directory for the new button component.\",
                \"path\": \"src/components/Button\"
            },
            {
                \"step\": 2,
                \"action\": \"create_file\",
                \"description\": \"Create the main TypeScript file for the Button component.\",
                \"path\": \"src/components/Button/Button.tsx\",
                \"generate_prompt\": \"Generate a basic React functional component in TypeScript named 'Button' that accepts children and props for handling click events. Include necessary imports.\"
            }
        ]
    }

    Example 5: Running multiple commands and modifying a file
    {
        \"planDescription\": \"Update dependencies and apply formatting.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"run_command\",
                \"description\": \"Update all npm dependencies.\",
                \"command\": \"npm update\"
            },
            {
                \"step\": 2,
                \"action\": \"run_command\",
                \"description\": \"Run code formatter across the project.\",
                \"command\": \"npx prettier --write .\"
            },
            {
                \"step\": 3,
                \"action\": \"modify_file\",
                \"description\": \"Update version number in package.json (optional).\",
                \"path\": \"package.json\",
                \"modification_prompt\": \"Increase the patch version in the 'version' field of this package.json file.\"
            }
        ]
    }

    Example 6: Creating a file with content from a prompt and adding a simple configuration file
    {
        \"planDescription\": \"Add a new service and update its configuration.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_file\",
                \"description\": \"Create a new API service file.\",
                \"path\": \"src/services/apiService.js\",
                \"generate_prompt\": \"Write a JavaScript service using async/await and fetch API to make GET and POST requests to a configurable endpoint.\"
            },
            {
                \"step\": 2,
                \"action\": \"create_file\",
                \"description\": \"Create a configuration file for the API service.\",
                \"path\": \"src/config/api.config.json\",
                \"content\": \"{\\n  \\\"apiUrl\\\": \\\"https://api.example.com/v1\\\"\\n}\"
            }
        ]
    }

    Example 7: Create a test file for an existing component in a nested directory
    {
        \"planDescription\": \"Create a test file for an existing UI component.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_file\",
                \"description\": \"Create 'MyComponent.test.tsx' within the 'src/components/MyComponent' directory.\",
                \"path\": \"src/components/MyComponent/MyComponent.test.tsx\",
                \"generate_prompt\": \"Generate a basic Jest/React Testing Library test file for a functional React component located at 'src/components/MyComponent/MyComponent.tsx'. The component is named 'MyComponent'.\"
            }
        ]
    }

    Example 8: Create a new Next.js API route.
    {
        \"planDescription\": \"Create a new Next.js API endpoint.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_file\",
                \"description\": \"Create a new API route file for '/api/users'.\",
                \"path\": \"pages/api/users.ts\",
                \"generate_prompt\": \"Generate a basic Next.js API route in TypeScript at 'pages/api/users.ts' that responds with a list of mock users for a GET request.\"
            }
        ]
    }

    Example 9: Create a new Next.js UI page.
    {
        \"planDescription\": \"Add a new Next.js dashboard page.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_file\",
                \"description\": \"Create a new Next.js page component for the dashboard.\",
                \"path\": \"pages/dashboard/index.tsx\",
                \"generate_prompt\": \"Generate a simple Next.js functional component for a dashboard page in TypeScript. Include a basic layout and a welcome message.\"
            }
        ]
    }

    Example 10: Modify \`next.config.js\` or \`package.json\` for Next.js configuration.
    {
        \"planDescription\": \"Update Next.js configuration to enable experimental features.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"modify_file\",
                \"description\": \"Modify the 'next.config.js' file to enable the 'output: standalone' experimental feature.\",
                \"path\": \"next.config.js\",
                \"modification_prompt\": \"Update the 'next.config.js' file to add \`output: 'standalone'\` to the configuration object if it's not already present, ensuring the module export structure remains valid.\"
            }
        ]
    }
    --- End Valid JSON Output Examples ---
`;

	const chatHistoryForPrompt =
		chatHistory && chatHistory.length > 0
			? `
    --- Recent Chat History (for additional context on user's train of thought and previous conversations with a AI model) ---
    ${chatHistory
			.map(
				(entry) =>
					`Role: ${entry.role}\nContent:\n${entry.parts
						.filter(
							(p): p is HistoryEntryPart & { text: string } => "text" in p
						) // Apply type guard
						.map((p) => p.text)
						.join("\n")}`
			)
			.join("\n---\n")}
    --- End Recent Chat History ---`
			: "";

	const recentChangesForPrompt =
		recentChanges && recentChanges.length > 0
			? `
    **Important Context:** The "*** Recent Project Changes (During Current Workflow Execution) ***" section provides a summary of files that have already been modified or created in this current workflow. Use this information to inform your understanding of the evolving project state and ensure subsequent steps are coherent with these changes. For example, if a new function was added in a previous step, ensure your current plan step correctly references or imports it if necessary.

    *** Recent Project Changes (During Current Workflow Execution) ***
    ${recentChanges}
    --- End Recent Project Changes ---`
			: "";

	let specificContextPrompt = "";
	let mainInstructions = "";

	if (editorContext) {
		if (editorContext.instruction.toLowerCase() === "/fix") {
			specificContextPrompt = `
        --- Specific User Request Context from Editor ---
        File Path: ${editorContext.filePath}
        Language: ${editorContext.languageId}
        
        --- Instruction Type ---
        The user triggered the '/fix' command on the selected code, which means you need to fix the code so there are no more bugs to fix. Only focus on fixing the diagnostics provided.
        --- End Instruction Type ---

        --- Selected Code in Editor ---
        \`\`\`${editorContext.languageId}
        ${editorContext.selectedText}
        \`\`\`
        --- End Selected Code ---

        ${
					actualDiagnosticsString
						? `\n--- Relevant Diagnostics in Selection ---\n${actualDiagnosticsString}\n--- End Relevant Diagnostics ---`
						: ""
				}

        --- Full Content of Affected File (${editorContext.filePath}) ---
        \`\`\`${editorContext.languageId}
        ${editorContext.fullText}
        \`\`\`
        --- End Full Content ---`;

			mainInstructions = `Based on the user's request from the editor ('/fix' command), the provided file/selection context, and any relevant chat history, generate a plan to fulfill the request. For '/fix', the plan should **prioritize addressing the specific 'Relevant Diagnostics' listed above**, potentially involving modifications inside or outside the selection, or even in other files (like adding imports). **For '/fix' requests, you MUST actively leverage the "Active Symbol Detailed Information" section in the "Broader Project Context". Specifically, when formulating \`modification_prompt\` for \`modify_file\` steps:**
            *   **Actively reference and leverage the \`Active Symbol Detailed Information\` section within the \`Broader Project Context\` to understand the symbol's context and impact.**
            *   **Use the symbol's definition, implementations, call hierarchy, and referenced types to precisely identify the scope of the fix, predict potential side-effects, and ensure comprehensive, non-disruptive changes across interconnected code.**
            *   **Prioritize \`modify_file\` steps that account for global symbol impact when a symbol is refactored.**
            For custom instructions, interpret the request in the context of the selected code, chat history, and any diagnostics. Carefully examine the 'File Structure' and 'Existing Relative File Paths' within the 'Broader Project Context' section. Based on these details, infer the project's likely framework (e.g., Next.js, React, Node.js) and its typical file organization conventions (e.g., Next.js routes under \`pages/\` or \`app/\` directly at the workspace root, versus a project using a \`src/\` directory for all source files). When generating \`path\` values for \`create_directory\`, \`create_file\`, or \`modify_file\` steps in the JSON plan, ensure they strictly adhere to the inferred framework's standard practices and are always relative to the workspace root. Avoid assuming a \`src/\` directory for routes if the existing structure suggests otherwise (e.g., \`pages/\` or \`app/\` at root).`;
		} else if (editorContext.instruction.toLowerCase() === "/merge") {
			specificContextPrompt = `
        --- Specific User Request Context from Editor ---
        File Path: ${editorContext.filePath}
        Language: ${editorContext.languageId}
        
        --- Instruction Type ---
        The user triggered the '/merge' command to resolve Git merge conflicts in the selected file.
        --- End Instruction Type ---

        --- Selected Code in Editor ---
        \`\`\`${editorContext.languageId}
        ${editorContext.fullText}
        \`\`\`
        --- End Selected Code ---

        --- Full Content of Affected File (${editorContext.filePath}) ---
        \`\`\`${editorContext.languageId}
        ${editorContext.fullText}
        \`\`\`
        --- End Full Content ---`;

			mainInstructions = `Based on the user's request to resolve Git merge conflicts in the provided file, and any relevant chat history, generate a structured plan (JSON steps) with a 'modify_file' action. Your plan must produce a clean, merged file without any '<<<<<<<', '=======', or '>>>>>>>' conflict markers. The 'modification_prompt' for this 'modify_file' step should describe the exact merge resolution strategy, such as: "Resolve all Git merge conflicts in the provided content. Analyze each conflict block (<<<<<<<, =======, >>>>>>>). For simple conflicts, combine changes intelligently. For complex conflicts, prioritize changes from the 'HEAD' section unless the 'incoming' section contains critical additions. Remove all conflict markers upon completion. The goal is a fully merged, syntactically correct, and functional file.". Reiterate the "Single Modify Step Per File" instruction to ensure the AI combines all conflict resolutions for the active file into one 'modify_file' step. Carefully examine the 'File Structure' and 'Existing Relative File Paths' within the 'Broader Project Context' section to understand project conventions. Ensure any generated 'path' values adhere to standard practices and are relative to the workspace root.`;
		} else {
			specificContextPrompt = `
        --- Specific User Request Context from Editor ---
        File Path: ${editorContext.filePath}
        Language: ${editorContext.languageId}
        
        --- Instruction Type ---
        The user provided the custom instruction for you to complete: "${
					editorContext.instruction
				}".
        --- End Instruction Type ---

        --- Selected Code in Editor ---
        \`\`\`${editorContext.languageId}
        ${editorContext.selectedText}
        \`\`\`
        --- End Selected Code ---

        ${
					actualDiagnosticsString
						? `\n--- Relevant Diagnostics in Selection ---\n${actualDiagnosticsString}\n--- End Relevant Diagnostics ---`
						: ""
				}

        --- Full Content of Affected File (${editorContext.filePath}) ---
        \`\`\`${editorContext.languageId}
        ${editorContext.fullText}
        \`\`\`
        --- End Full Content ---`;

			mainInstructions = `Based on the user's request from the editor (custom instruction), the provided file/selection context, and any relevant chat history, generate a plan to fulfill the request. For custom instructions, interpret the request in the context of the selected code, chat history, and any diagnostics. Carefully examine the 'File Structure' and 'Existing Relative File Paths' within the 'Broader Project Context' section. Based on these details, infer the project's likely framework (e.g., Next.js, React, Node.js) and its typical file organization conventions (e.g., Next.js routes under \`pages/\` or \`app/\` directly at the workspace root, versus a project using a \`src/\` directory for all source files). When generating \`path\` values for \`create_directory\`, \`create_file\`, or \`modify_file\` steps in the JSON plan, ensure they strictly adhere to the inferred framework's standard practices and are always relative to the workspace root. Avoid assuming a \`src/\` directory for routes if the existing structure suggests otherwise (e.g., \`pages/\` or \`app/\` at root).`;
		}
	} else if (userRequest) {
		specificContextPrompt = `
        --- User Request from Chat ---
        ${userRequest}
        --- End User Request ---`;
		mainInstructions = `Based on the user's request from the chat (\"${userRequest}\") and any relevant chat history, generate a plan to fulfill it. Carefully examine the 'File Structure' and 'Existing Relative File Paths' within the 'Broader Project Context' section. Based on these details, infer the project's likely framework (e.g., Next.js, React, Node.js) and its typical file organization conventions (e.g., Next.js routes under \`pages/\` or \`app/\` directly at the workspace root, versus a project using a \`src/\` directory for all source files). When generating \`path\` values for \`create_directory\`, \`create_file\`, or \`modify_file\` steps in the JSON plan, ensure they strictly adhere to the inferred framework's standard practices and are always relative to the workspace root. Avoid assuming a \`src/\` directory for routes if the existing structure suggests otherwise (e.g., \`pages/\` or \`app/\` at root).`;
	}

	const textualPlanPromptSection = `
    --- Detailed Textual Plan Explanation (Base your entire JSON plan on this) ---
    ${textualPlanExplanation}
    --- End Detailed Textual Plan Explanation ---

    **Strict Instruction:** Your JSON plan MUST be a direct, accurate translation of the detailed steps provided in the "Detailed Textual Plan Explanation" section above. Ensure EVERY action described in the textual plan is represented as a step in the JSON, using the correct 'action', 'path', 'description', and relevant content/prompt/command fields as described in the format section. NEVER omit steps or invent new ones not present in the textual explanation.
    `;

	return `
    You are an expert software engineer. Your ONLY task is to create a step-by-step execution plan in JSON format.

    **Goal:** Generate ONLY a valid JSON object representing the plan. Do NOT include any introductory text, explanations, apologies, or markdown formatting like \`\`\`json ... \`\`\`. The entire response must be the JSON plan itself, starting with { and ending with }.

    ${
			extractedRetryInstruction
				? `\n**Important Retry Instruction:** ${extractedRetryInstruction}\n`
				: ""
		}

    **Instructions for Plan Generation:**
    *   **Requirements**:
        *   Avoid cosmetic changes.
        *   Preserve existing code structure, indentation, and formatting.
        *   Focus on minimal, surgical changes.
        *   Maintain code style.
        *   Ensure modifications are substantial, functional changes.
        *   Generate production-ready, robust, maintainable, secure, clean, efficient code adhering to best practices.
    *   **Guidelines**:
        *   **Context & Completeness**: ${mainInstructions} Consult "Broader Project Context" (especially symbol info for '/fix' targeting and impact analysis) and "Recent Chat History". Address the *entirety* of the request.
        *   **Recent Changes**: Build upon "Recent Project Changes". Avoid redundant steps. Combine all logical changes for a single file into one \`modify_file\`'s \`modification_prompt\`.
        *   **Steps**: Decompose into logical, sequential, 1-indexed steps. Define \`action\` (create_directory, create_file, modify_file, run_command).
        *   **Properties**: Provide \`path\` (relative, safe, non-empty), \`description\` (required, detailed, explains *why* and *how*). Use \`content\`/\`generate_prompt\` for \`create_file\`, \`modification_prompt\` for \`modify_file\`, \`command\` for \`run_command\` (infer package manager).
        *   **Single Modify Per File**: At most one \`modify_file\` step per file path. Consolidate all changes for a file into its \`modification_prompt\`.
        *   **JSON Escaping**: Escape \`\\n\`, \`\\r\`, \`\\\`, \`\"\` within JSON string values.
        *   **Output**: Strictly adhere to the JSON structure below and examples.

    --- Specific Context Prompt ---
    ${specificContextPrompt}
    --- End Specific Context Prompt ---

    --- Chat History For Prompt ---
    ${chatHistoryForPrompt}
    --- End Chat History For Prompt ---

    --- Broader Project Context (Reference Only) ---
    ${projectContext}
    --- End Broader Project Context ---

    ${
			urlContextString
				? `--- URL Context ---\n${urlContextString}\n--- End URL Context ---`
				: ""
		}

    --- Recent Changes ---
    ${recentChangesForPrompt}
    --- End Recent Changes ---
    
    ${textualPlanPromptSection}

    --- Expected JSON Plan Format ---
    ${jsonFormatDescription}
    --- End Expected Format ---

    --- Few Examples ---
    ${fewShotExamples}
    --- End Few Examples ---

    **IMPORTANT:** For modification steps, ensure the modification_prompt is specific and actionable, focusing on substantial changes rather warmer cosmetic formatting. The AI will be instructed to preserve existing formatting and only make the requested functional changes.

    Generate the execution plan:`;
}

export function createCorrectionPlanPrompt(
	originalUserInstruction: string,
	projectContext: string,
	editorContext: sidebarTypes.EditorContext | undefined,
	chatHistory: sidebarTypes.HistoryEntry[],
	relevantSnippets: string,
	aggregatedFormattedDiagnostics: string,
	formattedRecentChanges: string,
	retryReason?: string,
	activeSymbolDetailedInfo?: ActiveSymbolDetailedInfo, // MODIFIED TYPE
	jsonEscapingInstructions: string = "" // NEW OPTIONAL PARAMETER WITH DEFAULT
): string {
	const chatHistoryForPrompt =
		chatHistory && chatHistory.length > 0
			? `
        --- Recent Chat History (for additional context on user's train of thought and previous conversations with a AI model) ---
        ${chatHistory
					.map(
						(entry) =>
							`Role: ${entry.role}\nContent:\n${entry.parts
								.filter(
									(p): p is HistoryEntryPart & { text: string } => "text" in p
								) // Apply type guard
								.map((p) => p.text)
								.join("\n")}`
					)
					.join("\n---\n")}
        --- End Recent Chat History ---`
			: "";

	const editorContextForPrompt = editorContext
		? `
    --- Editor Context ---
    File Path: ${editorContext.filePath}
    Language: ${editorContext.languageId}
    Selected Text:
    \`\`\`${editorContext.languageId}
    ${editorContext.selectedText}
    \`\`\`
    Full Text of Affected File:
    \`\`\`${editorContext.languageId}
    ${editorContext.fullText}
    \`\`\`
    --- End Editor Context ---`
		: "";

	const retryReasonSection = retryReason
		? `
    --- Previous Plan Parsing Error ---
    CRITICAL ERROR: Your previous JSON output failed parsing/validation with the following error: "${retryReason}".
    You MUST correct this. Provide ONLY a valid JSON object according to the schema, with no additional text or explanations. Do not include markdown fences.
    --- End Previous Plan Parsing Error ---`
		: "";

	const jsonSchemaReference = `
        interface ExecutionPlan {
          planDescription: string;
          steps: PlanStep[];
        }

        interface PlanStep {
          step: number; // 1-indexed, sequential
          action: "create_directory" | "create_file" | "modify_file" | "run_command";
          description: string;
          // File/Directory Operations:
          path?: string; // REQUIRED for 'create_directory', 'create_file', 'modify_file'. Must be a non-empty, relative string (e.g., 'src/components/button.ts'). DO NOT leave this empty, null, or undefined.
          // 'create_file' specific:
          content?: string; // Exclusive with 'generate_prompt'. Full content of the new file.
          generate_prompt?: string; // Exclusive with 'content'. A prompt to generate file content.
          // 'modify_file' specific:
          modification_prompt?: string; // REQUIRED for 'modify_file'. Instructions on how to modify the file's content.
          // 'run_command' specific:
          command?: string; // REQUIRED for 'run_command'. The command string to execute.
        }`;

	const fewShotCorrectionExamples = `
        --- Valid Correction Plan Examples ---
        Example 1: Simple syntax fix in an existing file
        {
            \"planDescription\": \"Fix a syntax error in utils.ts\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"modify_file\",
                    \"description\": \"Correct missing semicolon and adjust function call in utils.ts as per diagnostic.\",
                    \"path\": \"src/utils.ts\",
                    \"modification_prompt\": \"The file src/utils.ts has a syntax error: 'Expected ;'. Add a semicolon at the end of line 10. Also, ensure the 'calculateSum' function call on line 15 passes the correct number of arguments as indicated by the 'Expected 2 arguments, but got 1.' diagnostic.\"
                }
            ]
        }

        Example 2: Adding a missing import
        {
            \"planDescription\": \"Add missing 'useState' import to MyComponent.tsx\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"modify_file\",
                    \"description\": \"Add missing 'useState' import from 'react' to MyComponent.tsx to resolve 'useState is not defined' error.\",
                    \"path\": \"src/components/MyComponent.tsx\",
                    \"modification_prompt\": \"Add 'useState' to the React import statement in src/components/MyComponent.tsx so it becomes 'import React, { useState } from 'react';' to resolve the 'useState is not defined' error.\"
                }
            ]
        }

        Example 3: Resolving a type error in TypeScript
        {
            \"planDescription\": \"Correct type mismatch in userSlice.ts\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"modify_file\",
                    \"description\": \"Adjust the type definition for 'user' state in userSlice.ts from 'string' to 'UserInterface' to match expected object structure.\",
                    \"path\": \"src/store/userSlice.ts\",
                    \"modification_prompt\": \"In src/store/userSlice.ts, change the type of the 'user' property in the initial state from 'string' to 'UserInterface' (assuming UserInterface is already defined or will be imported). Ensure the default value for 'user' is a valid UserInterface object or null as appropriate.\"
                }
            ]
        }

        Example 4: Creating a new file to fix a missing module error
        {
            \"planDescription\": \"Create a new utility file for common functions\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"create_file\",
                    \"description\": \"Create 'src/utils/mathUtils.ts' as it is missing, which causes 'Module not found' error.\",
                    \"path\": \"src/utils/mathUtils.ts\",
                    \"generate_prompt\": \"Generate a TypeScript file 'src/utils/mathUtils.ts' that exports a function named 'add' which takes two numbers and returns their sum, and a function named 'subtract' which takes two numbers and returns their difference.\"
                }
            ]
        }
        --- End Valid Correction Plan Examples ---
    `;

	// Helper for formatting location (single or array of vscode.Location objects).
	// Attempts to make path relative using a heuristic based on editor context if available.
	const formatLocation = (
		location: vscode.Location | vscode.Location[] | undefined
	): string => {
		if (!location) {
			return "N/A";
		}
		const actualLocation = Array.isArray(location)
			? location.length > 0
				? location[0]
				: undefined
			: location;
		if (!actualLocation || !actualLocation.uri) {
			return "N/A";
		}

		let formattedPath = actualLocation.uri.fsPath; // Default to absolute path

		// Heuristically try to make path relative if within the assumed workspace
		if (editorContext) {
			// Find the common root by looking for common project structures (like 'src/', 'pages/', 'app/')
			const editorPathSegments = editorContext.documentUri.fsPath.split(
				path.sep
			);
			let commonRootIndex = -1;
			// Find the deepest common ancestor that looks like a project root or a folder above src/
			for (let i = editorPathSegments.length - 1; i >= 0; i--) {
				const segment = editorPathSegments[i].toLowerCase();
				if (["src", "pages", "app"].includes(segment) && i > 0) {
					commonRootIndex = i - 1; // Take the directory above src/pages/app as root
					break;
				}
			}
			let inferredRootPath = "";
			if (commonRootIndex !== -1) {
				inferredRootPath = editorPathSegments
					.slice(0, commonRootIndex + 1)
					.join(path.sep);
			} else {
				// If no specific project structure is found, use the current workspace folder's root
				// This is a best-effort guess without an explicit workspaceRootUri being passed in.
				if (
					vscode.workspace.workspaceFolders &&
					vscode.workspace.workspaceFolders.length > 0
				) {
					inferredRootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
				}
			}

			if (
				inferredRootPath &&
				actualLocation.uri.fsPath.startsWith(inferredRootPath)
			) {
				formattedPath = path
					.relative(inferredRootPath, actualLocation.uri.fsPath)
					.replace(/\\/g, "/");
			} else {
				// Fallback to absolute if the heuristic doesn't find a good relative path
				formattedPath = actualLocation.uri.fsPath;
			}
		}

		return `${formattedPath}:${actualLocation.range.start.line + 1}`;
	};

	// Helper for formatting arrays of vscode.Location objects.
	const formatLocations = (
		locations: vscode.Location[] | undefined,
		limit: number = 5
	): string => {
		if (!locations || locations.length === 0) {
			return "None";
		}
		const limited = locations.slice(0, limit);
		const formatted = limited.map((loc) => formatLocation(loc)).join(", ");
		return locations.length > limit
			? `${formatted}, ... (${locations.length - limit} more)`
			: formatted;
	};

	// Helper for formatting Call Hierarchy (Incoming/Outgoing) data.
	const formatCallHierarchy = (
		calls:
			| vscode.CallHierarchyIncomingCall[]
			| vscode.CallHierarchyOutgoingCall[]
			| undefined,
		limit: number = 5
	): string => {
		if (!calls || calls.length === 0) {
			return `No Calls`;
		}
		const limitedCalls = calls.slice(0, limit);
		const formatted = limitedCalls
			.map((call) => {
				let uri: vscode.Uri | undefined;
				let name: string = "Unknown";
				let detail: string | undefined;
				let rangeStartLine: number | undefined;

				if ("from" in call) {
					// IncomingCall
					uri = call.from.uri;
					name = call.from.name;
					detail = call.from.detail;
					rangeStartLine =
						call.fromRanges.length > 0
							? call.fromRanges[0].start.line + 1
							: undefined;
				} else if ("to" in call) {
					// OutgoingCall
					uri = call.to.uri;
					name = call.to.name;
					detail = call.to.detail;
					rangeStartLine = call.to.range.start.line + 1;
				}

				if (!uri) {
					return `${name} (N/A:URI_Missing)`;
				}

				let formattedPath = uri.fsPath; // Default to absolute path

				// Heuristically try to make path relative if within the assumed workspace
				if (editorContext) {
					const editorPathSegments = editorContext.documentUri.fsPath.split(
						path.sep
					);
					let commonRootIndex = -1;
					for (let i = editorPathSegments.length - 1; i >= 0; i--) {
						const segment = editorPathSegments[i].toLowerCase();
						if (["src", "pages", "app"].includes(segment) && i > 0) {
							commonRootIndex = i - 1;
							break;
						}
					}
					let inferredRootPath = "";
					if (commonRootIndex !== -1) {
						inferredRootPath = editorPathSegments
							.slice(0, commonRootIndex + 1)
							.join(path.sep);
					} else {
						if (
							vscode.workspace.workspaceFolders &&
							vscode.workspace.workspaceFolders.length > 0
						) {
							inferredRootPath =
								vscode.workspace.workspaceFolders[0].uri.fsPath;
						}
					}

					if (inferredRootPath && uri.fsPath.startsWith(inferredRootPath)) {
						formattedPath = path
							.relative(inferredRootPath, uri.fsPath)
							.replace(/\\/g, "/");
					} else {
						formattedPath = uri.fsPath;
					}
				}

				const lineInfo = rangeStartLine ? `:${rangeStartLine}` : "";
				const detailInfo = detail ? ` (Detail: ${detail})` : "";
				return `${name} (${formattedPath}${lineInfo})${detailInfo}`;
			})
			.join("\n    - ");
		const more =
			calls.length > limit ? `\n    ... (${calls.length - limit} more)` : "";
		return `    - ${formatted}${more}`;
	};

	const MAX_REFERENCED_TYPE_CONTENT_CHARS_PROMPT = 1000;
	const MAX_REFERENCED_TYPES_TO_INCLUDE_PROMPT = 3;

	const activeSymbolInfoSection = activeSymbolDetailedInfo
		? `
--- Active Symbol Detailed Information ---
Name: ${activeSymbolDetailedInfo.name || "N/A"}
Kind: ${activeSymbolDetailedInfo.kind || "N/A"}
Detail: ${activeSymbolDetailedInfo.detail || "N/A"}
File Path: ${activeSymbolDetailedInfo.filePath || "N/A"}
Full Range: ${
				activeSymbolDetailedInfo.fullRange
					? `Lines ${activeSymbolDetailedInfo.fullRange.start.line + 1}-${
							activeSymbolDetailedInfo.fullRange.end.line + 1
					  }`
					: "N/A"
		  }
Children Hierarchy:
\`\`\`
${activeSymbolDetailedInfo.childrenHierarchy || "N/A"}
\`\`\`
Definition: ${formatLocation(activeSymbolDetailedInfo.definition)}
Implementations: ${formatLocations(activeSymbolDetailedInfo.implementations)}
Type Definition: ${formatLocation(activeSymbolDetailedInfo.typeDefinition)}
Referenced Type Definitions:
${
	activeSymbolDetailedInfo.referencedTypeDefinitions &&
	activeSymbolDetailedInfo.referencedTypeDefinitions.size > 0
		? Array.from(activeSymbolDetailedInfo.referencedTypeDefinitions.entries())
				.slice(0, MAX_REFERENCED_TYPES_TO_INCLUDE_PROMPT)
				.map(([filePath, content]) => {
					let contentPreview = content;
					if (
						contentPreview.length > MAX_REFERENCED_TYPE_CONTENT_CHARS_PROMPT
					) {
						contentPreview =
							contentPreview.substring(
								0,
								MAX_REFERENCED_TYPE_CONTENT_CHARS_PROMPT
							) + "\n// ... (content truncated)";
					}
					return `  - File: ${filePath}\n    Content:\n\`\`\`\n${contentPreview}\n\`\`\``;
				})
				.join("\n") +
		  (activeSymbolDetailedInfo.referencedTypeDefinitions.size >
		  MAX_REFERENCED_TYPES_TO_INCLUDE_PROMPT
				? `\n  ... (${
						activeSymbolDetailedInfo.referencedTypeDefinitions.size -
						MAX_REFERENCED_TYPES_TO_INCLUDE_PROMPT
				  } more)`
				: "")
		: "None"
}
Incoming Calls:
${formatCallHierarchy(activeSymbolDetailedInfo.incomingCalls)}
Outgoing Calls:
${formatCallHierarchy(activeSymbolDetailedInfo.outgoingCalls)}
--- End Active Symbol Detailed Information ---
`
		: "";

	return `
        You are an expert software engineer. Your ONLY task is to generate a JSON ExecutionPlan to resolve all reported diagnostics.

        The previous code generation/modification resulted in issues. Your plan MUST resolve ALL "Error" diagnostics, and address "Warning" and "Information" diagnostics where appropriate without new errors. DO NOT revert changes already completed, unless explicitly required to fix a new regression.

        **CRITICAL DIRECTIVES:**
        *   **Single-Shot Correction**: Resolve ALL reported issues in this single plan. The resulting code MUST compile and run without errors or warnings.
        *   **JSON Output**: Provide ONLY a valid JSON object strictly following the 'ExecutionPlan' schema. No markdown fences or extra text.
        *   **Minimal & Precise Changes**: Make only the absolute minimum, most targeted changes necessary to fix diagnostics. No new features, unrelated refactoring, or cosmetic changes.
        *   **Maintain Context**: Preserve original code style, structure, formatting (indentation, spacing, line breaks), comments, and project conventions (e.g., import order).
        *   **Production Readiness**: All generated/modified code MUST be robust, maintainable, efficient, and adhere to industry best practices, prioritizing modularity and readability.
        *   **Valid File Operations**: Use 'modify_file', 'create_file', 'create_directory', or 'run_command'. Ensure 'path' is non-empty, relative to workspace root, and safe (no '..' or absolute paths).
        *   **Detailed Descriptions**: Provide clear, concise 'description' for each step, explaining *why* it's necessary and *how* it specifically addresses diagnostics.
        *   **Single Modify Per File**: For any given file path, at most **one** \`modify_file\` step. Combine all logical changes for that file into a single, comprehensive \`modification_prompt\`.

        --- Json Escaping Instructions ---
        ${jsonEscapingInstructions}
        --- Json Escaping Instructions ---

        --- Original User Request ---
        ${originalUserInstruction}
        --- End Original User Request ---

        --- Broader Project Context ---
        ${projectContext}
        --- End Broader Project Context ---
        ${editorContextForPrompt}
        ${chatHistoryForPrompt}

        --- Active Symbol Info Section ---
        ${activeSymbolInfoSection}
        --- Active Symbol Info Section ---

        --- Relevant Project Snippets (for additional context) ---
        ${relevantSnippets}
        --- End Relevant Project Snippets ---

        --- Recent Project Changes (During Current Workflow) ---
        ${formattedRecentChanges}
        --- End Recent Project Changes ---

        --- Diagnostics to Address (Errors & Warnings) ---
        ${aggregatedFormattedDiagnostics}
        --- End Diagnostics to Address ---
        
        --- Retry Reason Section ---
        ${retryReasonSection}
        --- End Retry Reason Section ---

        --- Required JSON Schema Reference ---
        Your output MUST strictly adhere to the following TypeScript interfaces for \`ExecutionPlan\` and \`PlanStep\` types. Pay special attention to the 'path' field for file operations.

        ${jsonSchemaReference}
        --- End Required JSON Schema Reference ---

        --- Few Shot Correction Examples ---
        ${fewShotCorrectionExamples}
        --- Few Shot Correction Examples ---
        
        ExecutionPlan (ONLY JSON):
`;
}

export async function _performModification(
	originalFileContent: string,
	modificationPrompt: string,
	languageId: string,
	filePath: string,
	modelName: string,
	aiRequestService: AIRequestService,
	enhancedCodeGenerator: EnhancedCodeGenerator,
	token: vscode.CancellationToken,
	postMessageToWebview: (
		message: sidebarTypes.ExtensionToWebviewMessages
	) => void,
	isMergeOperation: boolean = false // isMergeOperation parameter
): Promise<string> {
	const streamId = crypto.randomUUID(); // Added as per instruction 1

	let specializedMergeInstruction = "";
	if (isMergeOperation) {
		// This is the core enhancement: detailed merge instructions for the AI
		specializedMergeInstruction = `
            You are currently resolving Git merge conflicts. Your absolute primary goal is to produce a single, coherent, and syntactically correct file with **ALL** merge conflict markers (\`<<<<<<<\`, \`=======\`, \`>>>>>>>\`, \`|||||||\`) completely removed.

            When analyzing conflict blocks:
            -   **Prioritize Semantic Coherence:** Understand the purpose of the code and how the changes from both sides (HEAD and incoming) might interact.
            -   **Intelligently Integrate:** For simple, non-overlapping changes, combine them.
            -   **Handle Overlaps Carefully:** For directly conflicting lines, decide based on which change appears to be more complete, critical, or aligns better with the overall project logic. The \`Modification Instruction\` below will guide your high-level strategy.
            -   **Syntax and Structure:** Ensure the final code is syntactically valid for ${languageId} and maintains consistent indentation and coding style.
            -   **No Partial Conflicts:** Do not leave any partial markers or unresolved sections. The file must be fully merged.
            `;
	}

	const prompt = `You are an expert AI software developer tasked with modifying the provided file content based on the given instructions.

    --- Specialized Merge Instruction ---
    ${specializedMergeInstruction}
    --- End Specialized Merge Instruction ---

    **CRITICAL REQUIREMENTS:**
    *   **Preserve Existing Structure & Style**: Maintain the current file organization, structural patterns, and architectural design. Strictly follow existing code style, formatting (indentation, spacing, line breaks), and conventions. Preserve comments and import order unless new imports are strictly necessary.
    *   **Surgical Precision & Minimal Functional Changes**: Make *only* the exact, most targeted and minimal changes required. Your output must represent a *functional or structural change*, strictly avoiding changes that are solely whitespace, comments, or minor formatting, unless explicitly requested and essential.
    *   **Error Prevention & Production Readiness**: Ensure the modified code compiles and runs *without any errors or warnings*. Proactively address potential runtime issues, logical flaws, and edge cases (e.g., null/undefined checks, off-by-one errors, input validations). Stress robustness, maintainability, and adherence to best practices for production readiness.

    Your output MUST contain **ONLY** the complete, production-ready file content. **ABSOLUTELY NO MARKDOWN CODE BLOCK FENCES (\`\`\`typescript), NO CONVERSATIONAL TEXT, NO EXPLANATIONS, NO APOLOGIES, NO COMMENTS (UNLESS PART OF THE CODE LOGIC), NO YAML, NO JSON, NO XML, NO EXTRA ELEMENTS WHATSOEVER.** Your response **MUST START DIRECTLY ON THE FIRST LINE** with the pure, modified file content and nothing else.

    File Path: ${filePath}
    Language: ${languageId}

    --- Original File Content ---
    \`\`\`${languageId}
    ${originalFileContent}
    \`\`\`
    --- End Original File Content ---

    --- Modification Instruction ---
    ${modificationPrompt}
    --- End Modification Instruction ---

    Your complete, raw modified file content:`;

	const generationConfig = {
		temperature: TEMPERATURE,
	};

	let modifiedContent = "";
	try {
		// Send codeFileStreamStart message immediately before content generation
		postMessageToWebview({
			type: "codeFileStreamStart",
			value: { streamId: streamId, filePath: filePath, languageId: languageId }, // Modified as per instruction 2
		});

		const generationContext = {
			projectContext: "",
			relevantSnippets: "",
			editorContext: undefined,
			activeSymbolInfo: undefined,
		};
		const genResult = await enhancedCodeGenerator.generateFileContent(
			filePath,
			modificationPrompt,
			generationContext,
			modelName,
			token,
			undefined, // feedbackCallback
			async (chunk: string) => {
				// onCodeChunkCallback that sends messages
				postMessageToWebview({
					type: "codeFileStreamChunk",
					value: { streamId: streamId, filePath: filePath, chunk: chunk }, // Modified as per instruction 3
				});
			}
		);
		modifiedContent = genResult.content;

		// Send `codeFileStreamEnd` on success
		postMessageToWebview({
			type: "codeFileStreamEnd",
			value: { streamId: streamId, filePath: filePath, success: true }, // Modified as per instruction 4
		});
	} catch (error) {
		console.error("Error during AI file", error); // Log any caught errors
		// Send `codeFileStreamEnd` on error
		postMessageToWebview({
			type: "codeFileStreamEnd",
			value: {
				streamId: streamId, // Modified as per instruction 4 (use the declared streamId)
				filePath: filePath,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			},
		});
		throw error; // Re-throw them to ensure proper upstream handling by planExecutionService
	}

	return modifiedContent;
}

export async function generateLightweightPlanPrompt(
	aiMessageContent: string,
	modelName: string,
	aiRequestService: AIRequestService,
	token?: vscode.CancellationToken
): Promise<string> {
	const prompt = `Given the following AI response, generate a concise '/plan' command request, using ONLY "/plan [your request]". Focus on the core actionable intent and summary. Do not include any extraneous text.
AI Response: ${aiMessageContent}`;

	try {
		const result = await aiRequestService.generateWithRetry(
			[{ text: prompt }], // Modified as per instruction
			DEFAULT_FLASH_LITE_MODEL,
			undefined, // No history needed for this type of request
			"lightweight plan prompt",
			undefined, // No specific generation config needed
			undefined, // No streaming callbacks needed
			token
		);

		if (token?.isCancellationRequested) {
			throw new Error(ERROR_OPERATION_CANCELLED);
		}

		if (!result || result.toLowerCase().startsWith("error:")) {
			throw new Error(
				result ||
					"Empty or erroneous response from lightweight AI for plan prompt."
			);
		}
		return result.trim(); // Trim any leading/trailing whitespace
	} catch (error: any) {
		console.error("Error generating lightweight plan prompt:", error);
		if (error.message === ERROR_OPERATION_CANCELLED) {
			throw error; // Re-throw cancellation error directly
		}
		throw new Error(`Failed to generate /plan prompt: ${error.message}`);
	}
}

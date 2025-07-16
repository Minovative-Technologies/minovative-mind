import * as sidebarTypes from "../common/sidebarTypes";
import * as vscode from "vscode";
import { TEMPERATURE } from "../common/sidebarConstants";
import { AIRequestService } from "../../services/aiRequestService";

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
			instructionType = `The user triggered the '/fix' command on the selected code, which means you need to fix the code so there are no more bugs to fix.`;
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
						.map((p) => p.text)
						.join("\n")}`
			)
			.join("\n---\n")}
    --- End Recent Chat History ---`
			: "";

	return `
    You are an expert senior software engineer. Your task is to ONLY explain your plan to fulfill the user's request.

    **Goal:** Provide a clear, readable, step-by-step explanation of your plan in great detail no matter what. Use Markdown formatting for clarity (e.g., bullet points, numbered lists, bold text for emphasis).

    **Instructions for Plan Explanation:**
    1.  Analyze Request & Context: ${mainInstructions}. Use the broader project context below for reference. The broader project context includes '**detailed symbol information** to help you understand code structure and relationships.'. ${
		editorContext && diagnosticsString
			? "**Pay very close attention to the 'Relevant Diagnostics' section and ensure your textual plan describes, in great detail, how you will address them for '/fix' requests.**"
			: ""
	}
    2.  **Be Comprehensive:** Your explanation should cover all necessary steps to achieve the user's goal.
    3.  Clarity: Make the plan easy for a junior developer to understand. Briefly describe what each step will do (e.g., "Create a new file named 'utils.ts'", "Modify 'main.ts' to import the new utility function", "Install the 'axios' package using npm").
    4.  No JSON: **Do NOT output any JSON for this initial explanation.** Your entire response should be human-readable text.
    5. ALWAYS keep in mind of modularization to make sure everything stays organized and easy to maintain for the developers.
    6. Generate production-ready code for the following task. Prioritize robustness, maintainability, and security. The code must be clean, efficient, and follow all industry best practices.


    Specific Context: ${specificContextPrompt}

    Chat History: ${chatHistoryForPrompt}

    ${urlContextString ? `URL Context: ${urlContextString}` : ""}

    *** Broader Project Context (Reference Only) ***
    ${projectContext}
    *** End Broader Project Context ***

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
                "description": "What this step does. Make sure the step is as detailed as possible. **This field is ALWAYS required for every step no matter what.**",
                "path": "relative/path/to/target", // Required for file/dir ops. Relative to workspace root and user's project.
                "content": "...", // For create_file with direct content (string). Use ONLY this OR generate_prompt.
                "generate_prompt": "...", // For create_file, AI instruction to generate content (string). Use ONLY this OR content. Make sure the step is as detailed as possible.
                "modification_prompt": "...", // For modify_file, AI instruction to generate changes (string). Required. Make sure the step is as detailed as possible.
                "command": "..." // For run_command, the shell command to execute (string). Required.
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
        The user triggered the '/fix' command on the selected code, which means you need to fix the code so there are no more bugs to fix
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

	const planningInstructions = `
    You are an expert senior software engineer. Your task is to generate a detailed, step-by-step execution plan in JSON format.

    **CRITICAL PLANNING REQUIREMENTS:**
    1. **Avoid Cosmetic Changes**: When creating modification steps, ensure they only make substantial code changes, not cosmetic formatting or whitespace-only modifications
    2. **Preserve Existing Structure**: Modification prompts should preserve existing code structure, indentation, and formatting unless explicitly requested to change them
    3. **Minimal Invasiveness**: Focus on surgical precision - only modify what's necessary to achieve the goal
    4. **Maintain Code Style**: Respect the existing code style and conventions in the project
    5. **Substantial Modifications Only**: Ensure modification_prompt instructions result in meaningful code changes, not just reformatting

    **PLANNING GUIDELINES:**
    1. **Analyze Dependencies:** Consider how changes might affect other parts of the codebase. Generate
    2. **Ensure Completeness:** The generated steps **must collectively address the *entirety* of the user's request**. Do not leave out or exclude any requested actions or components. If a request is complex, break it into multiple smaller steps.
    3. **Consult Recent Project Changes:** Always consult the "Recent Project Changes (During Current Workflow Execution)" section. Your plan MUST build upon these prior changes. Avoid generating steps that redundantly re-create files already created, or redundantly modify files already changed in prior steps and whose desired state is reflected by that prior modification. Instead, if multiple logical changes are needed for one file, combine *all* those required modifications into a **single** \`modification_prompt\` for that file's \`modify_file\` step. This ensures efficiency and avoids unnecessary operations.
    4. Break Down: Decompose the request into logical, sequential steps. Number steps starting from 1.
    5. Specify Actions: For each step, define the 'action' (create_directory, create_file, modify_file, run_command).
    6. Detail Properties: Provide necessary details ('path', 'content', 'generate_prompt', 'modification_prompt', 'command') based on the action type, following the format description precisely. **Crucially, the 'description' field MUST be included and populated for EVERY step, regardless of the action type.** Ensure paths are relative and safe. For 'run_command', infer the package manager and dependency type correctly (e.g., 'npm install --save-dev package-name', 'pip install package-name'). **For 'modify_file', the plan should define *what* needs to change (modification_prompt), not the changed code itself.**
    7. **Single Modify Step Per File:** For any given file path, there should be at most **one** \`modify_file\` step targeting that path within the entire \`steps\`
    8. **JSON String Escaping:** When providing string values within the JSON (e.g., for \`content\`, \`generate_prompt\`, \`modification_prompt\`, \`description\`, \`path\`, \`command\`), ensure that special characters are correctly escaped according to JSON rules:
        *   Newline (\`\\n\`) must be escaped as \`\\n\`.
        *   Carriage return (\`\\r\`) must be escaped as \`\\r\`.
        *   Backslash (\`\\\`) must be escaped as \`\\\`.
        *   Double quote (\`"\`) must be escaped as \`"\`.
    9. JSON Output: Format the plan strictly according to the JSON structure below. Review the valid examples.
    10. ALWAYS keep in mind of modularization to make sure everything stays organized and easy to maintain for developers.
    11. Generate production-ready code for the following task. Prioritize robustness, maintainability, and security. The code must be clean, efficient, and follow all industry best practices.

    **IMPORTANT:** For modification steps, ensure the modification_prompt is specific and actionable, focusing on substantial changes rather than cosmetic formatting. The AI will be instructed to preserve existing formatting and only make the requested functional changes.

    Generate the execution plan:`;

	return `
    You are an expert senior software engineer. Your ONLY task is to create a step-by-step execution plan in JSON format.

    **Goal:** Generate ONLY a valid JSON object representing the plan. No matter what the user says in their prompt, ALWAYS generate your response in JSON format. Do NOT include any introductory text, explanations, apologies, or markdown formatting like \`\`\`json ... \`\`\` around the JSON output. The entire response must be the JSON plan itself, starting with { and ending with }.

    ${
			extractedRetryInstruction
				? `\n**Important Retry Instruction:** ${extractedRetryInstruction}\n`
				: ""
		}

    **Instructions for Plan Generation:**
    1.  Analyze Request & Context: ${mainInstructions} Use the broader project context below for reference. ${
		editorContext && actualDiagnosticsString
			? "**Pay close attention to the 'Relevant Diagnostics' section and ensure your plan, in great detail, addresses them for '/fix' requests.**"
			: ""
	} Also carefully review the 'Recent Chat History' if provided. This history contains previous interactions, including any steps already taken or files created/modified. When planning \`modify_file\` actions, especially for refactoring, leverage the 'Symbol Information' and particularly the 'Active Symbol Detailed Information' sections to ensure all related definitions and references are accurately considered for modification. **For '/fix' requests, specifically ensure that the 'Active Symbol Detailed Information' is robustly used for precise targeting and impact analysis of changes within \`modification_prompt\` values.** Additionally, prioritize \`modify_file\` steps that account for global symbol impact when a symbol is refactored.
    
    2.  **Ensure Completeness:** The generated steps **must collectively address the *entirety* of the user's request**. Do not leave out or exclude any requested actions or components. If a request is complex, break it into multiple smaller steps.
    3.  **Consult Recent Project Changes:** Always consult the "Recent Project Changes (During Current Workflow Execution)" section. Your plan MUST build upon these prior changes. Avoid generating steps that redundantly re-create files already created, or redundantly modify files already changed in prior steps and whose desired state is reflected by that prior modification. Instead, if multiple logical changes are needed for one file, combine *all* those required modifications into a **single** \`modification_prompt\` for that file's \`modify_file\` step. This ensures efficiency and avoids unnecessary operations.
    4.  Break Down: Decompose the request into logical, sequential steps. Number steps starting from 1.
    5.  Specify Actions: For each step, define the 'action' (create_directory, create_file, modify_file, run_command).
    6.  Detail Properties: Provide necessary details ('path', 'content', 'generate_prompt', 'modification_prompt', 'command') based on the action type, following the format description precisely. **Crucially, the 'description' field MUST be included and populated for EVERY step, regardless of the action type.** Ensure paths are relative and safe. For 'run_command', infer the package manager and dependency type correctly (e.g., 'npm install --save-dev package-name', 'pip install package-name'). **For 'modify_file', the plan should define *what* needs to change (modification_prompt), not the changed code itself.**
    7.  **Single Modify Step Per File:** For any given file path, there should be at most **one** \`modify_file\` step targeting that path within the entire \`steps\` array of the generated plan. If the user's request requires multiple logical changes to the same file, combine all those required modifications into the **single** \`modification_prompt\` for that file's \`modify_file\` step, describing all necessary changes comprehensively within that one prompt field.
    8.  **JSON String Escaping:** When providing string values within the JSON (e.g., for \`content\`, \`generate_prompt\`, \`modification_prompt\`, \`description\`, \`path\`, \`command\`), ensure that special characters are correctly escaped according to JSON rules:
        *   Newline (\`\\n\`) must be escaped as \`\\n\`.
        *   Carriage return (\`\\r\`) must be escaped as \`\\r\`.
        *   Backslash (\`\\\`) must be escaped as \`\\\`.
        *   Double quote (\`"\`) must be escaped as \`"\`.
    9.  JSON Output: Format the plan strictly according to the JSON structure below. Review the valid examples.
    10. ALWAYS keep in mind of modularization to make sure everything stays organized and easy to maintain for developers.
    11. Generate production-ready code for the following task. Prioritize robustness, maintainability, and security. The code must be clean, efficient, and follow all industry best practices.

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

    **IMPORTANT:** For modification steps, ensure the modification_prompt is specific and actionable, focusing on substantial changes rather than cosmetic formatting. The AI will be instructed to preserve existing formatting and only make the requested functional changes.

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
	retryReason?: string
): string {
	const chatHistoryForPrompt =
		chatHistory && chatHistory.length > 0
			? `
        --- Recent Chat History (for additional context on user's train of thought and previous conversations with a AI model) ---
        ${chatHistory
					.map(
						(entry) =>
							`Role: ${entry.role}\nContent:\n${entry.parts
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

	return `
        You are an expert senior software engineer. Your ONLY task is to generate a JSON ExecutionPlan to fix errors.

        The previous attempt to generate/modify code resulted in the following diagnostics across potentially multiple files. Your plan MUST resolve ALL reported diagnostics. DO NOT revert or change files that were already successfully modified or created during the current workflow execution, unless explicitly required to fix a new diagnostic reported below.

        **CRITICAL REQUIREMENTS TO AVOID COSMETIC CHANGES:**
        1. **Preserve Exact Formatting**: Maintain the existing indentation, spacing, and line breaks exactly as they are
        2. **No Whitespace-Only Changes**: Do not modify spaces, tabs, or line endings unless explicitly requested
        3. **Preserve Comments**: Keep all existing comments in their exact positions and formatting
        4. **Maintain Import Order**: Keep imports in their current order unless new imports are specifically needed
        5. **Preserve Code Style**: Do not reformat code or change coding style unless explicitly requested
        6. **Minimal Changes**: Make only the specific changes needed to fix the diagnostics, nothing more
        7. **Preserve Empty Lines**: Keep existing empty lines and paragraph breaks exactly as they are

        **SUBSTANTIAL CHANGES ONLY:**
        - Only modify code that directly addresses the reported diagnostics
        - Do not rewrite or reformat existing code that doesn't need changes
        - Preserve all existing functionality unless explicitly asked to change it
        - Maintain the exact same structure and organization

        Your plan MUST resolve ALL reported diagnostics by generating a valid ExecutionPlan in JSON format. For create_file and modify_file steps, ensure the path field is **non-empty, a relative string** (e.g., 'src/utils/myFile.ts') to the workspace root, and accurately reflects the file being acted upon. This path is critical for successful execution.

        **Single File, Single Step for Modifications (Critical for Corrections):** For any given file path, ensure there is at most **one** \`modify_file\` step targeting that path within the entire \`steps\` array of this correction plan. If multiple logical changes are required for the same file to fix diagnostics, combine *all* those modifications comprehensively into the **single** \`modification_prompt\` for that file's \`modify_file\` step.

        Your output MUST be ONLY a JSON object, with no conversational text, explanations, or markdown formatting (e.g., \`\`\`json\`).

        --- Original User Request ---
        ${originalUserInstruction}
        --- End Original User Request ---

        --- Broader Project Context ---
        ${projectContext}
        --- End Broader Project Context ---
        ${editorContextForPrompt}
        ${chatHistoryForPrompt}

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
        }

        --- End Required JSON Schema Reference ---

        When generating steps to resolve diagnostics, you must use the exact file paths indicated in the 'Diagnostics to Address' section for the \`path\` field of \`create_file\` and \`modify_file\` steps.

        **Key Requirements for your plan:**
        1.  **Resolve ALL Reported Diagnostics:** Every error and warning listed in the 'Diagnostics to Address' section MUST be resolved by your plan.
        2.  **No Reversion of Changes:** DO NOT revert any changes previously made during the current workflow unless the diagnostic explicitly indicates a regression that needs fixing. The 'Recent Project Changes (During Current Workflow)' section details these changes. **Consult the 'Recent Project Changes (During Current Workflow)' section to avoid redundant correction steps. Focus solely on resolving diagnostics that *persist* after prior modifications, and do not re-modify files if their desired state is already reflected by previous changes.**
        3.  **Output ONLY JSON:** Your response MUST be a single, valid JSON object for the ExecutionPlan, and nothing else.
        4.  **Production-Ready Code:** All modifications and new code generated must be production-ready, robust, maintainable, and secure. Emphasize modularity, readability, efficiency, and adherence to industry best practices and clean code principles.
        5.  **Adhere to Project Structure:** Consider the existing project structure, dependencies, and conventions inferred from the 'Broader Project Context' and 'Relevant Project Snippets'.
        
        ExecutionPlan (ONLY JSON):
`;
}

export async function _performModification(
	originalFileContent: string,
	modificationPrompt: string,
	languageId: string,
	filePath: string,
	modelName: string,
	aiRequestService: AIRequestService, // ApiKey: string, ADDED aiRequestService
	token: vscode.CancellationToken,
	isMergeOperation: boolean = false // isMergeOperation parameter
): Promise<string> {
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

	const prompt = `You are an expert AI software developer. Your task is to modify the provided file content based on the given instructions.

    --- Specialized Merge Instruction ---
    ${specializedMergeInstruction}
    --- End Specialized Merge Instruction ---

    **CRITICAL REQUIREMENTS TO AVOID COSMETIC CHANGES:**
    1. **Preserve Exact Formatting**: Maintain the existing indentation, spacing, and line breaks exactly as they are
    2. **No Whitespace-Only Changes**: Do not modify spaces, tabs, or line endings unless explicitly requested
    3. **Preserve Comments**: Keep all existing comments in their exact positions and formatting
    4. **Maintain Import Order**: Keep imports in their current order unless new imports are specifically needed
    5. **Preserve Code Style**: Do not reformat code or change coding style unless explicitly requested
    6. **Minimal Changes**: Make only the specific changes requested, nothing more
    7. **Preserve Empty Lines**: Keep existing empty lines and paragraph breaks exactly as they are

    **SUBSTANTIAL CHANGES ONLY:**
    - Only modify code that directly addresses the modification instructions
    - Do not rewrite or reformat existing code that doesn't need changes
    - Preserve all existing functionality unless explicitly asked to change it
    - Maintain the exact same structure and organization

    **Crucially, ensure the generated code is modular, readable, adheres to common coding standards for ${languageId}, and is production-ready, efficient, and maintainable.**

    You MUST ONLY return the complete modified file content. Do NOT include any conversational text, explanations, or markdown code blocks (e.g., \`\`\`typescript\\n...\\n\`\`\`):. Your response must start directly with the modified file content.

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
		modifiedContent = await aiRequestService.generateWithRetry(
			prompt,
			modelName,
			undefined, // history: pass undefined
			"file_modification", // requestType: optional, can be 'file_modification'
			generationConfig,
			{
				onChunk: (chunk) => {
					modifiedContent += chunk;
				}, // onChunk callback to accumulate content
				// onComplete: omit if awaiting the result, as generateWithRetry returns the full string
			},
			token,
			isMergeOperation
		);
	} catch (error) {
		console.error("Error during AI file", error); // Log any caught errors
		throw error; // Re-throw them to ensure proper upstream handling by planExecutionService
	}

	return modifiedContent;
}

// src/sidebar/services/aiInteractionService.ts
import { HistoryEntry, PlanGenerationContext } from "../common/sidebarTypes";
import * as vscode from "vscode";
import { generateContentStream } from "../../ai/gemini";
import { TEMPERATURE } from "../common/sidebarConstants";

export function createInitialPlanningExplanationPrompt(
	projectContext: string,
	userRequest?: string,
	editorContext?: PlanGenerationContext["editorContext"],
	diagnosticsString?: string,
	chatHistory?: HistoryEntry[]
): string {
	let specificContextPrompt = "";
	let mainInstructions = "";

	if (editorContext) {
		const instructionType =
			editorContext.instruction.toLowerCase() === "/fix"
				? `The user triggered the '/fix' command on the selected code, which means you need to fix the code so there are no more bugs to fix.`
				: `The user provided the custom instruction for you to complete for you to complete: "${editorContext.instruction}".`;

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

		mainInstructions = `Based on the user's request from the editor (${
			editorContext.instruction.toLowerCase() === "/fix"
				? "'/fix' command"
				: "custom instruction"
		}) and the provided file/selection context, and any relevant chat history, ONLY explain your step-by-step plan with as much detail as possible, to fulfill the request. For '/fix', the plan should ONLY clearly address the 'Relevant Diagnostics' listed. For custom instructions, interpret the request in the context of the selected code, chat history, and any diagnostics.`;
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

    *** Broader Project Context (Reference Only) ***
    ${projectContext}
    *** End Broader Project Context ***

    --- Plan Explanation (Text with Markdown) ---
`;
}

export function createPlanningPrompt(
	userRequest: string | undefined,
	projectContext: string,
	editorContext: PlanGenerationContext["editorContext"] | undefined,
	combinedDiagnosticsAndRetryString: string | undefined,
	chatHistory: HistoryEntry[] | undefined,
	textualPlanExplanation: string,
	recentChanges: string | undefined // Modified to accept pre-formatted string
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
                "action": "create_directory | create_file | modify_file | run_command",
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
		const instructionType =
			editorContext.instruction.toLowerCase() === "/fix"
				? `The user triggered the '/fix' command on the selected code, which means you need to fix the code so there are no more bugs to fix`
				: `The user provided the custom instruction for you to complete: "${editorContext.instruction}".`;

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
					actualDiagnosticsString
						? `\n--- Relevant Diagnostics in Selection ---\n${actualDiagnosticsString}\n--- End Relevant Diagnostics ---`
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
		}), the provided file/selection context, and any relevant chat history, generate a plan to fulfill the request. For '/fix', the plan should **prioritize addressing the specific 'Relevant Diagnostics' listed above**, potentially involving modifications inside or outside the selection, or even in other files (like adding imports). For custom instructions, interpret the request in the context of the selected code, chat history, and any diagnostics. Carefully examine the 'File Structure' and 'Existing Relative File Paths' within the 'Broader Project Context' section. Based on these details, infer the project's likely framework (e.g., Next.js, React, Node.js) and its typical file organization conventions (e.g., Next.js routes under \`pages/\` or \`app/\` directly at the workspace root, versus a project using a \`src/\` directory for all source files). When generating \`path\` values for \`create_directory\`, \`create_file\`, or \`modify_file\` steps in the JSON plan, ensure they strictly adhere to the inferred framework's standard practices and are always relative to the workspace root. Avoid assuming a \`src/\` directory for routes if the existing structure suggests otherwise (e.g., \`pages/\` or \`app/\` at root).`;
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
	} Also carefully review the 'Recent Chat History' if provided. This history contains previous interactions, including any steps already taken or files created/modified. Your plan MUST build upon these prior changes, avoid redundant operations (e.g., recreating existing files, reinstalling already installed dependencies), and correctly reference or import new entities (e.g., functions from newly created utility files) introduced in earlier steps or during the conversation. When planning \`modify_file\` actions, especially for refactoring, leverage the 'Symbol Information' section to ensure all related definitions and references are accurately considered for modification. Additionally, prioritize \`modify_file\` steps that account for global symbol impact when a symbol is refactored.
    
    2.  **Ensure Completeness:** The generated steps **must collectively address the *entirety* of the user's request**. Do not leave out or exclude any requested actions or components. If a request is complex, break it into multiple smaller steps.
    3.  Break Down: Decompose the request into logical, sequential steps. Number steps starting from 1.
    4.  Specify Actions: For each step, define the 'action' (create_directory, create_file, modify_file, run_command).
    5.  Detail Properties: Provide necessary details ('path', 'content', 'generate_prompt', 'modification_prompt', 'command') based on the action type, following the format description precisely. **Crucially, the 'description' field MUST be included and populated for EVERY step, regardless of the action type.** Ensure paths are relative and safe. For 'run_command', infer the package manager and dependency type correctly (e.g., 'npm install --save-dev package-name', 'pip install package-name'). **For 'modify_file', the plan should define *what* needs to change (modification_prompt), not the changed code itself.**
    6.  **JSON String Escaping:** When providing string values within the JSON (e.g., for \`content\`, \`generate_prompt\`, \`modification_prompt\`, \`description\`, \`path\`, \`command\`), ensure that special characters are correctly escaped according to JSON rules:
        *   Newline (\`\\n\`) must be escaped as \`\\n\`.
        *   Carriage return (\`\\r\`) must be escaped as \`\\r\`.
        *   Backslash (\`\\\`) must be escaped as \`\\\`.
        *   Double quote (\`"\`) must be escaped as \`"\`.
    7.  JSON Output: Format the plan strictly according to the JSON structure below. Review the valid examples.
    8. ALWAYS keep in mind of modularization to make sure everything stays organized and easy to maintain for developers.
    // Ensure only one modify_file step per file path
    9. **Single Modify Step Per File:** For any given file path, there should be at most **one** \`modify_file\` step targeting that path within the entire \`steps\` array of the generated plan. If the user's request requires multiple logical changes to the same file, combine all those required modifications into the **single** \`modification_prompt\` for that file's \`modify_file\` step, describing all necessary changes comprehensively within that one prompt field.
    6. Generate production-ready code for the following task. Prioritize robustness, maintainability, and security. The code must be clean, efficient, and follow all industry best practices.

    --- Specific Context Prompt ---
    ${specificContextPrompt}
    --- End Specific Context Prompt ---

    --- Chat History For Prompt ---
    ${chatHistoryForPrompt}
    --- End Chat History For Prompt ---

    --- Broader Project Context (Reference Only) ---
    ${projectContext}
    --- End Broader Project Context ---

    --- Recent Changes ---
    ${recentChangesForPrompt}
    --- End Recent Changes ---

    --- Textual Plan Prompt Section ---
    ${textualPlanPromptSection}
    --- End Textual Plan Prompt Section ---

    --- Expected JSON Plan Format ---
    ${jsonFormatDescription}
    --- End Expected Format ---

    --- Few Examples ---
    ${fewShotExamples}
    --- End Few Examples ---

    Execution Plan (ONLY JSON):
    `;
}

export async function _performModification(
	originalFileContent: string,
	modificationPrompt: string,
	languageId: string,
	filePath: string,
	modelName: string,
	apiKey: string,
	token: vscode.CancellationToken
): Promise<string> {
	const prompt = `You are an expert AI software developer. Your task is to modify the provided file content based on the given instructions.
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
	const contentStream = generateContentStream(
		apiKey,
		modelName,
		prompt,
		undefined,
		generationConfig,
		token
	);

	for await (const chunk of contentStream) {
		modifiedContent += chunk;
	}

	return modifiedContent;
}

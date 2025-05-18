// src/sidebar/services/aiInteractionService.ts
import { HistoryEntry, PlanGenerationContext } from "../common/sidebarTypes"; // Assuming PlanGenerationContext is correctly defined

export function createInitialPlanningExplanationPrompt(
	projectContext: string,
	userRequest?: string,
	editorContext?: PlanGenerationContext["editorContext"],
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
    6. ALWAYS keep in mind of Modularization for everything you create.

    ${specificContextPrompt}

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
	textualPlanExplanation: string
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

	const fewShotExamples = `
    --- Valid JSON Output Examples ---
    Example 1: A simple file creation with explicit content
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

    Example 3: Modifying a TypeScript file using a modification prompt
    {
        "planDescription": "Implement a new utility function.",
        "steps": [
            {
                "step": 1,
                "action": "modify_file",
                "description": "Add a new function 'formatDate' to the existing utils.ts file.",
                "path": "src/utils.ts",
                "modification_prompt": "Add a public function 'formatDate' that takes a Date object and returns a string in 'YYYY-MM-DD' format. Use existing helper functions if available, otherwise implement date formatting logic."
            }
        ]
    }

    Example 4: Creating a directory and a file with AI-generated content
    {
        "planDescription": "Set up a new component directory and create a component file.",
        "steps": [
            {
                "step": 1,
                "action": "create_directory",
                "description": "Create a directory for the new button component.",
                "path": "src/components/Button"
            },
            {
                "step": 2,
                "action": "create_file",
                "description": "Create the main TypeScript file for the Button component.",
                "path": "src/components/Button/Button.tsx",
                "generate_prompt": "Generate a basic React functional component in TypeScript named 'Button' that accepts children and props for handling click events. Include necessary imports."
            }
        ]
    }

    Example 5: Running multiple commands and modifying a file
    {
        "planDescription": "Update dependencies and apply formatting.",
        "steps": [
            {
                "step": 1,
                "action": "run_command",
                "description": "Update all npm dependencies.",
                "command": "npm update"
            },
            {
                "step": 2,
                "action": "run_command",
                "description": "Run code formatter across the project.",
                "command": "npx prettier --write ."
            },
            {
                "step": 3,
                "action": "modify_file",
                "description": "Update version number in package.json (optional).",
                "path": "package.json",
                "modification_prompt": "Increase the patch version in the 'version' field of this package.json file."
            }
        ]
    }

    Example 6: Creating a file with content from a prompt and adding a simple configuration file
    {
        "planDescription": "Add a new service and update its configuration.",
        "steps": [
            {
                "step": 1,
                "action": "create_file",
                "description": "Create a new API service file.",
                "path": "src/services/apiService.js",
                "generate_prompt": "Write a JavaScript service using async/await and fetch API to make GET and POST requests to a configurable endpoint."
            },
            {
                "step": 2,
                "action": "create_file",
                "description": "Create a configuration file for the API service.",
                "path": "src/config/api.config.json",
                "content": "{\\n  \\"apiUrl\\": \\"https://api.example.com/v1\\"\\n}"
            }
        ]
    }

    --- End Valid JSON Output Examples ---
`;

	const chatHistoryForPrompt =
		chatHistory && chatHistory.length > 0
			? `
    --- Recent Chat History (for additional context on user's train of thought and previous interactions) ---
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
		}), the provided file/selection context, and any relevant chat history, generate a plan to fulfill the request. For '/fix', the plan should **prioritize addressing the specific 'Relevant Diagnostics' listed above**, potentially involving modifications inside or outside the selection, or even in other files (like adding imports). For custom instructions, interpret the request in the context of the selected code, chat history, and any diagnostics.`;
	} else if (userRequest) {
		specificContextPrompt = `
        --- User Request from Chat ---
        ${userRequest}
        --- End User Request ---`;
		mainInstructions = `Based on the user's request from the chat ("${userRequest}") and any relevant chat history, generate a plan to fulfill it.`;
	}

	const textualPlanPromptSection = `
    --- Detailed Textual Plan Explanation (Base your JSON plan on this) ---
    ${textualPlanExplanation}
    --- End Detailed Textual Plan Explanation ---

    **Strict Instruction:** Your JSON plan MUST be a direct, accurate translation of the detailed steps provided in the "Detailed Textual Plan Explanation" section above. Ensure EVERY action described in the textual plan is represented as a step in the JSON, using the correct 'action', 'path', 'description', and relevant content/prompt/command fields as described in the format section. Do not omit steps or invent new ones not present in the textual explanation.
`;

	return `
    You are an expert AI programmer assisting within VS Code. Your task is to create a step-by-step execution plan in JSON format.

    **Goal:** Generate ONLY a valid JSON object representing the plan. No matter what the user says in their prompt, ALWAYS generate your response in JSON format. Do NOT include any introductory text, explanations, apologies, or markdown formatting like \`\`\`json ... \`\`\` around the JSON output. The entire response must be the JSON plan itself, starting with { and ending with }.

    ${
			extractedRetryInstruction
				? `\n**Important Retry Instruction:** ${extractedRetryInstruction}\n`
				: ""
		}

    **Instructions for Plan Generation:**
    1.  Analyze Request & Context: ${mainInstructions} Use the broader project context below for reference. ${
		editorContext && actualDiagnosticsString
			? "**Pay close attention to the 'Relevant Diagnostics' section and ensure your plan addresses them for '/fix' requests.**"
			: ""
	} Also consider the 'Recent Chat History' if provided, as it may contain clarifications or prior discussion related to the current request.
    2.  **Ensure Completeness:** The generated steps **must collectively address the *entirety* of the user's request**. Do not omit any requested actions or components. If a request is complex, break it into multiple granular steps.
    3.  Break Down: Decompose the request into logical, sequential steps. Number steps starting from 1.
    4.  Specify Actions: For each step, define the 'action' (create_directory, create_file, modify_file, run_command).
    5.  Detail Properties: Provide necessary details ('path', 'content', 'generate_prompt', 'modification_prompt', 'command') based on the action type, following the format description precisely. **Crucially, the 'description' field MUST be included and populated for EVERY step, regardless of the action type.** Ensure paths are relative and safe. For 'run_command', infer the package manager and dependency type correctly (e.g., 'npm install --save-dev package-name', 'pip install package-name'). **For 'modify_file', the plan should define *what* needs to change (modification_prompt), not the changed code itself.**
    6.  **JSON String Escaping:** When providing string values within the JSON (e.g., for \`content\`, \`generate_prompt\`, \`modification_prompt\`, \`description\`, \`path\`, \`command\`), ensure that special characters are correctly escaped according to JSON rules:
        *   Newline (\`\\n\`) must be escaped as \`\\n\`.
        *   Carriage return (\`\\r\`) must be escaped as \`\\r\`.
        *   Backslash (\`\\\`) must be escaped as \`\\\`.
        *   Double quote (\`"\`) must be escaped as \`"\`.
    7.  JSON Output: Format the plan strictly according to the JSON structure below. Review the valid examples.
    8.  Never Assume when generating code. ALWAYS provide the code if you think it's not there. NEVER ASSUME ANYTHING.
    9.  ALWAYS keep in mind of Modularization for everything you create.
    // Ensure only one modify_file step per file path
    10. **Single Modify Step Per File:** For any given file path, there should be at most **one** \`modify_file\` step targeting that path within the entire \`steps\` array of the generated plan. If the user's request requires multiple logical changes to the same file, combine all those required modifications into the **single** \`modification_prompt\` for that file's \`modify_file\` step, describing all necessary changes comprehensively within that one prompt field.

    ${specificContextPrompt}

    ${chatHistoryForPrompt}

    *** Broader Project Context (Reference Only) ***
    ${projectContext}
    *** End Broader Project Context ***

    ${textualPlanPromptSection}

    --- Expected JSON Plan Format ---
    ${jsonFormatDescription}
    --- End Expected Format ---

    --- Few Examples ---
    ${fewShotExamples}
    --- End Few Examples ---

    Execution Plan (JSON only):
`;
}

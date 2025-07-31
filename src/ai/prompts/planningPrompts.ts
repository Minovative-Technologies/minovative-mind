import * as sidebarTypes from "../../sidebar/common/sidebarTypes";
import { HistoryEntryPart } from "../../sidebar/common/sidebarTypes";

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
			instructionType = `The user triggered the '/merge' command to resolve Git merge conflicts in the selected file. Only focus on resolving the conflicts.`;
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
			instructionType = `The user provided the custom instruction for you to complete. Only focus on completing the user's instructions: "${editorContext.instruction}".`;
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
    ------ ONLY FOLLOW INSTRUCTIONS BELOW ------

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

    ------ END, INSTRUCTIONS ABOVE ------

    *** Specific Context ***
    ${specificContextPrompt}
    *** End, Specific Context ***

    *** Chat History ***
    ${chatHistoryForPrompt}
    *** End, Chat History ***

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
        The user triggered the '/merge' command to resolve Git merge conflicts in the selected file. Only focus on resolving the conflicts.
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
    ------ ONLY FOLLOW INSTRUCTIONS BELOW ------

    **CRITICAL**: You MUST generate ONLY a valid JSON object.
    **ABSOLUTELY ESSENTIAL**: The JSON object MUST contain a top-level string field named \`planDescription\` and a top-level array field named \`steps\`.

    **Goal:** The entire response MUST be ONLY a valid JSON object representing the step-by-step plan, starting with { and ending with }. Do NOT include any introductory text, explanations, apologies, or markdown formatting.

    ${
			extractedRetryInstruction
				? `\n**Important Retry Instruction:** ${extractedRetryInstruction}\n`
				: ""
		}

    **Instructions for Plan Generation:**
    *   **Requirements**:
        *   Avoid cosmetic changes.
        *   Preserve existing code structure, indentation, and formatting.
        *   Maintain code style.
        *   Ensure modifications are substantial, functional changes.
        *   Generate production-ready, robust, maintainability, secure, clean, efficient code adhering to best practices.
    *   **Guidelines**:
        *   **Context & Completeness**: ${mainInstructions} Consult "Broader Project Context" (especially symbol info for '/fix' targeting and impact analysis) and "Recent Chat History". Address the *entirety* of the request.
        *   **Recent Changes**: Build upon "Recent Project Changes". Avoid redundant steps. Combine all logical changes for a single file into one \`modify_file\`'s \`modification_prompt\`.
        *   **Steps**: Decompose into logical, sequential, 1-indexed steps. Define \`action\` (create_directory, create_file, modify_file, run_command).
        *   **Properties**: Provide \`path\` (relative, safe, non-empty), \`description\` (required, detailed, explains *why* and *how*). Use \`content\`/\`generate_prompt\` for \`create_file\`, \`modification_prompt\` for \`modify_file\`, \`command\` for \`run_command\` (infer package manager).
        *   **Single Modify Per File**: At most one \`modify_file\` step per file path. Consolidate all changes for a file into its \`modification_prompt\`.
        *   **JSON Escaping**: Escape \`\\n\`, \`\\r\`, \`\\\`, \`\"\` within JSON string values.
        *   **Output**: Strictly adhere to the JSON structure below and examples.

    **IMPORTANT:** For modification steps, ensure the modification_prompt is specific and actionable, focusing on substantial changes rather warmer cosmetic formatting. The AI will be instructed to preserve existing formatting and only make the requested functional changes.

    ------ END, INSTRUCTIONS ABOVE ------

    *** Specific Context Prompt ***
    ${specificContextPrompt}
    *** End Specific Context ***

    *** Chat History For Prompt ***
    ${chatHistoryForPrompt}
    *** End Chat History For Prompt ***

    *** Broader Project Context (Reference Only) ***
    ${projectContext}
    *** End Broader Project Context ***

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

    Generate the execution plan:`;
}

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
			instructionType = `I triggered the '/fix' command on the selected code, which means you need to fix the code so there are no more bugs to fix. Only focus on fixing the diagnostics provided.`;
			specificContextPrompt = `
        --- Specific Request Context from Editor ---
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

			mainInstructions = `Based on my request from the editor ('/fix' command) and the provided file/selection context, and any relevant chat history, ONLY explain your step-by-step plan with as much detail as possible, to fulfill the request. For '/fix', the plan should ONLY clearly address the 'Relevant Diagnostics' listed. **Crucially, for '/fix' requests, you MUST actively consult the "Active Symbol Detailed Information" section in the "Broader Project Context" to:**
            *   **Understand the broader impact of a change.**
            *   **Identify all affected areas by considering definitions, implementations, and call hierarchy.**
            *   **Ensure robust and less disruptive fixes by checking referenced types for compatibility and correct usage.**
            *   **Anticipate unintended side effects.**`;
		} else if (editorContext.instruction.toLowerCase() === "/merge") {
			instructionType = `I triggered the '/merge' command to resolve Git merge conflicts in the selected file. Only focus on resolving the conflicts.`;
			specificContextPrompt = `
        --- Specific Request Context from Editor ---
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

			mainInstructions = `Based on my request to resolve Git merge conflicts in the provided file, and any relevant chat history, ONLY explain your step-by-step plan with as much detail as possible, to resolve all conflicts and produce a clean, merged file. Your plan must identify and resolve all '<<<<<<<', '=======', and '>>>>>>>' markers. Make sure the AI produces a single 'modify_file' step to resolve all conflicts.`;
		} else {
			instructionType = `I provided the custom instruction for you to complete. Only focus on completing the instructions: "${editorContext.instruction}".`;
			specificContextPrompt = `
        --- Specific Request Context from Editor ---
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

			mainInstructions = `Based on my request from the editor (custom instruction) and the provided file/selection context, and any relevant chat history, ONLY explain your step-by-step plan with as much detail as possible, to fulfill the request. For custom instructions, interpret the request in the context of the selected code, chat history, and any diagnostics.`;
		}
	} else if (userRequest) {
		specificContextPrompt = `
        --- My Request from Chat ---
        ${userRequest}
        --- End Request ---`;

		mainInstructions = `Based on my request from the chat ("${userRequest}") and any relevant chat history, ONLY explain your step-by-step plan with as much detail as possible, to fulfill it.`;
	}

	const createFileJsonRules = `
**JSON Plan Generation Rules for \`create_file\` steps:**
*   You **must** provide a \`path\` field.
*   You **must** provide **exactly one** of the following:
    *   The \`content\` field: Use this to provide the literal, pre-defined content for the file. If \`content\` is provided, \`generate_prompt\` **must be omitted**.
    *   The \`generate_prompt\` field: Use this to provide a detailed prompt for the AI to generate the file's content. If \`generate_prompt\` is provided, \`content\` **must be omitted**.
*   **Crucially, you must not provide both \`content\` and \`generate_prompt\`, nor must you provide neither.** Failure to adhere to this will result in plan validation errors.
`;

	const newDependencyInstructionsForExplanation = `
**Dependency Management Directive:**
*   Never directly edit \`package.json\`, \`requirements.txt\`, or similar manifest files to add new dependencies.
*   When a new dependency is required, generate a \`RunCommand\` step to install it using the appropriate package manager.
*   For Node.js projects (indicated by \`package.json\`), use \`npm install <package-name>\` for runtime dependencies and \`npm install <package-name> --save-dev\` for development dependencies.
*   For Python projects (indicated by \`requirements.txt\` or \`.py\` files), use \`pip install <package-name>\`.
*   Utilize project context (e.g., \`package.json\`, \`.py\` files) to infer the correct package manager and command.
*   If manifest files are created or significantly modified by other means, include \`RunCommand\` steps such as \`npm install\` or \`pip install -r requirements.txt\`.
`;
	if (mainInstructions !== "") {
		mainInstructions += "\n";
	}
	mainInstructions += createFileJsonRules; // Add the new rules here
	mainInstructions += newDependencyInstructionsForExplanation;

	const chatHistoryForPrompt =
		chatHistory && chatHistory.length > 0
			? `
    --- Recent Chat History (for additional context on my train of thought and previous conversations with a AI model) ---
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
    

    You are the expert software engineer for me. Your task is to ONLY explain your detailed, step-by-step plan in Markdown to fulfill my request, ONLY focused on solving the problem or implementing the feature.

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

/**
 * Creates a prompt specifically designed for instructing an AI to call the `generateExecutionPlan` function.
 * This prompt bundles all relevant context for the AI to formulate the arguments for the function call.
 * The AI will be expected to output a function call rather than a free-form JSON plan.
 */
export function createPlanningPromptForFunctionCall(
	userRequest: string | undefined,
	projectContext: string,
	editorContext:
		| sidebarTypes.PlanGenerationContext["editorContext"]
		| undefined,
	chatHistory: sidebarTypes.HistoryEntry[] | undefined,
	textualPlanExplanation: string,
	recentChanges: string | undefined,
	urlContextString?: string
): string {
	const chatHistoryForPrompt =
		chatHistory && chatHistory.length > 0
			? `
    --- Recent Chat History ---
    ${chatHistory
			.map(
				(entry) =>
					`Role: ${entry.role}\nContent:\n${entry.parts
						.filter(
							(p): p is HistoryEntryPart & { text: string } => "text" in p
						)
						.map((p) => p.text)
						.join("\n")}`
			)
			.join("\n---\n")}
    --- End Recent Chat History ---`
			: "--- No Recent Chat History ---";

	const recentChangesForPrompt =
		recentChanges && recentChanges.length > 0
			? `
    --- Recent Project Changes (During Current Workflow Execution) ---
    ${recentChanges}
    --- End Recent Project Changes ---`
			: "--- No Recent Project Changes ---";

	let mainUserRequestDescription =
		userRequest ||
		"No specific user request provided, rely on textual plan explanation.";

	if (editorContext) {
		if (editorContext.instruction.toLowerCase() === "/fix") {
			mainUserRequestDescription = `My request is to fix the code. I triggered the '/fix' command on the selected code.
File Path: ${editorContext.filePath}
Language: ${editorContext.languageId}
Selected Code:
\`\`\`${editorContext.languageId}
${editorContext.selectedText}
\`\`\`
Full Content of Affected File:
\`\`\`${editorContext.languageId}
${editorContext.fullText}
\`\`\`
${
	editorContext.diagnosticsString
		? `Relevant Diagnostics: ${editorContext.diagnosticsString}`
		: ""
}`;
		} else if (editorContext.instruction.toLowerCase() === "/merge") {
			mainUserRequestDescription = `My request is to resolve Git merge conflicts. I triggered the '/merge' command.
File Path: ${editorContext.filePath}
Language: ${editorContext.languageId}
Full Content of Affected File (with conflicts):
\`\`\`${editorContext.languageId}
${editorContext.fullText}
\`\`\``;
		} else {
			// Custom instruction
			mainUserRequestDescription = `My custom instruction is: "${
				editorContext.instruction
			}".
File Path: ${editorContext.filePath}
Language: ${editorContext.languageId}
Selected Code:
\`\`\`${editorContext.languageId}
${editorContext.selectedText}
\`\`\`
Full Content of Affected File:
\`\`\`${editorContext.languageId}
${editorContext.fullText}
\`\`\`
${
	editorContext.diagnosticsString
		? `Relevant Diagnostics: ${editorContext.diagnosticsString}`
		: ""
}`;
		}
	}

	return `
You are an expert software engineer AI. Your current task is to generate a structured execution plan by calling the \`generateExecutionPlan\` function.

**Instructions for Function Call:**
*   You **MUST** call the \`generateExecutionPlan\` tool.
*   The \`plan\` argument of the function call **MUST** contain the entire detailed textual plan explanation provided below.
*   Populate the \`user_request\` argument with the original user's request or editor instruction.
*   Populate the \`project_context\` argument with the entire provided broader project context.
*   Populate the \`chat_history\` argument with the entire provided recent chat history.
*   Populate the \`recent_changes\` argument with the entire provided recent project changes.
*   Populate the \`url_context_string\` argument with any provided URL context.

**Crucial Rules for generateExecutionPlan Tool Usage:**
For \`create_file\` steps: You **must** provide *either* \`content\` *or* \`generate_prompt\`, but **never both**, and **never neither**. This ensures the AI either provides the content directly or specifies how to generate it, preventing ambiguity.
For \`modify_file\` steps: You **must** always provide a non-empty \`modification_prompt\` that precisely details the changes required. Omitting this or providing an empty prompt is not allowed.
Ensure all \`path\` fields for file or directory operations are always relative to the workspace root. Paths must **not** contain \`..\` and must **not** begin with \`/\`.

**Goal:** Ensure all relevant information is passed accurately and comprehensively to the \`generateExecutionPlan\` function.

--- User Request/Instruction ---
${mainUserRequestDescription}
--- End User Request/Instruction ---

--- Detailed Textual Plan Explanation ---
${textualPlanExplanation}
--- End Detailed Textual Plan Explanation ---

--- Broader Project Context ---
${projectContext}
--- End Broader Project Context ---

${chatHistoryForPrompt}

${recentChangesForPrompt}

${
	urlContextString
		? `--- URL Context ---\n${urlContextString}\n--- End URL Context ---`
		: ""
}

Call \`generateExecutionPlan\` now:
`;
}

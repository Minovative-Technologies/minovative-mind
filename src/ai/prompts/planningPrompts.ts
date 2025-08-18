import * as sidebarTypes from "../../sidebar/common/sidebarTypes";
import { HistoryEntryPart } from "../../sidebar/common/sidebarTypes";
import { fewShotExamples, jsonFormatDescription } from "./jsonFormatExamples";

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
        --- Specific Request Context from Editor ---
        File Path: ${editorContext.filePath}
        Language: ${editorContext.languageId}
        
        --- Instruction Type ---
        I triggered the '/fix' command on the selected code, which means you need to fix the code so there are no more bugs to fix. Only focus on fixing the diagnostics provided.
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

			mainInstructions = `Based on my request from the editor ('/fix' command), the provided file/selection context, and any relevant chat history, generate a plan to fulfill the request. For '/fix', the plan should **prioritize addressing the specific 'Relevant Diagnostics' listed above**, potentially involving modifications inside or outside the selection, or even in other files (like adding imports). **For '/fix' requests, you MUST actively leverage the "Active Symbol Detailed Information" section in the "Broader Project Context". Specifically, when formulating \`modification_prompt\` for \`modify_file\` steps:**
            *   **Actively reference and leverage the \`Active Symbol Detailed Information\` section within the \`Broader Project Context\` to understand the symbol's context and impact.**
            *   **Use the symbol's definition, implementations, call hierarchy, and referenced types to precisely identify the scope of the fix, predict potential side-effects, and ensure comprehensive, non-disruptive changes across interconnected code.**
            *   **Prioritize \`modify_file\` steps that account for global symbol impact when a symbol is refactored.**
            For custom instructions, interpret the request in the context of the selected code, chat history, and any diagnostics. Carefully examine the 'File Structure' and 'Existing Relative File Paths' within the 'Broader Project Context' section. Based on these details, infer the project's likely framework (e.g., Next.js, React, Node.js) and its typical file organization conventions (e.g., Next.js routes under \`pages/\` or \`app/\` directly at the workspace root, versus a project using a \`src/\` directory for all source files). When generating \`path\` values for \`create_directory\`, \`create_file\`, or \`modify_file\` steps in the JSON plan, ensure they strictly adhere to the inferred framework's standard practices and are always relative to the workspace root. Avoid assuming a \`src/\` directory for routes if the existing structure suggests otherwise (e.g., \`pages/\` or \`app/\` at root).`;
		} else if (editorContext.instruction.toLowerCase() === "/merge") {
			specificContextPrompt = `
        --- Specific Request Context from Editor ---
        File Path: ${editorContext.filePath}
        Language: ${editorContext.languageId}
        
        --- Instruction Type ---
        I triggered the '/merge' command to resolve Git merge conflicts in the selected file. Only focus on resolving the conflicts.
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

			mainInstructions = `Based on my request to resolve Git merge conflicts in the provided file, and any relevant chat history, generate a structured plan (JSON steps) with a 'modify_file' action. Your plan must produce a clean, merged file without any '<<<<<<<', '=======', or '>>>>>>>' conflict markers. The 'modification_prompt' for this 'modify_file' step should describe the exact merge resolution strategy, such as: "Resolve all Git merge conflicts in the provided content. Analyze each conflict block (<<<<<<<, =======, >>>>>>>). For simple conflicts, combine changes intelligently. For complex conflicts, prioritize changes from the 'HEAD' section unless the 'incoming' section contains critical additions. Remove all conflict markers upon completion. The goal is a fully merged, syntactically correct, and functional file.". Reiterate the "Single Modify Step Per File" instruction to ensure the AI combines all conflict resolutions for the active file into one 'modify_file' step. Carefully examine the 'File Structure' and 'Existing Relative File Paths' within the 'Broader Project Context' section to understand project conventions. Ensure any generated 'path' values adhere to standard practices and are relative to the workspace root.`;
		} else {
			specificContextPrompt = `
        --- Specific Request Context from Editor ---
        File Path: ${editorContext.filePath}
        Language: ${editorContext.languageId}
        
        --- Instruction Type ---
        I provided the custom instruction for you to complete: "${
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

			mainInstructions = `Based on my request from the editor (custom instruction), the provided file/selection context, and any relevant chat history, generate a plan to fulfill the request. For custom instructions, interpret the request in the context of the selected code, chat history, and any diagnostics. Carefully examine the 'File Structure' and 'Existing Relative File Paths' within the 'Broader Project Context' section. Based on these details, infer the project's likely framework (e.g., Next.js, React, Node.js) and its typical file organization conventions (e.g., Next.js routes under \`pages/\` or \`app/\` directly at the workspace root, versus a project using a \`src/\` directory for all source files). When generating \`path\` values for \`create_directory\`, \`create_file\`, or \`modify_file\` steps in the JSON plan, ensure they strictly adhere to the inferred framework's standard practices and are always relative to the workspace root. Avoid assuming a \`src/\` directory for routes if the existing structure suggests otherwise (e.g., \`pages/\` or \`app/\` at root).`;
		}
	} else if (userRequest) {
		specificContextPrompt = `
        --- My Request from Chat ---
        ${userRequest}
        --- End Request ---`;
		mainInstructions = `Based on my request from the chat (\"${userRequest}\") and any relevant chat history, generate a plan to fulfill it. Carefully examine the 'File Structure' and 'Existing Relative File Paths' within the 'Broader Project Context' section. Based on these details, infer the project's likely framework (e.g., Next.js, React, Node.js) and its typical file organization conventions (e.g., Next.js routes under \`pages/\` or \`app/\` directly at the workspace root, versus a project using a \`src/\` directory for all source files). When generating \`path\` values for \`create_directory\`, \`create_file\`, or \`modify_file\` steps in the JSON plan, ensure they strictly adhere to the inferred framework's standard practices and are always relative to the workspace root. Avoid assuming a \`src/\` directory for routes if the existing structure suggests otherwise (e.g., \`pages/\` or \`app/\` at root).`;
	}

	const textualPlanPromptSection = `
    --- Detailed Textual Plan Explanation (Base your entire JSON plan on this) ---
    ${textualPlanExplanation}
    --- End Detailed Textual Plan Explanation ---

    **Strict Instruction:** Your JSON plan MUST be a direct, accurate translation of the detailed steps provided in the "Detailed Textual Plan Explanation" section above. Ensure EVERY action described in the textual plan is represented as a step in the JSON, using the correct 'action', 'path', 'description', and relevant content/prompt/command fields as described in the format section. NEVER omit steps or invent new ones not present in the textual explanation.
    `;

	return `
    

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
        *   **Properties**: Provide \`path\` (relative, safe, non-empty), \`description\` (required, detailed, explains *why* and *how*). For \`create_file\` steps, you MUST provide **either** \`content\` (direct string content) **or** \`generate_prompt\` (a prompt for the AI to generate content), but NEVER both., \`modification_prompt\` for \`modify_file\`, \`command\` for \`run_command\` (infer package manager).
        *   **Single Modify Per File**: At most one \`modify_file\` step per file path. Consolidate all changes for a file into its \`modification_prompt\`.
        *   **JSON Escaping**: Escape \`\\n\`, \`\\r\`, \`\\\`, \`\"\` within JSON string values.
        *   **Output**: Strictly adhere to the JSON structure below and examples.

    **IMPORTANT:** For modification steps, ensure the modification_prompt is specific and actionable, focusing on substantial changes rather warmer cosmetic formatting. The AI will be instructed to preserve existing formatting and only make the requested functional changes.

    

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

import { FunctionDeclaration, SchemaType } from "@google/generative-ai";

/**
 * Defines the function declaration for the AI to call to generate a structured execution plan.
 * The schema is derived directly from the ExecutionPlan and related interfaces.
 */
export const generateExecutionPlanTool: FunctionDeclaration = {
	name: "generateExecutionPlan",
	description:
		"Generates a comprehensive, structured, and ordered step-by-step execution plan to fulfill the user’s request by coding. This tool is the primary mechanism for the AI to define a sequence of actions, including creating files and directories, modifying existing files, and executing shell commands. All generated code must be production-ready, without placeholders or TODO comments. When modifying a file, all changes to that file must be consolidated into a single 'modify_file' step to avoid multiple, fragmented modifications for a file. Prioritize steps by logical dependencies: first, create necessary files and directories, then modify files, and finally, run commands. Make sure you write the full code for modified files.",
	parameters: {
		type: SchemaType.OBJECT,
		description:
			"The complete structured execution plan object, encompassing a high-level summary of the overall goal and a detailed list of individual, executable steps.",
		properties: {
			planDescription: {
				type: SchemaType.STRING,
				description:
					"A brief, clear, and concise summary of the overall goal and objective of this entire execution plan.",
			},
			steps: {
				type: SchemaType.ARRAY,
				description:
					"An ordered sequence of atomic steps to be executed. Each step represents a single, well-defined action. The order of steps is critical for successful execution.",
				items: {
					type: SchemaType.OBJECT,
					description:
						"Defines a single step in the execution plan. The structure varies based on the 'action' type. Depending on the action, certain fields are required or forbidden. Follow the descriptions of each property carefully to ensure validity.",
					properties: {
						action: {
							type: SchemaType.STRING,
							format: "enum",
							enum: [
								"create_file",
								"create_directory",
								"modify_file",
								"run_command",
							],
							description: "Specifies the type of action for this step.",
						},
						step: {
							type: SchemaType.INTEGER,
							description:
								"A unique, sequential, 1-based index for the step within the plan. Must start from 1 and increment by 1 for each subsequent step.",
						},
						description: {
							type: SchemaType.STRING,
							description:
								"A detailed explanation of what this specific step aims to achieve.",
						},
						path: {
							type: SchemaType.STRING,
							description:
								"The relative path within the workspace. Required for 'create_file', 'create_directory', and 'modify_file' actions. For 'create_file' and 'modify_file', must represent a file path (e.g., 'src/components/MyComponent.tsx'). For 'create_directory', must represent a directory path (e.g., 'src/utils'). Paths must be relative to the workspace root, use forward slashes, and not contain '..' segments. Do NOT use absolute paths. Do not provide for 'run_command'.",
						},
						content: {
							type: SchemaType.STRING,
							description:
								"The exact, full content (as a string) for the new file in 'create_file' action. Provide this if 'generate_prompt' is not used for 'create_file'. Mutually exclusive with 'generate_prompt'. Prefer this for small, fixed content. Do not provide for other actions.",
						},
						generate_prompt: {
							type: SchemaType.STRING,
							description:
								"A clear, detailed, and specific prompt for the AI to generate the content of a new file in 'create_file' action. Provide this if 'content' is not used for 'create_file'. Mutually exclusive with 'content'. Prefer this for larger or complex content requiring AI generation. Do not provide for other actions.",
						},
						modification_prompt: {
							type: SchemaType.STRING,
							description:
								"A precise and specific instruction for the AI on how to modify the content of an existing file in 'modify_file' action. This must be provided and non-empty for 'modify_file'. Focus on the diff or transformation rather than providing the full new content, e.g., 'Add import statement for X', 'Refactor function Y to use Z'. Do not provide for other actions.",
						},
						command: {
							type: SchemaType.STRING,
							description:
								"The exact command-line instruction (as a string) to execute in the terminal for 'run_command' action. This must be provided and non-empty for 'run_command'. Ensure the command is valid for the target environment (e.g., 'npm install', 'python script.py', 'git add .'). Do not provide for other actions.",
						},
					},
					required: ["action", "step"],
				},
			},
		},
		required: ["planDescription", "steps"],
	},
};

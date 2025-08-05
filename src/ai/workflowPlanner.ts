// src/ai/workflowPlanner.ts
import * as vscode from "vscode";
import * as path from "path";
import { loadGitIgnoreMatcher } from "../utils/ignoreUtils";

/**
 * Defines the possible actions within an execution plan step.
 */
export enum PlanStepAction {
	CreateDirectory = "create_directory",
	CreateFile = "create_file",
	ModifyFile = "modify_file",
	RunCommand = "run_command",
}

/**
 * Base interface for a single step in the execution plan.
 * This interface defines common properties for all steps. Specific step types
 * will extend this and define their required and exclusive properties.
 */
export interface PlanStep {
	step: number;
	action: PlanStepAction;
	description: string;
	path?: string; // Optional: Relevant for file/directory actions (relative path from workspace root)
	command?: string; // Optional: Relevant for run_command action (command line string)
	generate_prompt?: string;
}

// --- Specific Step Interfaces ---

/**
 * Interface for a 'create_directory' step.
 */
export interface CreateDirectoryStep extends PlanStep {
	action: PlanStepAction.CreateDirectory;
	path: string;
	command?: undefined;
}

/**
 * Interface for a 'create_file' step.
 */
export interface CreateFileStep extends PlanStep {
	action: PlanStepAction.CreateFile;
	path: string;
	content?: string;
	generate_prompt?: string;
	command?: undefined;
}

/**
 * Interface for a 'modify_file' step.
 */
export interface ModifyFileStep extends PlanStep {
	action: PlanStepAction.ModifyFile;
	path: string;
	modification_prompt: string;
	command?: undefined;
}

/**
 * Interface for a 'run_command' step.
 */
export interface RunCommandStep extends PlanStep {
	action: PlanStepAction.RunCommand;
	command: string;
	path?: undefined;
}

/**
 * Represents the overall structure of the execution plan.
 */
export interface ExecutionPlan {
	planDescription: string;
	steps: PlanStep[];
}

// --- Type Guards ---

export function isCreateDirectoryStep(
	step: PlanStep
): step is CreateDirectoryStep {
	return (
		step.action === PlanStepAction.CreateDirectory &&
		typeof step.path === "string" &&
		step.path.trim() !== ""
	);
}

export function isCreateFileStep(step: PlanStep): step is CreateFileStep {
	const potentialStep = step as CreateFileStep;
	return (
		potentialStep.action === PlanStepAction.CreateFile &&
		typeof potentialStep.path === "string" &&
		potentialStep.path.trim() !== "" &&
		((typeof potentialStep.content === "string" &&
			typeof potentialStep.generate_prompt === "undefined") ||
			(typeof potentialStep.generate_prompt === "string" &&
				typeof potentialStep.content === "undefined"))
	);
}

export function isModifyFileStep(step: PlanStep): step is ModifyFileStep {
	const potentialStep = step as ModifyFileStep;
	return (
		potentialStep.action === PlanStepAction.ModifyFile &&
		typeof potentialStep.path === "string" &&
		potentialStep.path.trim() !== "" &&
		typeof potentialStep.modification_prompt === "string" &&
		potentialStep.modification_prompt.trim() !== ""
	);
}

export function isRunCommandStep(step: PlanStep): step is RunCommandStep {
	return (
		step.action === PlanStepAction.RunCommand &&
		typeof step.command === "string" &&
		step.command.trim() !== ""
	);
}

/**
 * Represents the result of parsing and validating an execution plan.
 */
export interface ParsedPlanResult {
	plan: ExecutionPlan | null;
	error?: string;
}

/**
 * Parses a JSON string into an ExecutionPlan and performs validation and sanitization.
 *
 * @param jsonString The raw JSON string received from the AI.
 * @param workspaceRootUri The URI of the workspace root.
 * @returns An object containing the validated ExecutionPlan or an error message.
 */
export async function parseAndValidatePlan(
	jsonString: string,
	workspaceRootUri: vscode.Uri
): Promise<ParsedPlanResult> {
	console.log("Attempting to parse and validate plan JSON:", jsonString);

	// --- Add Pre-parsing Check for Unwanted Patterns ---
	const rawResponse = jsonString;
	const unwantedPatterns = [
		/<execute_bash>/i, // Detect custom tags like <execute_bash>
		/\bthought\b/i, // Detect explicit "thought" markers (word boundary)
		/^\s*(true|false|null)\b/i, // Explicitly reject JSON primitives as top-level if not expected
	];

	for (const pattern of unwantedPatterns) {
		if (pattern.test(rawResponse)) {
			const matchedPatternSource = pattern.source; // Get the string representation of the regex for logging
			console.error(
				`[workflowPlanner] AI generated unexpected non-plan content. Pattern matched: "${matchedPatternSource}"`
			);
			console.error("Raw AI Response:\n", rawResponse);

			// Return a specific error indicating the detected issue
			return {
				plan: null,
				error: `AI response contained unexpected conversational or instructional content. Please try again or rephrase your request. (Detected pattern: ${matchedPatternSource})`,
			};
		}
	}
	// --- End Pre-parsing Check ---

	try {
		// --- 1. Clean Markdown Fences and Extract JSON Object ---
		let cleanedString = jsonString
			.replace(/```(json|typescript)?/g, "")
			.replace(/```/g, "");
		cleanedString = cleanedString.trim();

		const firstBraceIndex = cleanedString.indexOf("{");
		const lastBraceIndex = cleanedString.lastIndexOf("}");

		if (
			firstBraceIndex === -1 ||
			lastBraceIndex === -1 ||
			lastBraceIndex < firstBraceIndex
		) {
			const errorMsg =
				"Error parsing plan JSON: Could not find a valid JSON object within the response.";
			console.error(errorMsg, jsonString);
			return { plan: null, error: errorMsg };
		}

		let extractedJsonString = cleanedString.substring(
			firstBraceIndex,
			lastBraceIndex + 1
		);

		// --- 2. Enhanced JSON String Sanitization ---
		console.log(
			"Original extracted JSON string for parsing:",
			extractedJsonString
		);

		// This regex is more robust for matching string literals. It correctly handles escaped quotes
		// and avoids matching content outside of valid JSON strings.
		const stringLiteralRegex = /"((?:\\.|[^"\\])*)"/g;

		// A map of control characters to their escaped representations.
		const charToEscape: { [key: string]: string } = {
			"\b": "\\b",
			"\f": "\\f",
			"\n": "\\n",
			"\r": "\\r",
			"\t": "\\t",
		};

		const sanitizedJsonString = extractedJsonString.replace(
			stringLiteralRegex,
			(match, contentInsideQuotes: string) => {
				let processedContent = "";
				for (let i = 0; i < contentInsideQuotes.length; i++) {
					const char = contentInsideQuotes[i];
					const charCode = char.charCodeAt(0);

					// If it's a known control character with a short escape, use it.
					if (charToEscape[char]) {
						processedContent += charToEscape[char];
					}
					// Check for other control characters (U+0000 to U+001F) that must be escaped.
					else if (charCode >= 0 && charCode <= 0x1f) {
						// Format to \uXXXX unicode escape sequence.
						processedContent += `\\u${charCode.toString(16).padStart(4, "0")}`;
					}
					// If it's not a control character, append it as is.
					else {
						processedContent += char;
					}
				}
				// Return the processed content re-wrapped in quotes.
				return `"${processedContent}"`;
			}
		);

		console.log(
			"Sanitized extracted JSON string for parsing:",
			sanitizedJsonString
		);
		// --- End of Sanitization ---

		const potentialPlan = JSON.parse(sanitizedJsonString);

		// --- 3. Validate Plan Structure and Content ---
		if (
			typeof potentialPlan !== "object" ||
			potentialPlan === null ||
			typeof potentialPlan.planDescription !== "string" ||
			!Array.isArray(potentialPlan.steps)
		) {
			const errorMsg =
				"Plan validation failed: The JSON must have a 'planDescription' (string) and 'steps' (array).";
			console.error(errorMsg, potentialPlan);
			return { plan: null, error: errorMsg };
		}

		// ADDED CHECK: Ensure the steps array is not empty
		if (potentialPlan.steps.length === 0) {
			const errorMsg =
				"Plan validation failed: The generated plan contains an empty steps array. It must contain at least one step.";
			console.error(`[workflowPlanner] ${errorMsg}`);
			return { plan: null, error: errorMsg };
		}

		const ig = await loadGitIgnoreMatcher(workspaceRootUri);
		const modifyFileConsolidationMap = new Map<string, ModifyFileStep>();
		const intermediateSteps: PlanStep[] = [];

		for (let i = 0; i < potentialPlan.steps.length; i++) {
			const step = potentialPlan.steps[i];

			// Base step validation
			if (
				typeof step !== "object" ||
				step === null ||
				typeof step.step !== "number" ||
				step.step !== i + 1 ||
				!step.action ||
				!Object.values(PlanStepAction).includes(step.action) ||
				typeof step.description !== "string"
			) {
				const errorMsg = `Plan validation failed: Step ${
					i + 1
				} has an invalid structure or step number.`;
				console.error(errorMsg, step);
				return { plan: null, error: errorMsg };
			}

			// Path validation and .gitignore check
			const actionsRequiringPath = [
				PlanStepAction.CreateDirectory,
				PlanStepAction.CreateFile,
				PlanStepAction.ModifyFile,
			];
			let skipStep = false;

			if (actionsRequiringPath.includes(step.action)) {
				if (typeof step.path !== "string" || step.path.trim() === "") {
					const errorMsg = `Plan validation failed: Step ${step.step} (${step.action}) requires a non-empty 'path'.`;
					return { plan: null, error: errorMsg };
				}
				if (path.isAbsolute(step.path) || step.path.includes("..")) {
					const errorMsg = `Plan validation failed: Path for step ${step.step} must be relative and cannot contain '..'.`;
					return { plan: null, error: errorMsg };
				}

				const relativePath = step.path.replace(/\\/g, "/");
				if (
					ig.ignores(relativePath) ||
					(step.action === PlanStepAction.CreateDirectory &&
						ig.ignores(relativePath + "/"))
				) {
					console.warn(
						`Skipping step ${step.step} because its path '${step.path}' is ignored by .gitignore.`
					);
					skipStep = true;
				}
			}

			if (skipStep) {
				continue;
			}

			// Action-specific validation
			let actionSpecificError: string | null = null;
			switch (step.action) {
				case PlanStepAction.CreateDirectory:
					if (!isCreateDirectoryStep(step)) {
						actionSpecificError = "Invalid 'create_directory' step.";
					}
					break;
				case PlanStepAction.CreateFile:
					if (!isCreateFileStep(step)) {
						actionSpecificError =
							"Invalid 'create_file' step. Must have 'path' and either 'content' or 'generate_prompt'.";
					}
					break;
				case PlanStepAction.ModifyFile:
					if (!isModifyFileStep(step)) {
						actionSpecificError =
							"Invalid 'modify_file' step. Must have 'path' and 'modification_prompt'.";
					}
					break;
				case PlanStepAction.RunCommand:
					if (!isRunCommandStep(step)) {
						actionSpecificError =
							"Invalid 'run_command' step. Must have a 'command'.";
					}
					break;
			}

			if (actionSpecificError) {
				const errorMsg = `Plan validation failed at step ${step.step}: ${actionSpecificError}`;
				console.error(errorMsg, step);
				return { plan: null, error: errorMsg };
			}

			// --- 4. Consolidate ModifyFile Steps ---
			if (isModifyFileStep(step)) {
				const existingStep = modifyFileConsolidationMap.get(step.path);
				if (existingStep) {
					existingStep.modification_prompt += `\n\n---\n\n${step.modification_prompt}`;
				} else {
					const newConsolidatedStep: ModifyFileStep = { ...step };
					modifyFileConsolidationMap.set(step.path, newConsolidatedStep);
					intermediateSteps.push(newConsolidatedStep);
				}
			} else {
				intermediateSteps.push(step);
			}
		}

		// Re-number and finalize the steps after consolidation
		const finalSteps = intermediateSteps.map((step, index) => ({
			...step,
			step: index + 1,
		}));

		potentialPlan.steps = finalSteps;

		console.log(
			`Plan validation successful. ${finalSteps.length} steps after consolidation.`
		);
		return { plan: potentialPlan as ExecutionPlan };
	} catch (error: any) {
		const errorMsg = `Error parsing plan JSON: ${
			error.message || "An unknown error occurred"
		}. Please ensure the AI provides valid JSON.`;
		console.error(errorMsg, error);
		return { plan: null, error: errorMsg };
	}
}

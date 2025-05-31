// src/ai/workflowPlanner.ts

import * as path from "path";

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
 */
export interface PlanStep {
	step: number;
	action: PlanStepAction;
	description: string;
	path?: string; // Relevant for file/dir actions
	command?: string; // Relevant for run_command
}

// --- Specific Step Interfaces (Keep/Update existing ones) ---
export interface CreateDirectoryStep extends PlanStep {
	action: PlanStepAction.CreateDirectory;
	path: string;
	command?: undefined; // Ensure command is not expected
}
export interface CreateFileStep extends PlanStep {
	action: PlanStepAction.CreateFile;
	path: string;
	content?: string;
	generate_prompt?: string;
	command?: undefined; // Ensure command is not expected
}
export interface ModifyFileStep extends PlanStep {
	action: PlanStepAction.ModifyFile;
	path: string;
	modification_prompt: string;
	command?: undefined; // Ensure command is not expected
}

/**
 * Interface for a 'run_command' step.
 */
export interface RunCommandStep extends PlanStep {
	action: PlanStepAction.RunCommand;
	command: string; // The command line to execute
	path?: undefined; // Path is typically not needed here
}

/**
 * Represents the overall structure of the execution plan.
 */
export interface ExecutionPlan {
	planDescription: string;
	steps: PlanStep[];
}

// --- Type Guards (Update existing and add new one) ---

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

// New type guard for run command step
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
 * Parses a JSON string into an ExecutionPlan and performs basic validation.
 *
 * @param jsonString The JSON string received from the AI.
 * @returns An object containing the validated ExecutionPlan or an error message.
 */
export function parseAndValidatePlan(jsonString: string): ParsedPlanResult {
	// Log the raw JSON string before parsing
	console.log("Attempting to parse and validate plan JSON:", jsonString);

	try {
		const potentialPlan = JSON.parse(jsonString);

		// Basic structure validation
		if (
			typeof potentialPlan !== "object" ||
			potentialPlan === null ||
			typeof potentialPlan.planDescription !== "string" ||
			!Array.isArray(potentialPlan.steps)
		) {
			const errorMsg =
				"Plan validation failed: Missing top-level fields (planDescription, steps array) or plan is not an object. Please Retry.";
			console.error(errorMsg, potentialPlan);
			return { plan: null, error: errorMsg };
		}

		// Validate each step
		for (let i = 0; i < potentialPlan.steps.length; i++) {
			const step = potentialPlan.steps[i];
			if (
				typeof step !== "object" ||
				step === null ||
				typeof step.step !== "number" ||
				step.step !== i + 1 ||
				!step.action ||
				!Object.values(PlanStepAction).includes(step.action) ||
				typeof step.description !== "string"
			) {
				const errorMsg = `Plan validation failed: Invalid base step structure or numbering at index ${i}. Expected step number ${
					i + 1
				}. Please Retry.`;
				console.error(errorMsg, step);
				return { plan: null, error: errorMsg };
			}

			// --- Property Checks based on Action ---
			const actionsRequiringPath = [
				PlanStepAction.CreateDirectory,
				PlanStepAction.CreateFile,
				PlanStepAction.ModifyFile,
			];
			const actionsRequiringCommand = [PlanStepAction.RunCommand];

			// Validate path presence/absence and safety
			if (actionsRequiringPath.includes(step.action)) {
				if (typeof step.path !== "string" || step.path.trim() === "") {
					const errorMsg = `Plan validation failed: Missing or empty path for required step ${step.step} (${step.action}). Please Retry.`;
					console.error(errorMsg, step);
					return { plan: null, error: errorMsg };
				}
				if (path.isAbsolute(step.path) || step.path.includes("..")) {
					const errorMsg = `Plan validation failed: Invalid path (absolute or traversal) for step ${step.step}: ${step.path}.`;
					console.error(errorMsg, step); // Include step object here
					return { plan: null, error: errorMsg };
				}
				if (typeof step.command !== "undefined") {
					// This is a warning, not a fatal error for parsing, but good to log.
					// Depending on strictness, could be an error. For now, warning.
					console.warn(
						`Plan validation warning: Step ${step.step} (${step.action}) should not have a 'command'.`,
						step
					);
				}
			} else if (actionsRequiringCommand.includes(step.action)) {
				if (typeof step.command !== "string" || step.command.trim() === "") {
					const errorMsg = `Plan validation failed: Missing or empty command for step ${step.step} (${step.action}). Please Retry.`;
					console.error(errorMsg, step);
					return { plan: null, error: errorMsg };
				}
				if (typeof step.path !== "undefined") {
					// Similar to above, path is not expected for command.
					console.warn(
						`Plan validation warning: Step ${step.step} (${step.action}) should not have a 'path'.`,
						step
					);
				}
			} else {
				// Actions that require neither (if any added later)
				if (typeof step.path !== "undefined") {
					console.warn(
						`Plan validation warning: Step ${step.step} (${step.action}) has unexpected 'path'.`,
						step
					);
				}
				if (typeof step.command !== "undefined") {
					console.warn(
						`Plan validation warning: Step ${step.step} (${step.action}) has unexpected 'command'.`,
						step
					);
				}
			}

			// Action-specific validation using type guards
			let actionSpecificError: string | null = null;
			switch (step.action) {
				case PlanStepAction.CreateDirectory:
					if (!isCreateDirectoryStep(step)) {
						actionSpecificError = `Invalid CreateDirectoryStep at index ${i}. Must have a non-empty 'path'. Please Retry.`;
					}
					break;
				case PlanStepAction.CreateFile:
					if (!isCreateFileStep(step)) {
						actionSpecificError = `Invalid CreateFileStep at index ${i}. Must have a non-empty 'path' and either 'content' or 'generate_prompt'. Please Retry.`;
					}
					break;
				case PlanStepAction.ModifyFile:
					if (!isModifyFileStep(step)) {
						actionSpecificError = `Invalid ModifyFileStep at index ${i}. Must have a non-empty 'path' and a non-empty 'modification_prompt'. Please Retry.`;
					}
					break;
				case PlanStepAction.RunCommand:
					if (!isRunCommandStep(step)) {
						actionSpecificError = `Invalid RunCommandStep at index ${i}. Must have a non-empty 'command'. Please Retry.`;
					}
					break;
				default:
					// This case should ideally not be reached if Object.values(PlanStepAction).includes(step.action) passed.
					// However, it's good for exhaustiveness.
					const exhaustiveCheck: any = step.action;
					actionSpecificError = `Unhandled PlanStepAction during validation: ${exhaustiveCheck}`;
					console.warn(actionSpecificError, step); // Log as warning, as base validation passed.
					// Decide if this should be a fatal error. If the action is in PlanStepAction enum,
					// but has no specific validation, it might be okay if it doesn't need extra fields.
					// If it was an *unknown* action, the earlier check `!Object.values(PlanStepAction).includes(step.action)` would have caught it.
					break;
			}

			if (actionSpecificError) {
				console.error(`Plan validation failed: ${actionSpecificError}`, step);
				return { plan: null, error: actionSpecificError };
			}
		}

		console.log("Plan validation successful.");
		return { plan: potentialPlan as ExecutionPlan };
	} catch (error: any) {
		const errorMsg = `Error parsing plan JSON: ${
			error.message || "Unknown JSON parsing error"
		}`;
		console.error(errorMsg, error);
		return { plan: null, error: errorMsg };
	}
}

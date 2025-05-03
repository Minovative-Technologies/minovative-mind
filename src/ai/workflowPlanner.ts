// src/ai/workflowPlanner.ts

import * as path from "path";

/**
 * Defines the possible actions within an execution plan step.
 */
export enum PlanStepAction {
	CreateDirectory = "create_directory",
	CreateFile = "create_file",
	ModifyFile = "modify_file",
	RunCommand = "run_command", // <-- Add new action
	// Removed: InstallDependencies
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
 * Parses a JSON string into an ExecutionPlan and performs basic validation.
 *
 * @param jsonString The JSON string received from the AI.
 * @returns The validated ExecutionPlan object or null if parsing/validation fails.
 */
export function parseAndValidatePlan(jsonString: string): ExecutionPlan | null {
	try {
		const potentialPlan = JSON.parse(jsonString);

		// Basic structure validation
		if (
			typeof potentialPlan !== "object" ||
			potentialPlan === null ||
			typeof potentialPlan.planDescription !== "string" ||
			!Array.isArray(potentialPlan.steps)
		) {
			console.error(
				"Plan validation failed: Missing top-level fields or steps array."
			);
			return null;
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
				console.error(
					`Plan validation failed: Invalid base step structure or numbering at index ${i}.`,
					step
				);
				return null;
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
					console.error(
						`Plan validation failed: Missing or empty path for required step ${step.step} (${step.action}).`,
						step
					);
					return null;
				}
				if (path.isAbsolute(step.path) || step.path.includes("..")) {
					console.error(
						`Plan validation failed: Invalid path (absolute or traversal) for step ${step.step}: ${step.path}`
					);
					return null;
				}
				if (typeof step.command !== "undefined") {
					console.warn(
						`Plan validation warning: Step ${step.step} (${step.action}) should not have a 'command'.`
					);
				}
			} else if (actionsRequiringCommand.includes(step.action)) {
				if (typeof step.command !== "string" || step.command.trim() === "") {
					console.error(
						`Plan validation failed: Missing or empty command for step ${step.step} (${step.action}).`,
						step
					);
					return null;
				}
				if (typeof step.path !== "undefined") {
					console.warn(
						`Plan validation warning: Step ${step.step} (${step.action}) should not have a 'path'.`
					);
				}
			} else {
				// Actions that require neither (if any added later)
				if (typeof step.path !== "undefined") {
					console.warn(
						`Plan validation warning: Step ${step.step} (${step.action}) has unexpected 'path'.`
					);
				}
				if (typeof step.command !== "undefined") {
					console.warn(
						`Plan validation warning: Step ${step.step} (${step.action}) has unexpected 'command'.`
					);
				}
			}

			// Action-specific validation using type guards
			switch (step.action) {
				case PlanStepAction.CreateDirectory:
					if (!isCreateDirectoryStep(step)) {
						console.error(
							`Plan validation failed: Invalid CreateDirectoryStep at index ${i}.`,
							step
						);
						return null;
					}
					break;
				case PlanStepAction.CreateFile:
					if (!isCreateFileStep(step)) {
						console.error(
							`Plan validation failed: Invalid CreateFileStep at index ${i}.`,
							step
						);
						return null;
					}
					break;
				case PlanStepAction.ModifyFile:
					if (!isModifyFileStep(step)) {
						console.error(
							`Plan validation failed: Invalid ModifyFileStep at index ${i}.`,
							step
						);
						return null;
					}
					break;
				case PlanStepAction.RunCommand:
					if (!isRunCommandStep(step)) {
						console.error(
							`Plan validation failed: Invalid RunCommandStep at index ${i}.`,
							step
						);
						return null;
					}
					break;
				// Removed: InstallDependencies case
				default:
					const exhaustiveCheck: any = step.action;
					console.warn(
						`Unhandled valid PlanStepAction during validation: ${exhaustiveCheck}`
					);
					break;
			}
		}

		console.log("Plan validation successful.");
		return potentialPlan as ExecutionPlan;
	} catch (error) {
		console.error("Error parsing plan JSON:", error);
		return null;
	}
}

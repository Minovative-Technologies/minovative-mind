// src/ai/workflowPlanner.ts

import * as path from "path"; // <-- Import the 'path' module

/**
 * Defines the possible actions within an execution plan step.
 */
export enum PlanStepAction {
	CreateDirectory = "create_directory",
	CreateFile = "create_file",
	ModifyFile = "modify_file",
	// Add other actions as needed
}

/**
 * Base interface for a single step in the execution plan.
 */
export interface PlanStep {
	step: number;
	action: PlanStepAction;
	description: string;
	path?: string;
	// Add other common optional fields if needed
}

/**
 * Interface for a 'create_directory' step.
 */
export interface CreateDirectoryStep extends PlanStep {
	action: PlanStepAction.CreateDirectory;
	path: string; // Path is required
}

/**
 * Interface for a 'create_file' step.
 * Must contain either 'content' or 'generate_prompt'.
 */
export interface CreateFileStep extends PlanStep {
	action: PlanStepAction.CreateFile;
	path: string; // Path is required
	content?: string;
	generate_prompt?: string;
}

/**
 * Interface for a 'modify_file' step.
 */
export interface ModifyFileStep extends PlanStep {
	action: PlanStepAction.ModifyFile;
	path: string; // Path is required
	modification_prompt: string; // Instructions are required
}

/**
 * Represents the overall structure of the execution plan.
 */
export interface ExecutionPlan {
	planDescription: string;
	steps: PlanStep[];
}

// --- Type Guards (Corrected) ---

export function isCreateDirectoryStep(
	step: PlanStep
): step is CreateDirectoryStep {
	return (
		step.action === PlanStepAction.CreateDirectory &&
		typeof step.path === "string" && // Ensure path is present and a string
		step.path.trim() !== "" // Ensure path is not empty
	);
}

export function isCreateFileStep(step: PlanStep): step is CreateFileStep {
	// Cast to potentially check properties after confirming action type
	const potentialStep = step as CreateFileStep;
	return (
		potentialStep.action === PlanStepAction.CreateFile &&
		typeof potentialStep.path === "string" &&
		potentialStep.path.trim() !== "" &&
		// Check that EITHER content OR generate_prompt exists (and is a string), but NOT both
		((typeof potentialStep.content === "string" &&
			typeof potentialStep.generate_prompt === "undefined") ||
			(typeof potentialStep.generate_prompt === "string" &&
				typeof potentialStep.content === "undefined"))
	);
}

export function isModifyFileStep(step: PlanStep): step is ModifyFileStep {
	// Cast to potentially check properties after confirming action type
	const potentialStep = step as ModifyFileStep;
	return (
		potentialStep.action === PlanStepAction.ModifyFile &&
		typeof potentialStep.path === "string" &&
		potentialStep.path.trim() !== "" &&
		typeof potentialStep.modification_prompt === "string" && // Check modification_prompt exists
		potentialStep.modification_prompt.trim() !== "" // Ensure modification prompt is not empty
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
				step.step !== i + 1 || // Ensure steps are numbered correctly
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

			// Define actions that require a path
			const actionsRequiringPath = [
				PlanStepAction.CreateDirectory,
				PlanStepAction.CreateFile,
				PlanStepAction.ModifyFile,
			];

			if (actionsRequiringPath.includes(step.action)) {
				// For actions requiring path, validate it exists, is a non-empty string, and is safe
				if (typeof step.path !== "string" || step.path.trim() === "") {
					console.error(
						`Plan validation failed: Missing or empty path for required step ${step.step} (${step.action}).`,
						step
					);
					return null;
				}
				// Basic security check: prevent absolute paths or path traversal
				if (path.isAbsolute(step.path) || step.path.includes("..")) {
					// Now 'path' module is available
					console.error(
						`Plan validation failed: Invalid path (absolute or traversal) for step ${step.step}: ${step.path}`
					);
					return null;
				}
			} else {
				// Handle actions that might not require a path (if any are added later)
				if (typeof step.path !== "undefined" && step.path !== null) {
					console.warn(
						`Step ${step.step} action ${step.action} has an unexpected path defined.`
					);
					// Allow it for now, but log a warning.
				}
			}

			// Action-specific validation using the corrected type guards
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
							`Plan validation failed: Invalid CreateFileStep at index ${i} (must have 'content' OR 'generate_prompt', not both/neither).`,
							step
						);
						return null;
					}
					break;
				case PlanStepAction.ModifyFile:
					if (!isModifyFileStep(step)) {
						console.error(
							`Plan validation failed: Invalid ModifyFileStep at index ${i} (missing/empty 'modification_prompt'?).`,
							step
						);
						return null;
					}
					break;
				// Add cases for future actions if needed
				default:
					console.warn(
						`Step ${step.step}: Unknown action type '${step.action}' encountered during validation.`
					);
					// Allow unknown actions for now? Or return null? Let's allow but warn.
					break;
			}
		}

		console.log("Plan validation successful.");
		return potentialPlan as ExecutionPlan; // Cast to ExecutionPlan after validation
	} catch (error) {
		console.error("Error parsing plan JSON:", error);
		return null;
	}
}

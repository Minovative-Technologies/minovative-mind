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
 * @param workspaceRootUri The URI of the workspace root.
 * @returns An object containing the validated ExecutionPlan or an error message.
 */
export async function parseAndValidatePlan(
	jsonString: string,
	workspaceRootUri: vscode.Uri
): Promise<ParsedPlanResult> {
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

		const ig = await loadGitIgnoreMatcher(workspaceRootUri);
		const modifyFileConsolidationMap = new Map<string, ModifyFileStep>();
		const intermediateSteps: PlanStep[] = [];

		// Process each step and consolidate modify_file steps
		for (let i = 0; i < potentialPlan.steps.length; i++) {
			const step = potentialPlan.steps[i];

			// --- 1. Original Base Validation --- (Preserve these checks)
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

			// --- 2. Original Property Checks and .gitignore Check --- (Preserve and adapt)
			const actionsRequiringPath = [
				PlanStepAction.CreateDirectory,
				PlanStepAction.CreateFile,
				PlanStepAction.ModifyFile,
			];
			let skipStep = false; // Flag to determine if step should be skipped entirely

			if (actionsRequiringPath.includes(step.action)) {
				// Preserve existing path validation
				if (typeof step.path !== "string" || step.path.trim() === "") {
					const errorMsg = `Plan validation failed: Missing or empty path for required step ${step.step} (${step.action}). Path must be a non-empty relative string.`;
					console.error(errorMsg, step);
					return { plan: null, error: errorMsg };
				}
				if (path.isAbsolute(step.path) || step.path.includes("..")) {
					const errorMsg = `Plan validation failed: Path for step ${step.step} ('${step.path}') is invalid. Paths must be relative to the workspace root, use forward slashes, and not contain '..' for directory traversal.`;
					console.error(errorMsg, step);
					return { plan: null, error: errorMsg };
				}

				// Preserve .gitignore check logic, including passing 'step' to console.warn
				const fullPath = path.join(workspaceRootUri.fsPath, step.path);
				const relativePath = path
					.relative(workspaceRootUri.fsPath, fullPath)
					.replace(/\\/g, "/");

				if (
					ig.ignores(relativePath) ||
					(step.action === PlanStepAction.CreateDirectory &&
						ig.ignores(relativePath + "/"))
				) {
					console.warn(
						`Skipping plan step ${step.step} (${step.path}) as its path is ignored by .gitignore rules.`,
						step
					);
					skipStep = true; // Mark for skipping
				}

				if (typeof step.command !== "undefined") {
					console.warn(
						`Plan validation warning: Step ${step.step} (${step.action}) should not have a 'command'.`,
						step
					);
				}
			}

			// Preserve other original property checks (e.g., command presence/absence for specific actions).
			// Also, ensure action-specific validations using type guards (isCreateDirectoryStep, isCreateFileStep, etc.) are correctly called.
			// If any validation fails, return the appropriate error response.
			let actionSpecificError: string | null = null;
			switch (step.action) {
				case PlanStepAction.CreateDirectory:
					if (!isCreateDirectoryStep(step)) {
						actionSpecificError = `Invalid CreateDirectoryStep at index ${i}. Must have a non-empty 'path'.`;
					}
					break;
				case PlanStepAction.CreateFile:
					if (!isCreateFileStep(step)) {
						actionSpecificError = `Invalid CreateFileStep at index ${i}. Must have a non-empty 'path' and either 'content' or 'generate_prompt'.`;
					}
					break;
				case PlanStepAction.ModifyFile:
					if (!isModifyFileStep(step)) {
						actionSpecificError = `Invalid ModifyFileStep at index ${i}. Must have a non-empty 'path' and a non-empty 'modification_prompt'.`;
					}
					break;
				case PlanStepAction.RunCommand:
					if (typeof step.path !== "undefined") {
						console.warn(
							`Plan validation warning: Step ${step.step} (${step.action}) should not have a 'path'.`,
							step
						);
					}
					if (!isRunCommandStep(step)) {
						actionSpecificError = `Invalid RunCommandStep at index ${i}. Must have a non-empty 'command'.`;
					}
					break;
				default:
					// This should be caught by base validation, but for completeness.
					break;
			}
			if (actionSpecificError) {
				console.error(
					`Plan validation failed: ${actionSpecificError} Please Retry.`,
					step
				);
				return { plan: null, error: `${actionSpecificError} Please Retry.` };
			}

			// If the step should be skipped due to .gitignore, continue to the next iteration.
			if (skipStep) {
				continue;
			}

			// --- 3. Consolidation Logic ---
			if (step.action === PlanStepAction.ModifyFile) {
				const filePath = step.path!;
				const currentModificationPrompt = step.modification_prompt;

				if (modifyFileConsolidationMap.has(filePath)) {
					// Existing modification for this file: append prompt
					const existingStep = modifyFileConsolidationMap.get(filePath)!;
					existingStep.modification_prompt += `\n\n---\n\n${currentModificationPrompt}`;
					modifyFileConsolidationMap.set(filePath, existingStep);
					// Do NOT add this current step to intermediateSteps, as it's merged into an existing entry.
				} else {
					// First modification encountered for this file: Create a copy to serve as the initial consolidated step.
					// Add this copy to the map AND to intermediateSteps.
					const newConsolidatedStep: ModifyFileStep = { ...step };
					modifyFileConsolidationMap.set(filePath, newConsolidatedStep);
					intermediateSteps.push(newConsolidatedStep);
				}
			} else {
				// For all other step types (create_directory, create_file, run_command),
				// add them directly to intermediateSteps. These are not consolidated.
				intermediateSteps.push(step);
			}
		} // End of the replaced for loop

		const finalSteps: PlanStep[] = [];

		// Iterate through intermediateSteps. When a placeholder for a modify_file step is found,
		// retrieve its fully consolidated version from modifyFileConsolidationMap.
		for (const intermediateStep of intermediateSteps) {
			if (intermediateStep.action === PlanStepAction.ModifyFile) {
				const filePath = intermediateStep.path!;
				const consolidatedStep = modifyFileConsolidationMap.get(filePath);
				if (consolidatedStep) {
					finalSteps.push(consolidatedStep);
				} else {
					// Safeguard: This case indicates a logic error. If the consolidated step is missing,
					// fall back to using the placeholder, but log an error.
					console.error(
						`Consolidated step not found for file: ${filePath} when reconstructing plan. Using original placeholder.`,
						intermediateStep
					);
					finalSteps.push(intermediateStep);
				}
			} else {
				// For all other step types, add them directly to finalSteps as they are not consolidated.
				finalSteps.push(intermediateStep);
			}
		}

		// Update the 'steps' array in potentialPlan with the final ordered and re-numbered steps.
		potentialPlan.steps = finalSteps.map((step, index) => ({
			...step,
			step: index + 1, // Re-number steps sequentially starting from 1
		}));

		console.log(
			`Plan validation successful. ${finalSteps.length} steps after consolidation and re-numbering.`
		);
		return { plan: potentialPlan as ExecutionPlan };
	} catch (error: any) {
		const errorMsg = `Error parsing plan JSON: ${
			error.message || "Unknown JSON parsing error"
		}`;
		console.error(errorMsg, error);
		return { plan: null, error: errorMsg };
	}
}

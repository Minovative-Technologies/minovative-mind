import * as vscode from "vscode";
import * as path from "path";
import { loadGitIgnoreMatcher } from "../utils/ignoreUtils";
import { detectFramework, ProjectFramework } from "../utils/frameworkDetector";
import {
	getConvention,
	FrameworkConvention,
} from "../utils/frameworkConventions";

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
		const filteredSteps: PlanStep[] = []; // Initialize an empty array for filtered steps
		// Detect framework once for the entire plan validation
		const detectedFramework = await detectFramework(workspaceRootUri);
		const frameworkConvention =
			detectedFramework && detectedFramework !== ProjectFramework.Unknown
				? getConvention(detectedFramework)
				: undefined;

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
					const errorMsg = `Plan validation failed: Missing or empty path for required step ${step.step} (${step.action}). Path must be a non-empty relative string.`;
					console.error(errorMsg, step);
					return { plan: null, error: errorMsg };
				}
				if (path.isAbsolute(step.path) || step.path.includes("..")) {
					const errorMsg = `Plan validation failed: Path for step ${step.step} ('${step.path}') is invalid. Paths must be relative to the workspace root, use forward slashes, and not contain '..' for directory traversal.`;
					console.error(errorMsg, step); // Include step object here
					return { plan: null, error: errorMsg };
				}

				// .gitignore check
				const fullPath = path.join(workspaceRootUri.fsPath, step.path);
				// Normalize path separators for .gitignore matcher
				const relativePath = path
					.relative(workspaceRootUri.fsPath, fullPath)
					.replace(/\\/g, "/");

				if (
					ig.ignores(relativePath) ||
					(step.action === PlanStepAction.CreateDirectory &&
						ig.ignores(relativePath + "/"))
				) {
					const warningMsg =
						"Skipping plan step " +
						step.step +
						" (" +
						step.path +
						") as its path is ignored by .gitignore rules. This step will not be executed.";
					console.warn(warningMsg, step);
					continue;
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
			// --- NEW: Framework-aware Path Validation ---
			if (frameworkConvention && actionsRequiringPath.includes(step.action)) {
				const stepPath = step.path as string; // Assert type after base validation
				let conventionViolationMessage: string | null = null;

				switch (detectedFramework) {
					case ProjectFramework.NextJs:
						if (
							stepPath.startsWith("pages/api/") &&
							!frameworkConvention.typicalFilePaths?.apiRoutes?.some((p) =>
								stepPath.startsWith(p)
							)
						) {
							conventionViolationMessage = `Next.js API route '${stepPath}' should be placed within 'pages/api/'.`;
						} else if (
							stepPath.startsWith("pages/") &&
							!frameworkConvention.typicalFilePaths?.pagesOrRoutes?.some((p) =>
								stepPath.startsWith(p)
							)
						) {
							conventionViolationMessage = `Next.js page '${stepPath}' should be placed within 'pages/'.`;
						} else if (
							(step.action === PlanStepAction.CreateFile ||
								step.action === PlanStepAction.ModifyFile) &&
							stepPath.includes("/components/") &&
							!frameworkConvention.typicalFilePaths?.components?.some((p) =>
								stepPath.includes(p)
							)
						) {
							conventionViolationMessage = `Next.js component '${stepPath}' should typically be in 'components/' or 'src/components/'.`;
						}
						// Add naming convention checks (e.g., PascalCase for components)
						if (
							stepPath.match(/components\/[A-Za-z0-9\-\_]+\.(tsx|jsx|ts|js)/) &&
							!/components\/[A-Z][a-zA-Z0-9]*\.(tsx|jsx|ts|js)/.test(stepPath)
						) {
							conventionViolationMessage = `Next.js component file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'MyComponent.tsx').`;
						}
						break;
					case ProjectFramework.Angular:
						// Example: Angular components typically end with .component.ts
						if (
							(step.action === PlanStepAction.CreateFile ||
								step.action === PlanStepAction.ModifyFile) &&
							stepPath.includes(".component.") &&
							!frameworkConvention.typicalFilePaths?.components?.some((p) =>
								stepPath.includes(p)
							)
						) {
							conventionViolationMessage = `Angular component '${stepPath}' should typically be in 'src/app/' or 'src/app/components/'.`;
						}
						// Example: Angular files should use kebab-case
						if (/[A-Z]/.test(path.basename(stepPath))) {
							// Check for uppercase letters
							conventionViolationMessage = `Angular file '${path.basename(
								stepPath
							)}' should use kebab-case (e.g., 'my-component.ts').`;
						}
						break;
					case ProjectFramework.Vue:
						if (
							(step.action === PlanStepAction.CreateFile ||
								step.action === PlanStepAction.ModifyFile) &&
							stepPath.endsWith(".vue") &&
							!frameworkConvention.typicalFilePaths?.components?.some((p) =>
								stepPath.includes(p)
							)
						) {
							conventionViolationMessage = `Vue component '${stepPath}' should typically be in 'src/components/' or 'src/views/'.`;
						}
						if (
							stepPath.endsWith(".vue") &&
							!/^[A-Z][a-zA-Z0-9]*\.vue$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Vue single-file component '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'MyComponent.vue').`;
						}
						break;
					case ProjectFramework.Python:
					case ProjectFramework.PythonDjango:
					case ProjectFramework.PythonFlask:
						// Example: Python files should use snake_case
						if (
							stepPath.endsWith(".py") &&
							/[A-Z]/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Python file '${path.basename(
								stepPath
							)}' should use snake_case (e.g., 'my_module.py').`;
						}
						// Add checks for common directory placements (e.g., tests/ should contain test files)
						break;

					case ProjectFramework.DotNetCsharp:
					case ProjectFramework.UnityCsharp: // Unity also uses PascalCase for C#
						// Example: C# files should use PascalCase
						if (
							stepPath.endsWith(".cs") &&
							!/^[A-Z][a-zA-Z0-9]*\.cs$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `C# file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'MyClass.cs').`;
						}
						// Additional: Check for typical C# project subdirectories (Controllers/, Models/, etc.)
						// For Unity, specifically check for Assets/Scripts/ for new C# files.
						if (
							detectedFramework === ProjectFramework.UnityCsharp &&
							stepPath.endsWith(".cs") &&
							!stepPath.startsWith("Assets/Scripts/")
						) {
							conventionViolationMessage = `Unity C# script '${stepPath}' should typically be placed in 'Assets/Scripts/' or a subfolder within it.`;
						}
						break;

					case ProjectFramework.Go:
						// Example: Go files often use snake_case, directories kebab-case
						if (
							stepPath.endsWith(".go") &&
							/[A-Z]/.test(path.basename(stepPath)) &&
							!/^[a-z0-9_]+\.go$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Go file '${path.basename(
								stepPath
							)}' should use snake_case (e.g., 'my_package.go').`;
						}
						// Example: Enforce Go standard project layout
						if (
							(stepPath.startsWith("src/") || stepPath.startsWith("lib/")) &&
							!stepPath.startsWith("pkg/") &&
							!stepPath.startsWith("internal/") &&
							!stepPath.startsWith("cmd/")
						) {
							conventionViolationMessage = `Go projects often prefer 'pkg/', 'internal/', 'cmd/' for top-level code organization.`;
						}
						break;

					case ProjectFramework.Ruby:
					case ProjectFramework.RubyRails:
						// Example: Ruby files should use snake_case
						if (
							stepPath.endsWith(".rb") &&
							/[A-Z]/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Ruby file '${path.basename(
								stepPath
							)}' should use snake_case (e.g., 'my_util.rb').`;
						}
						// For Rails, check app/models, app/controllers, etc.
						if (detectedFramework === ProjectFramework.RubyRails) {
							if (
								stepPath.startsWith("app/") &&
								!/app\/(models|views|controllers|helpers|assets)\//.test(
									stepPath
								)
							) {
								conventionViolationMessage = `Rails app files should be placed in standard directories like 'app/models/', 'app/views/', 'app/controllers/'.`;
							}
						}
						break;

					case ProjectFramework.CppCMake:
						// C++ conventions can be varied, focus on general structure
						if (stepPath.endsWith(".h") || stepPath.endsWith(".hpp")) {
							if (!stepPath.includes("include/")) {
								conventionViolationMessage = `C++ header file '${stepPath}' should typically be placed in an 'include/' directory.`;
							}
						} else if (stepPath.endsWith(".cpp") || stepPath.endsWith(".cc")) {
							if (!stepPath.includes("src/")) {
								conventionViolationMessage = `C++ source file '${stepPath}' should typically be placed in a 'src/' directory.`;
							}
						}
						break;

					case ProjectFramework.JavaMaven:
						// Java files should be PascalCase and follow package structure
						if (
							stepPath.endsWith(".java") &&
							!/^[A-Z][a-zA-Z0-9]*\.java$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Java file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'MyClass.java').`;
						}
						if (
							stepPath.startsWith("src/") &&
							!stepPath.startsWith("src/main/java/") &&
							!stepPath.startsWith("src/test/java/") &&
							!stepPath.startsWith("src/main/resources/")
						) {
							conventionViolationMessage = `Java files should adhere to Maven's standard layout (e.g., 'src/main/java/', 'src/test/java/').`;
						}
						break;

					case ProjectFramework.KotlinAndroid:
						// Kotlin files should be PascalCase, resources snake_case.
						if (
							stepPath.endsWith(".kt") &&
							!/^[A-Z][a-zA-Z0-9]*\.kt$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Kotlin file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'MyActivity.kt').`;
						}
						if (
							stepPath.startsWith("app/src/main/res/layout/") &&
							!/^[a-z0-9_]+\.xml$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Android layout file '${path.basename(
								stepPath
							)}' should use snake_case (e.g., 'activity_main.xml').`;
						}
						break;

					case ProjectFramework.SwiftIOS:
						// Swift files should be PascalCase
						if (
							stepPath.endsWith(".swift") &&
							!/^[A-Z][a-zA-Z0-9]*\.swift$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Swift file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'MyViewController.swift').`;
						}
						if (
							stepPath.includes("/Controllers/") ||
							stepPath.includes("/Views/") ||
							stepPath.includes("/Models/")
						) {
							// General guidance for iOS structure, more specific checks can be added later if needed.
						}
						break;
					case ProjectFramework.SvelteKit:
						if (
							(step.action === PlanStepAction.CreateFile ||
								step.action === PlanStepAction.ModifyFile) &&
							stepPath.endsWith(".svelte") &&
							!/^[A-Z][a-zA-Z0-9]*\.svelte$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `SvelteKit component file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'MyComponent.svelte').`;
						}
						if (
							stepPath.includes("src/routes/") &&
							(stepPath.endsWith("+page.ts") ||
								stepPath.endsWith("+page.js") ||
								stepPath.endsWith("+page.svelte")) &&
							!/^(\+\w+\.(svelte|ts|js))$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `SvelteKit page/route file '${path.basename(
								stepPath
							)}' should start with '+' (e.g., '+page.svelte').`;
						}
						break;
					case ProjectFramework.Laravel:
						if (
							stepPath.endsWith(".php") &&
							!/^[A-Z][a-zA-Z0-9]*\.php$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Laravel PHP file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'UserController.php').`;
						}
						if (
							stepPath.startsWith("resources/views/") &&
							!/^[a-z0-9_.-]+\.blade\.php$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Laravel view file '${path.basename(
								stepPath
							)}' should use kebab-case/snake-case and end with '.blade.php' (e.g., 'users/index.blade.php').`;
						}
						break;
					case ProjectFramework.Deno:
						if (stepPath.endsWith(".ts") || stepPath.endsWith(".js")) {
							if (/[A-Z]/.test(path.basename(stepPath))) {
								conventionViolationMessage = `Deno files '${path.basename(
									stepPath
								)}' typically use snake_case or kebab-case (e.g., 'my_module.ts').`;
							}
						}
						break;

					case ProjectFramework.Electron:
						if (stepPath.endsWith(".js") || stepPath.endsWith(".ts")) {
							if (/[A-Z]/.test(path.basename(stepPath))) {
								conventionViolationMessage = `Electron JS/TS file '${path.basename(
									stepPath
								)}' typically use kebab-case (e.g., 'main-process.js').`;
							}
						}
						break;
					case ProjectFramework.DotNetMaui:
						if (
							stepPath.endsWith(".cs") &&
							!/^[A-Z][a-zA-Z0-9]*\.cs$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `.NET MAUI C# file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'MainPage.cs').`;
						}
						if (
							stepPath.endsWith(".xaml") &&
							!/^[A-Z][a-zA-Z0-9]*\.xaml$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `.NET MAUI XAML file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'MainPage.xaml').`;
						}
						break;

					case ProjectFramework.Flutter:
						if (
							stepPath.endsWith(".dart") &&
							!/^[a-z0-9_]+\.dart$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Flutter Dart file '${path.basename(
								stepPath
							)}' should use snake_case (e.g., 'my_widget.dart').`;
						}
						break;
					case ProjectFramework.ReactNative:
						if (
							(stepPath.endsWith(".js") ||
								stepPath.endsWith(".jsx") ||
								stepPath.endsWith(".ts") ||
								stepPath.endsWith(".tsx")) &&
							stepPath.includes("components/") &&
							!/^[A-Z][a-zA-Z0-9]*\.(js|jsx|ts|tsx)$/.test(
								path.basename(stepPath)
							)
						) {
							conventionViolationMessage = `React Native component file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'MyButton.tsx').`;
						}
						break;

					case ProjectFramework.UnrealEngine:
						if (
							(stepPath.endsWith(".h") || stepPath.endsWith(".cpp")) &&
							!/^[A-Z][a-zA-Z0-9_]+\.(h|cpp)$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Unreal Engine C++ file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'MyActor.h').`;
						}
						if (
							stepPath.includes("Source/") &&
							!(stepPath.includes("/Public/") || stepPath.includes("/Private/"))
						) {
							conventionViolationMessage = `Unreal Engine C++ files in 'Source/' should be in 'Public/' or 'Private/' subdirectories.`;
						}
						break;
					case ProjectFramework.GodotEngine:
						if (
							stepPath.endsWith(".gd") &&
							/[A-Z]/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Godot GDScript file '${path.basename(
								stepPath
							)}' should use snake_case (e.g., 'player_controller.gd').`;
						} else if (
							stepPath.endsWith(".cs") &&
							!/^[A-Z][a-zA-Z0-9]*\.cs$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Godot C# script file '${path.basename(
								stepPath
							)}' should use PascalCase (e.g., 'PlayerController.cs').`;
						}
						break;

					case ProjectFramework.PythonML:
						// Re-use Python validation, but add specific checks for ML project structure
						if (
							stepPath.endsWith(".py") &&
							/[A-Z]/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Python file '${path.basename(
								stepPath
							)}' should use snake_case (e.g., 'data_preprocessing.py').`;
						}
						if (
							stepPath.startsWith("data/") &&
							!stepPath.match(/^data\/(raw|processed|external)\//)
						) {
							conventionViolationMessage = `Python ML data files '${stepPath}' should be organized into 'data/raw/', 'data/processed/', or 'data/external/'.`;
						}
						break;
					case ProjectFramework.JupyterNotebook:
						if (
							stepPath.endsWith(".ipynb") &&
							/[A-Z]/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Jupyter Notebook file '${path.basename(
								stepPath
							)}' should typically use kebab-case or snake_case (e.g., 'data-exploration.ipynb').`;
						}
						if (
							!stepPath.startsWith("notebooks/") &&
							!/^[^/]+\.ipynb$/.test(stepPath)
						) {
							conventionViolationMessage = `Jupyter Notebooks '${stepPath}' should be in a 'notebooks/' directory or the project root.`;
						}
						break;

					case ProjectFramework.DockerCompose:
						if (stepPath.endsWith(".yml") || stepPath.endsWith(".yaml")) {
							if (
								/[A-Z]/.test(path.basename(stepPath)) &&
								!/^[a-z0-9_-]+\.(yml|yaml)$/.test(path.basename(stepPath))
							) {
								conventionViolationMessage = `Docker Compose YAML file '${path.basename(
									stepPath
								)}' should use kebab-case (e.g., 'docker-compose.yml').`;
							}
						}
						break;
					case ProjectFramework.Kubernetes:
						if (
							(stepPath.endsWith(".yml") || stepPath.endsWith(".yaml")) &&
							/[A-Z]/.test(path.basename(stepPath)) &&
							!/^[a-z0-9_-]+\.(yml|yaml)$/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Kubernetes manifest file '${path.basename(
								stepPath
							)}' should use kebab-case (e.g., 'my-deployment.yaml').`;
						}
						if (
							stepPath.includes("/") &&
							!(
								stepPath.startsWith("k8s/") ||
								stepPath.startsWith("manifests/") ||
								stepPath.startsWith("charts/")
							)
						) {
							conventionViolationMessage = `Kubernetes manifest file '${stepPath}' should typically be in a 'k8s/', 'manifests/', or 'charts/' directory.`;
						}
						break;
					case ProjectFramework.Terraform:
						if (
							stepPath.endsWith(".tf") &&
							/[A-Z]/.test(path.basename(stepPath))
						) {
							conventionViolationMessage = `Terraform file '${path.basename(
								stepPath
							)}' should use snake_case (e.g., 'main.tf', 'variables.tf').`;
						}
						if (
							stepPath.includes("/") &&
							!(
								stepPath.startsWith("modules/") ||
								stepPath.startsWith("environments/")
							)
						) {
							conventionViolationMessage = `Terraform file '${stepPath}' should typically be in 'modules/' or 'environments/' for complex projects.`;
						}
						break;
					default:
						// For unknown or un-handled specific frameworks, rely on general checks.
						break;
				}

				if (conventionViolationMessage) {
					const errorMsg = `Plan validation failed for step ${step.step} (${step.action}): Framework convention violation. ${conventionViolationMessage} Please adjust path: '${stepPath}' to follow ${detectedFramework} conventions.`;
					console.error(errorMsg, step);
					return { plan: null, error: errorMsg };
				}
			}
			// --- END: Framework-aware Path Validation ---

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

			// If the step passed all validations (including .gitignore check), add it to the filtered list
			filteredSteps.push(step);
		}

		potentialPlan.steps = filteredSteps.map((step, index) => ({
			...step,
			step: index + 1, // Assign new sequential step numbers based on the filtered list
		}));
		console.log(
			`Plan validation successful. ${filteredSteps.length} steps remaining after filtering.`
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

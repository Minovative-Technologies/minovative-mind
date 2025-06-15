import * as vscode from "vscode";
import * as path from "path";

export enum ProjectFramework {
	NextJs = "Next.js",
	React = "React",
	Angular = "Angular",
	Vue = "Vue.js",
	NodeExpress = "Node.js (Express)",
	Svelte = "Svelte",
	Gatsby = "Gatsby",
	NestJs = "NestJS",
	Python = "Python (General)",
	PythonDjango = "Python (Django)",
	PythonFlask = "Python (Flask)",
	DotNetCsharp = ".NET (C#)",
	UnityCsharp = "Unity (C#)", // For game development
	Go = "Go",
	Ruby = "Ruby (General)",
	RubyRails = "Ruby (Ruby on Rails)",
	CppCMake = "C++ (CMake)", // For general C++ projects
	JavaMaven = "Java (Maven)",
	KotlinAndroid = "Kotlin (Android)", // For mobile development
	SwiftIOS = "Swift (iOS)", // For mobile development
	SvelteKit = "SvelteKit",
	Laravel = "Laravel",
	Deno = "Deno",
	Electron = "Electron",
	DotNetMaui = ".NET MAUI",
	Flutter = "Flutter",
	ReactNative = "React Native",
	UnrealEngine = "Unreal Engine (C++)",
	GodotEngine = "Godot Engine (GDScript/C#)",
	PythonML = "Python (ML/Data Science)",
	JupyterNotebook = "Jupyter Notebook Project",
	DockerCompose = "Docker Compose",
	Kubernetes = "Kubernetes",
	Terraform = "Terraform",
	Unknown = "Unknown",
}

/**
 * Analyzes the workspace to infer the primary project framework.
 * Prioritizes more specific frameworks over general ones (e.g., Next.js over React).
 * @param workspaceRootUri The URI of the workspace root.
 * @returns A promise that resolves to the detected ProjectFramework or null if none is confidently identified.
 */
export async function detectFramework(
	workspaceRootUri: vscode.Uri
): Promise<ProjectFramework | null> {
	const packageJsonPath = vscode.Uri.joinPath(workspaceRootUri, "package.json");
	let packageJsonContent: any = {};

	try {
		const contentBytes = await vscode.workspace.fs.readFile(packageJsonPath);
		packageJsonContent = JSON.parse(
			Buffer.from(contentBytes).toString("utf-8")
		);
	} catch (error) {
		console.log(
			`No package.json found or readable at ${packageJsonPath.fsPath}. Cannot infer framework from dependencies.`
		);
		// Continue without package.json, might rely on folder structure or config files
	}

	const dependencies = {
		...(packageJsonContent.dependencies || {}),
		...(packageJsonContent.devDependencies || {}),
	};

	// --- New Language/Framework Detection ---

	// C# / .NET / Unity
	if (
		(await pathExists(vscode.Uri.joinPath(workspaceRootUri, "*.sln"))) ||
		(await findFileByExtension(workspaceRootUri, ".csproj"))
	) {
		// Heuristic for Unity: Check for common Unity project structure
		if (
			(await pathExists(vscode.Uri.joinPath(workspaceRootUri, "Assets"))) &&
			(await pathExists(
				vscode.Uri.joinPath(workspaceRootUri, "ProjectSettings")
			))
		) {
			return ProjectFramework.UnityCsharp;
		}
		return ProjectFramework.DotNetCsharp;
	}

	// Python
	if (
		(await pathExists(
			vscode.Uri.joinPath(workspaceRootUri, "requirements.txt")
		)) ||
		(await pathExists(vscode.Uri.joinPath(workspaceRootUri, "Pipfile"))) ||
		(await pathExists(
			vscode.Uri.joinPath(workspaceRootUri, "pyproject.toml")
		)) ||
		(await pathExists(vscode.Uri.joinPath(workspaceRootUri, "setup.py")))
	) {
		if (await pathExists(vscode.Uri.joinPath(workspaceRootUri, "manage.py"))) {
			return ProjectFramework.PythonDjango; // Django specific
		}
		// Could add more specific Flask checks (e.g., app.py in root with common Flask imports)
		return ProjectFramework.Python; // General Python
	}

	// Go
	if (await pathExists(vscode.Uri.joinPath(workspaceRootUri, "go.mod"))) {
		return ProjectFramework.Go;
	}

	// Ruby
	if (await pathExists(vscode.Uri.joinPath(workspaceRootUri, "Gemfile"))) {
		if (
			await pathExists(
				vscode.Uri.joinPath(workspaceRootUri, "config/routes.rb")
			)
		) {
			return ProjectFramework.RubyRails; // Ruby on Rails
		}
		return ProjectFramework.Ruby; // General Ruby
	}

	// C++ (CMake)
	if (
		await pathExists(vscode.Uri.joinPath(workspaceRootUri, "CMakeLists.txt"))
	) {
		return ProjectFramework.CppCMake;
	}

	// Java (Maven example, add Gradle if needed)
	if (await pathExists(vscode.Uri.joinPath(workspaceRootUri, "pom.xml"))) {
		return ProjectFramework.JavaMaven;
	}

	// Kotlin (Android)
	if (
		(await pathExists(
			vscode.Uri.joinPath(workspaceRootUri, "AndroidManifest.xml")
		)) &&
		(await pathExists(
			vscode.Uri.joinPath(
				vscode.Uri.joinPath(workspaceRootUri, "app"),
				"build.gradle"
			)
		))
	) {
		return ProjectFramework.KotlinAndroid;
	}

	// Swift (iOS)
	if (
		(await findFileByExtension(workspaceRootUri, ".xcodeproj")) ||
		(await findFileByExtension(workspaceRootUri, ".xcworkspace"))
	) {
		return ProjectFramework.SwiftIOS;
	}

	// Web Development (Additional)
	// SvelteKit: Check for svelte.config.js (already covered by Svelte) and specific Kit structure/dependencies
	if (
		dependencies["@sveltejs/kit"] ||
		((await pathExists(
			vscode.Uri.joinPath(workspaceRootUri, "svelte.config.js")
		)) &&
			((await pathExists(
				vscode.Uri.joinPath(workspaceRootUri, "src/routes")
			)) ||
				(await pathExists(vscode.Uri.joinPath(workspaceRootUri, "src/lib")))))
	) {
		return ProjectFramework.SvelteKit;
	}
	// Laravel: Check for composer.json with laravel/framework and artisan script
	if (
		dependencies["laravel/framework"] ||
		((await pathExists(
			vscode.Uri.joinPath(workspaceRootUri, "composer.json")
		)) &&
			(await pathExists(vscode.Uri.joinPath(workspaceRootUri, "artisan"))))
	) {
		return ProjectFramework.Laravel;
	}
	// Deno: Check for deno.json or common Deno entry points/import patterns (more complex to reliably detect via files only)
	if (await pathExists(vscode.Uri.joinPath(workspaceRootUri, "deno.json"))) {
		return ProjectFramework.Deno;
	}

	// Desktop Applications
	// Electron: Check for 'electron' dependency in package.json
	if (
		dependencies["electron"] ||
		dependencies["electron-builder"] ||
		dependencies["electron-packager"]
	) {
		return ProjectFramework.Electron;
	}
	// .NET MAUI: Check for .csproj file with specific MAUI SDK reference
	if (await findFileContent(workspaceRootUri, ".csproj", "<UseMaui>true")) {
		return ProjectFramework.DotNetMaui;
	}

	// Mobile Development (Additional)
	// Flutter (General Mobile/Desktop): Check for pubspec.yaml with flutter sdk
	if (
		(await pathExists(vscode.Uri.joinPath(workspaceRootUri, "pubspec.yaml"))) &&
		(await findFileContent(
			vscode.Uri.joinPath(workspaceRootUri, "pubspec.yaml"),
			null,
			"sdk: flutter"
		))
	) {
		return ProjectFramework.Flutter;
	}
	// React Native: Check for 'react-native' dependency in package.json
	if (dependencies["react-native"]) {
		return ProjectFramework.ReactNative;
	}

	// Game Development
	// Unreal Engine (C++): Check for .uproject file and Source/
	if (
		(await findFileByExtension(workspaceRootUri, ".uproject")) &&
		(await pathExists(vscode.Uri.joinPath(workspaceRootUri, "Source")))
	) {
		return ProjectFramework.UnrealEngine;
	}
	// Godot Engine (GDScript/C#): Check for project.godot file
	if (
		await pathExists(vscode.Uri.joinPath(workspaceRootUri, "project.godot"))
	) {
		return ProjectFramework.GodotEngine;
	}

	// Data Science & Machine Learning
	// Python ML/Data Science: Check for common ML library dependencies in requirements.txt/pyproject.toml
	if (
		(await findFileContent(
			vscode.Uri.joinPath(workspaceRootUri, "requirements.txt"),
			null,
			"pandas|numpy|scikit-learn|tensorflow|keras|torch"
		)) ||
		(await findFileContent(
			vscode.Uri.joinPath(workspaceRootUri, "pyproject.toml"),
			null,
			"pandas|numpy|scikit-learn|tensorflow|keras|torch"
		))
	) {
		return ProjectFramework.PythonML;
	}
	// Jupyter Notebook Project: Check for presence of .ipynb files
	if (await findFileByExtension(workspaceRootUri, ".ipynb")) {
		return ProjectFramework.JupyterNotebook;
	}

	// Cloud & DevOps
	// Docker Compose: Check for docker-compose.yml or docker-compose.yaml
	if (
		(await pathExists(
			vscode.Uri.joinPath(workspaceRootUri, "docker-compose.yml")
		)) ||
		(await pathExists(
			vscode.Uri.joinPath(workspaceRootUri, "docker-compose.yaml")
		))
	) {
		return ProjectFramework.DockerCompose;
	}
	// Kubernetes: Check for .yaml/.yml files with Kubernetes specific keywords (e.g., apiVersion, kind)
	if (
		(await findFileContent(workspaceRootUri, ".yaml", "apiVersion:")) ||
		(await findFileContent(workspaceRootUri, ".yml", "apiVersion:")) ||
		(await findFileContent(workspaceRootUri, ".yaml", "kind:")) ||
		(await findFileContent(workspaceRootUri, ".yml", "kind:"))
	) {
		return ProjectFramework.Kubernetes;
	}
	// Terraform: Check for .tf files
	if (await findFileByExtension(workspaceRootUri, ".tf")) {
		return ProjectFramework.Terraform;
	}

	// Check for specific framework indicators
	if (dependencies["next"]) {
		return ProjectFramework.NextJs;
	}
	if (
		dependencies["@angular/core"] ||
		(await pathExists(vscode.Uri.joinPath(workspaceRootUri, "angular.json")))
	) {
		return ProjectFramework.Angular;
	}
	if (
		dependencies["vue"] ||
		(await pathExists(
			vscode.Uri.joinPath(workspaceRootUri, "vue.config.js")
		)) ||
		(await pathExists(vscode.Uri.joinPath(workspaceRootUri, "nuxt.config.js")))
	) {
		// Include Nuxt detection for Vue ecosystems
		return ProjectFramework.Vue;
	}
	if (
		dependencies["react"] &&
		!dependencies["next"] &&
		!dependencies["gatsby"]
	) {
		// General React, if not Next.js or Gatsby
		return ProjectFramework.React;
	}
	if (dependencies["express"]) {
		return ProjectFramework.NodeExpress;
	}
	if (
		dependencies["svelte"] ||
		(await pathExists(
			vscode.Uri.joinPath(workspaceRootUri, "svelte.config.js")
		))
	) {
		return ProjectFramework.Svelte;
	}
	if (dependencies["gatsby"]) {
		return ProjectFramework.Gatsby;
	}
	if (dependencies["@nestjs/core"]) {
		return ProjectFramework.NestJs;
	}

	// Fallback to unknown if no specific framework is detected
	console.log("No specific framework detected based on common indicators.");
	return ProjectFramework.Unknown; // Or null if strictly no detection
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function findFileByExtension(
	workspaceRootUri: vscode.Uri,
	pattern: string
): Promise<boolean> {
	const files = await vscode.workspace.findFiles(
		new vscode.RelativePattern(workspaceRootUri, `**/*${pattern}`),
		"**/{node_modules,target,build,bin,obj,.vscode,venv,.git}/**",
		1
	);
	return files.length > 0;
}

// Add a new helper function for searching content within files
async function findFileContent(
	uri: vscode.Uri,
	extension: string | null,
	contentRegex: string
): Promise<boolean> {
	try {
		let files: vscode.Uri[] = [];
		if (extension) {
			files = await vscode.workspace.findFiles(
				new vscode.RelativePattern(uri, `**/*${extension}`),
				"**/{node_modules,.git,.venv,venv}/**",
				10
			); // Limit to 10 files for performance
		} else {
			// If no extension, assume `uri` is a specific file path.
			// Read that file directly if it exists.
			if (await pathExists(uri)) {
				files.push(uri);
			}
		}

		const regex = new RegExp(contentRegex, "i"); // Case-insensitive
		for (const file of files) {
			try {
				const contentBytes = await vscode.workspace.fs.readFile(file);
				const content = Buffer.from(contentBytes).toString("utf-8");
				if (regex.test(content)) {
					return true;
				}
			} catch (readErr) {
				// Ignore read errors, continue to next file
			}
		}
		return false;
	} catch {
		return false;
	}
}

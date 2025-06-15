import { ProjectFramework } from "./frameworkDetector";

/**
 * Defines common file structuring and naming conventions for a given framework.
 */
export interface FrameworkConvention {
	description: string; // A general description for the AI
	typicalFilePaths?: {
		components?: string[];
		pagesOrRoutes?: string[];
		apiRoutes?: string[];
		styles?: string[];
		utils?: string[];
		hooks?: string[];
		services?: string[];
		models?: string[];
		schemas?: string[];
		controllers?: string[];
		modules?: string[];
		views?: string[];
		templates?: string[]; // For templating engines like Django
		admin?: string[]; // For admin panels
		migrations?: string[]; // For database migrations
		tests?: string[]; // For test files
		data?: string[]; // For data layers/repositories
		middleware?: string[]; // For middleware
		includes?: string[]; // For C++ headers
		build?: string[]; // For build artifacts
		repositories?: string[]; // For repositories (Java)
		resources?: string[]; // For resources (Java, Android, iOS)
		layouts?: string[]; // For Android layouts
		drawables?: string[]; // For Android drawables
		values?: string[]; // For Android values
		storyboards?: string[]; // For iOS storyboards
		prefabs?: string[]; // For Unity prefabs
		scenes?: string[]; // For Unity scenes
		shaders?: string[]; // For Unity shaders
		animations?: string[]; // For Unity animations
		scripts?: string[]; // For general scripts (Ruby)
		assets?: string[]; // For web assets (Rails)
		main?: string[]; // For main entry files
		preload?: string[]; // For Electron preload scripts
		commands?: string[]; // For Laravel Artisan commands
		dependencies?: string[]; // For Deno deps.ts
		sourceCode?: string[]; // For general source code
		helmCharts?: string[]; // For Kubernetes Helm charts
		environments?: string[]; // For Terraform environments
		variables?: string[]; // For Terraform variables
		outputs?: string[]; // For Terraform outputs
		providers?: string[]; // For Terraform providers
		config?: string[]; // For general configuration files (Docker Compose, K8s)
		volumes?: string[]; // For Docker Compose volumes
	};
	namingConventions?: {
		componentFiles?: string; // e.g., "PascalCase.tsx"
		pageFiles?: string; // e.g., "kebab-case.tsx" or "PascalCase.tsx"
		apiRouteFiles?: string; // e.g., "kebab-case.ts"
		styleFiles?: string; // e.g., "kebab-case.module.css"
		generalFiles?: string; // e.g., "kebab-case.ts"
		directories?: string; // e.g., "kebab-case"
		views?: string; // e.g., "kebab-case.blade.php" for Laravel
	};
	bestPractices?: string[]; // Specific textual advice
}

/**
 * A map storing convention details for various detected frameworks.
 */
const FRAMEWORK_CONVENTIONS: Map<ProjectFramework, FrameworkConvention> =
	new Map([
		[
			ProjectFramework.NextJs,
			{
				description:
					"Next.js projects typically use a 'pages/' directory for routes and API endpoints, a 'components/' directory for reusable UI components, and often 'public/' for static assets.",
				typicalFilePaths: {
					pagesOrRoutes: ["pages/", "app/"],
					apiRoutes: ["pages/api/", "app/api/"],
					components: ["components/", "src/components/"],
					styles: [
						"styles/",
						"src/styles/",
						"components/**/*.module.css",
						"components/**/*.css",
						"app/**/*.module.css",
						"app/**/*.css",
					],
					utils: ["utils/", "src/utils/"],
					hooks: ["hooks/", "src/hooks/"],
				},
				namingConventions: {
					componentFiles: "PascalCase.tsx/jsx",
					pageFiles:
						"kebab-case.tsx/jsx (for dynamic segments like [id].tsx), or index.tsx",
					apiRouteFiles:
						"kebab-case.ts (for dynamic segments like [id].ts), or index.ts",
					styleFiles: "kebab-case.module.css or kebab-case.css",
					generalFiles: "kebab-case.ts/js",
					directories: "kebab-case",
				},
				bestPractices: [
					"Place pages inside the `pages/` or `app/` directory.",
					"API routes must be placed inside `pages/api/` or `app/api/`.",
					"Co-locate styles with components where applicable, e.g., using CSS Modules.",
					"Use PascalCase for React component file names and kebab-case for directories and other utility files.",
				],
			},
		],
		[
			ProjectFramework.Angular,
			{
				description:
					"Angular projects follow a modular structure, often using 'src/app/' for core application logic, 'src/app/components/' for components, 'src/app/services/' for services, and a 'src/assets/' for static assets.",
				typicalFilePaths: {
					components: ["src/app/", "src/app/components/"],
					modules: ["src/app/", "src/app/modules/"],
					services: ["src/app/services/"],
					views: ["src/app/"],
					styles: ["src/", "src/app/", "src/styles/"],
				},
				namingConventions: {
					componentFiles: "kebab-case.component.ts/html/css",
					generalFiles: "kebab-case.ts",
					directories: "kebab-case",
				},
				bestPractices: [
					"Use kebab-case for file and directory names (e.g., `my-component.component.ts`).",
					"Feature modules are encouraged for large applications.",
					"Keep related files (component, template, style) together.",
				],
			},
		],
		[
			ProjectFramework.Vue,
			{
				description:
					"Vue.js projects typically have a 'src/components/' directory for reusable components, 'src/views/' for page-level components, 'src/router/' for routing, and 'src/store/' for state management.",
				typicalFilePaths: {
					components: ["src/components/"],
					views: ["src/views/"],
					styles: ["src/assets/css/", "src/components/**/*.vue"],
					utils: ["src/utils/"],
				},
				namingConventions: {
					componentFiles: "PascalCase.vue",
					generalFiles: "kebab-case.ts/js",
					directories: "kebab-case",
				},
				bestPractices: [
					"Use PascalCase for single-file component names (e.g., `MyButton.vue`).",
					"Use kebab-case for directory names.",
					"Organize components by feature or domain.",
				],
			},
		],
		[
			ProjectFramework.React, // General React without Next/Gatsby
			{
				description:
					"Standard React applications often structure files under a 'src/' directory, with 'src/components/' for UI components, 'src/pages/' or 'src/routes/' for route-specific components, and 'src/utils/', 'src/hooks/' for utilities and custom hooks.",
				typicalFilePaths: {
					components: ["src/components/", "src/"],
					pagesOrRoutes: ["src/pages/", "src/routes/"],
					styles: ["src/styles/", "src/**/*.css", "src/**/*.module.css"],
					utils: ["src/utils/"],
					hooks: ["src/hooks/"],
				},
				namingConventions: {
					componentFiles: "PascalCase.tsx/jsx",
					generalFiles: "kebab-case.ts/js",
					directories: "kebab-case",
				},
				bestPractices: [
					"Use PascalCase for React component file names (e.g., `Button.tsx`).",
					"Use kebab-case for non-component files and directories (e.g., `user-service.ts`, `auth-utils/`).",
					"Co-locate related files (e.g., `Button/index.tsx`, `Button/Button.module.css`).",
				],
			},
		],
		[
			ProjectFramework.NodeExpress,
			{
				description:
					"Node.js with Express commonly organizes applications into 'src/', 'routes/', 'controllers/', 'models/', 'services/', and 'middleware/' directories.",
				typicalFilePaths: {
					apiRoutes: ["routes/", "src/routes/"],
					controllers: ["controllers/", "src/controllers/"],
					models: ["models/", "src/models/"],
					services: ["services/", "src/services/"],
					utils: ["utils/", "src/utils/"],
					middleware: ["middleware/", "src/middleware/"],
				},
				namingConventions: {
					generalFiles: "kebab-case.ts/js",
					directories: "kebab-case",
				},
				bestPractices: [
					"Use kebab-case for file and directory names (e.g., `user-routes.ts`, `auth-middleware.ts`).",
					"Separate concerns into distinct directories like `routes`, `controllers`, `services`, `models`.",
					"Prefer functional programming for middleware and controllers where appropriate.",
				],
			},
		],
		[
			ProjectFramework.Python,
			{
				description:
					"General Python projects often follow a `src/` layout or flat structure, with `tests/` for tests and `docs/` for documentation.",
				typicalFilePaths: {
					utils: ["src/", "utils/", "helpers/"],
					models: ["src/models/", "models/", "data/"],
					tests: ["tests/", "test/"],
					services: ["src/services/", "services/"],
					controllers: ["src/controllers/", "controllers/"], // for web frameworks
				},
				namingConventions: {
					generalFiles: "snake_case.py",
					directories: "snake_case",
				},
				bestPractices: [
					"Adhere to PEP 8 naming conventions (snake_case for functions, variables, files; PascalCase for classes).",
					"Organize code into logical modules and packages.",
					"Use `__init__.py` for package definitions.",
				],
			},
		],
		[
			ProjectFramework.PythonDjango,
			{
				description:
					"Django projects are structured around applications, each typically containing `models.py`, `views.py`, `urls.py`, `admin.py`, and `migrations/` within app directories.",
				typicalFilePaths: {
					pagesOrRoutes: ["<app_name>/urls.py"],
					models: ["<app_name>/models.py"],
					views: ["<app_name>/views.py"],
					templates: ["<app_name>/templates/", "templates/"],
					admin: ["<app_name>/admin.py"],
					migrations: ["<app_name>/migrations/"],
					tests: ["<app_name>/tests.py"],
				},
				namingConventions: {
					generalFiles: "snake_case.py",
					directories: "snake_case",
				},
				bestPractices: [
					"Organize code into reusable applications.",
					"Use `snake_case` for module and file names.",
					"Database migrations should reside in `migrations/`.",
				],
			},
		],
		[
			ProjectFramework.DotNetCsharp,
			{
				description:
					".NET C# projects often use a solution (.sln) containing multiple projects (.csproj), typically structured with folders like 'Controllers', 'Models', 'Views', 'Services', and 'Data'.",
				typicalFilePaths: {
					controllers: ["Controllers/", "Features/*/Controllers/"],
					models: ["Models/", "Data/Models/", "Features/*/Models/"],
					services: [
						"Services/",
						"Infrastructure/Services/",
						"Features/*/Services/",
					],
					views: ["Views/", "Pages/"], // For MVC/Razor Pages
					data: ["Data/", "Repositories/"],
					utils: ["Utils/", "Helpers/"],
					tests: ["Tests/", "TestProject/"],
				},
				namingConventions: {
					generalFiles: "PascalCase.cs",
					directories: "PascalCase",
				},
				bestPractices: [
					"Use PascalCase for file, class, method, and public property names.",
					"Organize code by feature or by type.",
					"Separate concerns using layers (e.g., API, Business Logic, Data Access).",
				],
			},
		],
		[
			ProjectFramework.UnityCsharp,
			{
				description:
					"Unity projects store assets in the 'Assets/' folder, often with subfolders like 'Scripts', 'Prefabs', 'Scenes', 'Materials', etc. C# scripts are common.",
				typicalFilePaths: {
					components: ["Assets/Scripts/", "Assets/<Feature>/Scripts/"],
					models: ["Assets/Data/", "Assets/<Feature>/Data/"],
					scenes: ["Assets/Scenes/"],
					prefabs: ["Assets/Prefabs/"],
					shaders: ["Assets/Shaders/"],
					animations: ["Assets/Animations/"],
				},
				namingConventions: {
					generalFiles: "PascalCase.cs", // For C# scripts
					directories: "PascalCase", // Common for Assets subfolders
					componentFiles: "PascalCase.cs", // Specifically for MonoBehaviour scripts
				},
				bestPractices: [
					"Organize assets within the 'Assets/' folder logically.",
					"Use PascalCase for C# script names.",
					"Favor composition over inheritance for game objects.",
				],
			},
		],
		[
			ProjectFramework.Go,
			{
				description:
					"Go projects follow a canonical layout with `cmd/` for main applications, `pkg/` for reusable libraries, and `internal/` for private application code.",
				typicalFilePaths: {
					apiRoutes: ["cmd/", "api/"], // cmd for main, api for handlers
					services: ["pkg/services/", "internal/services/"],
					models: ["pkg/models/", "internal/models/"],
					utils: ["pkg/utils/", "internal/utils/", "helpers/"],
					tests: ["<package_name>/_test.go", "tests/"],
				},
				namingConventions: {
					generalFiles: "snake_case.go", // or sometimes kebab-case for directories
					directories: "kebab-case", // Go commonly uses kebab-case for module/repo names, but snake_case for internal package names
				},
				bestPractices: [
					"Adhere to the standard Go project layout.",
					"Use `camelCase` for variables and functions, `PascalCase` for exported names.",
					"Package names should be short, all lowercase, and contain no underscores.",
				],
			},
		],
		[
			ProjectFramework.Ruby,
			{
				description:
					"General Ruby projects might have `lib/` for libraries, `bin/` for executables, and `spec/` or `test/` for tests.",
				typicalFilePaths: {
					utils: ["lib/", "helpers/"],
					tests: ["spec/", "test/"],
					scripts: ["bin/", "scripts/"],
				},
				namingConventions: {
					generalFiles: "snake_case.rb",
					directories: "snake_case",
				},
				bestPractices: [
					"Use `snake_case` for method and variable names.",
					"Use `PascalCase` for class and module names.",
					"Organize gem-like structures with `lib/` and `bin/`.",
				],
			},
		],
		[
			ProjectFramework.RubyRails,
			{
				description:
					"Ruby on Rails projects follow a strict MVC pattern with `app/models`, `app/views`, `app/controllers`, `db/migrate`, and `config/routes.rb`.",
				typicalFilePaths: {
					controllers: ["app/controllers/"],
					models: ["app/models/"],
					views: ["app/views/"],
					pagesOrRoutes: ["config/routes.rb"],
					migrations: ["db/migrate/"],
					helpers: ["app/helpers/"],
					assets: ["app/assets/"],
					tests: ["test/", "spec/"],
				},
				namingConventions: {
					generalFiles: "snake_case.rb",
					directories: "snake_case",
					componentFiles: "snake_case.rb", // For models, controllers
				},
				bestPractices: [
					"Adhere to Rails' 'convention over configuration' principle.",
					"Use `snake_case` for file and directory names.",
					"Models, Views, and Controllers follow a strict naming pattern (e.g., `user.rb`, `users_controller.rb`).",
				],
			},
		],
		[
			ProjectFramework.CppCMake,
			{
				description:
					"C++ CMake projects often separate headers (`include/`) from source files (`src/`) and place build artifacts in a `build/` directory.",
				typicalFilePaths: {
					components: ["src/", "lib/", "modules/"],
					utils: ["src/utils/", "include/utils/"],
					tests: ["tests/", "test/"],
					includes: ["include/"],
					build: ["build/", "bin/"], // For output
				},
				namingConventions: {
					generalFiles: "snake_case.cpp/h", // Common but can vary (kebab-case, PascalCase)
					directories: "kebab-case", // Or snake_case
				},
				bestPractices: [
					"Use `include/` for public headers and `src/` for implementation.",
					"Separate compilation units for better build times.",
					"Follow a consistent naming convention, often `snake_case` or `kebab-case` for files and directories.",
				],
			},
		],
		[
			ProjectFramework.JavaMaven,
			{
				description:
					"Maven Java projects use a standard `src/main/java`, `src/main/resources`, `src/test/java` structure, managed by `pom.xml`.",
				typicalFilePaths: {
					services: [
						"src/main/java/<package>/service/",
						"src/main/java/<package>/core/",
					],
					models: [
						"src/main/java/<package>/model/",
						"src/main/java/<package>/domain/",
					],
					controllers: ["src/main/java/<package>/controller/"],
					repositories: ["src/main/java/<package>/repository/"],
					resources: ["src/main/resources/"],
					tests: ["src/test/java/"],
				},
				namingConventions: {
					generalFiles: "PascalCase.java",
					directories: "kebab-case", // For project structure directories
					componentFiles: "PascalCase.java", // For classes
				},
				bestPractices: [
					"Adhere to Maven's standard directory layout.",
					"Use `PascalCase` for class names and `camelCase` for methods/variables.",
					"Package names should be all lowercase and unique.",
				],
			},
		],
		[
			ProjectFramework.KotlinAndroid,
			{
				description:
					"Android projects (Kotlin) organize code within `app/src/main/java` or `app/src/main/kotlin` with distinct folders for activities, fragments, services, and models.",
				typicalFilePaths: {
					components: [
						"app/src/main/kotlin/<package>/ui/",
						"app/src/main/kotlin/<package>/fragments/",
						"app/src/main/kotlin/<package>/activities/",
					],
					models: [
						"app/src/main/kotlin/<package>/data/",
						"app/src/main/kotlin/<package>/model/",
					],
					services: ["app/src/main/kotlin/<package>/service/"],
					utils: ["app/src/main/kotlin/<package>/util/"],
					resources: ["app/src/main/res/"],
					layouts: ["app/src/main/res/layout/"],
					drawables: ["app/src/main/res/drawable/"],
					values: ["app/src/main/res/values/"],
				},
				namingConventions: {
					generalFiles: "PascalCase.kt",
					directories: "snake_case", // for package structure or kebab-case for resource directories
					componentFiles: "PascalCase.kt", // Activities, Fragments, ViewModels
				},
				bestPractices: [
					"Follow Android Architecture Components for clean code.",
					"Use `PascalCase` for class names and `camelCase` for functions/variables.",
					"Resources like layouts and drawables use `snake_case`.",
				],
			},
		],
		[
			ProjectFramework.SwiftIOS,
			{
				description:
					"iOS projects (Swift) are typically organized around MVC/MVVM patterns, with folders for ViewControllers, Models, Views, and supporting files, managed by an Xcode project.",
				typicalFilePaths: {
					components: ["Views/", "ViewControllers/"],
					models: ["Models/", "Data/"],
					services: ["Services/", "Networking/"],
					utils: ["Utils/", "Helpers/"],
					resources: ["Resources/", "Assets.xcassets/"],
					storyboards: ["Base.lproj/"],
				},
				namingConventions: {
					generalFiles: "PascalCase.swift",
					directories: "PascalCase", // Or flat structure often preferred
					componentFiles: "PascalCase.swift", // ViewControllers, Views, Models
				},
				bestPractices: [
					"Use `PascalCase` for type names and `camelCase` for functions/variables.",
					"Organize files logically, either by type or by feature.",
					"Utilize Swift Package Manager or CocoaPods for dependency management.",
				],
			},
		],
		// Web Development (Additional)
		[
			ProjectFramework.SvelteKit,
			{
				description:
					"SvelteKit projects use a `src/routes/` directory for pages and API endpoints, and `src/lib/` for reusable components and utilities.",
				typicalFilePaths: {
					pagesOrRoutes: ["src/routes/", "src/routes/api/"],
					components: ["src/lib/components/", "src/components/"],
					utils: ["src/lib/utils/", "src/utils/"],
					styles: ["src/lib/styles/", "static/css/"],
				},
				namingConventions: {
					componentFiles: "PascalCase.svelte",
					pageFiles: "+page.svelte",
					apiRouteFiles: "+server.ts/js",
					generalFiles: "kebab-case.ts/js",
					directories: "kebab-case",
				},
				bestPractices: [
					"Pages and routes are defined by files in `src/routes/`.",
					"Components and utilities often reside in `src/lib/`.",
					"Use kebab-case for directories and PascalCase for Svelte component files.",
				],
			},
		],
		[
			ProjectFramework.Laravel,
			{
				description:
					"Laravel applications follow a standard structure with `app/` for core logic (Models, Controllers), `routes/` for routing, `resources/views/` for templates, and `database/migrations/`.",
				typicalFilePaths: {
					controllers: ["app/Http/Controllers/"],
					models: ["app/Models/"],
					views: ["resources/views/"],
					pagesOrRoutes: ["routes/web.php", "routes/api.php"],
					migrations: ["database/migrations/"],
					commands: ["app/Console/Commands/"],
					services: ["app/Services/"],
				},
				namingConventions: {
					generalFiles: "PascalCase.php", // For classes
					directories: "PascalCase", // Common for main directories
					componentFiles: "PascalCase.php", // Controllers, Models
					views: "kebab-case.blade.php",
				},
				bestPractices: [
					"Follow Laravel's naming conventions (e.g., `UserController.php`, `User.php`).",
					"Use migrations for database schema changes.",
					"Controllers should be thin, delegating logic to services or models.",
				],
			},
		],
		[
			ProjectFramework.Deno,
			{
				description:
					"Deno projects are typically structured as a collection of TypeScript/JavaScript modules, often with a `src/` directory and explicit `deps.ts` for dependencies.",
				typicalFilePaths: {
					utils: ["src/utils/", "utils/", "helpers/"],
					services: ["src/services/", "services/"],
					controllers: ["src/controllers/", "controllers/"],
					middlewares: ["src/middleware/", "middleware/"],
					routes: ["src/routes/", "routes/"],
					dependencies: ["deps.ts"],
				},
				namingConventions: {
					generalFiles: "snake_case.ts/js", // or kebab-case
					directories: "kebab-case",
				},
				bestPractices: [
					"Use explicit file extensions for imports.",
					"Avoid `node_modules` by directly importing from URLs or local modules.",
					"Organize by feature or domain.",
				],
			},
		],

		// Desktop Applications
		[
			ProjectFramework.Electron,
			{
				description:
					"Electron apps combine a main process (Node.js) and renderer processes (web technologies). Common structure includes `main.js`, `preload.js`, and `src/` for UI.",
				typicalFilePaths: {
					main: ["main.js", "src/main.js"],
					components: ["src/renderer/", "src/ui/"], // For renderer-side React/Vue/etc.
					utils: ["src/utils/", "utils/"],
					preload: ["preload.js", "src/preload.js"],
				},
				namingConventions: {
					generalFiles: "kebab-case.js/ts",
					directories: "kebab-case",
				},
				bestPractices: [
					"Keep main process logic separate from renderer process logic.",
					"Use `preload.js` for secure IPC communication.",
					"Organize UI components as you would in a web project.",
				],
			},
		],
		[
			ProjectFramework.DotNetMaui,
			{
				description:
					".NET MAUI projects offer cross-platform desktop and mobile development, often with shared C# code in a single project, using XAML for UI.",
				typicalFilePaths: {
					views: ["Views/", "Pages/"],
					viewModels: ["ViewModels/"],
					services: ["Services/"],
					models: ["Models/"],
					utils: ["Helpers/", "Utility/"],
					platforms: ["Platforms/"], // Platform-specific code
					resources: ["Resources/"], // Images, fonts, styles
				},
				namingConventions: {
					generalFiles: "PascalCase.cs",
					componentFiles: "PascalCase.xaml/cs", // For pages/views and their code-behind
					directories: "PascalCase",
				},
				bestPractices: [
					"Utilize MVVM pattern for separation of concerns.",
					"Place platform-specific code in the `Platforms/` folder.",
					"Use `Resources/` for shared assets.",
				],
			},
		],

		// Mobile Development (Additional)
		[
			ProjectFramework.Flutter,
			{
				description:
					"Flutter projects are built with Dart, typically organizing UI (`widgets/`, `pages/`), business logic (`models/`, `services/`), and utilities (`utils/`) under `lib/`.",
				typicalFilePaths: {
					components: ["lib/widgets/", "lib/components/"],
					pagesOrRoutes: ["lib/pages/", "lib/screens/"],
					models: ["lib/models/"],
					services: ["lib/services/"],
					utils: ["lib/utils/", "lib/helpers/"],
					assets: ["assets/images/", "assets/fonts/"],
				},
				namingConventions: {
					generalFiles: "snake_case.dart",
					directories: "snake_case",
					componentFiles: "snake_case.dart", // For widgets/pages
				},
				bestPractices: [
					"Follow Dart's `snake_case` for filenames and `PascalCase` for class names.",
					"Organize features into separate directories.",
					"Use provider/bloc/riverpod for state management.",
				],
			},
		],
		[
			ProjectFramework.ReactNative,
			{
				description:
					"React Native projects use JavaScript/TypeScript for cross-platform mobile apps. Structure often includes `src/components/`, `src/screens/`, `src/navigation/`, and `src/utils/`.",
				typicalFilePaths: {
					components: ["src/components/", "app/components/"],
					pagesOrRoutes: ["src/screens/", "app/screens/"],
					navigation: ["src/navigation/", "app/navigation/"],
					utils: ["src/utils/", "app/utils/"],
					hooks: ["src/hooks/", "app/hooks/"],
					assets: ["assets/images/", "assets/icons/"],
				},
				namingConventions: {
					componentFiles: "PascalCase.tsx/jsx/js",
					generalFiles: "kebab-case.ts/js",
					directories: "kebab-case",
				},
				bestPractices: [
					"Use PascalCase for component files and kebab-case for directories.",
					"Organize by feature rather than type (e.g., `features/auth/components/Login.tsx`).",
					"Use React Navigation for navigation, Redux/Context for state management.",
				],
			},
		],

		// Game Development
		[
			ProjectFramework.UnrealEngine,
			{
				description:
					"Unreal Engine C++ projects have a `Source/` directory for C++ code (`Public/`, `Private/`) and a `Content/` directory for assets (Blueprints, textures, models).",
				typicalFilePaths: {
					components: [
						"Source/<ProjectName>/Public/",
						"Source/<ProjectName>/Private/",
					],
					assets: [
						"Content/<Feature>/",
						"Content/Blueprints/",
						"Content/Models/",
					],
					classes: [
						"Source/<ProjectName>/Public/",
						"Source/<ProjectName>/Private/",
					],
				},
				namingConventions: {
					generalFiles: "PascalCase.h/cpp", // Standard for UE C++
					directories: "PascalCase", // Common for folders within Content
					componentFiles: "A<Name>.h/cpp", // Actors
					views: "U<Name>.h/cpp", // UI elements, Widgets
				},
				bestPractices: [
					"Follow Unreal Engine's strict naming conventions (e.g., `AMyActor`, `UMyWidget`).",
					"Separate public and private headers/source files.",
					"Organize content by feature or type within the `Content/` directory.",
				],
			},
		],
		[
			ProjectFramework.GodotEngine,
			{
				description:
					"Godot Engine projects use `.gd` (GDScript), `.cs` (C#), or other script files, and organize scenes, scripts, and assets directly within the project root or logical subfolders.",
				typicalFilePaths: {
					components: ["scripts/", "addons/", "features/"],
					scenes: ["scenes/", "levels/"],
					assets: ["assets/images/", "assets/audio/", "assets/models/"],
					utils: ["utils/", "helpers/"],
				},
				namingConventions: {
					generalFiles: "snake_case.gd", // For GDScript
					componentFiles: "PascalCase.cs", // For C# scripts
					directories: "snake_case", // Or kebab-case
				},
				bestPractices: [
					"Organize project files into logical folders (e.g., `scenes/`, `scripts/`, `assets/`).",
					"Use `snake_case` for GDScript files and variables, `PascalCase` for C# files and classes.",
					"Prefer `tscn` for scenes and `gd` or `cs` for scripts.",
				],
			},
		],

		// Data Science & Machine Learning
		[
			ProjectFramework.PythonML,
			{
				description:
					"Python projects focused on ML/Data Science often have dedicated directories for `data/` (raw, processed), `notebooks/`, `src/` (for modular code), and `models/` (trained models).",
				typicalFilePaths: {
					data: ["data/raw/", "data/processed/", "data/external/"],
					notebooks: ["notebooks/", "jupyter/"],
					models: ["models/"], // Trained models
					scripts: ["scripts/"], // ETL, training scripts
					utils: ["src/utils/", "src/helpers/"],
					sourceCode: ["src/"], // Modularized Python code
					tests: ["tests/"],
				},
				namingConventions: {
					generalFiles: "snake_case.py",
					directories: "snake_case",
				},
				bestPractices: [
					"Separate raw, processed, and external data.",
					"Keep notebooks for exploration, move production code to `src/`.",
					"Version control data and models where appropriate.",
				],
			},
		],
		[
			ProjectFramework.JupyterNotebook,
			{
				description:
					"Projects predominantly consisting of Jupyter notebooks (`.ipynb` files) are often organized in a `notebooks/` directory alongside `data/` and `scripts/`.",
				typicalFilePaths: {
					notebooks: ["notebooks/", "."], // Main notebooks in root or dedicated folder
					data: ["data/"],
					scripts: ["scripts/", "utils/"],
				},
				namingConventions: {
					generalFiles: "kebab-case.ipynb", // Or snake_case
					directories: "kebab-case", // Or snake_case
				},
				bestPractices: [
					"Place `.ipynb` files in a dedicated `notebooks/` directory.",
					"Keep notebooks focused on experimentation and analysis, extract reusable code into `.py` files in `scripts/` or `utils/`.",
					"Avoid large datasets directly in Git; use external storage.",
				],
			},
		],

		// Cloud & DevOps
		[
			ProjectFramework.DockerCompose,
			{
				description:
					"Docker Compose projects use `docker-compose.yml` (or `.yaml`) to define multi-container applications. Other files include `Dockerfile` and service-specific configurations.",
				typicalFilePaths: {
					config: ["docker-compose.yml", "docker-compose.yaml", "Dockerfile"],
					services: ["services/<service_name>/"], // For microservice architectures
					volumes: ["data/"], // For persistent volumes
				},
				namingConventions: {
					generalFiles: "kebab-case.yml/yaml",
					directories: "kebab-case",
				},
				bestPractices: [
					"Place `Dockerfile` next to the application code for a service.",
					"Use separate `docker-compose.override.yml` for local development configurations.",
					"Keep `docker-compose.yml` files concise and focused on defining services.",
				],
			},
		],
		[
			ProjectFramework.Kubernetes,
			{
				description:
					"Kubernetes projects typically organize manifest files (Deployments, Services, Pods, Ingress) in `.yaml` files within a dedicated `k8s/` or `manifests/` directory.",
				typicalFilePaths: {
					config: ["k8s/", "manifests/", "deployments/", "services/"],
					helmCharts: ["charts/<chart_name>/"],
					scripts: ["scripts/k8s/"], // Deployment scripts
				},
				namingConventions: {
					generalFiles: "kebab-case.yaml", // or .yml
					directories: "kebab-case",
				},
				bestPractices: [
					"Organize manifests by resource type or by application/feature.",
					"Use separate files for different resource kinds (e.g., `deployment.yaml`, `service.yaml`).",
					"Employ Helm or Kustomize for managing complex deployments.",
				],
			},
		],
		[
			ProjectFramework.Terraform,
			{
				description:
					"Terraform projects define infrastructure as code using `.tf` files. Common structure includes modules and environment-specific configurations.",
				typicalFilePaths: {
					modules: ["modules/<module_name>/"],
					environments: ["environments/<env_name>/"], // dev, staging, prod
					main: ["main.tf"],
					variables: ["variables.tf"],
					outputs: ["outputs.tf"],
					providers: ["providers.tf"],
				},
				namingConventions: {
					generalFiles: "snake_case.tf",
					directories: "snake_case", // Or kebab-case
				},
				bestPractices: [
					"Use modules to encapsulate reusable infrastructure components.",
					"Separate state files by environment.",
					"Organize files logically (e.g., `main.tf`, `variables.tf`, `outputs.tf`).",
				],
			},
		],
	]);

/**
 * Retrieves the convention details for a given project framework.
 * @param framework The detected ProjectFramework.
 * @returns The FrameworkConvention object or undefined if not found.
 */
export function getConvention(
	framework: ProjectFramework
): FrameworkConvention | undefined {
	return FRAMEWORK_CONVENTIONS.get(framework);
}

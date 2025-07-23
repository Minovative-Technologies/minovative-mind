import * as vscode from "vscode";
import * as path from "path";
import { loadGitIgnoreMatcher } from "../utils/ignoreUtils";

export interface ProjectProfile {
	language: string;
	framework?: string;
	type: string; // e.g., "frontend", "backend", "library", "cli", "fullstack"
	version?: string; // Optional framework version
	description?: string; // A human-readable description of the detected profile
}

// Cache for project type detection to avoid repeated scans within the same session
const projectTypeCache = new Map<string, string>(); // Stores stringified JSON of { timestamp, profile }

export async function detectProjectType(
	workspaceUri: vscode.Uri,
	allScannedFiles: vscode.Uri[],
	options?: {
		useCache?: boolean;
		cacheTimeout?: number; // in milliseconds
	}
): Promise<ProjectProfile | null> {
	const workspacePath = workspaceUri.fsPath;
	const useCache = options?.useCache ?? true;
	const cacheTimeout = options?.cacheTimeout ?? 5 * 60 * 1000; // 5 minutes default

	// Check cache
	if (useCache) {
		const cachedResult = projectTypeCache.get(workspacePath);
		if (cachedResult !== undefined) {
			try {
				const cacheEntry = JSON.parse(cachedResult);
				if (Date.now() - cacheEntry.timestamp < cacheTimeout) {
					console.log(
						`[ProjectTypeDetector] Using cached project type for: ${workspacePath}`
					);
					return cacheEntry.profile;
				}
			} catch (e: any) {
				console.warn(
					`[ProjectTypeDetector] Failed to parse cached project profile for ${workspacePath}: ${e.message}`
				);
				// In case of parsing error, invalidate cache and proceed with detection
				projectTypeCache.delete(workspacePath);
			}
		}
	}

	// Load .gitignore rules and default patterns. Filter out ignored files before proceeding with detection.
	const fileMatcher = await loadGitIgnoreMatcher(workspaceUri);

	const filteredFiles = allScannedFiles.filter((fileUri) => {
		// Get the path relative to the workspace root for .gitignore matching
		const relativePath = path.relative(workspaceUri.fsPath, fileUri.fsPath);
		// Return true if the file should NOT be ignored
		return !fileMatcher.ignores(relativePath);
	});

	let detectedProfile: ProjectProfile | null = null;

	// --- Primary Detection: package.json (Node.js/JS/TS projects) ---
	const packageJsonUri = filteredFiles.find(
		(file) => path.basename(file.fsPath).toLowerCase() === "package.json"
	);

	if (packageJsonUri) {
		try {
			const contentBytes = await vscode.workspace.fs.readFile(packageJsonUri);
			const packageJson = JSON.parse(
				Buffer.from(contentBytes).toString("utf-8")
			);

			const dependencies = {
				...(packageJson.dependencies || {}),
				...(packageJson.devDependencies || {}),
			};

			let language = "";
			let framework = "";
			let type = "application"; // Default type
			let version = "";

			// Language Detection (TypeScript preferred over JavaScript)
			if (
				dependencies.typescript ||
				packageJson.name?.includes("typescript") ||
				packageJson.description?.includes("typescript") ||
				packageJson.scripts?.build?.includes("tsc")
			) {
				language = "TypeScript";
			} else if (
				Object.keys(dependencies).some(
					(dep) =>
						[
							"react",
							"vue",
							"angular",
							"svelte",
							"express",
							"koa",
							"next",
							"webpack",
							"rollup",
							"vite",
							"parcel",
						].includes(dep) ||
						dep.startsWith("@angular/") ||
						dep.startsWith("@nestjs/")
				) ||
				packageJson.main ||
				packageJson.module
			) {
				language = "JavaScript";
			}

			// Framework & Type Detection (prioritized by specificity)
			if (dependencies.next) {
				framework = "Next.js";
				type = "frontend";
				language = language || "TypeScript"; // Next.js is often TypeScript
				version = dependencies.next;
			} else if (dependencies.react) {
				framework = "React";
				type = "frontend";
				language = language || "JavaScript";
				version = dependencies.react;
			} else if (dependencies.angular || dependencies["@angular/core"]) {
				framework = "Angular";
				type = "frontend";
				language = "TypeScript"; // Angular strongly implies TypeScript
				version = dependencies.angular || dependencies["@angular/core"];
			} else if (dependencies.vue) {
				framework = "Vue.js";
				type = "frontend";
				language = language || "JavaScript";
				version = dependencies.vue;
			} else if (dependencies.svelte) {
				framework = "Svelte";
				type = "frontend";
				language = language || "JavaScript";
				version = dependencies.svelte;
			} else if (dependencies.nest || dependencies["@nestjs/core"]) {
				framework = "NestJS";
				type = "backend";
				language = "TypeScript"; // NestJS strongly implies TypeScript
				version = dependencies.nest || dependencies["@nestjs/core"];
			} else if (dependencies.express) {
				framework = "Express.js";
				type = "backend";
				language = language || "JavaScript";
				version = dependencies.express;
			} else if (dependencies.koa) {
				framework = "Koa.js";
				type = "backend";
				language = language || "JavaScript";
				version = dependencies.koa;
			}

			// Python frameworks within package.json (uncommon but possible with tools like PyInstaller)
			// It's more common to find these in requirements.txt or poetry.lock.
			if (dependencies.django) {
				language = "Python";
				framework = "Django";
				type = "backend";
				version = dependencies.django;
			} else if (dependencies.flask) {
				language = "Python";
				framework = "Flask";
				type = "backend";
				version = dependencies.flask;
			} else if (dependencies.fastapi) {
				language = "Python";
				framework = "FastAPI";
				type = "backend";
				version = dependencies.fastapi;
			}

			// Type inference based on package.json specific fields
			if (
				packageJson.bin ||
				packageJson.directories?.bin ||
				packageJson.preferGlobal
			) {
				type = "cli";
			} else if (
				packageJson.main &&
				!packageJson.browser &&
				type !== "frontend"
			) {
				// Don't override frontend if already set
				type = "backend";
			} else if (packageJson.module || packageJson.browser) {
				type = "frontend";
			} else if (
				!framework &&
				language === "JavaScript" &&
				(dependencies.webpack ||
					dependencies.rollup ||
					dependencies.vite ||
					dependencies.parcel)
			) {
				type = "frontend";
			}

			if (language || framework) {
				// Only create a profile if at least language or framework is detected
				detectedProfile = {
					language: language || "Unknown", // Default to unknown if no specific language
					framework: framework || undefined,
					type: type,
					version: version || undefined,
					description: `Detected via package.json: ${
						framework ? framework + " " : ""
					}${language ? language + " " : ""}${type} project.`,
				};
			}
		} catch (e: any) {
			console.warn(
				`[ProjectTypeDetector] Failed to parse package.json for ${workspacePath}: ${e.message}`
			);
		}
	}

	// --- Fallback: Other Manifests ---
	if (!detectedProfile) {
		// Java (Maven)
		const pomXmlUri = filteredFiles.find(
			(file) => path.basename(file.fsPath).toLowerCase() === "pom.xml"
		);
		if (pomXmlUri) {
			let version: string | undefined = undefined; // Declared here
			try {
				const contentBytes = await vscode.workspace.fs.readFile(pomXmlUri);
				const pomContent = Buffer.from(contentBytes).toString("utf-8");
				let language = "Java";
				let framework = "";
				let type = "backend";

				// Look for common Spring Boot dependencies
				const springBootMatch = pomContent.match(
					/<artifactId>(spring-boot-starter(?:-\w+)*)<\/artifactId>\s*<version>([^<]+)<\/version>/i
				);
				if (springBootMatch) {
					framework = "Spring Boot";
					type = "backend";
					// Attempt to extract Spring Boot version from dependency or parent
					const versionMatch = pomContent.match(
						/<parent>\s*<groupId>org\.springframework\.boot<\/groupId>\s*<artifactId>spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)<\/version>/i
					);
					if (versionMatch) {
						version = versionMatch[1];
					}
				} else if (pomContent.includes("<groupId>org.hibernate</groupId>")) {
					framework = framework || "Hibernate";
					type = "backend";
				} else if (
					pomContent.includes("<groupId>org.apache.maven.plugins</groupId>")
				) {
					framework = framework || "Maven";
					type = "application";
				}
				detectedProfile = {
					language,
					framework: framework || undefined,
					type,
					version: version, // Use the correctly scoped version here
					description: `Detected via pom.xml: ${
						framework ? framework + " " : ""
					}Java ${type} project.`,
				};
			} catch (e: any) {
				console.warn(
					`[ProjectTypeDetector] Failed to parse pom.xml for ${workspacePath}: ${e.message}`
				);
			}
		}
	}

	if (!detectedProfile) {
		// Java (Gradle)
		const buildGradleUri = filteredFiles.find((file) =>
			path.basename(file.fsPath).toLowerCase().includes("build.gradle")
		); // Could be build.gradle.kts
		if (buildGradleUri) {
			let version: string | undefined = undefined; // Declared here
			try {
				const contentBytes = await vscode.workspace.fs.readFile(buildGradleUri);
				const gradleContent = Buffer.from(contentBytes).toString("utf-8");
				let language = "Java";
				let framework = "";
				let type = "backend";

				const springBootMatch = gradleContent.match(
					/['"]org\.springframework\.boot:spring-boot-starter(?:-\w+)*:([^'"]+)['"]/i
				);
				if (springBootMatch) {
					framework = "Spring Boot";
					type = "backend";
					version = springBootMatch[1];
				} else if (
					gradleContent.includes("plugins { id 'java' }") ||
					gradleContent.includes("plugins { id 'application' }")
				) {
					framework = framework || "Gradle";
					type = "application";
				}
				detectedProfile = {
					language,
					framework: framework || undefined,
					type,
					version: version, // Use the correctly scoped version here
					description: `Detected via build.gradle: ${
						framework ? framework + " " : ""
					}Java ${type} project.`,
				};
			} catch (e: any) {
				console.warn(
					`[ProjectTypeDetector] Failed to parse build.gradle for ${workspacePath}: ${e.message}`
				);
			}
		}
	}

	if (!detectedProfile) {
		// Python (requirements.txt, poetry.lock, Pipfile.lock)
		const requirementsTxtUri = filteredFiles.find(
			(file) => path.basename(file.fsPath).toLowerCase() === "requirements.txt"
		);
		const poetryLockUri = filteredFiles.find(
			(file) => path.basename(file.fsPath).toLowerCase() === "poetry.lock"
		);
		const pipfileLockUri = filteredFiles.find(
			(file) => path.basename(file.fsPath).toLowerCase() === "pipfile.lock"
		);

		if (requirementsTxtUri || poetryLockUri || pipfileLockUri) {
			let language = "Python";
			let type = "application";
			let framework = "";
			let version = "";
			const manifestUri = requirementsTxtUri || poetryLockUri || pipfileLockUri;
			try {
				const contentBytes = await vscode.workspace.fs.readFile(manifestUri!);
				const manifestContent = Buffer.from(contentBytes)
					.toString("utf-8")
					.toLowerCase();
				if (manifestContent.includes("django==")) {
					framework = "Django";
					type = "backend";
					const match = manifestContent.match(/django==([\d\.]+)/);
					if (match) {
						version = match[1];
					}
				} else if (manifestContent.includes("flask==")) {
					framework = "Flask";
					type = "backend";
					const match = manifestContent.match(/flask==([\d\.]+)/);
					if (match) {
						version = match[1];
					}
				} else if (manifestContent.includes("fastapi==")) {
					framework = "FastAPI";
					type = "backend";
					const match = manifestContent.match(/fastapi==([\d\.]+)/);
					if (match) {
						version = match[1];
					}
				}
				detectedProfile = {
					language,
					framework: framework || undefined,
					type,
					version: version || undefined,
					description: `Detected via ${path.basename(manifestUri!.fsPath)}: ${
						framework ? framework + " " : ""
					}Python ${type} project.`,
				};
			} catch (e: any) {
				console.warn(
					`[ProjectTypeDetector] Failed to parse ${path.basename(
						manifestUri!.fsPath
					)} for ${workspacePath}: ${e.message}`
				);
			}
		}
	}

	if (!detectedProfile) {
		// Rust (Cargo.toml)
		const cargoTomlUri = filteredFiles.find(
			(file) => path.basename(file.fsPath).toLowerCase() === "cargo.toml"
		);
		if (cargoTomlUri) {
			try {
				const contentBytes = await vscode.workspace.fs.readFile(cargoTomlUri);
				const cargoContent = Buffer.from(contentBytes).toString("utf-8");
				let language = "Rust";
				let framework = "";
				let type = "application";
				let version = "";

				// Extract package version
				const packageVersionMatch = cargoContent.match(/version\s*=\s*"(.*?)"/);
				if (packageVersionMatch) {
					version = packageVersionMatch[1];
				}

				if (
					cargoContent.includes("actix-web =") ||
					cargoContent.includes("actix =")
				) {
					framework = "Actix-web";
					type = "backend";
				} else if (cargoContent.includes("rocket =")) {
					framework = "Rocket";
					type = "backend";
				} else if (cargoContent.includes("axum =")) {
					framework = "Axum";
					type = "backend";
				}

				// Check if it's a library or a binary (CLI/Application) based on targets
				if (cargoContent.includes("[lib]") && !cargoContent.includes("[bin]")) {
					type = "library";
				} else if (
					cargoContent.includes("[bin]") ||
					cargoContent.includes("[[bin]]")
				) {
					type = "cli";
				}

				detectedProfile = {
					language,
					framework: framework || undefined,
					type,
					version: version || undefined,
					description: `Detected via Cargo.toml: ${
						framework ? framework + " " : ""
					}Rust ${type} project.`,
				};
			} catch (e: any) {
				console.warn(
					`[ProjectTypeDetector] Failed to parse Cargo.toml for ${workspacePath}: ${e.message}`
				);
			}
		}
	}

	if (!detectedProfile) {
		// Go (go.mod)
		const goModUri = filteredFiles.find(
			(file) => path.basename(file.fsPath).toLowerCase() === "go.mod"
		);
		if (goModUri) {
			try {
				const contentBytes = await vscode.workspace.fs.readFile(goModUri);
				const goModContent = Buffer.from(contentBytes).toString("utf-8");
				let language = "Go";
				let framework = "";
				let type = "application";

				// Extract module version (Go module name usually doesn't have a version in go.mod itself, dependencies do)
				const goModuleMatch = goModContent.match(/^module\s+(.+)$/m);
				if (goModuleMatch) {
					framework = goModuleMatch[1];
				} // Use module name as framework for now

				if (goModContent.includes("github.com/gin-gonic/gin")) {
					framework = "Gin";
					type = "backend";
				} else if (goModContent.includes("github.com/labstack/echo")) {
					framework = "Echo";
					type = "backend";
				} else if (goModContent.includes("github.com/gofiber/fiber")) {
					framework = "Fiber";
					type = "backend";
				} else if (goModContent.includes("net/http")) {
					framework = framework || "Standard Library HTTP"; // Prefer specific framework, else standard lib
					type = "backend";
				}
				detectedProfile = {
					language,
					framework: framework || undefined,
					type,
					description: `Detected via go.mod: ${
						framework ? framework + " " : ""
					}Go ${type} project.`,
				};
			} catch (e: any) {
				console.warn(
					`[ProjectTypeDetector] Failed to parse go.mod for ${workspacePath}: ${e.message}`
				);
			}
		}
	}

	if (!detectedProfile) {
		// C# (.csproj)
		const csprojUri = filteredFiles.find(
			(file) => path.extname(file.fsPath).toLowerCase() === ".csproj"
		);
		if (csprojUri) {
			try {
				const contentBytes = await vscode.workspace.fs.readFile(csprojUri);
				const csprojContent = Buffer.from(contentBytes).toString("utf-8");
				let language = "C#";
				let framework = "";
				let type = "application";
				let version = "";

				// Extract TargetFramework
				const targetFrameworkMatch = csprojContent.match(
					/<TargetFramework>(net\d+\.\d+)<\/TargetFramework>/i
				);
				if (targetFrameworkMatch) {
					version = targetFrameworkMatch[1];
				}

				if (
					csprojContent.includes('<Sdk Name="Microsoft.NET.Sdk.Web" />') ||
					csprojContent.includes(
						'<PackageReference Include="Microsoft.AspNetCore.App"'
					)
				) {
					framework = "ASP.NET Core";
					type = "backend";
				} else if (
					csprojContent.includes(
						'<Sdk Name="Microsoft.NET.Sdk.WindowsDesktop" />'
					)
				) {
					framework = "WPF/WinForms";
					type = "desktop";
				} else if (
					csprojContent.includes('<Sdk Name="Microsoft.NET.Sdk.Worker" />')
				) {
					framework = "Worker Service";
					type = "backend";
				} else if (csprojContent.includes("<OutputType>Exe</OutputType>")) {
					type = "cli";
				} else if (csprojContent.includes("<OutputType>Library</OutputType>")) {
					type = "library";
				}
				detectedProfile = {
					language,
					framework: framework || undefined,
					type,
					version: version || undefined,
					description: `Detected via .csproj: ${
						framework ? framework + " " : ""
					}C# ${type} project.`,
				};
			} catch (e: any) {
				console.warn(
					`[ProjectTypeDetector] Failed to parse .csproj for ${workspacePath}: ${e.message}`
				);
			}
		}
	}

	// --- Last Resort: File Extension and Directory Structure Analysis ---
	if (!detectedProfile) {
		let tsCount = 0;
		let jsCount = 0;
		let pyCount = 0;
		let javaCount = 0;
		let goCount = 0;
		let csCount = 0;
		let rustCount = 0;
		let primaryTypeFromDir = ""; // Will store 'frontend', 'backend', 'fullstack' or remain empty

		const rootPath = workspaceUri.fsPath;

		for (const fileUri of filteredFiles) {
			const ext = path.extname(fileUri.fsPath).toLowerCase();
			const relativePath = path
				.relative(rootPath, fileUri.fsPath)
				.toLowerCase();

			if (ext === ".ts" || ext === ".tsx") {
				tsCount++;
			} else if (ext === ".js" || ext === ".jsx") {
				jsCount++;
			} else if (ext === ".py") {
				pyCount++;
			} else if (ext === ".java") {
				javaCount++;
			} else if (ext === ".go") {
				goCount++;
			} else if (ext === ".cs") {
				csCount++;
			} else if (ext === ".rs") {
				rustCount++;
			}

			// Directory-based type inference (prioritize specific signals)
			if (
				relativePath.includes("src/components/") ||
				relativePath.includes("/components/") ||
				relativePath.includes("/public/") ||
				relativePath.includes("/views/") ||
				relativePath.includes("/assets/")
			) {
				if (primaryTypeFromDir === "backend") {
					primaryTypeFromDir = "fullstack";
				} else if (primaryTypeFromDir !== "fullstack") {
					primaryTypeFromDir = "frontend";
				}
			}
			if (
				relativePath.includes("src/api/") ||
				relativePath.includes("/api/") ||
				relativePath.includes("/controllers/") ||
				relativePath.includes("/services/") ||
				relativePath.includes("/database/") ||
				relativePath.includes("/model/") ||
				relativePath.includes("/server/")
			) {
				if (primaryTypeFromDir === "frontend") {
					primaryTypeFromDir = "fullstack";
				} else if (primaryTypeFromDir !== "fullstack") {
					primaryTypeFromDir = "backend";
				}
			}
		}

		let predominantLang = "";
		let highestCount = 0;

		const langCounts: { [key: string]: number } = {
			TypeScript: tsCount,
			JavaScript: jsCount,
			Python: pyCount,
			Java: javaCount,
			Go: goCount,
			"C#": csCount,
			Rust: rustCount,
		};

		for (const lang in langCounts) {
			if (langCounts[lang] > highestCount) {
				highestCount = langCounts[lang];
				predominantLang = lang;
			}
		}

		if (predominantLang && highestCount > 0) {
			detectedProfile = {
				language: predominantLang,
				type: primaryTypeFromDir || "application",
				description: `Detected via file structure: ${predominantLang} ${
					primaryTypeFromDir || "application"
				} project.`,
			};
		}
	}

	// Set a default if nothing specific was detected
	if (!detectedProfile) {
		detectedProfile = {
			language: "Unknown",
			type: "application",
			description:
				"Could not determine specific project type. Defaulting to generic application.",
		};
	}

	// Store in cache before returning
	if (useCache) {
		projectTypeCache.set(
			workspacePath,
			JSON.stringify({ timestamp: Date.now(), profile: detectedProfile })
		);
	}

	return detectedProfile;
}

export function formatProjectProfileForPrompt(
	profile: ProjectProfile | null
): string {
	if (
		!profile ||
		profile.language === "Unknown" ||
		(profile.language === "JavaScript" &&
			!profile.framework &&
			profile.type === "application" &&
			!profile.description?.includes("package.json"))
	) {
		// Return empty string if no specific profile was detected or it's a generic JS application without specific package.json info
		return "";
	}

	let descriptionParts: string[] = [];

	// Prioritize framework with language
	if (profile.framework) {
		descriptionParts.push(profile.framework);
		if (
			profile.language &&
			profile.language !== "Unknown" &&
			profile.language !== "JavaScript" &&
			profile.language !== "TypeScript"
		) {
			descriptionParts[0] = `${profile.framework} (${profile.language})`; // E.g., "Django (Python)"
		} else if (
			profile.language &&
			(profile.language === "JavaScript" || profile.language === "TypeScript")
		) {
			descriptionParts.push(`(${profile.language})`); // E.g., "Next.js (TypeScript)"
		}
	} else if (profile.language && profile.language !== "Unknown") {
		descriptionParts.push(profile.language);
	}

	// Add type if it provides more specific information than 'application'
	if (profile.type && profile.type !== "application") {
		descriptionParts.push(profile.type);
	}

	// Ensure we have at least some descriptive parts before forming the prompt
	if (descriptionParts.length === 0) {
		return "";
	}

	let preamble = `You are working on a ${descriptionParts
		.join(" ")
		.trim()} project.`;

	// Add best practices instruction
	if (profile.language && profile.language !== "Unknown") {
		preamble += ` Follow modern best practices for ${profile.language}.`;
	} else {
		preamble += ` Follow modern best practices.`;
	}

	return preamble.trim();
}

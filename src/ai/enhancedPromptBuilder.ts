import * as vscode from "vscode";
import * as path from "path";
import * as sidebarTypes from "../sidebar/common/sidebarTypes";

/**
 * Enhanced prompt builder that provides more accurate and detailed instructions
 * to improve AI code generation accuracy
 */
export class EnhancedPromptBuilder {
	/**
	 * Create enhanced planning prompt with better accuracy instructions
	 */
	public static createEnhancedPlanningPrompt(
		userRequest: string | undefined,
		projectContext: string,
		editorContext?: sidebarTypes.PlanGenerationContext["editorContext"],
		diagnosticsString?: string,
		chatHistory?: sidebarTypes.HistoryEntry[],
		textualPlanExplanation?: string,
		recentChanges?: string
	): string {
		const enhancedInstructions = this._buildEnhancedInstructions(
			userRequest,
			editorContext,
			diagnosticsString
		);

		const accuracyGuidelines = this._buildAccuracyGuidelines(editorContext);
		const codeQualityStandards = this._buildCodeQualityStandards();
		const frameworkGuidelines = this._buildFrameworkGuidelines(projectContext);

		return `You are an expert senior software engineer with deep expertise in modern software development. Your task is to create a highly accurate, step-by-step execution plan.

**CRITICAL ACCURACY REQUIREMENTS:**
${accuracyGuidelines}

**CODE QUALITY STANDARDS:**
${codeQualityStandards}

**FRAMEWORK-SPECIFIC GUIDELINES:**
${frameworkGuidelines}

**ENHANCED INSTRUCTIONS:**
${enhancedInstructions}

**PROJECT CONTEXT ANALYSIS:**
${projectContext}

${
	recentChanges
		? `**RECENT CHANGES TO CONSIDER:**
${recentChanges}`
		: ""
}

${
	textualPlanExplanation
		? `**DETAILED PLAN EXPLANATION:**
${textualPlanExplanation}`
		: ""
}

**OUTPUT FORMAT:**
Generate ONLY a valid JSON object representing the execution plan. The JSON must follow this exact structure:

\`\`\`json
{
  "planDescription": "Brief summary of the overall goal",
  "steps": [
    {
      "step": 1,
      "action": "create_directory" | "create_file" | "modify_file" | "run_command",
      "description": "Detailed description of what this step accomplishes",
      "path": "relative/path/to/target",
      "content": "...", // For create_file with direct content
      "generate_prompt": "...", // For create_file with AI generation
      "modification_prompt": "...", // For modify_file
      "command": "..." // For run_command
    }
  ]
}
\`\`\`

**VALIDATION REQUIREMENTS:**
- Every step must have a detailed description
- Paths must be relative to workspace root
- For file operations, ensure paths are correct and safe
- For commands, use appropriate package managers and tools
- Ensure all dependencies are properly handled
- Follow the project's existing patterns and conventions

**EXECUTION PLAN (JSON ONLY):**`;
	}

	/**
	 * Create enhanced code generation prompt
	 */
	public static createEnhancedCodeGenerationPrompt(
		filePath: string,
		generatePrompt: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: any;
		},
		languageId: string
	): string {
		const fileAnalysis = this._analyzeFileForGeneration(filePath, context);
		const languageGuidelines = this._getLanguageSpecificGuidelines(languageId);
		const accuracyChecks = this._getAccuracyChecks(languageId);

		return `You are an expert software engineer specializing in ${languageId} development. Generate production-ready, accurate code.

**CRITICAL ACCURACY REQUIREMENTS:**
${accuracyChecks}

**FILE ANALYSIS:**
${fileAnalysis}

**LANGUAGE-SPECIFIC GUIDELINES:**
${languageGuidelines}

**GENERATION INSTRUCTIONS:**
${generatePrompt}

**PROJECT CONTEXT:**
${context.projectContext}

**RELEVANT CODE SNIPPETS:**
${context.relevantSnippets}

${
	context.activeSymbolInfo
		? `**ACTIVE SYMBOL INFORMATION:**
${JSON.stringify(context.activeSymbolInfo, null, 2)}`
		: ""
}

**QUALITY ASSURANCE CHECKLIST:**
- [ ] All imports are correct and necessary
- [ ] Types are properly defined (for TypeScript)
- [ ] Error handling is implemented
- [ ] Code follows project conventions
- [ ] No syntax errors or logical issues
- [ ] Security best practices are followed
- [ ] Performance considerations are addressed
- [ ] Code is modular and maintainable

**OUTPUT:**
Generate ONLY the file content without any markdown formatting, explanations, or code block fences.`;
	}

	/**
	 * Create enhanced file modification prompt
	 */
	public static createEnhancedModificationPrompt(
		filePath: string,
		modificationPrompt: string,
		currentContent: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			editorContext?: any;
			activeSymbolInfo?: any;
		},
		languageId: string
	): string {
		const fileStructure = this._analyzeFileStructure(currentContent);
		const modificationGuidelines = this._getModificationGuidelines(languageId);

		return `You are an expert software engineer. Modify the existing file according to the provided instructions.

**CRITICAL MODIFICATION REQUIREMENTS:**
- Preserve existing functionality unless explicitly requested to change
- Maintain the current code structure and style
- Add necessary imports if new dependencies are used
- Ensure the modified code compiles and runs correctly
- Follow the project's existing patterns and conventions

**FILE ANALYSIS:**
- Path: ${filePath}
- Language: ${languageId}
- Current Structure: ${fileStructure.summary}
- Functions: ${fileStructure.functions.length}
- Classes: ${fileStructure.classes.length}
- Imports: ${fileStructure.imports.length}

**MODIFICATION GUIDELINES:**
${modificationGuidelines}

**MODIFICATION INSTRUCTIONS:**
${modificationPrompt}

**CURRENT FILE CONTENT:**
\`\`\`${languageId}
${currentContent}
\`\`\`

**PROJECT CONTEXT:**
${context.projectContext}

**RELEVANT CODE SNIPPETS:**
${context.relevantSnippets}

**OUTPUT:**
Provide ONLY the complete modified file content without any markdown formatting or explanations.`;
	}

	/**
	 * Build enhanced instructions based on request type
	 */
	private static _buildEnhancedInstructions(
		userRequest?: string,
		editorContext?: sidebarTypes.PlanGenerationContext["editorContext"],
		diagnosticsString?: string
	): string {
		let instructions = "";

		if (editorContext) {
			if (editorContext.instruction.toLowerCase() === "/fix") {
				instructions = `**FIX REQUEST ANALYSIS:**
- Analyze the provided diagnostics carefully
- Identify the root cause of each issue
- Consider the broader impact of changes
- Ensure fixes don't introduce new problems
- Test the logic of your proposed solutions

**DIAGNOSTICS TO ADDRESS:**
${diagnosticsString || "No specific diagnostics provided"}

**FIX STRATEGY:**
1. Identify the specific issues in the diagnostics
2. Determine the minimal changes needed
3. Consider dependencies and side effects
4. Ensure type safety and error handling
5. Validate that fixes resolve all reported issues`;
			} else if (editorContext.instruction.toLowerCase() === "/merge") {
				instructions = `**MERGE CONFLICT RESOLUTION:**
- Carefully analyze all conflict markers
- Understand the intent of both branches
- Preserve important functionality from both sides
- Ensure the merged code is syntactically correct
- Test the logic of the merged result

**MERGE STRATEGY:**
1. Identify all conflict markers (<<<<<<<, =======, >>>>>>>)
2. Analyze the differences between branches
3. Determine the correct merged result
4. Ensure no syntax errors or logical issues
5. Validate that the merged code works correctly`;
			} else {
				instructions = `**CUSTOM INSTRUCTION ANALYSIS:**
- Understand the specific requirements
- Consider the context of the selected code
- Ensure the solution fits the project architecture
- Follow existing patterns and conventions
- Validate that the solution is complete and correct

**CUSTOM INSTRUCTION:**
${editorContext.instruction}

**CONTEXT ANALYSIS:**
- Selected Code: ${
					editorContext.selectedText
						? editorContext.selectedText.substring(0, 200) + "..."
						: "None"
				}
- File: ${editorContext.filePath}
- Language: ${editorContext.languageId}`;
			}
		} else if (userRequest) {
			instructions = `**CHAT REQUEST ANALYSIS:**
- Understand the user's specific requirements
- Consider the broader project context
- Ensure the solution is complete and accurate
- Follow the project's architecture and patterns
- Validate that all requirements are met

**USER REQUEST:**
${userRequest}

**ANALYSIS STRATEGY:**
1. Break down the request into specific requirements
2. Identify the necessary components and files
3. Consider dependencies and relationships
4. Ensure the solution is scalable and maintainable
5. Validate that all requirements are addressed`;
		}

		return instructions;
	}

	/**
	 * Build accuracy guidelines
	 */
	private static _buildAccuracyGuidelines(
		editorContext?: sidebarTypes.PlanGenerationContext["editorContext"]
	): string {
		return `**PATH ACCURACY:**
- All file paths must be relative to the workspace root
- Use forward slashes (/) for cross-platform compatibility
- Ensure paths match the project's file structure
- Avoid absolute paths or directory traversal

**DEPENDENCY ACCURACY:**
- Identify all required dependencies
- Use correct package names and versions
- Consider both runtime and development dependencies
- Ensure compatibility with existing dependencies

**CODE ACCURACY:**
- Generate syntactically correct code
- Use appropriate language features and patterns
- Ensure type safety (for TypeScript)
- Follow the project's coding conventions

**LOGIC ACCURACY:**
- Implement correct business logic
- Handle edge cases and error conditions
- Ensure proper error handling
- Validate input and output

**INTEGRATION ACCURACY:**
- Ensure new code integrates with existing code
- Maintain existing functionality
- Follow established patterns and conventions
- Consider the broader system architecture`;
	}

	/**
	 * Build code quality standards
	 */
	private static _buildCodeQualityStandards(): string {
		return `**READABILITY:**
- Use clear, descriptive names for variables, functions, and classes
- Write self-documenting code with meaningful comments
- Follow consistent formatting and indentation
- Use appropriate abstractions and modularity

**MAINTAINABILITY:**
- Write modular, reusable code
- Follow the Single Responsibility Principle
- Use appropriate design patterns
- Minimize coupling between components

**PERFORMANCE:**
- Use efficient algorithms and data structures
- Avoid unnecessary computations
- Consider memory usage and garbage collection
- Optimize for the specific use case

**SECURITY:**
- Validate and sanitize all inputs
- Use secure coding practices
- Avoid common vulnerabilities (XSS, injection, etc.)
- Follow the principle of least privilege

**TESTABILITY:**
- Write code that is easy to test
- Use dependency injection where appropriate
- Avoid tight coupling to external dependencies
- Include appropriate error handling`;
	}

	/**
	 * Build framework-specific guidelines
	 */
	private static _buildFrameworkGuidelines(projectContext: string): string {
		// Analyze project context to determine framework
		const isNextJS =
			projectContext.includes("next.config") ||
			projectContext.includes("pages/") ||
			projectContext.includes("app/");
		const isReact =
			projectContext.includes("react") ||
			projectContext.includes("jsx") ||
			projectContext.includes("tsx");
		const isNodeJS =
			projectContext.includes("package.json") && !isNextJS && !isReact;
		const isPython =
			projectContext.includes(".py") ||
			projectContext.includes("requirements.txt");

		let guidelines = "**FRAMEWORK GUIDELINES:**\n";

		if (isNextJS) {
			guidelines += `- Follow Next.js conventions and best practices
- Use appropriate routing patterns (pages/ or app/)
- Follow Next.js file naming conventions
- Use Next.js built-in features when appropriate
- Consider SEO and performance optimizations\n`;
		} else if (isReact) {
			guidelines += `- Follow React best practices and patterns
- Use functional components with hooks
- Follow proper prop typing and validation
- Use appropriate state management patterns
- Consider component reusability and composition\n`;
		} else if (isNodeJS) {
			guidelines += `- Follow Node.js best practices
- Use appropriate module patterns (CommonJS or ES modules)
- Follow proper error handling patterns
- Use appropriate package management
- Consider security and performance\n`;
		} else if (isPython) {
			guidelines += `- Follow PEP 8 style guidelines
- Use type hints where appropriate
- Follow Python naming conventions
- Use appropriate virtual environments
- Consider package management with pip/poetry\n`;
		} else {
			guidelines += `- Follow language-specific best practices
- Use appropriate design patterns
- Follow established conventions
- Consider maintainability and scalability\n`;
		}

		return guidelines;
	}

	/**
	 * Analyze file for generation context
	 */
	private static _analyzeFileForGeneration(
		filePath: string,
		context: any
	): string {
		const segments = filePath.split("/");
		const fileName = path.basename(filePath);
		const extension = path.extname(filePath);

		let analysis = `**FILE ANALYSIS:**
- Path: ${filePath}
- File Name: ${fileName}
- Extension: ${extension}
- Directory Structure: ${segments.slice(0, -1).join("/")}\n`;

		// Determine file type and purpose
		if (segments.includes("components")) {
			analysis += "- Purpose: UI Component\n";
			analysis += "- Expected Patterns: React/Component patterns\n";
		} else if (segments.includes("utils") || segments.includes("helpers")) {
			analysis += "- Purpose: Utility Functions\n";
			analysis += "- Expected Patterns: Pure functions, utilities\n";
		} else if (segments.includes("services")) {
			analysis += "- Purpose: Service Layer\n";
			analysis += "- Expected Patterns: API calls, business logic\n";
		} else if (segments.includes("types") || segments.includes("interfaces")) {
			analysis += "- Purpose: Type Definitions\n";
			analysis += "- Expected Patterns: TypeScript interfaces/types\n";
		} else if (segments.includes("pages") || segments.includes("app")) {
			analysis += "- Purpose: Page/Route Component\n";
			analysis += "- Expected Patterns: Next.js page patterns\n";
		}

		return analysis;
	}

	/**
	 * Get language-specific guidelines
	 */
	private static _getLanguageSpecificGuidelines(languageId: string): string {
		const guidelines: Record<string, string> = {
			typescript: `**TypeScript Guidelines:**
- Use strict TypeScript configuration
- Define proper interfaces and types
- Use type inference where appropriate
- Avoid 'any' type unless necessary
- Use proper access modifiers
- Implement proper error handling with typed errors
- Use modern TypeScript features (optional chaining, nullish coalescing)
- Follow naming conventions (PascalCase for types, camelCase for variables)`,
			javascript: `**JavaScript Guidelines:**
- Use ES6+ features (const, let, arrow functions)
- Use proper error handling with try/catch
- Use async/await for asynchronous operations
- Follow naming conventions (camelCase)
- Use proper JSDoc comments for documentation
- Avoid global variables and side effects
- Use proper module patterns`,
			python: `**Python Guidelines:**
- Follow PEP 8 style guide
- Use type hints where appropriate
- Use proper docstrings for documentation
- Follow naming conventions (snake_case)
- Use virtual environments for dependencies
- Implement proper error handling with try/except
- Use list/dict comprehensions where appropriate`,
			java: `**Java Guidelines:**
- Follow Java naming conventions
- Use proper access modifiers
- Implement equals() and hashCode() together
- Use try-with-resources for resource management
- Use Optional for nullable values
- Follow proper package structure
- Use appropriate design patterns`,
		};

		return (
			guidelines[languageId] ||
			`**General Guidelines:**
- Follow language-specific best practices
- Use appropriate design patterns
- Implement proper error handling
- Follow naming conventions
- Write maintainable and readable code`
		);
	}

	/**
	 * Get accuracy checks for specific language
	 */
	private static _getAccuracyChecks(languageId: string): string {
		const checks: Record<string, string> = {
			typescript: `**TypeScript Accuracy Checks:**
- [ ] All types are properly defined
- [ ] No implicit 'any' types
- [ ] Proper interface/type definitions
- [ ] Correct import/export statements
- [ ] Proper error handling with typed errors
- [ ] No unused imports or variables
- [ ] Proper access modifiers used
- [ ] Modern TypeScript features used appropriately`,
			javascript: `**JavaScript Accuracy Checks:**
- [ ] Proper ES6+ syntax used
- [ ] Correct async/await patterns
- [ ] Proper error handling implemented
- [ ] No unused variables or functions
- [ ] Proper module imports/exports
- [ ] No global scope pollution
- [ ] Proper naming conventions followed`,
			python: `**Python Accuracy Checks:**
- [ ] PEP 8 compliance
- [ ] Proper type hints used
- [ ] Correct import statements
- [ ] Proper error handling with try/except
- [ ] No unused imports or variables
- [ ] Proper docstrings included
- [ ] Correct naming conventions (snake_case)`,
			java: `**Java Accuracy Checks:**
- [ ] Proper package structure
- [ ] Correct access modifiers
- [ ] Proper exception handling
- [ ] No unused imports or variables
- [ ] Proper naming conventions
- [ ] Correct class structure
- [ ] Proper resource management`,
		};

		return (
			checks[languageId] ||
			`**General Accuracy Checks:**
- [ ] Syntax is correct
- [ ] Logic is sound
- [ ] Error handling is appropriate
- [ ] Naming conventions are followed
- [ ] Code is maintainable and readable`
		);
	}

	/**
	 * Analyze file structure for modification
	 */
	private static _analyzeFileStructure(content: string): {
		summary: string;
		functions: any[];
		classes: any[];
		imports: any[];
	} {
		const lines = content.split("\n");
		const functions: any[] = [];
		const classes: any[] = [];
		const imports: any[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();

			if (line.startsWith("import ")) {
				imports.push({ line: i + 1, content: line });
			} else if (line.includes("function ") || line.includes("=>")) {
				functions.push({ line: i + 1, content: line });
			} else if (line.includes("class ")) {
				classes.push({ line: i + 1, content: line });
			}
		}

		return {
			summary: `${functions.length} functions, ${classes.length} classes, ${imports.length} imports`,
			functions,
			classes,
			imports,
		};
	}

	/**
	 * Get modification guidelines
	 */
	private static _getModificationGuidelines(languageId: string): string {
		return `**Modification Guidelines for ${languageId}:**
- Preserve existing imports unless new ones are needed
- Maintain the current code structure and organization
- Follow the existing naming conventions
- Preserve existing functionality unless explicitly requested to change
- Add necessary error handling if new code paths are introduced
- Ensure the modified code compiles/runs without errors
- Update types/interfaces if new structures are added
- Consider the impact on existing tests and documentation`;
	}
}

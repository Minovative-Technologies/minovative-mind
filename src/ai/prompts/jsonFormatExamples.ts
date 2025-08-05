export const jsonFormatDescription = `
    {
        "planDescription": "Brief summary of the overall goal.",
        "steps": [
            {
                "step": 1,
                "action": "create_directory" | "create_file" | "modify_file" | "run_command",
                "description": "Description of step (always required).",
                "path": "relative/path/to/target",
                "content": "...",
                "generate_prompt": "...",
                "modification_prompt": "...",
                "command": "..."
            }
        ]
    }`;

export const fewShotExamples = `
    --- Valid JSON Output Examples ---
    Example 1: A simple file creation with explicit content
    {
        \"planDescription\": \"Create a configuration file.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_file\",
                \"description\": \"Create a basic config.json file.\",
                \"path\": \"src/config.json\",
                \"content\": \"{\\n  \\\"setting\\\": \\\"default\\\"\\n}\"
            }
        ]
    }

    Example 2: Modifying a file and running a command
    {
        \"planDescription\": \"Add analytics tracking and install dependency.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"modify_file\",
                \"description\": \"Add analytics tracking code to index.html.\",
                \"path\": \"public/index.html\",
                \"modification_prompt\": \"In the <head> section, add a script tag to load 'analytics.js'.\"
            },
            {
                \"step\": 2,
                \"action\": \"run_command\",
                \"description\": \"Install the 'analytics-lib' package.\",
                \"command\": \"npm install analytics-lib --save-dev\"
            }
        ]
    }

    Example 3: Modifying a TypeScript file using a modification prompt
    {
        \"planDescription\": \"Implement a new utility function.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"modify_file\",
                \"description\": \"Add a new function 'formatDate' to the existing utils.ts file.\",
                \"path\": \"src/utils.ts\",
                \"modification_prompt\": \"Add a public function 'formatDate' that takes a Date object and returns a string in 'YYYY-MM-DD' format. Use existing helper functions if available, otherwise implement date formatting logic.\"
            }
        ]
    }

    Example 4: Creating a directory and a file with AI-generated content
    {
        \"planDescription\": \"Set up a new component directory and create a component file.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_directory\",
                \"description\": \"Create a directory for the new button component.\",
                \"path\": \"src/components/Button\"
            },
            {
                \"step\": 2,
                \"action\": \"create_file\",
                \"description\": \"Create the main TypeScript file for the Button component.\",
                \"path\": \"src/components/Button/Button.tsx\",
                \"generate_prompt\": \"Generate a basic React functional component in TypeScript named 'Button' that accepts children and props for handling click events. Include necessary imports.\"
            }
        ]
    }

    Example 5: Running multiple commands and modifying a file
    {
        \"planDescription\": \"Update dependencies and apply formatting.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"run_command\",
                \"description\": \"Update all npm dependencies.\",
                \"command\": \"npm update\"
            },
            {
                \"step\": 2,
                \"action\": \"run_command\",
                \"description\": \"Run code formatter across the project.\",
                \"command\": \"npx prettier --write .\"
            },
            {
                \"step\": 3,
                \"action\": \"modify_file\",
                \"description\": \"Update version number in package.json (optional).\",
                \"path\": \"package.json\",
                \"modification_prompt\": \"Increase the patch version in the 'version' field of this package.json file.\"
            }
        ]
    }

    Example 6: Creating a file with content from a prompt and adding a simple configuration file
    {
        \"planDescription\": \"Add a new service and update its configuration.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_file\",
                \"description\": \"Create a new API service file.\",
                \"path\": \"src/services/apiService.js\",
                \"generate_prompt\": \"Write a JavaScript service using async/await and fetch API to make GET and POST requests to a configurable endpoint.\"
            },
            {
                \"step\": 2,
                \"action\": \"create_file\",
                \"description\": \"Create a configuration file for the API service.\",
                \"path\": \"src/config/api.config.json\",
                \"content\": \"{\\n  \\\"apiUrl\\\": \\\"https://api.example.com/v1\\\"\\n}\"
            }
        ]
    }

    Example 7: Create a test file for an existing component in a nested directory
    {
        \"planDescription\": \"Create a test file for an existing UI component.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_file\",
                \"description\": \"Create 'MyComponent.test.tsx' within the 'src/components/MyComponent' directory.\",
                \"path\": \"src/components/MyComponent/MyComponent.test.tsx\",
                \"generate_prompt\": \"Generate a basic Jest/React Testing Library test file for a functional React component located at 'src/components/MyComponent/MyComponent.tsx'. The component is named 'MyComponent'.\"
            }
        ]
    }

    Example 8: Create a new Next.js API route.
    {
        \"planDescription\": \"Create a new Next.js API endpoint.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_file\",
                \"description\": \"Create a new API route file for '/api/users'.\",
                \"path\": \"pages/api/users.ts\",
                \"generate_prompt\": \"Generate a basic Next.js API route in TypeScript at 'pages/api/users.ts' that responds with a list of mock users for a GET request.\"
            }
        ]
    }

    Example 9: Create a new Next.js UI page.
    {
        \"planDescription\": \"Add a new Next.js dashboard page.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"create_file\",
                \"description\": \"Create a new Next.js page component for the dashboard.\",
                \"path\": \"pages/dashboard/index.tsx\",
                \"generate_prompt\": \"Generate a simple Next.js functional component for a dashboard page in TypeScript. Include a basic layout and a welcome message.\"
            }
        ]
    }

    Example 10: Modify \`next.config.js\` or \`package.json\` for Next.js configuration.
    {
        \"planDescription\": \"Update Next.js configuration to enable experimental features.\",
        \"steps\": [
            {
                \"step\": 1,
                \"action\": \"modify_file\",
                \"description\": \"Modify the 'next.config.js' file to enable the 'output: standalone' experimental feature.\",
                \"path\": \"next.config.js\",
                \"modification_prompt\": \"Update the 'next.config.js' file to add \`output: 'standalone'\` to the configuration object if it's not already present, ensuring the module export structure remains valid.\"
            }
        ]
    }
    --- End Valid JSON Output Examples ---
`;

export const jsonSchemaReference = `
        interface ExecutionPlan {
          planDescription: string;
          steps: PlanStep[];
        }

        interface PlanStep {
          step: number; // 1-indexed, sequential
          action: "create_directory" | "create_file" | "modify_file" | "run_command";
          description: string;
          // File/Directory Operations:
          path?: string; // REQUIRED for 'create_directory', 'create_file', 'modify_file'. Must be a non-empty, relative string (e.g., 'src/components/button.ts'). DO NOT leave this empty, null, or undefined.
          // 'create_file' specific:
          content?: string; // Exclusive with 'generate_prompt'. Full content of the new file.
          generate_prompt?: string; // Exclusive with 'content'. A prompt to generate file content.
          // 'modify_file' specific:
          modification_prompt?: string; // REQUIRED for 'modify_file'. Instructions on how to modify the file's content.
          // 'run_command' specific:
          command?: string; // REQUIRED for 'run_command'. The command string to execute.
        }`;

export const fewShotCorrectionExamples = `
        --- Valid Correction Plan Examples ---
        Example 1: Simple syntax fix in an existing file
        {
            \"planDescription\": \"Fix a syntax error in utils.ts\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"modify_file\",
                    \"description\": \"Correct missing semicolon and adjust function call in utils.ts as per diagnostic.\",
                    \"path\": \"src/utils.ts\",
                    \"modification_prompt\": \"The file src/utils.ts has a syntax error: 'Expected ;'. Add a semicolon at the end of line 10. Also, ensure the 'calculateSum' function call on line 15 passes the correct number of arguments as indicated by the 'Expected 2 arguments, but got 1.' diagnostic.\"
                }
            ]
        }

        Example 2: Adding a missing import
        {
            \"planDescription\": \"Add missing 'useState' import to MyComponent.tsx\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"modify_file\",
                    \"description\": \"Add missing 'useState' import from 'react' to MyComponent.tsx to resolve 'useState is not defined' error.\",
                    \"path\": \"src/components/MyComponent.tsx\",
                    \"modification_prompt\": \"Add 'useState' to the React import statement in src/components/MyComponent.tsx so it becomes 'import React, { useState } from 'react';' to resolve the 'useState is not defined' error.\"
                }
            ]
        }

        Example 3: Resolving a type error in TypeScript
        {
            \"planDescription\": \"Correct type mismatch in userSlice.ts\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"modify_file\",
                    \"description\": \"Adjust the type definition for 'user' state in userSlice.ts from 'string' to 'UserInterface' to match expected object structure.\",
                    \"path\": \"src/store/userSlice.ts\",
                    \"modification_prompt\": \"In src/store/userSlice.ts, change the type of the 'user' property in the initial state from 'string' to 'UserInterface' (assuming UserInterface is already defined or will be imported). Ensure the default value for 'user' is a valid UserInterface object or null as appropriate.\"
                }
            ]
        }

        Example 4: Creating a new file to fix a missing module error
        {
            \"planDescription\": \"Create a new utility file for common functions\",
            \"steps\": [
                {
                    \"step\": 1,
                    \"action\": \"create_file\",
                    \"description\": \"Create 'src/utils/mathUtils.ts' as it is missing, which causes 'Module not found' error.\",
                    \"path\": \"src/utils/mathUtils.ts\",
                    \"generate_prompt\": \"Generate a TypeScript file 'src/utils/mathUtils.ts' that exports a function named 'add' which takes two numbers and returns their sum, and a function named 'subtract' which takes two numbers and returns their difference.\"
                }
            ]
        }
        --- End Valid Correction Plan Examples ---
    `;

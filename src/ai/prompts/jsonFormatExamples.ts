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

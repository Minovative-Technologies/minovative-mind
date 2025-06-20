# Minovative Mind VS Code Extension: User Guide

Welcome to Minovative Mind, your AI-powered assistant seamlessly integrated into VS Code! This extension leverages Google Gemini to provide intelligent, context-aware assistance directly within your development environment. From understanding complex code to automating multi-step refactoring, Minovative Mind is designed to accelerate your coding workflow and enhance productivity.

This guide will walk you through the core features and provide tips on how to get the most out of this powerful tool.

## 1. Getting Started

Before you can start using Minovative Mind, you'll need to install the extension.

### 1.1 Installation

1.  **Search:** Open VS Code, go to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2.  **Install:** Search for "Minovative Mind" and click "Install".

## 2. Core AI Capabilities

Minovative Mind offers several ways to integrate AI directly into your coding process.

### 2.1 AI Chat Interface (Sidebar)

The primary mode of interaction is through the dedicated chat interface in the Minovative Mind sidebar.

- **General Q&A:** Ask the AI questions about your project, programming concepts, or anything code-related.
- **Contextual Awareness:** The AI automatically considers your open workspace and relevant files when you ask questions, providing highly contextual responses.
- **How to Use:** Simply type your query in the input field at the bottom of the chat view and press Enter.
- **Examples:**
  - "Explain the `authenticateUser` function in `auth.ts` file."
  - "How can I refactor this React component to use hooks for state management and side effects?"

#### Chat History Management

- **Clear Chat:** Click the "Clear Chat" button to erase the current conversation history.
- **Save Chat:** Click "Save Chat" to save the current conversation to a JSON file on your local machine. This is useful for preserving important discussions or AI-generated content.
- **Load Chat:** Click "Load Chat" to load a previously saved chat history. Loading a history provides the AI with context from past conversations, allowing for more coherent follow-ups across sessions.

#### Copy Message Feature

A "Copy Message" button is available with AI chat responses, allowing users to easily copy the generated text (including formatted code blocks) to their clipboard.

### 2.2 Code Explanation

Quickly understand selected code snippets without leaving your editor.

- **Purpose:** Get concise, clear explanations of code's purpose, functionality, and key components.
- **How to Use:**
  1.  **Select Code:** In any active editor, select the code block you want to understand.
  2.  **Context Menu:** Right-click on the selected code.
  3.  **Generate Explanation:** Choose "Minovative Mind" > "**Generate Explanation**".
- **Result:** A modal dialog will appear with the AI's explanation.
- **Example:** If you select the following JavaScript function:
  ```javascript
  function calculateArea(radius) {
  	return Math.PI * radius * radius;
  }
  ```
  The AI might explain: "This function calculates the area of a circle. It takes one parameter, `radius`, a number representing the circle's radius, and returns a number representing its area using the formula `πr²`."

### 2.3 Contextual Code Modification & Generation

This powerful feature allows you to ask the AI to modify selected code, generate documentation, or even fix issues directly in your editor. The AI is engineered with an advanced persona to generate production-ready, robust, maintainable, and secure code.

- **How to Use:**
  1.  **Select Code:** Select the code you wish to modify or apply an action to.
  2.  **Activate Command:**
      - **Keyboard Shortcut:** Press `Ctrl+M` (Windows/Linux) or `Cmd+M` (macOS).
      - **Context Menu:** Right-click on the selected code, then choose "Minovative Mind" > "**Custom Modifications**".
  3.  **Input Prompt:** A quick input box will appear. Here, you can type your instructions:
      - **Free-form Modification (Premium Tier):** Describe the change you want. Some powerful examples include:
        - "Refactor this function to be more modular and use helper functions to improve readability."
        - "Add JSDoc comments to this class and ensure type safety for all properties and methods using TypeScript interfaces."
        - "Change this API call from `axios` to `fetch` and implement robust error handling for network issues."
        - **Symbol-Aware Refactoring:** The AI leverages VS Code's symbol information (functions, classes, variables, references, definitions, and types) to enable more precise, comprehensive, and robust refactorings and modifications across your entire project.
      - **Automated Documentation (`/docs`):** Type `/docs` to instruct the AI to generate appropriate documentation (e.g., JSDoc for JavaScript/TypeScript, docstrings for Python) for the selected code. The documentation will be inserted directly into your file. Example: Select a JavaScript function, type `/docs`, and it will generate JSDoc comments above it.
      - **Automated Code Fixing (`/fix`) (Premium Tier):** Type `/fix` to tell the AI to analyze the selected code and its context, including any relevant VS Code diagnostics (warnings, errors), and propose fixes. **If no code is selected, the AI will analyze the entire active file.** The AI aims to directly modify the code to resolve identified issues. Example: If you have an `Unused variable` warning, select the problematic code or the whole file, type `/fix`, and the AI will remove the unused variable.
      - **AI Merge Conflict Resolution (`/merge`) (Premium Tier):** Type `/merge` to instruct the AI to automatically detect and resolve Git merge conflicts in the active file. The AI analyzes conflict markers, generates a semantically coherent merged version, applies the resolution, and unmarks the file as conflicted, streamlining a common tedious task.
      - **Diagnostic-Aware Modifications:** For both targeted selections and whole-file operations, the AI leverages relevant VS Code diagnostics (warnings, errors) to inform its custom modifications, leading to more accurate and problem-solving suggestions.

## 3. Advanced Workflow & Automation

For more complex tasks that involve multiple steps, file creations, or command executions, Minovative Mind offers a robust planning and execution workflow.

### 3.1 AI-Driven Planning and Execution (Premium Tier)

When you initiate a complex request via the chat (`/plan [request]`) or if a direct code modification request becomes too complex for a single step, Minovative Mind guides you through a two-stage planning process:

#### Stage 1: Textual Plan Explanation

1. **AI's Proposed Plan:** The AI will first generate a detailed, human-readable explanation of its step-by-step plan. This plan will be displayed in the Minovative Mind sidebar, formatted with Markdown for clarity.
2. **Review and Confirm:** This is your opportunity to review the proposed actions. You can either:
   - **Confirm:** If you agree with the plan, click the "Confirm Plan" button in the sidebar.
   - **Cancel:** If the plan isn't what you expected, or you wish to refine your instructions, click "Cancel Plan".
   - **Benefit:** This stage provides transparency and control, allowing you to understand and approve the AI's strategy before any modifications are made to your codebase.

When reviewing the textual plan, pay close attention to:

- **Logical flow:** Are the steps in a sensible, coherent order?
- **Completeness:** Does the plan address all aspects of your request?
- **Unintended actions:** Are there any steps that seem unrelated or potentially harmful?
- **Resource efficiency:** Could the same outcome be achieved with fewer or simpler steps?

_Tip:_ If the plan isn't quite right, clicking "Cancel Plan" and then refining your initial prompt (e.g., "Make sure to include tests for this functionality," or "Please use pure functions for this part") can often lead to a much better revised plan.

#### Stage 2: Plan Execution (Structured JSON Plan)

Upon user confirmation, the AI will convert the textual plan into a machine-readable JSON format, which the extension will then execute.

- **Plan Step Actions:** The JSON plan can contain the following actions:

  - `create_directory`: Creates a new folder at the specified relative path (e.g., creating src/features/auth for authentication modules).
  - `create_file`: Creates a new file. It can either insert provided `content` directly, or it can use a `generate_prompt` where the AI itself generates the file's content based on your instructions (e.g., generating src/utils/validation.ts with helper functions).
  - `modify_file`: Modifies an existing file. The AI uses a `modification_prompt` to generate the updated file content based on the original content and your instruction. If the target file does not exist, the system will automatically create it and populate it with content generated from the `modification_prompt`, enhancing plan resilience and improving plan reliability (e.g., updating src/main.ts to import new components or add a new route).
    - **Important:** For any given file path, there will be at most **one** `modify_file` step within the entire plan. If multiple logical changes are needed for the same file, they are combined into a single, comprehensive `modification_prompt` for that file's step.
  - `run_command`: Executes a shell command in the integrated terminal (e.g., `npm install`, `git commit`) (e.g., installing new dependencies with npm install @fortawesome/react-fontawesome).
    - **User Confirmation Required:** For security, you will be prompted with a confirmation dialog before any `run_command` step is executed. You can choose to "Allow Command" or "Skip Command".

- **Interactive Execution:**

  - As the plan executes, Minovative Mind provides real-time progress updates in the VS Code notification area and within the sidebar chat.
  - **Typing Animation:** For `create_file` and `modify_file` steps that involve AI-generated content, you'll see a simulated "typing" animation as the content is written into your editor.
  - **File Diffs in Chat:** Real-time file changes (diffs) are displayed directly within the chat interface for `create_file` and `modify_file` plan steps, with enhanced execution messages indicating diff availability.
  - **Cancellation:** You can cancel an ongoing plan execution at any time via the VS Code progress notification. Be aware that changes made by completed steps are permanent.
  - **Resilient Plan Execution:** Enhances robustness by automatically retrying failed plan steps (with 10s, 15s, 20s delays) for transient errors like API overloads or network issues. For persistent failures or exhausted retries, users are prompted with options to 'Retry Step', 'Skip Step', or 'Cancel Plan', preventing mid-plan halts and preserving progress.

- **Dynamic Context Awareness:** The AI maintains a robust and adaptive understanding of ongoing project changes, including newly created files and recent modifications, throughout a multi-step workflow. This ensures that subsequent planned actions are highly coherent and build accurately upon previous steps, leading to more reliable and contextually aware solutions that reflect the evolving state of your codebase.
- **Seamless Editor-to-Plan Integration:** When custom code modification requests (triggered via `Ctrl+M` or `Cmd+M`) or `/fix` commands involve complex, multi-step tasks, the extension seamlessly escalates them to the full AI-driven planning and execution system. This allows the AI to break down and execute the task as a coherent series of actions, potentially across multiple files, to achieve the desired outcome.

### 3.2 Retrying Structured Plan Generation

If the AI fails to generate a valid JSON plan (e.g., due to parsing errors), Minovative Mind will prompt you with a "Retry" option in the sidebar. This allows the AI to re-attempt generating the JSON plan based on the same textual plan and context, often resolving transient issues or misinterpretations. The system will automatically retry plan generation up to 3 times for transient errors.

### 3.3 Automated Git Commit Messages

Minovative Mind offers intelligent Git integration to help you write better commit messages faster.

- **Purpose:** Automatically generate a descriptive and conventional commit message based on your staged changes.
- **How to Use:**
  1.  **Stage Changes:** Ensure you have changes staged in your Git repository.
  2.  **Execute Command:**
      - **Sidebar Chat:** Type `/commit` in the Minovative Mind chat input.
      - **Dedicated Button:** Click the "Commit Changes" button in the Minovative Mind sidebar.
  3.  **Process:**
      - Minovative Mind will first automatically stage any pending changes (`git add .`).
      - It will then analyze the staged diff and generate a conventional commit message using the AI.
      - **Interactive Review:** A user-facing review step is provided for generated Git commit messages before they are actually executed, allowing users to approve or modify.
      - The generated message will be used to execute a `git commit` command in your terminal.
- **Benefit:** Saves time, promotes consistent commit hygiene, and ensures your commit history is always clear and informative.

## 4. Account & Subscription Management

Access and manage your Minovative Mind user account and subscription directly within VS Code.

### 4.1 User Accounts & Authentication

- **Seamless Integration:** You can effortlessly sign in for a Minovative Mind account directly within the VS Code sidebar.
- **Secure Sessions:** The extension securely manages user authentication sessions, enabling personalized feature access and preferences.

### 4.2 Flexible Subscription Tiers

Minovative Mind offers two distinct subscription tiers to cater to different user needs:

- **Free Tier:** This tier provides foundational AI capabilities essential for everyday development. It includes comprehensive AI chat for general Q&A and contextual awareness, on-demand code explanation, AI-generated documentation via the `/docs` command, and automated Git commit message generation using the `/commit` command. This tier is perfect for users seeking powerful AI assistance for common tasks.
- **Premium Tier:** This tier unlocks the full suite of Minovative Mind's advanced AI-Agent features, significantly enhancing your productivity and workflow. It includes intelligent code modification for free-form refactors and enhancements, automated code fixing with the `/fix` command, AI merge conflict resolution using the new `/merge` command, sophisticated AI-driven planning & execution for multi-step tasks initiated with the `/plan` command, and real-time live code insertion with dynamic typing animations. The Premium Tier is designed for developers who require comprehensive, automated solutions for complex challenges.

### 4.3 Manage Your Subscription

- **Customer Portal Access:** You can conveniently manage your Premium subscription details, view billing information, and update payment methods via a secure link to the Stripe Customer Portal, accessible directly from the extension's settings.
- **Transparent Feature Gating:** The extension clearly indicates which features are available or restricted based on your current authentication status and subscription tier.

## 5. Customization & Management

Tailor Minovative Mind to your preferences and manage key settings.

### 5.1 Seamless API Key Setup

Minovative Mind requires a Google Gemini API key to function. This key enables the extension to communicate with Google's powerful AI models.

1.  **Obtain a Key:** If you don't have one, generate a Gemini API key from the Google AI Studio or Google Cloud Console.
2.  **Open Sidebar:** In VS Code, click on the "Minovative Mind" icon in the Activity Bar (it looks like a thought bubble with gears).
3.  **Add Key:** In the sidebar, locate the API Key input field. Paste your Gemini API key into this field and click "Add Key".
4.  **Manage Keys:**

    - You can add multiple API keys. Adding multiple API keys is highly recommended for heavy users to ensure uninterrupted workflow by automatically cycling through keys and distributing usage, minimizing 'Quota Exceeded' errors. Additionally, API keys will rotate on every AI API call to distribute cost and usage across all API keys for extreme efficiency.
    - Use the "Next Key" and "Previous Key" buttons to switch manually, or the "Delete Key" button to remove the currently active key.

    **Security Note:** Your API keys are securely stored in VS Code's secret storage and are never exposed or sent outside of your local environment except directly to Google's Gemini API endpoints.

### 5.2 Flexible AI Model Selection

Minovative Mind allows you to select the specific Gemini model you wish to use.

1.  **Access Settings:** In the Minovative Mind sidebar, you'll find a dropdown or section for "AI Model Selection".
2.  **Choose Model:** Select your preferred Gemini model (e.g., `gemini-2.5-pro`, `gemini-2.5-flash`). Different models offer varying capabilities, speed, and cost. `gemini-2.5-flash` is often a good balance for general programming tasks.

### 5.3 Precise Context Control

Gain granular control over what information the AI considers.

- **Intelligent Filtering:** The AI intelligently identifies and provides the most relevant files from your project. This is especially beneficial in large codebases, as it focuses the AI's attention on what truly matters to your query.
- **Configurable Inclusions/Exclusions:** You can fine-tune the AI’s understanding by explicitly including or excluding specific files or directories from its context in the chat interface. This also respects `.gitignore` rules.

## 6. User Experience & Productivity

Enhance your development workflow with these helpful features and tips.

### 6.1 Live Code Insertion (Premium Tier)

- **Dynamic Typing:** When the AI generates or modifies code as part of a plan, you’ll experience a dynamic, real-time "typing" animation as the content is written directly into your editor.

### 6.2 Smart Context Awareness

- **Comprehensive Understanding:** The AI intelligently considers your active file content, selected code, relevant diagnostics (warnings/errors) from VS Code, chat history, the overall project structure, enhanced detailed symbol information (definitions, references), and TypeScript-aware dependency graph analysis (respecting `tsconfig.json`/`jsconfig.json` for accurate module resolution), to provide highly relevant and accurate responses.

### 6.3 Built-in Troubleshooting Guidance

- **In-Extension Support:** The extension provides helpful tips and solutions directly within the app for common issues like API key errors or quota limits. Direct links are provided to check Google Cloud API usage quotas for comprehensive troubleshooting.

### 6.4 Practical Usage Tips

To get the best results from Minovative Mind, consider these tips:

- **Be Specific with Prompts:** The more detailed and clear your instructions to the AI, the more accurate and helpful its responses will be. Provide contrasting examples for various scenarios:
  - **Code Generation:** "Bad: 'Write a login form.' Good: 'Generate a React login form with state management using `useState`, basic input validation for email and password fields (client-side only), and a submit handler that calls an `api.login` function from `src/services/api.ts`.'"
  - **Debugging:** "Bad: 'Fix this bug.' Good: 'Analyze the `TypeError: Cannot read property 'map' of undefined` error occurring in `src/components/UserList.tsx` when `userData` is null or undefined. Propose a robust fix, possibly by adding a conditional check for loading state or data presence before rendering the list.'"
  - **Refactoring:** "Bad: 'Clean up this code.' Good: 'Refactor the `processData` function in `data_handler.py` to improve readability and performance. Break down complex logic into smaller, testable private methods and add type hints where appropriate.'"
- **Leverage Context Fully:**
  1.  When using editor commands, always select the most relevant code.
  2.  For chat, remember that Minovative Mind automatically considers your workspace. If you're discussing a specific part of your project, ensure relevant files are open or mentioned.
- **Review AI Plans (Crucial!):** Always take the time to read the textual plan explanation carefully. This is your most important control point. When reviewing the plan, critically assess:
  - **Verify scope:** Does the plan solely address what you asked, or are there unintended changes or side effects?
  - **Check logical flow:** Are the steps presented in a sensible and efficient order?
  - **Assess impact:** Will the proposed changes introduce breaking changes or require significant follow-up work on your part?
  - **Review file paths:** Are files being created, modified, or deleted in the correct and expected locations relative to your project structure?
  - **Command scrutiny:** For any `run_command` steps, understand precisely what each command will do before confirming its execution.
    If the plan isn't right, cancel it and refine your prompt.
- **Iterative Prompting & Refinement:** If the AI's initial response or plan isn't perfectly aligned with your needs, don't just clear the chat. Try refining your prompt by adding more constraints, clarifying ambiguities, or specifying a different approach. For example, if it uses a library you don't want, you could say: "Please regenerate the solution, but avoid using Library X and use Y instead," or "Refactor this with a functional approach, not class-based."
- **Reinforce Modularization:** When requesting complex features or refactors, explicitly ask the AI to adhere to modularization principles. For instance, phrase your request as: "Ensure all new components are reusable and follow the single responsibility principle," or "Extract shared logic into a new utility file to maintain modularity and avoid duplication."
- **Utilize Multiple API Keys:** If you're a heavy user and frequently encounter "Quota Exceeded" errors, adding multiple API keys allows the extension to automatically switch to an available key, minimizing interruptions.
- **Understand AI Limitations:** AI is a powerful tool, but it's not infallible. Always review and test AI-generated code or executed plan outcomes. Treat the AI as an expert assistant, not a replacement for your own judgment.
- **Modularization:** The AI is explicitly instructed to follow modularization principles. When making complex requests, consider reminding the AI in your prompt to ensure new code adheres to best practices for separation of concerns and reusability.

### 6.5 Chat History Management

- **Persistence:** You can save your entire chat history to a JSON file on your local machine for later review or to preserve important discussions/AI-generated content.
- **Restoration:** Previously saved chat histories can be loaded, providing the AI with context from past conversations for more coherent follow-ups across sessions. Chat history also automatically restores to the webview following actions like commit confirmation, cancellation, and plan execution updates.
- **Clear Chat:** Option to clear the current conversation.

### 6.6 Copy Message Feature

- **Convenience:** A convenient "Copy Message" button is integrated with AI chat responses, allowing you to easily copy the generated text (including formatted code blocks) to your clipboard.

### 6.7 Visual Feedback

- **Status Updates:** Provides clear status messages in the sidebar for ongoing operations (e.g., "Generating documentation…", "Executing Step 1…").
- **Error Indicators:** Displays distinct visual cues for error messages within the chat and status area.
- **Code Block Rendering:** Ensures code blocks displayed in the chat (e.g., within AI responses or diffs) are properly word-wrapped to prevent horizontal scrolling and improve readability.
- **Diff Syntax Highlighting:** File diffs displayed in the chat interface are rendered with syntax highlighting for added and removed lines, enhancing clarity and reviewability.

## 7. Troubleshooting Common Issues

If you encounter problems, consult these common solutions.

- **"No API Key" or "Invalid API Key" Errors:**
  - **Solution:** Double-check that your Gemini API key is correctly entered in the sidebar. Ensure it has the necessary permissions for the Gemini API.
- **"Quota Exceeded" Errors:**
  - **Cause:** You've reached Google's usage limits for the active API key.
  - **Solution:** Wait for your quota to reset (check your Google Cloud Console for details), or add another API key to your Minovative Mind settings. The extension will automatically try to switch to an unused key.
- **"Failed to Parse Plan" Errors:**
  - **Cause:** The AI generated an execution plan in an invalid JSON format.
  - **Solution:** Click the "Retry" button in the sidebar. The AI will attempt to regenerate the JSON plan. If it persists, try rephrasing your initial request or providing more specific instructions.
- **"Operation Cancelled" Messages:**
  - **Cause:** You manually cancelled an ongoing AI generation or plan execution.
  - **Note:** Any changes made by steps completed _before_ cancellation are permanent, but you can always use `Ctrl+Z` (Windows/Linux) or `Cmd+Z` (macOS).

## 8. Feedback and Support

Your feedback is invaluable! If you encounter any bugs, have suggestions for new features, or just want to share your experience, please visit the Minovative Mind Feedback Form below to submit an issue, feature, and more. Your contributions help make Minovative Mind better for every developer.

> Remember, Minovative Mind is designed to assist, not replace, the brilliance of human developers! Happy Coding!

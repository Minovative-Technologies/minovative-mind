# Minovative Mind VS Code Extension: User Guide

Welcome to Minovative Mind, your AI-powered assistant seamlessly integrated into VS Code! This extension leverages Google Gemini to provide intelligent, context-aware assistance directly within your development environment. From understanding complex code to automating multi-step refactoring, Minovative Mind is designed to accelerate your coding workflow and enhance productivity.

This guide will walk you through the core features and provide tips on how to get the most out of this powerful tool.

## 1. Getting Started

Before you can start using Minovative Mind, you'll need to set up your Google Gemini API key.

### 1.1 Installation

1.  **Search:** Open VS Code, go to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2.  **Install:** Search for "Minovative Mind" and click "Install".

### 1.2 Setting Up Your Gemini API Key

Minovative Mind requires a Google Gemini API key to function. This key enables the extension to communicate with Google's powerful AI models.

1.  **Obtain a Key:** If you don't have one, generate a Gemini API key from the Google AI Studio or Google Cloud Console.
2.  **Open Sidebar:** In VS Code, click on the "Minovative Mind" icon in the Activity Bar (it looks like a thought bubble with gears).
3.  **Add Key:** In the sidebar, locate the API Key input field. Paste your Gemini API key into this field and click "Add Key".
4.  **Manage Keys:**

    - You can add multiple API keys. Minovative Mind will automatically cycle through them if one hits a quota limit, ensuring uninterrupted workflow.
    - Use the "Next Key" and "Previous Key" buttons to switch manually, or the "Delete Key" button to remove the currently active key.

    **Security Note:** Your API keys are securely stored in VS Code's secret storage and are never exposed or sent outside of your local environment except directly to Google's Gemini API endpoints.

### 1.3 Selecting an AI Model

Minovative Mind allows you to select the specific Gemini model you wish to use.

1.  **Access Settings:** In the Minovative Mind sidebar, you'll find a dropdown or section for "AI Model Selection".
2.  **Choose Model:** Select your preferred Gemini model (e.g., `gemini-2.5-pro`, `gemini-2.5-flash`). Different models offer varying capabilities, speed, and cost. `gemini-2.5-flash` is often a good balance for general programming tasks.

## 2. Core Features: Accelerating Your Workflow

Minovative Mind offers several ways to integrate AI directly into your coding process.

### 2.1 AI Chat Interface (Sidebar)

The primary mode of interaction is through the dedicated chat interface in the Minovative Mind sidebar.

- **General Q&A:** Ask the AI questions about your project, programming concepts, or anything code-related.
- **Contextual Awareness:** The AI automatically considers your open workspace and relevant files when you ask questions, providing highly contextual responses.
- **How to Use:** Simply type your query in the input field at the bottom of the chat view and press Enter.

#### Chat History Management

- **Clear Chat:** Click the "Clear Chat" button to erase the current conversation history.
- **Save Chat:** Click "Save Chat" to save the current conversation to a JSON file on your local machine. This is useful for preserving important discussions or AI-generated content.
- **Load Chat:** Click "Load Chat" to load a previously saved chat history. Loading a history provides the AI with context from past conversations, allowing for more coherent follow-ups across sessions.

### 2.2 Code Explanation

Quickly understand selected code snippets without leaving your editor.

- **Purpose:** Get concise, clear explanations of code's purpose, functionality, and key components.
- **How to Use:**
  1.  **Select Code:** In any active editor, select the code block you want to understand.
  2.  **Context Menu:** Right-click on the selected code.
  3.  **Generate Explanation:** Choose "Minovative Mind" > "**Generate Explanation**".
- **Result:** A modal dialog will appear with the AI's explanation.

### 2.3 Contextual Code Modification & Generation

This powerful feature allows you to ask the AI to modify selected code, generate documentation, or even fix issues directly in your editor.

- **How to Use:**
  1.  **Select Code:** Select the code you wish to modify or apply an action to.
  2.  **Activate Command:**
      - **Keyboard Shortcut:** Press `Ctrl+M` (Windows/Linux) or `Cmd+M` (macOS).
      - **Context Menu:** Right-click on the selected code, then choose "Minovative Mind" > "**Custom Modifications**".
  3.  **Input Prompt:** A quick input box will appear. Here, you can type your instructions:
      - **Free-form Modification:** Describe the change you want (e.g., "Refactor this function to use async/await", "Add input validation for the 'username' field").
      - **Automated Documentation (`/docs`):** Type `/docs` to instruct the AI to generate appropriate documentation (e.g., JSDoc for JavaScript/TypeScript, docstrings for Python) for the selected code. The documentation will be inserted directly into your file.
      - **Automated Code Fixing (`/fix`):** Type `/fix` to tell the AI to analyze the selected code and its context, including any relevant VS Code diagnostics (warnings, errors), and propose fixes. The AI aims to directly modify the code to resolve identified issues.

## 3. Advanced Workflow: AI-Driven Planning and Execution

For more complex tasks that involve multiple steps, file creations, or command executions, Minovative Mind offers a robust planning and execution workflow. This is triggered automatically if your `/fix` or custom modification request cannot be solved with a single direct code insertion, or if you use the `/plan` chat command.

### 3.1 The Two-Stage Planning Process

When you initiate a complex request, Minovative Mind guides you through a two-stage planning process:

#### Stage 1: Textual Plan Explanation

1.  **AI's Proposed Plan:** The AI will first generate a detailed, human-readable explanation of its step-by-step plan. This plan will be displayed in the Minovative Mind sidebar, formatted with Markdown for clarity.
2.  **Review and Confirm:** This is your opportunity to review the proposed actions. You can either:
    - **Confirm:** If you agree with the plan, click the "Confirm Plan" button in the sidebar.
    - **Cancel:** If the plan isn't what you expected, or you wish to refine your instructions, click "Cancel Plan".
    - **Benefit:** This stage provides transparency and control, allowing you to understand and approve the AI's strategy before any modifications are made to your codebase.

#### Stage 2: Plan Execution (Structured JSON Plan)

Upon confirmation, the AI will convert the textual plan into a machine-readable JSON format, which the extension will then execute.

- **Plan Step Actions:** The JSON plan can contain the following actions:

  - `create_directory`: Creates a new folder at the specified relative path.
  - `create_file`: Creates a new file.
    - It can either insert provided `content` directly.
    - Or, it can use a `generate_prompt` where the AI itself generates the file's content based on your instructions.
  - `modify_file`: Modifies an existing file.
    - The AI uses a `modification_prompt` to generate the updated file content based on the original content and your instruction.
    - **Important:** For any given file path, there will be at most **one** `modify_file` step within the entire plan. If multiple logical changes are needed for the same file, they are combined into a single, comprehensive `modification_prompt` for that file's step.
  - `run_command`: Executes a shell command in the integrated terminal (e.g., `npm install`, `git commit`).
    - **User Confirmation Required:** For security, you will be prompted with a confirmation dialog before any `run_command` step is executed. You can choose to "Allow Command" or "Skip Command".

- **Interactive Execution:**
  - As the plan executes, Minovative Mind provides real-time progress updates in the VS Code notification area and within the sidebar chat.
  - **Typing Animation:** For `create_file` and `modify_file` steps that involve AI-generated content, you'll see a simulated "typing" animation as the content is written into your editor.
  - **Cancellation:** You can cancel an ongoing plan execution at any time via the VS Code progress notification. Be aware that changes made by completed steps are permanent.

### 3.2 Retrying Structured Plan Generation

If the AI fails to generate a valid JSON plan (e.g., due to parsing errors), Minovative Mind will prompt you with a "Retry" option in the sidebar. This allows the AI to re-attempt generating the JSON plan based on the same textual plan and context, often resolving transient issues or misinterpretations.

## 4. Git Integration: Automated Commit Messages

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
      - The generated message will be used to execute a `git commit` command in your terminal.
- **Benefit:** Saves time, promotes consistent commit hygiene, and ensures your commit history is always clear and informative.

## 5. Tips for Maximizing Utility

To get the best results from Minovative Mind, consider these tips:

- **Be Specific with Prompts:** The more detailed and clear your instructions to the AI, the more accurate and helpful its responses will be. For example, instead of "fix this code", try "refactor this function to be more readable and add inline comments explaining complex logic, paying attention to the existing error handling in `utils.ts`".
- **Leverage Context Fully:**
  - When using editor commands, always select the most relevant code.
  - For chat, remember that Minovative Mind automatically considers your workspace. If you're discussing a specific part of your project, ensure relevant files are open or mentioned.
  - **Smart Context Selection:** The extension intelligently identifies and provides the AI with the most relevant files from your project. This is especially beneficial in large codebases, as it focuses the AI's attention on what truly matters to your query.
- **Review AI Plans (Crucial!):** Always take the time to read the textual plan explanation. This is your most important control point. If the plan isn't right, cancel it and refine your prompt.
- **Utilize Multiple API Keys:** If you're a heavy user and frequently encounter "Quota Exceeded" errors, adding multiple API keys allows the extension to automatically switch to an available key, minimizing interruptions.
- **Understand AI Limitations:** AI is a powerful tool, but it's not infallible. Always review and test AI-generated code or executed plan outcomes. Treat the AI as an expert assistant, not a replacement for your own judgment.
- **Modularization:** The AI is explicitly instructed to follow modularization principles. When making complex requests, consider reminding the AI in your prompt to ensure new code adheres to best practices for separation of concerns and reusability.

## 6. Troubleshooting Common Issues

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
  - **Note:** Any changes made by steps completed _before_ cancellation are permanent but you can always use `Ctrl+Z` (Windows/Linux) or `Cmd+Z` (macOS).

## 7. Feedback and Support

Your feedback is invaluable! If you encounter any bugs, have suggestions for new features, or just want to share your experience, please visit the Minovative Mind Feedback Form below to submit an issue, feature, and more. Your contributions help make Minovative Mind better for every developer.

> Remember, Minovative Mind is designed to assist, not replace, the brilliance of human developers! Happy Coding!

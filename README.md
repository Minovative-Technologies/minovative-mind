# Minovative Mind VS Code Extension

Integrates Google Gemini directly into VS Code, providing an AI-powered assistant with project context awareness, intelligent code generation, and advanced workflow automation to supercharge your development process.

## ✨ Key Features

Minovative Mind is designed to streamline your coding tasks and boost productivity with cutting-edge AI capabilities:

- **Intelligent AI Chat:**

  - Engage directly with the AI assistant in a dedicated sidebar.
  - Benefit from contextual awareness, where the AI understands your active file, selected code, workspace, and relevant project files.
  - Ask general programming questions, debug issues, or inquire about concepts.

- **Contextual Code Explanation:**

  - Select any code snippet and instantly get a concise, AI-generated explanation via the right-click context menu (`Minovative Mind > Generate Explanation`).

- **Intelligent Code Modification & Generation:**

  - Select code and provide free-form instructions (e.g., "Refactor this function," "Add input validation").
  - Trigger via keyboard shortcut (`Ctrl+M` / `Cmd+M`) or context menu (`Minovative Mind > Custom Modifications`).
  - **Automated Documentation (`/docs`):** Type `/docs` for selected code to automatically generate and insert appropriate documentation (e.g., JSDoc, Python docstrings).
  - **Automated Code Fixing (`/fix`):** Type `/fix` to prompt the AI to analyze selected code (including VS Code diagnostics like errors/warnings) and propose/apply fixes directly in the editor.

- **Advanced AI-Driven Planning and Execution:**

  - Describe complex development tasks (e.g., “Implement user authentication”) to the AI, and it will break them down into actionable, step-by-step plans.
  - **User-Controlled Two-Stage Process:** Review a detailed textual plan in the sidebar before confirming for the AI to execute it.
  - **Diverse Actions:** Plans can include creating directories, creating files (with AI-generated content), modifying existing files, and running shell commands (with user confirmation for security).

- **Automated Git Commit Messages:**

  - Generate descriptive and conventional Git commit messages automatically based on your staged changes by typing `/commit` in the chat or clicking a dedicated button.

- **Seamless API Key Management & Model Selection:**

  - Easily add and manage your Google Gemini API keys directly within the sidebar. Keys are securely stored and cycled automatically if limits are hit.
  - Distribute usage and manage costs very efficiently with the automatic cycling system that cycles through your API keys, ensuring even consumption and enhanced resilience.
  - Select your preferred Gemini AI models (e.g., `gemini-2.5-pro`, `gemini-2.5-flash`) for optimized performance and cost.

- **Smart Context Awareness:**

  - The AI intelligently identifies and leverages the most relevant files from your project, selected code, diagnostics, and chat history for highly accurate responses. You can also configure inclusions/exclusions.

- **Live Code Insertion & Visual Feedback:**
  - Experience a dynamic, real-time "typing" animation as the AI generates and inserts code into your editor.
  - Clear status updates and error indicators keep you informed.

## 🚀 Installation

1. **Open VS Code:** Launch Visual Studio Code.
2. **Extensions View:** Go to the Extensions view by clicking the square icon on the Activity Bar on the side of the window or pressing `Ctrl+Shift+X` (Windows/Linux) / `Cmd+Shift+X` (macOS).
3. **Search:** Search for "Minovative Mind".
4. **Install:** Click the "Install" button for the Minovative Mind extension.

## 🔑 Getting Started: Setting Up Your Gemini API Key

Minovative Mind requires a Google Gemini API key to function.

1. **Obtain a Key:** If you don't have one, generate a Gemini API key from the [Google AI Studio](https://aistudio.google.com/app/apikey) or Google Cloud Console.
2. **Open Minovative Mind Sidebar:** Click on the "Minovative Mind" icon in the Activity Bar (it looks like a thought bubble with gears).
3. **Add Key:** In the sidebar, locate the API Key input field, paste your Gemini API key, and click "Add Key".

**Security Note:** Your API keys are securely stored in VS Code's built-in secret storage and are never exposed or sent outside of your local environment except directly to Google's Gemini API endpoints.

## 🧑‍💻 Basic Usage Examples

Here are a few quick ways to start using Minovative Mind:

- **Chat with AI:**

  1. Open the Minovative Mind sidebar.
  2. Type your query in the chat input field and press Enter. The AI will respond, leveraging your project context.

- **Explain Selected Code:**

  1. Select a code snippet in your active editor.
  2. Right-click on the selection.
  3. Choose `Minovative Mind` > `Generate Explanation`.
  4. A modal dialog will appear with the AI's explanation.

- **Custom Modifications (e.g., /docs, /fix, Refactor):**

  1. Select the code you want to modify or apply an action to.
  2. Press `Ctrl+M` (Windows/Linux) or `Cmd+M` (macOS) to activate the command.
  3. In the quick input box:
     - Type `/docs` to generate documentation for the selected code.
     - Type `/fix` to analyze and fix the selected code.
     - Type a custom prompt (e.g., "refactor this function to be more concise").

- **Automated Git Commit:**
  1. Ensure you have staged changes in your Git repository.
  2. Open the Minovative Mind sidebar chat.
  3. Type `/commit` and press Enter. Minovative Mind will stage changes, generate a conventional commit message, and commit them.

## 📚 Comprehensive Documentation

For a detailed guide on all features, advanced workflows (like AI-driven planning), customization options, troubleshooting tips, and more, please refer to our [Minovative Mind Learning Page](https://minovativemind.dev/learn/developer)

## 📄 Change Log

Stay updated with the latest improvements and bug fixes: [Minovative Mind Updates](https://www.minovativemind.dev/updates)

## 🔒 Privacy Policy

For detailed information on how the Minovative Mind VS Code extension handles user data and privacy, please refer to our comprehensive [Minovative Mind VS Code Privacy Policy](https://www.minovativemind.dev/legal/privacy/vscode/policy).

## 🔒 Terms of Use

For detailed information on the terms and conditions governing the use of the Minovative Mind VS Code extension, please refer to our comprehensive [Minovative Mind VS Code Terms of Use](https://www.minovativemind.dev/legal/terms-of-use).

## 💬 Feedback & Support

Your feedback is invaluable! If you encounter any bugs, have suggestions for new features, or just want to share your experience, please visit our [Minovative Mind Website](https://www.minovativemind.dev/) to submit an issue, feature request, or general feedback.

# Minovative Mind VS Code Extension

Integrates Google Gemini directly into VS Code, providing an AI-powered assistant with project context awareness, intelligent code generation, and advanced workflow automation to supercharge your development process.

## Table of Contents

- [Not Fully Launched Yet]
- [Getting Started: Setting Up Your Gemini API Key]
- [Account & Subscription Management]
  - [User Accounts & Authentication]
  - [Flexible Subscription Tiers]
  - [Manage Your Subscription]
  - [Transparent Feature Gating]
- [Minovative Mind — Feature Comparison]
- [Key Features]
- [Basic Usage Examples]
- [Comprehensive Documentation]
- [Change Log]
- [Privacy Policy]
- [Terms of Use]
- [Feedback & Support]
- [Feature / Capability Comparison]

## 🚧 Not Fully Launched Yet

> Sign in and sign up are currently not allowed as we prepare for our full launch. If you’ve discovered this extension already—awesome! You’re one of the first to stumble upon our silent, early access release.
> We’re hard at work behind the scenes to deliver something truly groundbreaking. Once we go live, this tool won’t just enhance your workflow—it’ll redefine how you build——everything. Stay tuned. 👀

- > For now, enjoy the free tier features and get a taste of what is to come - [Minovative Mind — Feature Comparison]

## 🔑 Getting Started: Setting Up Your Gemini API Key

Minovative Mind requires a Google Gemini API key to function. To access advanced features, you will also need to sign in with a Premium subscription.

1. **Obtain a Key:** If you don't have one, generate a Gemini API key from the [Google AI Studio](https://aistudio.google.com/app/apikey) or Google Cloud Console.
2. **Open Minovative Mind Sidebar:** Click on the "Minovative Mind" icon in the Activity Bar.
3. **Add Key:** In the sidebar, locate the API Key input field, paste your Gemini API key, and click "Add Key".

**Security Note:** Your API keys are securely stored in VS Code's built-in secret storage and are never exposed or sent outside of your local environment except directly to Google's Gemini API endpoints.

## 👤 Account & Subscription Management

### User Accounts & Authentication

Users can now sign in directly within the VS Code sidebar, with a dedicated 'Sign In' button and a command guiding them to the Minovative Mind settings panel for authentication. Secure session management ensures a persistent and safe user experience.

### Flexible Subscription Tiers

- **Free Tier:** Provides core functionalities including intelligent AI chat, contextual code explanation, AI-generated documentation via `/docs`, and automated Git commit messages via `/commit`.
- **Premium Tier:** Unlocks advanced AI-Agent features suchs as intelligent code modification (e.g., custom refactoring), automated code fixing (`/fix`), sophisticated AI-driven planning & execution (`/plan`), and real-time live code insertion with dynamic typing animations.

### Manage Your Subscription

Subscription details can be securely managed via a dedicated link to the Stripe Customer Portal, accessible directly from the Minovative Mind Website

### Transparent Feature Gating

The extension clearly indicates feature availability based on your authentication status and current subscription tier, ensuring you always know what features are accessible.

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

- **Custom Modifications (e.g., /docs, /fix, Refactor): (Note: /fix and custom refactoring are Premium Tier features.)**

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

## Minovative Mind — Feature Comparison

| **Feature Category**               | **Feature**                                                            | **Free Users** | **Paid Users ($10/mo)** |
| :--------------------------------- | :--------------------------------------------------------------------- | :------------- | :---------------------- |
| **Core AI Capabilities**           | AI Chat Interface (General Q&A, Contextual Awareness)                  | ✅ Yes         | ✅ Yes                  |
|                                    | Contextual Code Explanation                                            | ✅ Yes         | ✅ Yes                  |
|                                    | AI-Generated Documentation (`/docs` command)                           | ✅ Yes         | ✅ Yes                  |
|                                    | Intelligent Code Modification (free-form refactors, enhancements)      | ❌ No          | ✅ Yes                  |
|                                    | Automated Code Fixing (`/fix` command)                                 | ❌ No          | ✅ Yes                  |
|                                    | AI Merge Conflict Resolution (`/merge` command)                        | ❌ No          | ✅ Yes                  |
| **Advanced Workflow & Automation** | AI-Driven Planning & Execution (`/plan` command for multi-step tasks)  | ❌ No          | ✅ Yes                  |
|                                    | Automated Git Commit Messages (`/commit` command)                      | ✅ Yes         | ✅ Yes                  |
| **Customization & Management**     | Seamless API Key Setup (Add, Delete, Switch Keys)                      | ✅ Yes         | ✅ Yes                  |
|                                    | Flexible AI Model Selection (Gemini 2.5 Flash / Pro)                   | ✅ Yes         | ✅ Yes                  |
|                                    | Precise Context Control (Include/Exclude files & directories)          | ✅ Yes         | ✅ Yes                  |
| **User Experience & Productivity** | Chat History Management (Save, Load, Clear)                            | ✅ Yes         | ✅ Yes                  |
|                                    | Copy Message Button (from AI responses)                                | ✅ Yes         | ✅ Yes                  |
|                                    | Live Code Insertion (Real-time typing animation for AI-generated code) | ❌ No          | ✅ Yes                  |
|                                    | Smart Context Awareness (AI understands full project environment)      | ✅ Yes         | ✅ Yes                  |
|                                    | Built-in Troubleshooting & Usage Guidance                              | ✅ Yes         | ✅ Yes                  |

## ✨ Key Features

Minovative Mind is designed to streamline your coding tasks and boost productivity with cutting-edge AI capabilities:

- **Intelligent AI Chat:**

  - Engage directly with the AI assistant in a dedicated sidebar.
  - Benefit from contextual awareness, where the AI understands your active file, selected code, workspace, and relevant project files.
  - Ask general programming questions, debug issues, or inquire about concepts.
  - Now displays relevant file paths within chat responses, allowing users to collapse/expand the file list and open files directly.

- **Contextual Code Explanation:**

  - Select any code snippet and instantly get a concise, AI-generated explanation via the right-click context menu (`Minovative Mind > Generate Explanation`).

- **Intelligent Code Modification & Generation:**

  - Select code and provide free-form instructions (e.g., "Refactor this function," "Add input validation") (Premium Tier Feature).
  - Trigger via keyboard shortcut (`Ctrl+M` / `Cmd+M`) or context menu (`Minovative Mind > Custom Modifications`) (Premium Tier Feature).
  - AI persona updated to focus on generating production-ready, robust, and secure code.
  - **Automated Documentation (`/docs`):** Type `/docs` for selected code to automatically generate and insert appropriate documentation (e.g., JSDoc, Python docstrings).
  - **Automated Code Fixing (`/fix`):** Type `/fix` to prompt the AI to analyze selected code (including VS Code diagnostics like errors/warnings) and propose/apply fixes directly in the editor (Premium Tier Feature).

- **Advanced AI-Driven Planning and Execution: (Premium Tier Feature)**

  - Describe complex development tasks (e.g., “Implement user authentication”) to the AI, and it will break them down into actionable, step-by-step plans.
  - **User-Controlled Two-Stage Process:** Review a detailed textual plan in the sidebar before confirming for the AI to execute it.
  - **Diverse Actions:** Plans can include creating directories, creating files (with AI-generated content), modifying existing files, and running shell commands (with user confirmation for security). It now handles non-existent files by automatically creating them and populating their initial content using the provided 'modification_prompt'.
  - Enhances real-time execution messages to indicate diff availability for file operations.

- **Automated Git Commit Messages:**

  - Generate descriptive and conventional Git commit messages automatically based on your staged changes by typing `/commit` in the chat or clicking a dedicated button.

- **Seamless API Key Management & Model Selection:**

  - Easily add and manage your Google Gemini API keys directly within the sidebar. Keys are securely stored and cycled automatically if limits are hit.
  - Distribute usage and manage costs very efficiently with the automatic cycling system that cycles through your API keys, ensuring even consumption and enhanced resilience.
  - Select your preferred Gemini AI models (e.g., `gemini-2.5-pro`, `gemini-2.5-flash`) for optimized performance and cost.

- **Smart Context Awareness:**
  - The AI intelligently identifies and leverages the most relevant files from your project, including overall project structure, TypeScript-aware module resolution for enhanced dependency parsing, detailed symbol information, selected code, diagnostics, and chat history for highly accurate and idiomatic responses. You can also configure inclusions/exclusions.

## 📚 Comprehensive Documentation

For a detailed guide on all features, advanced workflows (like AI-driven planning), customization options, troubleshooting tips, and more, please refer to our [Minovative Mind Docs](https://minovativemind.dev/docs)

## 📄 Change Log

Stay updated with the latest improvements and bug fixes: [Minovative Mind Updates](https://www.minovativemind.dev/updates)

## 🔒 Privacy Policy

For detailed information on how the Minovative Mind VS Code extension handles user data and privacy, please refer to our comprehensive [Minovative Mind VS Code Privacy Policy](https://www.minovativemind.dev/legal/privacy/vscode/policy).

## 🔒 Terms of Use

For detailed information on the terms and conditions governing the use of the Minovative Mind VS Code extension, please refer to our comprehensive [Minovative Mind VS Code Terms of Use](https://www.minovativemind.dev/legal/terms-of-use/vscode).

## 💬 Feedback & Support

Your feedback is invaluable! If you encounter any bugs, have suggestions for new features, or just want to share your experience, please visit our [Minovative Mind Discord](https://discord.gg/w9dkHTncva) to submit an issue, feature request, or general feedback.

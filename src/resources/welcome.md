# 🚀 Welcome to Minovative Mind! 🧠✨

Unlock the power of Google Gemini directly within your VS Code! Minovative Mind is here to be your intelligent coding companion, helping you understand, modify, and generate code faster than ever before.

## 🛠️ Quick Setup Guide

Get started in just a few moments:

**🔑 Add Your API Key:**

- Click the **Minovative Mind logo** in the Activity Bar to open the sidebar.
- Scroll down to the **API Key Management** section.
- Paste your Google Gemini API key and click the `➕ Add` button.
- ✅ Your key is securely stored using VS Code's built-in Secret Storage.
- 🔄 Have multiple keys? Use the `<` and `>` buttons to cycle through them. The active key is displayed (e.g., `Key ...xyz (1/2)`).

**🤖 Select Your AI Model:**

- Just above the API Key section, find the **AI Model Selection** dropdown.
- Choose your preferred Gemini model (like `gemini-2.5-pro` & `gemini-2.5-flash`). This determines the AI's capabilities and cost.

**💬 Start Chatting!** - You're ready! Type your questions or instructions in the chat box at the top of the sidebar. - Minovative Mind automatically uses your project's context (files in your workspace, respecting `.gitignore`) to give you relevant answers.

## 🔥 Core Features

**🧠 Context-Aware Chat:**

- Ask questions about your codebase (e.g., "What does this function do?", "Where is `MyComponent` defined?").
- Generate code snippets based on your project's style (e.g., "Create a React component that takes a 'title' prop").
- Get explanations, suggestions, and more!

**✏️ Code Modification (Right-Click Menu):**

- Select code in your editor.
- Right-click -> **Minovative Mind**:
  - **Custom Modifications:** Enter a prompt (e.g., "Refactor this loop", "Add error handling", "Translate this to Python"). The AI rewrites _only your selection_.
  - **Generate Explanation:** Get a clear explanation of the selected code in a popup window.

**💡 Smart Shortcuts (via Custom Modifications):**

- Select problematic code, right-click -> **Minovative Mind** -> **Custom Modifications**.
- Type `/fix` and press Enter. The AI analyzes diagnostics (errors/warnings) in your selection and attempts to fix them, replacing the **entire file** content with the corrected version.
- Type `/docs` and press Enter. The AI generates documentation (like JSDoc, docstrings) for your selection and replaces it with the docs + original code.

**⚙️ Execution Planning (`@plan` Command):**

- Need to perform multiple steps like creating files, installing packages, and writing code? Use the `@plan` command in the chat!
- **Example:** `@plan create a react component named 'UserProfile' and install axios`
- Minovative Mind will generate a step-by-step plan (creating directories/files, modifying code, suggesting terminal commands).
- Review the proposed plan in the chat, then click `Confirm` to execute it or `Cancel`.

**💾 Chat Management:**

- Use the `Save`, `Load`, and `Clear` buttons at the top of the sidebar to manage your conversation history.

## ✨ Tips for Success

- **Be Specific:** Clear and detailed prompts lead to better AI responses.
- **Use `@plan`:** For complex tasks involving file creation, modification, or terminal commands, `@plan` is your friend.
- **Check Your Model:** Ensure the selected Gemini model is appropriate for your task and accessible with your API key. Some models are better at specific tasks than others.
- **Review AI Output:** Always review code generated or modified by the AI before committing it.

This will change the way you code forever... Happy Coding! 🎉

> _Minimal Input, Innovative Output_

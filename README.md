# Minovative Mind Features

Minovative Mind is a powerful VS Code extension designed to integrate advanced AI capabilities directly into your development workflow. It leverages Google Gemini models to provide intelligent assistance, automate tasks, and enhance productivity.

## Core AI Capabilities

### AI Chat Interface

- **Direct Interaction**: Users can chat directly with the AI assistant via a dedicated sidebar view.
- **Contextual Awareness**: The AI intelligently understands the active file, selected code, current workspace, and relevant project files, providing highly contextual responses to queries.
- **General Q&A**: Supports general programming questions, debugging help, and conceptual inquiries.
- **Interactive File Display**: Displays relevant file paths within AI chat responses, providing interactive elements to collapse/expand the file list and open files directly.
- **HTML Rendering**: Enables HTML rendering in Markdown chat responses for richer content.
- **Intelligent Command Suggestions & Autocomplete**: As you type `/` in the chat input, the extension provides real-time suggestions and autocomplete options for available commands (e.g., `/plan`, `/fix`, `/docs`, `/commit`), improving discoverability and efficiency.
- **Copy Message Feature**: A "Copy Message" button is integrated with AI chat responses, allowing users to easily copy the generated text (including formatted code blocks) to their clipboard.

### Enhanced AI Reasoning (Thinking Capabilities)

- **Advanced AI Configuration**: Leverages advanced AI configuration to enable deeper internal reasoning and problem-solving before generating responses, leading to more robust and accurate outcomes.
- **Thinking Budget**: Configurable thinking budget for complex reasoning tasks.

### Contextual Code Explanation

- **On-Demand Explanation**: Users can select any code snippet in the active editor.
- **In-VS Code Notifications**: Request an AI explanation via the right-click context menu (`Minovative Mind > Generate Explanation`), and the explanation is delivered concisely in a VS Code modal dialog.
- **Keyboard Shortcut**: Available via `Ctrl+M` (Windows/Linux) or `Cmd+M` (macOS) with explanation option.

### Intelligent Code Modification & Generation

- **Flexible Instructions (Premium Tier)**: Users can select any code snippet or operate on the **entire active file if no selection is present**, and provide free-form instructions (e.g., "Refactor this function to use async/await").
- **Quick Access**: Triggered via a keyboard shortcut (`Ctrl+M` or `Cmd+M`) or the editor's right-click context menu (`Minovative Mind > Custom Modifications`).
- **AI-Generated Documentation (`/docs`)**: Typing `/docs` for selected code automatically generates appropriate documentation (e.g., `JSDoc`, `Python doc-strings`) and inserts it directly into the file.
- **Automated Code Fixing (`/fix`) (Premium Tier)**: Typing `/fix` prompts the AI to analyze selected code, or the **entire active file if no selection is present**, including relevant `VS Code` diagnostics (warnings, errors), and propose/apply fixes directly within the editor.
- **AI Merge Conflict Resolution (`/merge`) (Premium Tier)**: Automatically detects and resolves Git merge conflicts in the active file. The AI analyzes conflict markers, generates a semantically coherent merged version, applies the resolution, and un-marks the file as conflicted, streamlining a common tedious task.
- **Symbol-Aware Refactoring**: Leverages VS Code's symbol information (functions, classes, variables, references, definitions, and types) to enable more precise, comprehensive, and robust refactorings and modifications across your entire project.
- **Modular Code Generation**: The AI is explicitly instructed to promote modular code generation principles, encouraging maintainable and scalable solutions.
- **Diagnostic-Aware Modifications**: The AI leverages relevant VS Code diagnostics (warnings, errors) in a more contextual manner, thanks to deeper integration with a dedicated diagnostic service, leading to more accurate and problem-solving custom modifications for both targeted selections and whole-file operations.
- **Production-Ready Code Focus**: AI persona updated to focus on generating production-ready, robust, and secure code.

#### Enhanced AI Code Generation Accuracy

- **Overview**: Minovative Mind now provides more accurate, reliable, and production-ready code through a comprehensive system of improvements.
- **Key Areas of Improvement**:
  - **Enhanced Context Analysis**: Deeper understanding of project structure, dependencies, active symbols, diagnostics, and framework detection.
  - **Improved Prompt Engineering**: More specific, framework, and language-aware instructions for the AI.
  - **Code Validation & Refinement**: Automatic validation for syntax, imports, and best practices with iterative refinement loops.
  - **Framework-Specific Optimizations**: Tailored guidance to ensure generated code adheres to specific framework conventions.
  - **Error Prevention & Correction**: Proactive detection and automatic fixing of common coding errors.

#### Inline Edit System

- **Purpose**: This system allows the AI to make precise, targeted changes to files instead of rewriting entire files. This approach leads to significantly better accuracy, performance, and user experience.
- **Mechanism (Conceptual)**: The AI generates specific edit instructions (e.g., add lines, remove lines, change content within a line range) which the system applies directly to the file. It includes robust validation with an automatic fallback mechanism to full file modification if inline edits fail or are invalid, ensuring reliability.
- **Key Benefits**:
  - **Precision**: Only specific lines are modified, preserving existing code, formatting, and structure, and avoiding accidental changes.
  - **Robustness**: Built-in validation and an intelligent fallback system ensure modifications are applied correctly, even in complex scenarios.

#### AI Workflow Orchestration & Incremental Updates

Introduced core services and utilities for advanced AI-driven development.

- EnhancedWorkflowService was added to orchestrate multi-step AI tasks with parallel processing and dependency management.
- IncrementalCodeUpdater was implemented to generate and apply minimal, precise code changes.
- ParallelProcessor was integrated to enable concurrent AI requests and file processing.
- EnhancedCodeGenerator was updated to utilize incremental updates for code modifications.
- AIRequestService gained new methods for parallel and batched AI request execution.

## Advanced Workflow & Automation

### AI-Driven Planning and Execution

- **High-Level Task Breakdown**: Users can describe complex development tasks (e.g., "Implement user authentication") to the AI, and it will break them down into actionable, step-by-step plans. This can be initiated via the chat (`/plan [request]`) or if a direct code modification request is too complex for a single step.
- **Two-Stage Planning Process (User Control)**:
  - **Textual Plan Explanation**: The AI first presents a human-readable, detailed textual explanation of its proposed plan in the sidebar (formatted with `Markdown`). This allows users to review and understand the AI's strategy.
  - **Structured `JSON` Plan & Execution**: Upon user confirmation, the AI converts the textual plan into a machine-readable `JSON` format, which the extension then executes.
- **Diverse Plan Step Actions**: The AI can plan and execute various actions:
  - `create_directory`: Create new folders at specified relative paths.
  - `create_file`: Create new files, either with static content provided by the AI, or with content generated by the AI based on a prompt.
  - `modify_file`: Modify existing files. The AI uses a `modification_prompt` to generate the updated file content based on the original and instructions. If the target file does not exist, it will be automatically created, with its initial content generated by the AI using the `modification_prompt`. This enhances the robustness of the action. For a given file, all logical changes are combined into a single modification step.
  - `run_command`: Execute shell commands in the integrated terminal (e.g., `npm install`, `git commit`).
- **User Confirmation for Commands**: For security, users are prompted with a confirmation dialog before any `run_command` step is executed, allowing them to "Allow Command" or "Skip Command".
- **Interactive Execution Feedback**: Provides real-time progress updates in `VS Code` notifications and the sidebar chat. Includes a simulated "typing" animation for AI-generated content in the editor (Premium Tier).
- **Per-step AI Rationale**: For file creation and modification steps in a plan, the AI now provides a concise 'mini-plan' or explanation of its approach directly in the chat, offering real-time insight into its actions before applying changes.
- **File Diffs in Chat**: Displays real-time file changes (diffs) directly within the chat interface for `create_file` and `modify_file` plan steps, with enhanced execution messages indicating diff availability.
- **Cancellation**: Users can cancel an ongoing plan execution at any time via the `VS Code` progress notification.
- **Resilient Plan Execution**: Enhances robustness by automatically retrying failed plan steps (with 10s, 15s, 20s delays) for transient errors like API overloads, network issues, or newly-identified 'Service Unavailable' (503) responses. Crucially, it now includes robust error handling to prevent AI API error messages from being written into files, ensuring file integrity. For persistent failures or exhausted retries, users are prompted with options to 'Retry Step', 'Skip Step', or 'Cancel Plan', preventing mid-plan halts and preserving progress.
- **AI-driven post-execution diagnostic validation and self-correction**: Introduces AI capabilities to validate the outcome of plan steps and self-correct based on diagnostic feedback, enhancing the reliability of complex multi-step operations.
- **Retry Mechanism**: If the AI fails to generate a valid `JSON` plan due to parsing errors, the system will automatically retry plan generation up to **3 times** (as defined by `MAX_PLAN_PARSE_RETRIES`). A "Retry" option is also provided in the sidebar for manual re-attempts.
- **Dynamic Context Awareness**: The AI maintains a robust and adaptive understanding of ongoing project changes, including newly created files and recent modifications, throughout a multi-step workflow. This ensures that subsequent planned actions are highly coherent and build accurately upon previous steps, leading to more reliable and contextually aware solutions that reflect the evolving state of your codebase.
- **Seamless Editor-to-Plan Integration**: When custom code modification requests (triggered via `Ctrl+M` or `Cmd+M`) or `/fix` commands involve complex, multi-step tasks, the extension seamlessly escalates them to the full AI-driven planning and execution system. This allows the AI to break down and execute the task as a coherent series of actions, potentially across multiple files, to achieve the desired outcome.

### Automated Git Commit Messages

- **Effortless Commit Messages**: Generates descriptive and relevant `Git commit` messages automatically based on staged changes.
- **Quick Execution**: Can be triggered by typing `/commit` in the chat or clicking a dedicated "Commit Changes" button in the sidebar.
- **Streamlined Process**: Automatically stages pending changes (`git add .`), analyzes the diff, generates a conventional commit message, and executes the `git commit` command.
- **Interactive Review**: A user-facing review step is provided for generated Git commit messages before they are actually executed, allowing users to approve or modify.
- **Editable AI-Generated Commit Messages**: Provides the flexibility to review and edit the AI-generated commit message before confirming the commit, giving you final control over the commit message.
- **Persistent Commit Review State**: If you close the sidebar or VS Code during a Git commit review, the extension intelligently restores the review state, ensuring continuity and preventing loss of context.

## Account & Subscription Management

### User Accounts & Authentication

- **Seamless Integration**: A dedicated 'Sign In' button triggers a command that guides users to the Minovative Mind settings panel, allowing them to effortlessly authenticate their Minovative Mind account directly within VS Code.
- **Secure Sessions**: The extension securely manages user authentication sessions, enabling personalized feature access and preferences.

### Flexible Subscription Tiers

- **Free Tier**: Provides foundational AI capabilities, including comprehensive AI chat, contextual code explanation, AI-generated documentation (`/docs` command), and automated Git commit message generation (`/commit` command).
- **Premium Tier**: Unlocks the full suite of Minovative Mind's advanced AI-Agent features, such as intelligent code modification, automated code fixing (`/fix` command), AI merge conflict resolution (`/merge` command), sophisticated AI-driven planning & execution for multi-step tasks (`/plan` command), and real-time live code insertion with dynamic typing animations.

### Manage Your Subscription

- **Customer Portal Access**: Users can conveniently manage their Premium subscription details, view billing information, and update payment methods via a secure link to the Stripe Customer Portal, accessible directly from the extension's settings.
- **Transparent Feature Gating**: The extension clearly indicates which features are available or restricted based on the user's current authentication status and subscription tier.
- **Dynamic Feature Gating**: Features are dynamically enabled or disabled based on user tier, authentication, and subscription status, using a centralized feature gating utility.

## Customization & Management

### Seamless API Key Setup

- **Easy Configuration**: Users can easily add their `Google Gemini API` keys directly within the `Minovative Mind sidebar`.
- **Secure Storage**: API keys are securely stored using `VS Code's` built-in secret storage and are not exposed or sent outside the local environment, except directly to `Google's Gemini API` endpoints.
- **Multi-Key Support**: Allows adding and managing multiple API keys.
- **Proactive API Key Switching**: The extension automatically cycles through configured API keys if one hits a quota limit or encounters common API errors, ensuring uninterrupted service. Additionally and most importantly, keys will rotate on every API call to distribute cost and usage for efficiency. Users can also manually switch to the next or previous key, or delete the active key.

### Flexible AI Model Selection

- **User Choice**: Select preferred Gemini AI models (e.g., `gemini-2.5-pro`, `gemini-2.5-flash`) directly from a dropdown in the sidebar to optimize performance and cost for specific needs.

### Precise Context Control

- **Intelligent Filtering**: The AI intelligently identifies and provides the most relevant files from the project as context, which is especially beneficial in large codebases.
- **Configurable Inclusions/Exclusions**: Users can fine-tune the AI's understanding by explicitly including or excluding specific files or directories from its context in the chat interface (by telling it what to in/exclude). This also respects `.gitignore` rules.

## User Experience & Productivity

### Live Code Insertion (Real-time Code Generation) (Premium Tier)

- **Dynamic Typing**: When the AI generates file content or modifications as part of a plan, users experience a dynamic, real-time "typing" animation as the code is written into the editor. This feature is exclusive to the Premium Tier.

### Smart Context Awareness

- **Comprehensive Understanding**: The AI intelligently considers the active file content, selected code, relevant diagnostics (warnings/errors) from VS Code, chat history, the overall project structure, **significantly enhanced relevant file context**, **and improved utilization of detailed symbol information** (definitions, references), along with TypeScript-aware dependency graph analysis (respecting `tsconfig.json`/`jsconfig.json` for accurate module resolution), to provide highly relevant and accurate responses.
- **File Change Tracking**: Includes a dedicated context section for the AI that lists recently modified and created file paths, providing the AI with up-to-date awareness of active development changes within the workspace.
- **Automatic URL Context Integration**: Automatically extracts and processes URLs from user messages and AI responses, fetching their content to provide additional context. This feature works seamlessly for both chat messages and plan requests, enhancing the AI's understanding of external resources and documentation.
- **Google Search Grounding**: Toggle the "Grounding with Google Search" option in the chat interface to enable AI responses that are grounded with real-time web search results. This feature enhances the AI's ability to provide up-to-date information and references from the internet, making responses more accurate and current for questions about recent technologies, frameworks, or documentation.

### Built-in Troubleshooting Guidance

- **In-Extension Support**: Provides helpful tips and solutions directly within the extension for common issues like API key errors or quota limits, minimizing interruptions.
- **External Links**: Includes direct links from the settings view to check `Google Cloud API` usage quotas and the Minovative Mind website for additional support.

### Practical Usage Tips

- The extension provides advice on how to effectively prompt the AI and utilize its features to maximize coding productivity, including being specific with prompts and leveraging context.

### Chat History Management

- **Persistence**: Users can save their entire chat history, including displayed file diffs and relevant files, to a `JSON` file on their local machine for later review or to preserve important discussions/AI-generated content.
- **Restoration**: Previously saved chat histories can be loaded, providing the AI with context from past conversations for more coherent follow-ups across sessions. Chat history also automatically restores to the webview following actions like commit confirmation, cancellation, and plan execution updates.
- **Clear Chat**: Option to clear the current conversation.
- **Individual Message Deletion**: Provides granular control, allowing users to remove specific chat entries from their history.
- **Persistent Relevant Files Display**: The expanded/collapsed state of file lists displayed in AI chat responses is now preserved across sessions for enhanced usability.

### Visual Feedback

- **Status Updates**: Provides clear status messages in the sidebar for ongoing operations (e.g., "`Generating documentation…`", "`Executing Step 1…`").
- **Error Indicators**: Displays distinct visual cues for error messages within the chat and status area.
- **Enhanced Loading States & UI Restoration**: Includes animated ellipsis effects in loading messages for improved feedback. The UI seamlessly restores its active loading/generating state (including typing animations and disabled inputs) even after the sidebar is closed/reopened or `VS Code` is restarted, ensuring a consistent and uninterrupted user experience.
- **Code Block and Diff Syntax Highlighting**: Enhances readability of AI-generated code blocks and file differences by applying syntax highlighting, making it easier to review and understand code snippets.
- **Code Block Rendering**: Ensures code blocks displayed in the chat (e.g., within AI responses or diffs) are properly word-wrapped to prevent horizontal scrolling and improve readability.
- **Diff Syntax Highlighting**: File diffs displayed in the chat interface are rendered with syntax highlighting for added and removed lines, enhancing clarity and reviewability.

## Advanced Context & Project Awareness

### Optimized Search & Context Selection

- **Overview**: Comprehensive optimizations have been implemented across the extension's search and context selection system. These improvements drastically enhance performance, reduce latency, and elevate the user experience when gathering project context for AI operations.
- **Key Optimizations Implemented**:
  - **Workspace Scanner Enhancements**: Features intelligent caching, efficient file type and size filtering, and concurrent processing for faster workspace scans.
  - **Dependency Graph Builder Improvements**: Incorporates multi-level caching, batch processing, retry logic, and enhanced concurrency for building robust dependency graphs.
  - **Smart Context Selector Refinements**: Includes AI selection caching, optimized prompt truncation, and robust fallback mechanisms to ensure relevant context is always provided efficiently.
- **Overall Benefits**: Results in faster response times, more efficient resource usage, improved reliability, enhanced user experience with real-time progress feedback, better scalability for large codebases, and comprehensive performance monitoring.

### Deep Symbol and Dependency Context

- **Comprehensive Symbol Analysis**: The extension analyzes the symbol under the cursor, gathering its name, kind, detail, definition, implementations, type definitions, call hierarchy (incoming/outgoing calls), and referenced type definitions. This enables highly precise, symbol-aware AI responses and modifications.
- **Children Hierarchy**: For symbols with children (e.g., classes with methods), a serialized tree structure is built and provided to the AI for richer context.
- **Referenced Type Content**: When a symbol references a type, the content of that type (from other files) is summarized and included in the AI context, up to a configurable character limit.

### Heuristic and AI-Driven File Relevance Selection

- **Heuristic File Selection**: Uses dependency graphs, symbol analysis, and recent changes to select the most relevant files for context, even in large projects.
- **AI-Driven File Selection**: Summarizes all or a subset of files and uses the AI to select the most relevant files for the current request, combining both heuristic and AI-driven approaches for optimal context.

### Project Change Logging

- **Change Log Context**: Tracks recent file changes (created, modified, deleted) and provides this change log as context to the AI, ensuring responses and plans are aware of the latest project state.

### Robust Error and Status Feedback

- **Granular Status Updates**: Provides detailed status updates in the sidebar and chat, including warnings and errors for dependency graph building, file selection, and context generation.
- **Fallback Strategies**: If smart context selection fails, falls back to heuristic selection, the active file, or a subset of files, ensuring the AI always receives some context.

## Advanced File and Workspace Processing

The system employs sophisticated processing mechanisms to analyze codebases efficiently. It utilizes **Incremental Context Building**, processing files individually and progressively building context where insights from prior files inform subsequent analysis. This is coupled with **Detailed File Analysis**, which assesses file complexity, detects its purpose, generates AI insights, tracks dependencies, and collects vital file statistics. For enhanced user visibility, **Progress Tracking** offers real-time updates, file-by-file feedback, and performance metrics. Furthermore, it supports efficient and concurrent **Batch Processing** with configurable sizes and optimized memory usage.

## Security & Safety Features

### File System Security

- **Workspace Path Validation**: All file operations are restricted to the current VS Code workspace, preventing access to files outside the project directory.
- **Gitignore Compliance**: All file operations respect `.gitignore` rules, ensuring sensitive files are not accessed or modified.
- **Path Traversal Protection**: Prevents directory traversal attacks by validating all file paths are relative to the workspace root.

### Command Execution Safety

- **User Confirmation**: All shell commands require explicit user confirmation before execution.
- **Command Validation**: Commands are validated and logged for security auditing.
- **Cancellation Support**: All operations can be cancelled by the user at any time.

## Internal Architecture Highlights

- **Dynamic Feature Gating**: Features are dynamically enabled or disabled based on user tier, authentication, and subscription status, using a centralized feature gating utility.
- **Settings Management**: User preferences (e.g., smart context, model selection) are managed and persisted, affecting extension behavior in real time.
- **Git Integration**: Can stage all changes in the workspace and build/execute git commit commands with AI-generated messages.
- **Utility Features**: Includes utilities for formatting file trees, sanitizing error messages, handling workspace-relative paths, and detecting merge conflicts in file content.
- **Advanced Error Handling**: Comprehensive error handling with user-friendly messages and automatic retry mechanisms for transient failures.
- **Streaming AI Responses**: Real-time streaming of AI responses with typing animations and progress indicators.

By combining these features, Minovative Mind aims to provide a comprehensive AI-powered assistant directly within `VS Code`, significantly streamlining development tasks and improving overall developer productivity.

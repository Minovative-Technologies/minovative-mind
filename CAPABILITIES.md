# Minovative Mind Capabilities

Minovative Mind is a powerful AI-augmented Visual Studio Code extension that integrates Google Gemini models into your development workflow. It enhances productivity through intelligent assistance, automated planning, and AI-driven coding support.

## 🚀 Key Capabilities for Developers

- **Seamless Gemini Integration**: Leverage powerful Google Gemini models directly within your VS Code workflow for intelligent assistance.
- **Automated Workflows & Planning**: Streamline tasks with AI-driven structured planning, file manipulation, and automated Git commit message generation.
- **Enhanced Contextual Understanding**: Gain deeper insights into your codebase through symbol and dependency graphing, enabling more relevant and accurate AI interactions.

---

## 1. Core AI Features

### 1.1 AI Chat Interface

- **Multimodal Chat (Text & Image Upload)**: Engage with the AI using both text prompts and image uploads (processed as Base64 data), enabling richer interactions and visual context awareness.
- **Context-Aware Q&A**: Leverages the active editor file's content and broader workspace context (managed by `ContextService`) to provide highly relevant answers.
- **Rich File Interactions**: Within the `SidebarProvider`'s chat interface, users can open, expand, or collapse contextual files.
- **Chat from Editor**: Initiate a chat directly from the active editor via right-click context menu or `Ctrl/Cmd+M` command (`minovative-mind.modifySelection` with "chat" instruction), sending selected code or the full file to the `chatService` for discussion.
- **HTML Rendering in Markdown Responses**: AI-generated Markdown responses are rendered with rich HTML support in the `SidebarProvider`'s webview.
- **Inline Code Copy and Edit**: Easily copy code snippets from AI responses or use an "Apply to Editor" feature to insert/modify code directly into your active file.
- **Slash Command Suggestions**: Smart suggestions for AI commands like `/plan`, `/fix`, and `/merge` are available in the chat input.
- **Edit Message & Chat History Re-evaluation**: Users can edit previous messages, triggering `chatService` to re-evaluate the conversation with the updated context.
- **Robust Confirmation Dialogs**: Clear chat history with explicit user confirmation, managed by the `SidebarProvider`.
- **Convert AI Responses to Executable Plans**: AI-generated responses can be seamlessly converted into actionable `/plan` commands for structured execution.
- **Interactive File Selector & Path Insertion**: Introduces an "Open File List" button that reveals a dynamic, searchable, and navigable popup. Users can efficiently select workspace files to insert their paths directly into the chat input at the cursor's current position. This enhancement includes:
  - **Search and Filtering:** A dedicated search bar allows real-time filtering of file suggestions for quick discoverability.
  - **Keyboard Navigation:** Supports `Tab`/`Shift+Tab` keys for cycling through file suggestions and the `ESC` key for globally dismissing the popup, regardless of element focus.
  - **Visual Enhancements:** Features a themed button, a blurred search input for visual separation, an 'ESC' indicator for clear dismissal cues, and prevents UI element duplication on repeated interaction.
  - **Underlying Mechanism:** Leverages the project's workspace scanning capabilities for providing the file list.

### 1.2 Token Management

- **Accurate Gemini API Token Counting**: Precisely measures token consumption for all AI requests.
- **Real-time Token Usage Display**: Provides immediate feedback on token usage directly within the sidebar, powered by `TokenTrackingService` and displayed via the `SidebarProvider`.
- **Core Services**: `TokenTrackingService` (for tracking) and `SidebarProvider` (for display and interaction).

### 1.3 Code Explanation

- **Direct Explanation via Command**: Users can trigger AI-driven code explanations via the VS Code right-click context menu ("Generate Explanation") or by executing the `minovative-mind.explainSelection` command.
- **VS Code Modals for Output**: AI explanations of selected code are presented concisely within VS Code information modals for quick review, leveraging the `executeExplainAction` helper in `src/extension.ts`.

### 1.4 Intelligent Code Modification

- **Flexible Modification Scope**: AI can refactor, edit, or modify selected code or the entire active file, as instructed via commands.
- **Triggered by Commands**: Modifications are initiated through the `minovative-mind.modifySelection` command, offering options for `/fix`, `/merge`, or custom prompts.
- **Symbol-Aware Context**: Leverages rich symbol information from the codebase to provide the AI with a deep understanding of functions, classes, and types, enabling more accurate and contextually relevant code modifications.
- **Modular, Maintainable Code Generation**: Emphasizes generating high-quality, readable, and production-ready code.
- **Diff Analysis for Quality Assurance**: Compares generated code against original content to validate output quality and suggest necessary refinements.
- **Focus on Production-Ready, Secure Code**: All modifications prioritize robust and secure coding practices.
- **Note on Modification Strategy**: The free, open-source version of Minovative Mind performs AI-powered code modifications by regenerating the _full file content_, as detailed in `ROADMAP.md`. Advanced "surgical edits" are not included but can be implemented by contributors.
- **Robust Output Sanitization & Validation**: Employs sophisticated heuristics (e.g., checking code structure density, alphanumeric content ratio, and meaningful line counts) within `cleanCodeOutput` to sanitize, validate, and ensure the quality of AI-generated code snippets, guaranteeing functional and production-ready output.

### 1.5 Code Streaming

- **Live Generation**: Code generated by AI (for `create_file` and `modify_file` steps) is streamed character-by-character directly into the editor.
- **Enhanced User Experience**: Provides immediate visual feedback during AI plan execution, making the process transparent and engaging.

---

## 2. Workflow & Automation

### 2.1 AI Planning & Execution

- **Structured Task Breakdown**: The `/plan` command, managed by the `PlanService`, enables the AI to break down complex goals into detailed, executable JSON steps, aligning with the `AI Planning Engine (Structured)` system in `ARCHITECTURE.md`.
- **Comprehensive Execution Flow**: Plans can include atomic actions such as:
  - `create_directory`: For creating new directories (folders) within the workspace.
  - `create_file`: For creating new files, optionally with AI-generated content or predefined content.
  - `modify_file`: For updating the content of existing files based on AI instructions or specific prompts.
  - `run_command`: For executing shell commands (e.g., `npm install`, `git add`) within the workspace context, always requiring explicit user confirmation.
- **Mandatory Shell Command Confirmation**: Explicit user confirmation is required for all `run_command` steps to ensure security and control.
- **Real-time Progress & Control**: Provides granular progress updates for AI planning steps and execution phases within VS Code (`vscode.window.withProgress`), allowing users to monitor workflow progress and cancel specific ongoing plan tasks.
- **Automatic Retry Mechanism**: Automatically retries plan generation in case of transient errors, ensuring resilience.
- **Intelligent Command Escalation**: Commands like `/fix` or general code edits can escalate to a full plan execution when the task complexity warrants it, as orchestrated by the `modifySelection` command in `src/extension.ts` via `PlanService`.
- **Automated Git Conflict Resolution**: Assists in resolving Git merge conflicts for files targeted by /merge commands or AI plans, including updating VS Code's Git status for resolved files.

### 2.2 Git Commit Automation

- **AI-Generated Commit Messages**: The `/commit` command, powered by Git services (e.g., `CommitService` and `GitService` from `ARCHITECTURE.md`), automatically generates descriptive commit messages based on staged code changes.
- **Pre-Commit Diff Analysis**: Analyzes code differences before suggesting a commit message, ensuring accuracy and relevance.
- **Fully Editable Messages**: Provides the user with full control to review and edit AI-generated commit messages before finalization.

---

## 3. Contextual Intelligence

### 3.1 Smart Context Awareness

- **Comprehensive Data Integration**: Integrates various contextual data points, including VS Code diagnostics (`DiagnosticService`), user selection, document symbols (`SymbolService`), and code references.
- **Dynamic Memory Updates**: Tracks recent changes in the workspace to continually update the AI's contextual understanding.
- **External Content Processing**: Extracts and processes content from URLs and external documentation (via `UrlContextService`) to enrich AI prompts.
- **Core Services**: `SymbolService`, `DiagnosticService`, `ContextService`, and `UrlContextService`.

### 3.2 Enhanced Chat History

- **Persistent Chat & Diff Storage**: Chat conversations, including associated file diffs, can be saved and loaded as JSON for continuity.
- **Session Restoration**: Restores conversation context and file states after VS Code reloads, maintaining workflow consistency (managed by `ChatHistoryManager`).
- **Flexible History Management**: Provides options to clear/reset the entire conversation or delete individual messages.

### 3.3 Feedback & UX

- **Real-time Status Indicators**: Delivers immediate visual feedback on AI operations and processing states.
- **Error and Diff Highlighting**: Highlights errors and code differences in the UI for quick identification and review.
- **Persistent UI States**: Retains UI states and settings across VS Code restarts for a seamless user experience.

---

## 4. Advanced Context & Project Awareness

### 4.1 Symbol & Dependency Graphing

- **Detailed Symbol Tree**: Builds a comprehensive symbol tree, including implementations and references, powered by `SymbolService` and `DependencyGraphBuilder` now provides persistent, cached workspace-wide dependency graphs that are integrated into services like `SequentialContextService` and `SequentialFileProcessor`, enabling deep, context-aware analysis.
- **Type Resolution**: Performs type resolution and summarization of code references, providing the AI with a deeper semantic understanding of the codebase.

### 4.2 File Relevance Engine

- **Hybrid File Selection**: Employs a combination of heuristic (rule-based) and AI-driven (smart) selection strategies to identify the most relevant files for context, using components like `HeuristicContextSelector` and `SmartContextSelector`.
- **Prioritized Context**: Prioritizes files that are recently modified, linked by symbols, or are directly related to the user's active context. It now includes **refined relevance scoring for prior file context, considering file dependency graphs** and user intent, ensuring the most pertinent information is presented to the AI.
- **Intelligent File Summarization**: Summarizes file content using `FileContentProcessor` to fit within token limits while preserving critical information for the AI (`intelligentlySummarizeFileContent`). This includes **detailed file complexity estimation** using multiple metrics and **enhanced main purpose detection** for files based on their path and extension.
- **Configurable Heuristic File Selection**: Utilizes `HeuristicContextSelector` with configurable rules (e.g., directory proximity, dependency analysis, symbol relevance) to intelligently select the most pertinent files for AI context, enhancing relevance beyond simple smart selection.
- **Dependency Extraction**: `SequentialFileProcessor` performs **expanded and refined dependency extraction** directly from code, enriching file summaries and contributing to accurate relevance scoring.

### 4.3 Project Change Logging

- **Comprehensive Change Tracking**: Accurately tracks all file system changes (additions, modifications, deletions) made by AI-driven workflows, managed by `ProjectChangeLogger`.
- **Reversible AI Plans**: Enables safe experimentation by allowing users to easily revert entire AI plans using `RevertibleChangeSet` (managed by `RevertService`).
- **Auditable Change Log**: Maintains a detailed log of all AI-driven changes for transparency and auditing.

### 4.4 Resilient Context Construction

- **Large Project Handling**: Designed to efficiently handle large projects by strategically skipping oversized files (e.g., 1MB+ files).
- **Intelligent File Exclusion**: Automatically excludes binary files and adheres to `.gitignore` rules to optimize context and avoid irrelevant data.
- **Language Detection**: Includes robust language detection for files without extensions, ensuring accurate context formatting for the AI.

### 4.5 Real-time Diagnostics & Error Handling

- **Context Fallback Strategy**: Implements a layered fallback mechanism for context building (smart → heuristic → minimal) to ensure AI always receives some relevant information.
- **Status Feedback**: Provides clear status feedback on the progress of plan generation and context building to the user.

---

## 5. Performance & Optimization

### 5.1 Search & Context Optimization

- **Efficient Workspace Scanner**: Utilizes `WorkspaceScanner` with intelligent filtering to quickly identify and process relevant project files.
- **Cached Dependency Graphing**: Caches and batches dependency graph analysis to improve performance for symbol and reference lookups. Furthermore, `SequentialFileProcessor` introduces **internal file caching** to prevent redundant processing and significantly improve overall performance of file analysis.
- **Smart Truncation & Progressive Loading**: Employs intelligent truncation and progressive loading of content to optimize token usage and response times.
- **Optimized AI Request Handling**: Employs parallel processing and batching for concurrent AI calls, enhancing scalability and managing workload efficiently.

### 5.2 Efficient Resource Management

- **LRU Cache**: Implements an LRU (Least Recently Used) cache with preloading for frequently accessed data, minimizing latency.
- **Dynamic Content Limits**: Enforces file size and context limits to manage memory and API token usage effectively.
- **Progressive Analysis**: Utilizes progressive analysis and refinement of context, ensuring efficiency even with complex tasks.

---

## 6. Customization & Model Control

### 6.1 API & Model Settings

- **Secure API Key Management**: Facilitates secure setup and storage of the Gemini API key, managed by `ApiKeyManager`.
- **Flexible Model Selection**: Allows users to select preferred Gemini models (`gemini-2.5-pro`, `flash`, `flash-lite` - Thinking Mode) for different tasks, offering control over performance and cost.

### 6.2 Context Filtering

- **Granular Inclusions/Exclusions**: Provides explicit options for users to include or exclude specific files and directories from AI context processing, offering fine-grained control over what information the AI accesses.

---

## 7. Security & User Protection

### 7.1 Filesystem Safety

- **Workspace-Bound Operations**: All file system modifications and creations are strictly confined to the user's active VS Code workspace directory, preventing unintended changes outside the project scope.

### 7.2 Shell Command Approval

- **Explicit Confirmation**: Requires explicit user confirmation for every `run_command` step within an AI-generated plan, as enforced by the `PlanExecutionService`.
- **User Control over Steps**: Users have the power to allow, skip, or cancel individual execution steps, maintaining full control over automated processes.

---

## 8. User Control & Transparency

- **Real-time Progress Indicators**: Provides constant, visible feedback on ongoing AI tasks using `vscode.window.withProgress` notifications.
- **Cancellable Tasks**: Supports cancellation of most AI-driven tasks via `CancellationToken`, allowing users to interrupt long-running operations.
- **Transparent UI Updates**: Ensures all UI changes and cancellations are clearly communicated and reflected in the extension's interface.
- **Seamless State Restoration**: Preserves and restores critical extension states (e.g., pending plans, active AI operations, user preferences) across VS Code restarts for continuity and a robust user experience.

---

Minovative Mind merges robust software engineering with advanced AI tooling to create a seamless, secure, and efficient development experience inside Visual Studio Code.

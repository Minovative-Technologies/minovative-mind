# Minovative Mind Capabilities

Minovative Mind is a powerful AI-augmented Visual Studio Code extension that integrates Google Gemini models into your development workflow. It enhances productivity through intelligent assistance, automated planning, and AI-driven coding support.

---

## 1. Core AI Features

### 1.1 AI Chat Interface

- Multimodal chat (text + image upload)
- Context-aware Q\&A based on active file and workspace
- Rich file interactions (open, expand, collapse)
- Chat from editor (right-click or `Ctrl/Cmd+M`)
- HTML rendering in Markdown responses
- Inline code copy and edit capabilities
- Slash command suggestions (`/plan`, `/fix`, `/docs`, etc.)
- Edit message + chat history re-evaluation
- Robust confirmation dialogs for clearing chat history
- Convert AI responses into executable `/plan` commands

### 1.2 Token Management

- Accurate Gemini API token counting
- Real-time token usage display in sidebar
- Services: `TokenTrackingService`, `updateTokenUsageDisplay`

### 1.3 Code Explanation

- Right-click → "Generate Explanation"
- AI explains selected code via VS Code modals

### 1.4 Intelligent Code Modification

- Refactor, edit, and modify selected or full file
- Trigger via `/fix`, `/docs`, `/merge`, etc.
- Symbol-aware context (functions, classes, types)
- Modular, maintainable code generation
- Self-correction loop with real-time diagnostics
- Diff analysis to validate output quality
- Emphasis on production-ready, secure code

### 1.5 AI Code Correction Pipeline

- Multi-step correction: syntax → logic → security
- Tracks progress and prevents infinite loops

### 1.6 Code Streaming

- Live code generation shown character-by-character
- Applies to `create_file`, `modify_file` steps

---

## 2. Workflow & Automation

### 2.1 AI Planning & Execution

- `/plan` command breaks down tasks into JSON steps
- Plan review → execution flow with:

  - `create_directory`
  - `create_file`
  - `modify_file`
  - `run_command`

- Confirmation for shell commands
- Real-time progress, cancellation, and retries
- AI post-execution validation and self-correction
- Automatic retry for plan generation errors
- Escalation from `/fix` or code edits to full plan execution

### 2.2 Git Commit Automation

- AI-generated commit messages via `/commit`
- Pre-commit diff analysis and user review
- Fully editable messages

---

## 3. Contextual Intelligence

### 3.1 Smart Context Awareness

- Incorporates diagnostics, selection, symbols, references
- Tracks recent changes and updates AI memory
- Extracts and processes URLs and documentation
- Google search grounding toggle

### 3.2 Enhanced Chat History

- Save/load chat + file diffs as JSON
- Restore context after reload
- Clear/reset conversation
- Delete individual messages

### 3.3 Feedback & UX

- Real-time status indicators
- Error + diff highlighting
- Persistent UI states across restarts

---

## 4. Advanced Context & Project Awareness

### 4.1 Symbol & Dependency Graphing

- Symbol tree with implementations, references
- Type resolution and reference summarization

### 4.2 File Relevance Engine

- Combines heuristic + AI file selection
- Prioritizes modified, symbol-linked, or related files
- Summarizes files with `intelligentlySummarizeFileContent`

### 4.3 Project Change Logging

- Tracks added/modified/deleted files
- Revert AI plans using `RevertibleChangeSet`
- Log and undo all AI-driven changes

### 4.4 Resilient Context Construction

- Handles large projects (skips 1MB+ files)
- Excludes binaries, obeys `.gitignore`
- Language detection for extensionless files

### 4.5 Real-time Diagnostics & Error Handling

- Fallbacks: smart → heuristic → minimal context
- Status feedback on plan/context building

---

## 5. Performance & Optimization

### 5.1 Search & Context Optimization

- Workspace scanner with intelligent filtering
- Cached and batched dependency graphing
- Smart truncation and progressive loading

### 5.2 Efficient Resource Management

- LRU cache with preloading
- File size + context limits
- Progressive analysis and refinement

---

## 6. Customization & Model Control

### 6.1 API & Model Settings

- Gemini API key setup with secure storage
- Model selection: `gemini-2.5-pro`, `flash`, `lite`

### 6.2 Context Filtering

- Explicit file/directory inclusions & exclusions
- `.gitignore` compliant filtering

---

## 7. Security & User Protection

### 7.1 Filesystem Safety

- Locked to workspace directory
- Prevents path traversal, obeys `.gitignore`

### 7.2 Shell Command Approval

- Explicit confirmation for `run_command`
- User must allow, skip, or cancel steps

---

## 8. User Control & Transparency

- Real-time `vscode.window.withProgress` indicators
- Cancellable tasks via `CancellationToken`
- Transparent UI updates and cancelation options

---

Minovative Mind merges robust software engineering with advanced AI tooling to create a seamless, secure, and efficient development experience inside Visual Studio Code.

Deeper analysis of the file structure, class responsibilities, and how different components interact, here is a more comprehensive breakdown of the systems that work together in this project. This results in approximately **19** distinct systems:

1. **VS Code Extension Core**:

   - **Responsibility**: Handles the main VS Code extension lifecycle, including activation, deactivation, and registration of top-level commands that initiate workflows.
   - **Key Files**: `src/extension.ts`

2. **Sidebar UI & Communication**:

   - **Responsibility**: Manages the webview-based sidebar interface, its rendering, user interactions within the sidebar, and the crucial bidirectional communication between the extension's backend and the webview frontend.
   - **Key Files**: `src/sidebar/SidebarProvider.ts`, `src/sidebar/ui/webviewHelper.ts` (and implied `src/services/webviewMessageHandler.ts`).

3. **Application Configuration Management**:

   - **Responsibility**: Manages user-specific settings and preferences for the extension, including loading defaults, persisting changes, and providing access to configured values.
   - **Key Files**: `src/sidebar/managers/settingsManager.ts`.

4. **AI API Key Management**:

   - **Responsibility**: Securely handles the storage, retrieval, validation, and rotation (if applicable) of API keys required for accessing external AI services.
   - **Key Files**: `src/sidebar/managers/apiKeyManager.ts`.

5. **AI Model Integration (Gemini Client)**:

   - **Responsibility**: Provides the low-level, direct interface for communicating with the Google Gemini API, using (`gemini-2.5-pro/flash/flash-lite`), handling API initialization, streaming responses, basic error mapping, and accurate token counting. Input your own api key to use Minovative Mind.
   - **Key Files**: `src/ai/gemini.ts`.

6. **AI Request Orchestration & Retry**:

   - **Responsibility**: Manages the overall process of making AI requests, including implementing robust retry logic for transient errors, handling cancellation requests, and orchestrating potentially parallel AI calls. It acts as an abstraction layer over the direct API client.
   - **Key Files**: `src/services/aiRequestService.ts`.

7. **Token Usage Tracking**:

   - **Responsibility**: Monitors and tracks the consumption of AI tokens for different request types, providing real-time and aggregate usage statistics to the user.
   - **Key Files**: `src/services/tokenTrackingService.ts`.

8. **Chat History Management**:

   - **Responsibility**: Manages the persistence, retrieval, truncation, and display of the conversational history between the user and the AI, ensuring context is maintained across sessions.
   - **Key Files**: `src/sidebar/managers/chatHistoryManager.ts`.

9. **Chat Interaction & Response**:

   - **Responsibility**: Orchestrates the user's general conversational experience with the AI, including receiving user messages, integrating various contextual data (like URL context), and managing the AI's textual responses for display in the chat interface.
   - **Key Files**: `src/services/chatService.ts`.

10. **Workspace File Scanning**:

    - **Responsibility**: Efficiently scans the VS Code workspace to discover and identify relevant project files and directories, respecting `.gitignore` rules, applying size and type filters, and utilizing caching for performance.
    - **Key Files**: `src/context/workspaceScanner.ts`.

11. **Code & Project Structure Analysis**:

    - **Responsibility**: A collection of services dedicated to deeply understanding the project's codebase, including extracting document symbols, fetching and formatting diagnostic information (errors, warnings), detecting the project's technology stack/type, and building the internal dependency graph between files.
    - **Key Files**: `src/services/symbolService.ts`, `src/utils/diagnosticUtils.ts`, `src/services/projectTypeDetector.ts`, `src/context/dependencyGraphBuilder.ts`.

12. **Intelligent Context Selection & Assembly**:

    - **Responsibility**: Determines the most relevant portions of the project (specific files, code snippets, summaries, active symbols) to provide as context to the AI. This system employs both heuristic (rule-based) and AI-driven (smart) selection strategies, and then assembles this disparate information into a cohesive, token-optimized prompt string. Includes a sequential processing mode for very large contexts.
    - **Key Files**: `src/services/contextService.ts`, `src/context/heuristicContextSelector.ts`, `src/context/smartContextSelector.ts`, `src/context/fileContentProcessor.ts`, `src/context/contextBuilder.ts`, `src/services/sequentialContextService.ts`.

13. **External URL Content Fetching**:

    - **Responsibility**: Specializes in retrieving and formatting content from external URLs (e.g., documentation pages, Stack Overflow links) to enrich the context provided to the AI.
    - **Key Files**: `src/services/urlContextService.ts`.

14. **AI Planning Engine (Structured)**:

    - **Responsibility**: Focuses on the AI's ability to generate, parse, and validate multi-step action plans in a structured (e.g., JSON) format, ensuring the generated plan adheres strictly to the predefined schema. This is the "brain" responsible for creating the executable strategy.
    - **Key Files**: `src/ai/workflowPlanner.ts`.

15. **Plan Execution & Workflow Automation**:

    - **Responsibility**: Interprets and executes the concrete steps defined in an AI-generated structured plan. This includes performing file system operations (creating/modifying files and directories), executing external commands (with user confirmation), and managing step-level retries and AI-driven corrections for failed steps. It orchestrates the entire automated workflow.
    - **Key Files**: `src/services/planService.ts` (orchestration logic), `src/sidebar/services/planExecutionService.ts` (implied utility for specific step execution).

16. **Enhanced Code Generation & Self-Correction**:

    - **Responsibility**: A sophisticated system dedicated to generating, modifying, and refining code files. It incorporates real-time validation against VS Code's language services (diagnostics), and employs iterative AI-driven self-correction loops to produce functional, error-free, and well-formatted code.
    - **Key Files**: `src/ai/enhancedCodeGeneration.ts`.

17. **Git Integration & Automation**:

    - **Responsibility**: Facilitates AI-assisted Git operations. This includes staging changes, generating insightful commit messages based on detected diffs, and providing functionality for AI-guided resolution and marking of merge conflicts.
    - **Key Files**: `src/services/commitService.ts`, `src/sidebar/services/gitService.ts` (implied), `src/services/gitConflictResolutionService.ts`, `src/utils/mergeUtils.ts`, `src/utils/diffingUtils.ts`.

18. **Project Change Logging & Reversion**:

    - **Responsibility**: Maintains a comprehensive, auditable log of all file system changes (creations, modifications, deletions) made by AI-driven workflows and provides the functionality to revert those changes, ensuring a safe and transparent development process.
    - **Key Files**: `src/workflow/ProjectChangeLogger.ts`, `src/services/RevertService.ts`.

19. **Concurrency Management (Infrastructure)**:
    - **Responsibility**: Provides generic, reusable utilities for managing parallel tasks and controlling concurrency across various operations within the extension, optimizing resource usage and preventing timeouts.
    - **Key Files**: `src/utils/parallelProcessor.ts`.

This breakdown provides a detailed view of the interconnected systems that collectively enable the Minovative Mind VS Code extension to function.

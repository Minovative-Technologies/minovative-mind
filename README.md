# Minovative Mind Features

Minovative Mind is a powerful VS Code extension designed to integrate advanced AI capabilities directly into your development workflow. It leverages Google Gemini models to provide intelligent assistance, automate tasks, and enhance productivity.

## Getting Started / Installation

To get started with Minovative Mind:

1. Open VS Code.
2. Navigate to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
3. Search for `Minovative Mind`.
4. Click `Install`.
5. Once installed, open the Minovative Mind sidebar from the Activity Bar and configure your AI API Key to unlock all features.

## Core AI Capabilities

### AI Chat Interface

- **Direct Interaction**: Users can chat directly with the AI assistant via a dedicated sidebar view.
- **Contextual Awareness**: The AI intelligently understands the active file, selected code, current workspace, and relevant project files, providing highly contextual responses to queries.
- **General Q&A**: Supports general programming questions, debugging help, and conceptual inquiries.
- **Interactive File Display**: Displays relevant file paths within AI chat responses, providing interactive elements to collapse/expand the file list and open files directly.
- **Direct 'Chat with Code' from Editor**: Users can right-click directly in the active editor (or use the universal shortcut `Ctrl/Cmd+M`) and select a 'Chat with AI' option. This sends selected code snippets or the entire active file directly to the AI chat for contextual discussions and queries, leveraging the AI's deep understanding of your codebase. This feature is orchestrated by `src/extension.ts` (specifically, the 'chat' branch of the `minovative-mind.modifySelection` command) and processed by `src/services/chatService.ts` (`handleRegularChat`).
- **HTML Rendering**: Enables HTML rendering in Markdown chat responses for richer content.
- **Intelligent Command Suggestions & Autocomplete**: As you type `/` in the chat input, the extension provides real-time suggestions and autocomplete options for available commands (e.g., `/plan`, `/fix`, `/docs`, `/commit`), improving discoverability and efficiency.
- **Copy Message Feature**: A "Copy Message" button is integrated with AI chat responses, allowing users to easily copy the generated text (including formatted code blocks) to their clipboard.
- **Edit Message Feature**: This feature allows you to correct typos, refine previous questions, or adjust context for the AI, enabling more precise and effective interactions.
  - **Activation**: Click the 'Edit Message' (pencil) icon next to your message in the chat history.
  - **Editing Mechanism**: Your message will transform into an editable text area. Modify your text as needed.
  - **Submission/Cancellation**: Press `Enter` (without `Shift`) or click outside the text area to apply your changes. Press `Escape` to discard changes and revert the message to its original state.
  - **Impact on Chat History and AI Interaction**: Upon submission, your message in the chat history will be updated, and all subsequent AI responses following that message will be cleared. The AI will then re-process the conversation using your edited message as the new context, allowing for real-time refinement of interactions.
- **Enhanced Chat History Management**: Introduces a robust confirmation dialog for clearing chat history. This critical operation now explicitly requires user consent and irrevocably deletes all associated revertible change data, ensuring greater control over your conversational data.
- **Generate Plans from AI Messages**: This feature directly streamlines turning AI suggestions into executable plans. A "Generate Plan" button appears on AI chat messages. Clicking it extracts the AI's response content (leveraging `generateLightweightPlanPrompt` in `src/sidebar/services/aiInteractionService.ts`), converts it into a concise `/plan` command, and pre-fills it directly into the chat input, making it effortless to transform AI's ideas into actionable development steps.

### Enhanced AI Reasoning (Thinking Capabilities)

- **Advanced AI Configuration**: Leverages advanced AI configuration to enable deeper internal reasoning and problem-solving before generating responses, leading to more robust and accurate outcomes.

### Efficient AI Resource Management

- **Accurate Token Counting**: Integrates precise token counting using the Gemini API to optimize API usage and enhance cost efficiency for all AI interactions. Users can **view real-time token statistics** (input tokens, output tokens, total tokens, request count) directly within the VS Code sidebar, ensuring transparency and dynamic updates. `TokenTrackingService` (from `src/services/tokenTrackingService.ts`) handles the counting, while `updateTokenUsageDisplay` and `toggleTokenUsageDisplay` (from `src/sidebar/webview/main.ts`) manage the UI presentation.

### Contextual Code Explanation

- **On-Demand Explanation**: Users can select any code snippet in the active editor.
- **In-VS Code Notifications**: Request an AI explanation via the right-click context menu (`Minovative Mind > Generate Explanation`), and the explanation is delivered concisely in a VS Code modal dialog.
- **Keyboard Shortcut**: Available via `Ctrl+M` (Windows/Linux) or `Cmd+M` (macOS) with explanation option.

### Intelligent Code Modification & Generation

- **Flexible Instructions (Premium Tier)**: Users can select any code snippet or operate on the **entire active file if no selection is present**, and provide free-form instructions (e.g., "Refactor this function to use async/await").
- **Quick Access**: Triggered via a keyboard shortcut (`Ctrl+M` or `Cmd+M`) or the editor's right-click context menu (`Minovative Mind > Custom Modifications`).
- **AI-Generated Documentation (`/docs`)**: Typing `/docs` for selected code automatically generates appropriate documentation (e.g., `JSDoc`, `Python doc-strings`) and inserts it directly into the file.
- **Automated Code Fixing (`/fix`) (Premium Tier)**: Typing `/fix` prompts the AI to analyze selected code, or the **entire active file if no selection is present**, including relevant `VS Code` diagnostics (warnings, errors), and propose/apply fixes directly within the editor. When modifications are initiated without explicit text selection, Minovative Mind intelligently analyzes cursor position, active diagnostics, and code structure to automatically identify and select the most relevant code unit (e.g., function, class, or the entire file) for targeted modifications. This intelligent auto-selection is powered by logic in `src/extension.ts`, `src/services/codeSelectionService.ts` (`findRelevantSymbolForFix`, `findLogicalCodeUnitForPrompt`), and `src/services/contextService.ts`.
- **AI Merge Conflict Resolution (`/merge`) (Premium Tier)**: Automatically detects and resolves Git merge conflicts in the active file. The AI analyzes conflict markers, generates a semantically coherent merged version, applies the resolution, and un-marks the file as conflicted, streamlining a common tedious task.
- **Symbol-Aware Refactoring**: Leverages VS Code's symbol information (functions, classes, variables, references, definitions, and types) to enable more precise, comprehensive, and robust refactorings and modifications across your entire project.
- **Modular Code Generation**: The AI is explicitly instructed to promote modular code generation principles, encouraging maintainable and scalable solutions.
- **AI Self-Correction & Validation Pipeline**: Minovative Mind features a sophisticated **internal self-correction loop** that rigorously validates AI-generated code _before_ it's written to your files. This system actively queries VS Code's diagnostic engine (`DiagnosticService` in `src/utils/diagnosticUtils.ts`) to detect real-time syntax errors, compilation issues, linting warnings, and other problems in the AI's proposed code changes. If issues are found, the AI receives targeted feedback, including specific diagnostics and code snippets, and attempts to refine its output iteratively (managed by `EnhancedCodeGenerator` in `src/ai/enhancedCodeGeneration.ts` via methods like `_validateCode` and `_refineContent`). For code modifications, it also performs **diff analysis** (`_analyzeDiff`) to ensure changes are reasonable and surgical. This robust, iterative process ensures a higher quality, error-free, and production-ready output, significantly minimizing manual debugging on the user's part.
- **Production-Ready Code Focus**: The AI's persona within Minovative Mind is meticulously crafted to ensure production-ready, robust, and secure code generation. Prompts are designed with stringent instructions to the AI (e.g., 'Accuracy First', 'Style Consistency', 'Surgical Precision & Minimal Changes', 'No Extra Text', 'Error Prevention', 'Security') (referencing `src/ai/enhancedCodeGeneration.ts`'s `_createEnhancedGenerationPrompt` and `_createEnhancedModificationPrompt` prompts). This guarantees outputs that are not only functional but also adhere strictly to best practices, seamlessly integrate into existing codebases, and minimize unnecessary 'noise' or cosmetic changes, maximizing utility and code quality.

#### Enhanced AI Code Generation Accuracy

- **Overview**: Minovative Mind now provides more accurate, reliable, and production-ready code through a comprehensive system of improvements.
- **Key Areas of Improvement**:
  - **Enhanced Context Analysis**: Deeper understanding of project structure, dependencies, active symbols, diagnostics, and framework detection.
  - **Improved Prompt Engineering**: More specific, framework, and language-aware instructions for the AI.
  - **Code Validation & Refinement**: Automatic validation for syntax, imports, and best practices with iterative refinement loops.
  - **Framework-Specific Optimizations**: Tailored guidance to ensure generated code adheres to specific framework conventions.
  - **Error Prevention & Correction**: Proactive detection and automatic fixing of common coding errors.

#### AI Code Correction Mechanisms

The extension employs a sophisticated, multi-stage correction and refinement process to ensure high-quality code:

- **Immediate Validation**: Validates code after each generation step
- **Progressive Correction**: Fixes issues in order of priority (syntax → imports → practices → security)
- **Alternative Strategies**: Tries different approaches when standard corrections fail
- **Progress Tracking**: Provides detailed progress updates with stage information
- **Iteration Limits**: Prevents infinite loops with configurable iteration limits

#### AI Workflow Orchestration & Incremental Updates

Introduced core services and utilities for advanced AI-driven development.

- EnhancedWorkflowService was added to orchestrate multi-step AI tasks with parallel processing and dependency management.
- ParallelProcessor was integrated to enable concurrent AI requests and file processing.
- EnhancedCodeGenerator was updated to utilize incremental updates for code modifications.
- AIRequestService gained new methods for parallel and batched AI request execution.

#### Real-time Code Streaming Updates

Minovative Mind provides a seamless and interactive experience during code generation and modification. For `create_file` or `modify_file` steps within an executed plan, users can observe code being written or updated character-by-character directly in a dedicated UI area within the sidebar or within the editor itself. This real-time streaming allows immediate feedback and enhances the sense of collaborative development. This feature relies on `src/ai/enhancedCodeGeneration.ts` for managing the code generation process and `src/sidebar/SidebarProvider.ts` for processing and rendering stream messages (specifically `codeFileStreamStart`, `codeFileStreamChunk`, and `codeFileStreamEnd` events).

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

### Enhanced Precision Search System

- **Dynamic Context Sizing**: Automatically adjusts context size based on request complexity
- **Smart Truncation**: Preserves important code elements (imports, exports, function definitions) while reducing file size
- **Progressive Loading**: Loads context progressively to optimize performance

### Performance Optimizations

- **Intelligent Caching**: Smart cache management with precision-based invalidation
- **Concurrent Processing**: Parallel file scanning and dependency analysis
- **Resource Management**: Configurable limits for file sizes, context length, and processing time
- **Progressive Enhancement**: Starts with fast heuristics, then applies AI for refinement

### Quality Assurance

- **Accuracy Validation**: Real-time validation of search accuracy and relevance
- **Feedback Loop**: Learns from user interactions to improve future searches
- **Quality Metrics**: Comprehensive metrics for precision, recall, and confidence
- **Continuous Improvement**: Self-optimizing system that adapts to usage patterns

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
- **AI-Driven File Selection**: When the AI selects relevant files for context, it leverages "intelligent summaries of files." These summaries (generated using `intelligentlySummarizeFileContent` and stored as `FileSummary` from `src/services/sequentialFileProcessor.ts`) provide a quick, high-level understanding of file content, enabling efficient and accurate context selection. This approach is supported by `SequentialContextService` (from `src/services/sequentialContextService.ts`) and `smartContextSelector.ts`, combining both heuristic and AI-driven approaches for optimal context.

### Project Change Logging

- **Change Log Context**: Tracks recent file changes (created, modified, deleted) and provides this change log as context to the AI, ensuring responses and plans are aware of the latest project state.
- **Revert Executed Plans**: Users can undo the effects of successfully executed AI plans, providing a crucial safety mechanism. The system automatically logs changes made by plans (leveraging `ProjectChangeLogger` and the `RevertibleChangeSet` type from `src/types/workflow.ts`). A "Revert Changes" button in the sidebar (linked to `src/sidebar/webview/main.ts` and `src/services/RevertService.ts`) allows users to initiate this process. **Warning**: Clearing chat history irrevocably deletes all associated revertible change data.

### Workflow Continuity & Persistent State

Minovative Mind automatically persists critical session state across VS Code restarts, ensuring uninterrupted development. This includes:

- **Pending AI Operations**: Ongoing plan generations awaiting user confirmation (`pendingPlanGenerationContext`).
- **Active AI Generation**: Flags indicating if the AI is actively processing a user request (`isGeneratingUserRequest`).
- **Revertibility Data**: A history of completed plan change sets (`completedPlanChangeSets`) that can be reverted.

This persistent state is managed by `src/sidebar/SidebarProvider.ts` utilizing VS Code's `vscode.Memento` (specifically `workspaceState`) to store and restore `_persistedPendingPlanData`, `isGeneratingUserRequest`, and `completedPlanChangeSets`.

### Robust Error and Status Feedback

- **Granular Status Updates**: Provides detailed status updates in the sidebar and chat, including warnings and errors for dependency graph building, file selection, and context generation.
- **Fallback Strategies**: If smart context selection fails, falls back to heuristic selection, the active file, or a subset of files, ensuring the AI always receives some context.

## User Control & Transparency

Throughout complex operations like plan generation, execution, and code streaming, Minovative Mind provides **real-time progress notifications** (`vscode.window.withProgress`). You'll see updates directly in VS Code's status bar and notifications, ensuring transparency. Crucially, almost all long-running AI operations are **fully cancellable** (`vscode.CancellationTokenSource` and checks for `token.isCancellationRequested` pervade `src/services/planService.ts`, `src/sidebar/SidebarProvider.ts`'s `triggerUniversalCancellation`), giving you immediate control to stop processes if needed, preventing resource waste or unwanted actions.

## Advanced File and Workspace Processing

The system employs sophisticated processing mechanisms to analyze codebases efficiently.
Minovative Mind's **context building** (`_formatRelevantFilesForPrompt` in `src/services/planService.ts`) intelligently filters and formats relevant files for the AI, gracefully handling large files (e.g., skipping files over 1MB (`maxFileSizeForSnippet`)), intelligently identifying and excluding binary content, and dynamically detecting programming languages based on extensions and common filenames (even for those without standard extensions like `Dockerfile`, `Makefile`, `.gitignore`). This ensures the AI always receives pertinent, actionable code snippets while avoiding irrelevant or problematic data, optimizing token usage and AI focus. This is complemented by **Incremental Context Building**, processing files individually and progressively building context where insights from prior files inform subsequent analysis. Furthermore, **Detailed File Analysis** assesses file complexity, detects its purpose, generates AI insights, tracks dependencies, and collects vital file statistics. For enhanced user visibility, **Progress Tracking** offers real-time updates, file-by-file feedback, and performance metrics. It also supports efficient and concurrent **Batch Processing** with configurable sizes and optimized memory usage.

## Caching Mechanisms

The extension incorporates sophisticated caching strategies to enhance performance and responsiveness:

- **Smart Cache Keys**: Based on file paths, options, and workspace context for precise caching.
- **Staleness Detection**: Automatically invalidates cache entries when underlying files change, ensuring data freshness.
- **Cache Management**: Employs an LRU (Least Recently Used) eviction policy to manage cache size efficiently, removing older entries when the cache reaches its maximum capacity.
- **Preloading**: Allows for preloading context for frequently accessed files, significantly reducing lookup times and improving user experience.

## Security & Safety Features

### File System Security

- **Workspace Path Validation**: All file operations are restricted to the current VS Code workspace, preventing access to files outside the project directory.
- **Gitignore Compliance**: All file operations respect `.gitignore` rules, ensuring sensitive files are not accessed or modified.
- **Path Traversal Protection**: Prevents directory traversal attacks by validating all file paths are relative to the workspace root.

### Command Execution Safety

- **Command Execution Safety & User Control**: When an AI-generated plan includes shell commands (`run_command`), Minovative Mind prioritizes your safety and control. Each command is presented with a **clear, explicit user confirmation prompt** directly in VS Code (`vscode.window.showWarningMessage` used in `src/services/planService.ts`). You always have the power to 'Allow', 'Skip', or 'Cancel Plan' for any command, ensuring you retain full oversight and prevent unintended system-level changes. This direct intervention mechanism empowers you to review and approve every potentially impactful action.

## Customization and Configuration

Minovative Mind is highly customizable to fit your specific development workflow. Easily configure various aspects directly in the sidebar or via VS Code settings:

- **AI Model Selection**: Choose your preferred Google Gemini model for different tasks (`AVAILABLE_GEMINI_MODELS` from `src/sidebar/common/sidebarConstants.ts`, managed by `SettingsManager` in `src/sidebar/managers/settingsManager.ts`).
- **API Key Management**: Securely store and manage your API keys.
- **Dynamic Feature Gating**: Features are dynamically enabled or disabled based on your user tier and subscription level (e.g., for Premium capabilities). These settings (`src/sidebar/managers/settingsManager.ts`) allow you to fine-tune the extension's behavior to your needs.

## Internal Architecture Highlights

- **Settings Management**: User preferences (e.g., smart context, model selection) are managed and persisted, affecting extension behavior in real time.
- **Robust Error Handling & User Feedback**: Minovative Mind provides clear, actionable feedback when issues arise. Our **intelligent error reporting system** delivers user-friendly messages directly within VS Code notifications and the chat interface, guiding you on how to resolve problems effectively (`showErrorNotification` in `src/utils/notificationUtils.ts`). For transient AI API failures (e.g., 'quota exceeded', network issues, timeouts), the extension automatically implements **robust retry mechanisms with exponential back-off** (logic in `_executePlanSteps` within `src/services/planService.ts`), ensuring resilience and minimizing workflow interruptions, allowing you to focus on coding.
- **Comprehensive Git Integration**: Minovative Mind offers **deep and comprehensive integration with Git**, streamlining essential version control tasks directly within your workflow. Beyond AI-driven commit message generation (`/commit`, leveraging `CommitService` in `src/services/commitService.ts`) and intelligent merge conflict resolution (`/merge`), the extension seamlessly interacts with your staged changes, accurately retrieves file content from Git history (`getGitFileContentFromHead`, `getGitFileContentFromIndex` from `src/sidebar/services/gitService.ts`), and can automatically unmark resolved merge conflict files (`unmarkFileAsResolved` in `src/services/gitConflictResolutionService.ts`). This integrated approach accelerates your Git workflow, allowing you to manage code changes more efficiently.
- **Utility Features**: Includes utilities for formatting file trees, sanitizing error messages, handling workspace-relative paths, and detecting merge conflicts in file content.
- **Streaming AI Responses**: Real-time streaming of AI responses with typing animations and progress indicators.
- **Robust Concurrency Management**: The extension leverages the `bluebird` library and a custom `src/utils/parallelProcessor.ts` utility for efficient, concurrent processing of intensive background tasks. This includes operations such as comprehensive workspace scanning, building detailed dependency graphs, and performing complex context analysis. By executing these tasks in parallel, Minovative Mind ensures that the VS Code UI remains responsive and fluid, preventing freezes during demanding AI operations. The `package.json` reflects the `bluebird` dependency, and its usage can be observed in `src/services/contextService.ts` (e.g., `BPromise.map`) and within the `ParallelProcessor` class itself.

## Development Toolchain

Minovative Mind is built with a modern and robust development toolchain to ensure code quality, performance, and maintainability:

- **TypeScript**: Utilized for its strong typing capabilities, which enhance code reliability, catch errors early in development, and improve developer productivity through better autocompletion and refactoring support.
- **Webpack**: Configured for efficient bundling of the extension's source code, optimizing load times and ensuring a streamlined distribution. This includes separate bundles for the extension host and the webview.
- **ESLint**: Employed for static code analysis, enforcing consistent code style, identifying potential bugs, and ensuring adherence to best practices across the codebase.

These tools are meticulously configured through `package.json` (for scripts and dependencies), `webpack.config.js` (for bundling logic), and `eslint.config.mjs` (for linting rules).

By combining these features, Minovative Mind aims to provide a comprehensive AI-powered assistant directly within `VS Code`, significantly streamlining development tasks and improving overall developer productivity.

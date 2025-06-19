# 📄 Change Log

Stay updated with the latest improvements and bug fixes: [Minovative Mind Updates](https://www.minovativemind.dev/updates)

## [1.2.4] - 2025-06-18

## [1.2.3] - 2025-06-18

## [1.2.2] - 2025-06-18

## [1.2.1] - 2025-06-18

- Small bug fix and changes

## [1.2.0] - 2025-06-18

- **feat: Add Sign In button and settings panel command**
  Introduced a 'Sign In' button in the sidebar webview to streamline the authentication process. Clicking this button triggers a new command () that guides the user to the Minovative Mind settings panel for sign-in. Includes necessary command registration, webview message handling, UI updates, and a minor refactor in SettingsProvider.
- **feat(webview): Enhance message and loading indicator rendering**
  Enabled HTML rendering in the MarkdownIt parser to support richer content.
  Updated the \Generating...\ loading message to include an animated ellipsis effect for a more dynamic UI.
- **feat: Display and interact with AI context files in chat**
  Refactors context generation to include relevant file paths, which are now displayed within AI chat responses. Users can collapse/expand the file list in chat messages and open files directly from the list. Chat history persistence now includes relevant files and their display state. Robust security checks are implemented for file opening.
- **feat: Improve AI code generation context and chat history persistence**
  - Refactor AI prompts for file creation and modification to include broader project, editor, and chat history context.
  - Update AI persona to focus on generating production-ready, robust, and secure code.
  - Ensure chat history is restored to the webview after commit confirmation, cancellation, and plan execution updates.
  - Refactor PlanService methods to pass object for better context management.
  - Enhance real-time execution messages to indicate diff availability for file operations.
- **feat(context): Enhance active symbol detail for richer context**
  Expands the active symbol context to provide more comprehensive information, improving AI's understanding.
- **feat: Implement TypeScript-aware module resolution**
  Integrates TypeScript's built-in module resolution API for enhanced accuracy in dependency parsing. This change:
  - Loads and respects project-specific tsconfig.json or jsconfig.json configurations.
  - Utilizes ts.resolveModuleName to correctly resolve module paths, including baseUrl and paths mappings.
  - Accurately distinguishes between internal project files and external library imports.
  - Updates TypeScript dependency to 5.8.3.
- **feat(context): Add detailed active symbol information**
  Introduce to capture and integrate comprehensive details about the active symbol under the cursor into the generated context.
- **refactor(core): Decompose SidebarProvider into dedicated services**
  This extensive refactoring enhances the extension's architecture by moving core functionalities out of the monolithic SidebarProvider.

## [1.1.3] - 2025-06-16

- **refactor(planExecution): Improve file path handling with VS Code URIs**
  - Ensure a workspace folder is open before performing file operations.
  - Transition from string-based path concatenation to for constructing target file URIs. This provides more robust and consistent path resolution within the VS Code environment.
  - Update all file-related operations (e.g., opening documents, reporting progress, error messages) to consistently use .

## [1.1.2] - 2025-06-16

- **feat: Remove framework convention adherence from public facing features**
  - Removes mentions of the AI automatically adhering to project framework conventions and performing path validation from FEATURES.md, README.md, and USAGE.md.

## [1.1.1] - 2025-06-16

- **refactor: Remove framework detection and convention logic**
  - Removed framework detection and convention enforcement/display capabilities. Removing this makes sure the parsing system is more robust. Solely relying on the AI to detect project's type.

## [1.1.0] - 2025-06-16

- **feat: document Symbol-Aware Refactoring feature**
  - Added a new feature description for "Symbol-Aware Refactoring," highlighting its ability to leverage VS Code’s symbol information for precise modifications. Updated the "Comprehensive Understanding" feature to explicitly mention the use of detailed symbol information. Adjusted table header alignment in the feature comparison section.
- **feat(context): Enhance AI context with document symbol information**
  - This commit integrates document symbol information into the context provided to the AI, significantly improving its understanding of codebase structure and relationships.
- **docs: Update feature comparison link in README**

## [1.0.3] - 2025-06-15

- **feat: Initialize webview with user authentication and subscription state**
  - On webview resolution, send the current sign-in status, user tier, subscription activity, and email to ensure the UI accurately reflects the user's state from the start.

## [1.0.2] - 2025-06-15

- **docs: Enhance README and refine UI styling**
  - - Added a comprehensive Table of Contents to README.md for improved navigation.
  - - Standardized list item formatting and updated internal links within README.md.
  - - Updated the VS Code activity bar icon to a higher resolution version.
  - - Adjusted sidebar layout by setting H2 elements to in styles.css.
  - - Refined the border style of the commit review container for better visual consistency.

## [1.0.1] - 2025-06-15

- **chore: Prepare for full launch**
  - - Remove \Beta\ designation from extension description and keywords.
  - - Update extension icon and associated references.
  - - Adjust README messages, documentation links, and copyright year.
  - - Clean up unused package metadata and correct changelog date.

## [1.0.0] - 2025-6-15

- First release of Minovative Mind in VS Code marketplace

## [0.0.7-beta.0] - 2025-6-15

## [0.0.6-beta.0] - 2025-6-12

## [0.0.5-beta.0] - 2025-6-8

## [0.0.4-beta.0] - 2025-6-6

## [0.0.3-beta.0] - 2025-6-6

## [0.0.2-beta.2] - 2025-6-5

## [0.0.2-beta.1] - 2025-6-4

## [0.0.2-beta.0] - 2025-6-4

## [0.0.1-beta.2] - 2025-5-31

- Beta pre-release for developer showcasing and feedback

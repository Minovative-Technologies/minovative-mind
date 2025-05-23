# Welcome to Minovative Mind VS Code Extension

## What's in the folder

- This folder contains all of the files necessary for your extension.
- package.json - this is the manifest file where the Minovative Mind extension declares its core features and metadata. It includes:
  - **Name, Display Name, Description, Version, Publisher:** Essential metadata for identification and marketplace listing.
  - **Engines:** Specifies compatibility with various VS Code versions.
  - **Categories:** Helps users find the extension in the marketplace (e.g., "AI", "Productivity").
  - **Activation Events:** Defines when the extension becomes active (e.g., when specific commands are executed, or when a Minovative Mind view is opened).
  - **Main:** Points to the compiled entry point of the extension, `./dist/extension.js`.
  - **Contributes:** Declares the specific contributions Minovative Mind makes to the VS Code UI and functionality:
    - **Views Containers:** Registers the 'Minovative Mind' icon in the Activity Bar, providing quick access to its features.
    - **Views:** Defines the 'Minovative Mind Tools' and 'Settings' webview sidebars accessible from the Activity Bar, offering interactive interfaces for AI operations and configuration.
    - **Commands:** Lists the commands available for execution, such as `minovative-mind.modifySelection` (for AI-driven code modification) and `minovative-mind.explainSelection` (for AI-driven code explanations).
    - **Menus:** Configures where the extension's commands appear, specifically in the editor's context menu when text is selected.
    - **Keybindings:** Assigns keyboard shortcuts, like `Ctrl+M` (or `Cmd+M` on macOS) for the `minovative-mind.modifySelection` command, enabling quick access.
- src/extension.ts - this is the core file providing the implementation for the Minovative Mind extension.
  - The `activate` function serves as the extension's primary entry point, called when the extension is first activated (e.g., by executing a command or opening a Minovative Mind view).
  - Within `activate`, the `SidebarProvider` and `SettingsProvider` are initialized and registered. These providers manage the webview panels that power the 'Minovative Mind Tools' and 'Settings' sidebars, enabling a rich interactive user experience.
  - The file registers the main commands:
    - `minovative-mind.modifySelection`: This command allows users to apply AI-driven modifications to selected code. Users can prepend their selection with commands like `/fix` (for bug fixes), `/docs` (for documentation generation), or provide custom instructions directly to the AI, with results displayed in the Minovative Mind sidebar.
    - `minovative-mind.explainSelection`: This command generates a concise, AI-powered explanation of the selected code, helping users quickly understand unfamiliar or complex sections.

## Setup

- install the recommended extensions (amodio.tsl-problem-matcher, ms-vscode.extension-test-runner, and dbaeumer.vscode-eslint)

## Get up and running straight away

- Press `F5` to open a new window with the Minovative Mind extension loaded for debugging.
- **Open the Minovative Mind Sidebar:** Click on the 'Minovative Mind' icon in the VS Code Activity Bar (usually on the left side) to open the main tools and settings panels.
- **Run Commands from the Command Palette:**
  - Press (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac).
  - Type `Minovative Mind: Custom Modifications` to initiate an AI-driven modification.
  - Type `Minovative Mind: Generate Explanation` to get an AI explanation of selected code.
- **Access Commands via Editor Context Menu:**
  - Select any code in the editor.
  - Right-click on the selection.
  - Choose `Minovative Mind: Custom Modifications` or `Minovative Mind: Generate Explanation` from the context menu.
- **Use the Keybinding for Custom Modifications:**
  - Select the code you wish to modify.
  - Press `Ctrl+M` (or `Cmd+M` on Mac) to quickly invoke the `Minovative Mind: Custom Modifications` command.
- **Interact with the Input Box:** When using the modification command (via Command Palette, Context Menu, or Keybinding), a quick pick input box will appear. You can type instructions like `/fix`, `/docs`, or any custom prompt, or leave it blank for a default action, to guide the AI's modification process.

## Make changes

- You can relaunch the extension from the debug toolbar after changing code in `src/extension.ts`.
- You can also reload (`Ctrl+R` or `Cmd+R` on Mac) the VS Code window with your extension to load your changes.

## Explore the API

- You can open the full set of our API when you open the file `node_modules/@types/vscode/index.d.ts`.

## Run tests

- Install the [Extension Test Runner](https://marketplace.visualstudio.com/items?itemName=ms-vscode.extension-test-runner)
- Run the "watch" task via the **Tasks: Run Task** command. Make sure this is running, or tests might not be discovered.
- Open the Testing view from the activity bar and click the Run Test" button, or use the hotkey `Ctrl/Cmd + ; A`
- See the output of the test result in the Test Results view.
- Make changes to `src/test/extension.test.ts` or create new test files inside the `test` folder.
  - The provided test runner will only consider files matching the name pattern `**.test.ts`.
  - You can create folders inside the `test` folder to structure your tests any way you want.

## Go further

- Reduce the extension size and improve the startup time by [bundling your extension](https://code.visualstudio.com/api/working-with-extensions/bundling-extension).
- [Publish your extension](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) on the VS Code extension marketplace.
- Automate builds by setting up [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration).

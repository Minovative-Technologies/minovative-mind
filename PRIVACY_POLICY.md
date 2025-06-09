# Minovative Mind VS Code Extension Privacy Policy

This Privacy Policy describes how the Minovative Mind VS Code extension ("the Extension") collects, uses, and shares information when you use our services within the Visual Studio Code environment. The purpose of this policy is to clearly explain our data practices and your rights regarding your information.

## 1. Introduction

The Minovative Mind VS Code Extension is designed to enhance your coding experience by integrating generative AI capabilities directly into your VS Code workspace. It leverages Google's Generative AI (Gemini) API to provide intelligent assistance, code generation, refactoring, documentation, and more. This policy outlines what information the Extension processes and why.

## 2. Information Collection

The Minovative Mind Extension collects and processes information in several ways to provide its functionality.

### Directly Provided by User

- **Google Gemini API Keys:** To use the Google Gemini API, you must provide your own API key. This key is securely stored by the Extension using VS Code's `SecretStorage` API. `SecretStorage` encrypts this data using mechanisms provided by your operating system, ensuring it is not directly accessible by the Extension's developers or any other third party. Your API key is _only_ used to authenticate your requests to Google's Generative AI API and is _never_ transmitted to Minovative Mind's publisher servers or any other external services.
- **User Instructions/Prompts:** Any text you enter into the Extension's chat interface (e.g., questions, chat messages, code modification instructions like `/fix`, `/docs`, or custom prompts) is collected as input for the AI models.

### Automatically Collected/Processed (User Workspace Data)

When you interact with the Extension, it processes data from your local VS Code workspace to provide relevant AI responses. This data is processed in-memory and sent to Google's API as part of your prompts. It is _not_ persistently stored by the Extension itself or sent to the publisher's servers.

- **Selected Code:** The exact text that you explicitly select in your VS Code editor when initiating an action (e.g., explaining selected code, refactoring).
- **Full File Content:** The entire content of the file where your selection or action originates. This provides necessary context for the AI, especially for actions that affect the whole file.
- **File Paths & Language IDs:** The full path and the language identifier (e.g., `typescript`, `python`) of the relevant file(s) you are working with.
- **Workspace File Structure:** Paths and names of relevant files within your VS Code workspace, as identified by internal mechanisms (e.g., `workspaceScanner.ts` feeding into `contextBuilder.ts`) to build broader project context for the AI. The `workspaceScanner.ts` component respects `.gitignore` rules by default, ensuring that files and directories ignored by your Git configuration are not processed or sent for context. This typically includes files near your current focus or files that are commonly referenced in a project structure.
- **Git Staged Changes (Diffs):** For features like 'Automated Git Commit Messages', the Extension processes the content of staged changes (diffs) from your local Git repository. This data (the diffs) is sent to Google's Generative AI API as part of the prompt to generate relevant commit messages.
- **Chat History:** The conversational context between you and the AI within the Extension's sidebar is stored in-memory during your active VS Code session. This history allows for continuous conversation and context retention within a session. You have the option to explicitly save this history to your local file system or load a previously saved history; however, the Extension itself does _not_ persist this history across VS Code sessions without your explicit action.
- **VS Code Diagnostics:** Relevant error, warning, or informational messages associated with the selected code or file, as provided by VS Code's language services. This data helps the AI understand the state and issues within your code.

### Authentication & Subscription Data (via Firebase)

The Minovative Mind Extension utilizes Google's Firebase services for user authentication and potentially for managing subscription tiers and usage quotas.

- **Firebase User Authentication Data:** When you sign in to the Extension, Firebase manages your user authentication. This may involve collecting and processing unique user IDs, authentication tokens, and potentially basic profile information (e.g., email address if you sign in with a Google account). This data is handled by Google's Firebase platform.
- **Subscription Status/Tier Data:** Information related to your subscription status or tier (e.g., whether you have an active subscription, your current tier) is managed and stored by Firebase. This data is used by the Extension (e.g., `_currentUserTier`, `_isSubscriptionActive` from `SidebarProvider.ts` and `extension.ts`) to enable or restrict access to certain features and enforce API usage limits or quotas associated with your subscription.

## 3. How Information is Used

The information collected by the Minovative Mind Extension is used solely for the following purposes:

- **To Provide AI Functionality:** The primary use of collected data (user prompts, workspace context, selected code, full file content, file paths, language IDs, workspace structure, chat history, and VS Code diagnostics) is to formulate requests and transmit them to Google's Generative AI API. This enables the AI to generate relevant responses, explanations, code modifications, documentation, and other intelligent assistance. Additionally, when the AI generates shell commands for execution (as part of a proposed plan), these commands are always presented to the user for review, and explicit confirmation is required before any `run_command` step is executed in their local terminal, ensuring user control over these powerful actions.
- **API Key Management:** Your provided Google Gemini API key is used exclusively to authenticate your requests with the Google Generative AI API.
- **Subscription/Feature Management:** Data managed via Firebase (user authentication data, subscription status) is used to verify your identity, manage your access to premium features, and enforce any usage limits or quotas associated with your subscription plan.
- **Internal Operations:** Limited data (e.g., console logs for error reporting, anonymized usage statistics to gauge extension performance) may be processed internally for debugging, performance monitoring, and improving the Extension's stability and responsiveness. This data does not contain personally identifiable information or your workspace content.

## 4. External Links

The Minovative Mind Extension may provide direct links to external websites within its interface (e.g., links to Google Cloud API usage dashboards for billing, or Minovative Mind's official website for support and documentation). Clicking on these links will navigate you outside of the Visual Studio Code environment. Please be aware that your interactions on these external sites are governed by their respective privacy policies, and not by this Minovative Mind VS Code Extension Privacy Policy. We encourage you to review the privacy policies of any third-party sites you visit.

## 5. Information Sharing and Disclosure

We are committed to protecting your privacy. The Minovative Mind Extension shares information only under the following limited circumstances:

- **Google Generative AI API:** Your user prompts, selected code, full file contents, and relevant workspace context (file paths, language IDs, workspace structure, diagnostics) are transmitted to Google's Generative AI API for processing and AI response generation. It's important to note that Google's Generative AI API may apply its own safety and content moderation policies. As indicated by `promptFeedback` and `finishReason` in `src/ai/gemini.ts`, requests (prompts, context) or responses may be blocked or truncated by Google's services if they are deemed to violate these policies. Google's handling of this data is governed by their own privacy policy. We encourage you to review Google's privacy policies for information on how they handle data submitted to their AI services.
- **Firebase:** Authentication and potentially subscription/usage data (e.g., user IDs, subscription status) are processed by Google's Firebase services. This is also a Google service, and its data handling practices are governed by Google's privacy policy.
- **No Other Sharing:** The Minovative Mind Extension does _not_ share your personal data, your API keys, or your code/workspace content with any other third parties beyond Google's services (Gemini API and Firebase) as described above. The Extension does _not_ send any of your sensitive data (like API keys or code content) to Minovative Mind's publisher servers.

## 6. Data Storage and Security

- **API Keys:** Your Google Gemini API key is securely stored using VS Code's built-in `SecretStorage`, which utilizes operating system-level encryption. The Extension does not store this key itself on disk or transmit it to external servers.
- **Chat History:** Your chat history within the Extension is stored in-memory during your active VS Code session. It is not persistently stored by the Extension across sessions unless you explicitly save it to your local file system.
- **Workspace Data:** Your selected code, full file content, file paths, language IDs, workspace structure, and VS Code diagnostics are processed in-memory to generate AI prompts. This data is transmitted to Google's API but is _not_ persistently stored by the Extension on your local machine or on any external servers.
- **Security Measures:** We leverage the robust security features provided by Visual Studio Code and its API, particularly for sensitive data storage like API keys. For data transmitted to Google's services, we rely on the security measures implemented by Google for their API and Firebase platforms.

## 7. User Rights and Controls

You have control over your data and how you interact with the Minovative Mind Extension:

- **API Key Management:** You can add, delete, or switch between different Google Gemini API keys directly within the Extension's settings, giving you full control over your API access.
- **Chat History:** You can clear your current chat history at any time within the Extension's interface. You also have the option to explicitly save your chat history to your local file system or load a previously saved history, giving you direct control over its persistence.
- **Data Minimization:** You can control the amount of context shared with the AI by selecting smaller, more focused code blocks rather than entire files. The Extension's default behavior respects `.gitignore` rules, providing an out-of-the-box mechanism to limit the scope of data processed from your workspace. If the Extension implements additional workspace scanning ignore patterns or explicit configuration options, you can configure these to further limit which files and folders are considered for workspace context.
- **Access/Deletion of Data:** For data processed by Google's Generative AI API, you should refer to Google's privacy policy and data retention policies. For authentication data managed by Firebase, you can typically manage your Google account data directly through Google's account settings.

## 8. Children's Privacy

The Minovative Mind VS Code Extension is not intended for use by children under the age of 13. We do not knowingly collect personally identifiable information from children under 13. If we become aware that we have inadvertently received personal information from a user under the age of 13, we will take steps to delete that information from our records as quickly as possible. If you are a parent or guardian and believe we may have collected information from your child, please contact us at the address provided in the "Contact Us" section below.

## 9. Changes to This Privacy Policy

We may update this Privacy Policy from time to time to reflect changes in our practices or for other operational, legal, or regulatory reasons. We will notify you of any significant changes by updating the policy within the VS Code Marketplace listing for the Extension or through other appropriate means within the VS Code environment. We encourage you to review this policy periodically.

## 10. Contact Us

If you have any questions or concerns about this Privacy Policy or our data practices, please contact us at:

Minovative Technologies (support@minovativemind.dev)

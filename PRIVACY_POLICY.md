# Minovative Mind VS Code Extension | Privacy Policy

This Privacy Policy describes how the Minovative Mind VS Code extension ("the Extension") collects, uses, and shares information when you use our services within the Visual Studio Code environment. The purpose of this policy is to clearly explain our data practices and your rights regarding your information.

## 1. Introduction

The Minovative Mind VS Code Extension is designed to significantly enhance your coding experience by integrating powerful generative AI capabilities directly into your VS Code workspace. It _relies_ on Google's Generative AI (Gemini) API to provide intelligent assistance, including code generation, refactoring, documentation, debugging support, and more. This policy outlines what information the Extension processes and why, ensuring transparency about our data practices.

## 2. Information Collection

The Minovative Mind Extension collects and processes information in several ways to provide its functionality.

### Directly Provided by User

- **Google Gemini API Keys:** To utilize the Google Gemini API, you are required to provide your own API key. This key is securely stored by the Extension using VS Code's `SecretStorage` API. `SecretStorage` employs robust, operating system-level encryption mechanisms to protect this data, ensuring it is not directly accessible by the Extension's developers or any other third party. Your API key is _exclusively_ used to authenticate your requests to Google's Generative AI API and is _never_ transmitted to Minovative Mind's publisher servers or any other external services.
- **User Instructions/Prompts:** Any text you enter into the Extension's chat interface (e.g., questions, chat messages, code modification instructions like `/fix`, `/docs`, or custom prompts), including explicit commands or instructions, is collected as input for the AI models to process your requests.

### Automatically Collected/Processed (User Workspace Data)

When you interact with the Extension, it intelligently processes relevant data from your local VS Code workspace to provide accurate and contextual AI responses. This data is processed _in-memory_ on your local machine and transmitted to Google's API as part of your prompts. Crucially, this information is **not persistently stored by the Extension itself on your local machine, nor is it sent to Minovative Mind's publisher servers.**

- **Selected Code:** The exact text that you explicitly select in your VS Code editor when initiating an action (e.g., explaining selected code, refactoring). This is processed to provide focused context for AI responses, enabling the AI to operate on the precise code segment you intend.
- **Full File Content:** The entire content of the file where your selection or action originates. This provides necessary context for the AI to understand the broader code structure, dependencies, and surrounding logic, especially for actions that affect the whole file.
- **File Paths & Language IDs:** The full path and the language identifier (e.g., `typescript`, `python`) of the relevant file(s) you are working with. This information helps the AI understand the file type and its location within your project, enabling more accurate and contextually aware assistance.
- **Workspace File Structure:** Paths and names of relevant files and directories within your VS Code workspace, as identified by internal mechanisms (e.g., `workspaceScanner.ts` feeding into `contextBuilder.ts`). This information is processed to provide the AI with an understanding of your project's overall layout and inter-file relationships, crucial for features like smart context awareness. The Extension's `workspaceScanner.ts` component respects `.gitignore` rules by default, ensuring that files and directories you've chosen to exclude from Git are generally excluded from this context processing as well.
- **Detailed Symbol Information:** For features like 'Symbol-Aware Refactoring' and 'Smart Context Awareness', the Extension collects and processes detailed symbol information from your workspace, including functions, classes, variables, references, definitions, and types. This detailed symbol information is processed to give the AI a granular understanding of your codebase's internal logic and relationships, which is vital for precise and robust refactoring and code generation.
- **Dependency Graph Analysis:** For 'Smart Context Awareness', the Extension processes data derived from your `tsconfig.json` or `jsconfig.json` files to build a dependency graph. This analysis helps the AI understand module resolution paths and inter-file relationships, providing a comprehensive project context essential for intelligent suggestions and modifications that span across multiple files.
- **Git Staged Changes (Diffs):** For features like 'Automated Git Commit Messages', the Extension processes the content of staged changes (diffs) from your local Git repository. This processing is performed to allow the AI to generate accurate and relevant commit messages based on your modifications before you commit them.
- **Chat History:** The conversational context between you and the AI within the Extension's sidebar is stored _in-memory_ during your active VS Code session. This in-memory storage allows for continuous conversation and context retention within a single session, and this data is transmitted to Google's API as part of your subsequent prompts to provide conversational context. You have the option to explicitly save this history to your local file system or load a previously saved history; however, the Extension itself does _not_ persistently store this history across VS Code sessions or send it to the publisher's servers without your explicit action.
- **VS Code Diagnostics:** Relevant error, warning, or informational messages associated with the selected code or file, as provided by VS Code's language services. This data helps the AI understand the current state and identify potential issues within your code, enabling more targeted and effective AI assistance.

### Authentication & Subscription Data (via Firebase)

The Minovative Mind Extension utilizes Google's Firebase services for secure user authentication and managing your subscription status and usage quotas. Please note that while Firebase, a secure, Google-managed platform, handles your authentication and subscription _status_, actual payment processing for subscriptions is handled by separate third-party payment processors like Stripe.

- **Firebase User Authentication Data:** When you sign in to the Extension, Firebase manages your user authentication. This involves collecting and processing unique user IDs, authentication tokens, and potentially basic profile information (e.g., email address if you sign in with a Google account). This data is handled entirely by Google's Firebase platform and is subject to Google's privacy policies.
- **Subscription Status/Tier Data:** Information related to your subscription status or tier (e.g., whether you have an active subscription, your current tier) is managed and stored by Firebase. This data is used by the Extension (e.g., `_currentUserTier`, `_isSubscriptionActive` as observed in internal components) to enable or restrict access to certain features and enforce API usage limits or quotas associated with your subscription plan.

## 3. How Information is Used

The information collected by the Minovative Mind Extension is used solely for the following purposes:

- **To Provide AI Functionality:** The primary use of all collected data—specifically user prompts and comprehensive workspace context (including selected code, full file content, file paths, language IDs, workspace structure, detailed symbol information, dependency graph analysis, chat history, Git staged changes, and VS Code diagnostics)—is to accurately formulate requests and transmit them to Google's Generative AI API. This enables the AI to generate highly relevant responses, intelligent explanations, precise code modifications, comprehensive documentation, and other tailored assistance directly within your development environment. Additionally, when the AI generates actions like shell commands (`run_command`), file creations (`create_file`), or file modifications (`modify_file`) as part of a proposed plan, these actions are always presented to the user for explicit review and confirmation before any step is executed in their local terminal or applied to their codebase, ensuring complete user control over these powerful operations.
- **API Key Management:** Your provided Google Gemini API key is used exclusively to authenticate your requests with the Google Generative AI API, ensuring your usage is attributed correctly.
- **Subscription/Feature Management:** Data managed via Firebase (user authentication data, subscription status, and usage quotas) is used to securely verify your identity, manage your access to premium features, and enforce any usage limits or quotas associated with your subscription plan.
- **Internal Operations:** Limited, anonymized data, such as aggregated usage statistics and diagnostic console logs (which _do not_ contain personally identifiable information or your workspace content), may be processed internally for debugging, performance monitoring, and continuously improving the Extension's stability, responsiveness, and overall user experience.

## 4. External Links

The Minovative Mind Extension may provide direct links to external websites within its interface (e.g., links to Google Cloud API usage dashboards for billing, Minovative Mind's official website for support and documentation, or third-party payment portals). Clicking on these links will navigate you outside of the Visual Studio Code environment. Please be aware that your interactions on these external sites are governed by their respective privacy policies, and not by this Minovative Mind VS Code Extension Privacy Policy. We encourage you to review the privacy policies of any third-party sites you visit.

## 5. Information Sharing and Disclosure

We are firmly committed to protecting your privacy. The Minovative Mind Extension shares information only under the following limited and transparent circumstances:

- **Google Generative AI API:** Your user prompts, selected code, full file contents, and all other relevant workspace context (including file paths, language IDs, workspace structure, detailed symbol information, dependency graph analysis, Git staged changes, and VS Code diagnostics) are securely transmitted to Google's Generative AI API for processing and AI response generation. It is crucial to understand that Google's Generative AI API may apply its own safety and content moderation policies. As indicated by parameters like `promptFeedback` and `finishReason` (e.g., in `src/ai/gemini.ts`), requests (prompts, context) or responses may be blocked or truncated by Google's services if they are deemed to violate these policies. Google's handling of this data is governed by their own privacy policy. We strongly encourage you to review Google's privacy policies for comprehensive information on how they handle data submitted to their AI services.
- **Firebase:** Authentication and subscription status data (e.g., unique user IDs, subscription tier information) are processed by Google's Firebase services. As Firebase is a Google service, its data handling practices are also governed entirely by Google's privacy policy.
- **Third-Party Payment Processors:** While Firebase manages your subscription _status_ for feature access, actual payment processing for Premium subscriptions (as indicated by the 'Stripe Customer Portal' mentioned in `FEATURES.md`) is handled by external third-party payment processors such as Stripe. When you choose to subscribe to a premium tier, you will be securely redirected to these external services to complete your payment. The Minovative Mind Extension does _not_ directly collect, process, or store any sensitive payment card data. Your financial data and interactions on these payment portals are governed by the respective privacy policies of these third-party payment processors, not by this Privacy Policy.
- **No Other Sharing:** The Minovative Mind Extension does _not_ share your personal data, your API keys, or your code/workspace content with any other third parties beyond Google's services (specifically the Gemini API and Firebase) and the designated third-party payment processors as explicitly described above. Furthermore, the Extension does _not_ send any of your sensitive data (such as API keys or your code content) to Minovative Mind's publisher servers.

## 6. Data Storage and Security

- **API Keys:** Your Google Gemini API key is securely stored using VS Code's built-in `SecretStorage`, which leverages robust operating system-level encryption. The Extension does not store this key itself on disk in an unencrypted format, nor does it transmit it to any external servers.
- **Chat History:** Your chat history within the Extension is stored _in-memory_ during your active VS Code session. It is not persistently stored by the Extension across sessions unless you explicitly choose to save it to your local file system.
- **Workspace Data:** Your selected code, full file content, file paths, language IDs, workspace structure, detailed symbol information, dependency graph analysis, Git staged changes, and VS Code diagnostics are processed _in-memory_ solely to generate AI prompts. This data is transmitted to Google's API but is **not persistently stored by the Extension** on your local machine or on any external servers after the AI response is generated.
- **Security Measures:** We leverage the robust security features provided by Visual Studio Code and its API, particularly for sensitive data storage like API keys. For data transmitted to Google's services and other integrated third-party services, we rely on and trust the comprehensive security measures implemented by those respective platforms to protect your information during transit and at rest on their systems.

## 7. User Rights and Controls

You have significant control over your data and how you interact with the Minovative Mind Extension:

- **API Key Management:** You have full control to add, delete, or switch between different Google Gemini API keys directly within the Extension's settings, giving you complete autonomy over your API access.
- **Chat History:** You can clear your current chat history at any time within the Extension's interface, effectively removing the in-memory conversational context. You also have the option to explicitly save your chat history to your local file system or load a previously saved history, giving you direct control over its persistence and archival.
- **Data Minimization & Context Control:** You can control the amount of context shared with the AI by selecting smaller, more focused code blocks rather than entire files. The Extension's default behavior respects `.gitignore` rules, providing an out-of-the-box mechanism to limit the scope of data processed from your workspace. If the Extension implements additional workspace scanning ignore patterns or explicit configuration options, you can configure these to further limit which files and folders are considered for workspace context. Furthermore, for all AI-driven plan executions, explicit user confirmation is required for potentially impactful actions like `run_command`, `create_file`, and `modify_file`, providing you with granular control and the ability to review before any changes are made to your system or codebase.
- **Access/Deletion of Data:** For data processed by Google's Generative AI API and Firebase, you should refer to Google's privacy policy and data retention policies for information on how to access, manage, or delete such data. For authentication data managed by Firebase, you can typically manage your associated Google account data directly through Google's account settings. For data related to third-party payment processors, please refer to their respective privacy policies and account management options for details on data access and deletion.

## 8. Children's Privacy

The Minovative Mind VS Code Extension is not intended for use by children under the age of 13. We do not knowingly collect personally identifiable information from children under 13. If we become aware that we have inadvertently received personal information from a user under the age of 13, we will take steps to delete that information from our records as quickly as possible. If you are a parent or guardian and believe we may have collected information from your child, please contact us at the address provided in the "Contact Us" section below.

## 9. Changes to This Privacy Policy

We may update this Privacy Policy from time to time to reflect changes in our practices or for other operational, legal, or regulatory reasons. We will notify you of any significant changes by updating the policy within the VS Code Marketplace listing for the Extension or through other appropriate means within the Visual Studio Code environment. We encourage you to review this policy periodically to stay informed about how we are protecting your information.

## 10. Contact Us

If you have any questions or concerns about this Privacy Policy or our data practices, please contact us at:

Minovative Technologies (support@minovativemind.dev)

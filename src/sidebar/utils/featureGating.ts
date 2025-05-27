import { UserTier } from "../common/sidebarTypes"; // Assuming UserTier is defined here

/**
 * Determines if a specific feature/action is allowed for the given user tier and subscription status.
 * @param userTier The current tier of the user ("free", "pro", etc.).
 * @param isSubscriptionActive True if the user has an active subscription, regardless of tier label.
 * @param actionType A string identifying the type of action/feature being requested (e.g., "plan_from_chat", "fix_command", "explain_selection").
 * @param instruction Optional: The raw user instruction, primarily for differentiating editor modification commands (e.g., "/docs" vs. custom prompts).
 * @returns True if the feature is allowed, false otherwise.
 */
export function isFeatureAllowed(
	userTier: UserTier,
	isSubscriptionActive: boolean,
	actionType: string,
	instruction?: string
): boolean {
	// Rule 1: Paid users or users with an active subscription can use ALL features.
	if (isSubscriptionActive || userTier === "pro") {
		return true;
	}

	// Rule 2: Free tier users without an active subscription have restrictions.
	if (userTier === "free") {
		switch (actionType) {
			// Features explicitly RESTRICTED for free tier (as per request)
			case "plan_from_chat": // Corresponds to the '/plan' command from the sidebar chat
			case "plan_from_editor_fix": // Corresponds to the '/fix' command from the editor action
			case "plan_from_editor_custom": // Corresponds to custom modification commands from the editor action (not '/docs')
				return false;

			// Features explicitly ALLOWED for free tier (as per request)
			case "regular_chat": // General chat messages
			case "explain_selection": // The 'explain selection' command
			case "commit_command": // The '/commit' chat command or explicit button
			case "api_key_management": // Adding, deleting, switching API keys
			case "chat_history_management": // Clearing, saving, loading chat history
			case "model_selection": // Selecting AI models
			case "generate_documentation": // New: Generate documentation is allowed for free tier
				return true;

			// Special case for editor modification commands: All are now restricted for free tier.
			case "editor_modification_command":
				// All custom modification commands (e.g., "refactor this", "add feature", including '/docs') are now restricted for free tier.
				return false;

			default:
				// Default to restricted for any unknown or unhandled action types for free tier.
				// This is a safety measure to prevent unintended access to future features.
				console.warn(
					`[FeatureGating] Unknown action type "${actionType}" for free tier user. Defaulting to restricted.`
				);
				return false;
		}
	}

	// Fallback for any unhandled user tier (should ideally not be reached if tiers are well-defined)
	console.warn(
		`[FeatureGating] Unknown user tier "${userTier}". Defaulting to restricted.`
	);
	return false;
}

// src/sidebar/webview/settings.ts
// Removed all Firebase SDK imports as per instructions.

import { auth } from "../../firebase/firebaseService";
import type {
	UserTier, // Used for determining subscription status text
	AuthStateUpdatePayload,
	SettingsWebviewIncomingMessage,
	SettingsWebviewOutgoingMessage, // Ensure this is imported for the type assertion change
} from "../common/sidebarTypes"; // Adjust path if your types are elsewhere

const vscode = acquireVsCodeApi();

// DOM Elements (ensure IDs match settings.html)
const emailInput = document.getElementById("email-input") as HTMLInputElement;
const passwordInput = document.getElementById(
	"password-input"
) as HTMLInputElement;
const signInButton = document.getElementById(
	"sign-in-button"
) as HTMLButtonElement;
const signUpButton = document.getElementById(
	"sign-up-button"
) as HTMLButtonElement;
const signOutButton = document.getElementById(
	"sign-out-button"
) as HTMLButtonElement;
const userInfoDiv = document.getElementById("user-info") as HTMLDivElement;
const userEmailDisplay = document.getElementById(
	"user-email-display"
) as HTMLSpanElement;
const subscriptionStatusDisplay = document.getElementById(
	"subscription-status-display"
) as HTMLSpanElement;
const subscriptionLoadingSpinner = document.getElementById(
	"subscription-loading-spinner"
) as HTMLSpanElement;
const authFormsDiv = document.getElementById("auth-forms") as HTMLDivElement;
const authSectionDiv = document.getElementById(
	"auth-section-wrapper"
) as HTMLDivElement;
const authErrorP = document.getElementById(
	"auth-error"
) as HTMLParagraphElement;
const authLoadingDiv = document.getElementById(
	"auth-loading"
) as HTMLDivElement;
const manageSubscriptionButton = document.getElementById(
	"manage-subscription-button"
) as HTMLButtonElement;

// Original buttons
const apiUsageButton = document.getElementById(
	"apiUsageButton"
) as HTMLButtonElement;
const minovativeMindWebsiteButton = document.getElementById(
	"minovativeMindWebsiteButton"
) as HTMLButtonElement;

// Removed all Firebase related variables (fbApp, fbAuth, fbDb, currentFirebaseUser, unsubscribeSubscription).

function showAuthError(message: string): void {
	if (authErrorP) {
		authErrorP.textContent = message;
		authErrorP.style.display = "block";
	}
}

function clearAuthError(): void {
	if (authErrorP) {
		authErrorP.textContent = "";
		authErrorP.style.display = "none";
	}
}

/**
 * Updates the UI elements based on the authentication state payload received from the extension.
 * This function replaces the Firebase-driven UI update logic.
 * @param payload The AuthStateUpdatePayload containing user sign-in and subscription status.
 */
function updateUIFromAuthState(payload: AuthStateUpdatePayload): void {
	console.log("[SettingsWebview] Updating UI with auth state:", payload);
	clearAuthError(); // Clear any previous errors when a new state is received

	// Hide the initial authentication loading spinner once any state is received
	if (authLoadingDiv) {
		authLoadingDiv.style.display = "none";
	}

	if (payload.isSignedIn) {
		// User is signed in: show user info, hide auth forms
		if (userInfoDiv) {
			userInfoDiv.style.display = "block";
		}
		if (authSectionDiv) {
			authSectionDiv.style.display = "none"; // Hide the entire authentication section
		}
		if (authFormsDiv) {
			authFormsDiv.style.display = "none"; // Ensure forms are hidden
		}

		if (userEmailDisplay) {
			userEmailDisplay.textContent = payload.email || "N/A";
		}

		let subscriptionStatusText: string;
		if (payload.tier === "pro") {
			// Changed from "paid" to "pro"
			if (payload.isSubscriptionActive) {
				subscriptionStatusText = "Tier - Pro (Active)"; // Updated text
			} else {
				// If tier is 'pro' but not active, it's considered inactive or expired
				subscriptionStatusText = "Tier - Pro (Inactive/Expired)"; // Updated text
			}
		} else {
			// Free tier or no subscription data implies free tier
			subscriptionStatusText = "Tier - Free";
		}
		if (subscriptionStatusDisplay) {
			subscriptionStatusDisplay.textContent = subscriptionStatusText;
		}

		// The manage subscription button should be visible if a user is signed in
		// as the extension will handle the logic of where to redirect.
		if (manageSubscriptionButton) {
			manageSubscriptionButton.style.display = "inline-block";
		}

		if (subscriptionLoadingSpinner) {
			subscriptionLoadingSpinner.style.display = "none"; // Hide spinner once status is displayed
		}
	} else {
		// User is signed out: hide user info, show auth forms
		if (userInfoDiv) {
			userInfoDiv.style.display = "none";
		}
		if (authSectionDiv) {
			authSectionDiv.style.display = "block"; // Show the entire authentication section
		}
		if (authFormsDiv) {
			authFormsDiv.style.display = "block"; // Ensure forms are shown
		}
		if (subscriptionStatusDisplay) {
			subscriptionStatusDisplay.textContent = "Not signed in";
		}
		if (manageSubscriptionButton) {
			manageSubscriptionButton.style.display = "none";
		}
		if (subscriptionLoadingSpinner) {
			subscriptionLoadingSpinner.style.display = "none";
		}
		if (userEmailDisplay) {
			userEmailDisplay.textContent = "N/A"; // Clear email display when signed out
		}
	}
}

// Removed the initializeFirebase function as Firebase is no longer initialized in the webview.

// --- Event Listeners for Authentication Actions ---
if (signUpButton) {
	signUpButton.addEventListener("click", () => {
		clearAuthError();
		const email = emailInput.value;
		const password = passwordInput.value;
		if (!email || !password) {
			showAuthError("Email and password are required.");
			return;
		}
		// Send a structured message to the VS Code extension for sign-up
		vscode.postMessage({
			command: "signUpRequest",
			payload: { email, password },
		});
	});
}

if (signInButton) {
	signInButton.addEventListener("click", () => {
		clearAuthError();
		const email = emailInput.value;
		const password = passwordInput.value;
		if (!email || !password) {
			showAuthError("Email and password are required.");
			return;
		}
		// Send a structured message to the VS Code extension for sign-in
		vscode.postMessage({
			command: "signInRequest",
			payload: { email, password },
		});
	});
}

if (signOutButton) {
	signOutButton.addEventListener("click", () => {
		clearAuthError();
		// Send a structured message to the VS Code extension for sign-out
		vscode.postMessage({ command: "signOutRequest" });
	});
}

if (manageSubscriptionButton) {
	manageSubscriptionButton.addEventListener("click", () => {
		clearAuthError();

		// Send a structured message to the VS Code extension to manage subscription
		// The extension will determine the appropriate URL or action.
		vscode.postMessage({
			type: "openUrl", // Changed from command: "manageSubscriptionRequest"
			command: "openUrl", // Added command: "openUrl"
			url: `https://minovative-mind-git-minovative-mind-vsc-minovative-tech.vercel.app/`, // Dynamic URL
		});
	});
}

// --- Event Listeners for Original Buttons (unrelated to auth refactoring) ---
if (apiUsageButton) {
	apiUsageButton.addEventListener("click", () => {
		vscode.postMessage({
			type: "openUrl", // Kept for consistency, though 'command' is preferred
			command: "openUrl",
			url: "https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas",
		});
	});
} else {
	console.warn("API Usage button not found.");
}

if (minovativeMindWebsiteButton) {
	minovativeMindWebsiteButton.addEventListener("click", () => {
		vscode.postMessage({
			type: "openUrl", // Kept for consistency, though 'command' is preferred
			command: "openUrl",
			url: "https://minovativemind.dev",
		});
	});
} else {
	console.warn("Minovative Mind Website button not found.");
}

// --- Handle messages from the VS Code extension ---
window.addEventListener("message", (event) => {
	const message = event.data as SettingsWebviewOutgoingMessage; // Changed type assertion here
	console.log(`[SettingsWebview] Message from extension: ${message.command}`);
	switch (message.command) {
		case "authStateUpdated": // Changed switch case from "authStateUpdate" to "authStateUpdated" here
			console.log(
				"[SettingsWebview] Received authStateUpdated payload:",
				message.payload
			);
			updateUIFromAuthState(message.payload);
			break;
		case "authError": // Handle authentication errors reported by the extension
			// Assuming SettingsWebviewIncomingMessage is updated to include this type.
			console.error(`[SettingsWebview] Auth Error: ${message.payload.message}`);
			showAuthError(message.payload.message);
			break;
		// The "initialize" command (previously used for Firebase config) is no longer needed here.
		// Other commands from the extension can be added as new cases.
	}
});

// --- Initial UI state setup ---
// Show a loading spinner and message while waiting for the initial auth state from the extension.
if (authLoadingDiv) {
	authLoadingDiv.style.display = "block";
	authLoadingDiv.textContent = "Loading authentication state...";
}
// Hide other sections until the actual state is determined by the extension.
if (userInfoDiv) {
	userInfoDiv.style.display = "none";
}
if (authFormsDiv) {
	authFormsDiv.style.display = "none";
}
if (subscriptionLoadingSpinner) {
	subscriptionLoadingSpinner.style.display = "none";
}
if (manageSubscriptionButton) {
	manageSubscriptionButton.style.display = "none"; // Hide initially
}

// Post a message to the extension indicating that the webview is fully loaded and ready.
// This signal should prompt the extension to send the initial `authStateUpdate` payload.
const sendReadyMessage = () => {
	console.log(
		"[SettingsWebview] DOMContentLoaded. Requesting auth state from extension."
	);
	vscode.postMessage({ command: "settingsWebviewReady" });
	console.log("[SettingsWebview] Posted 'settingsWebviewReady' message.");
};

// Add DOMContentLoaded listener to ensure the DOM is fully loaded before sending messages.
// This prevents issues if the script executes before all elements are available.
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", sendReadyMessage);
} else {
	// If the DOM is already ready (e.g., script loaded as 'defer' or at the end of body),
	// send the message immediately.
	sendReadyMessage();
}

// Log a message indicating the script's readiness and its expectation for auth state.
console.log(
	"[SettingsWebview] Script loaded. Waiting for auth state update from extension."
);

// src/sidebar/webview/settings.ts
import { initializeApp, FirebaseApp } from "firebase/app";
import {
	getAuth,
	createUserWithEmailAndPassword,
	signInWithEmailAndPassword,
	onAuthStateChanged,
	signOut,
	User as FirebaseUser,
	Auth,
} from "firebase/auth";
import {
	getFirestore,
	doc,
	getDoc,
	setDoc,
	onSnapshot,
	Firestore,
} from "firebase/firestore";

// Assuming VsCodeWebviewApi is defined in a .d.ts file and available globally
// No direct import needed for VsCodeWebviewApi if using declare global
import type {
	FirebaseConfigPayload,
	UserSubscriptionData,
	UserTier,
	AuthStateUpdatePayload,
	SettingsWebviewIncomingMessage, // Added as per instruction
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

let fbApp: FirebaseApp | null = null;
let fbAuth: Auth | null = null;
let fbDb: Firestore | null = null;
let currentFirebaseUser: FirebaseUser | null = null;
let unsubscribeSubscription: (() => void) | null = null; // For Firestore snapshot listener

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

function updateUILoginState(user: FirebaseUser | null): void {
	currentFirebaseUser = user;
	if (authLoadingDiv) {
		authLoadingDiv.style.display = "none";
	}

	if (user) {
		if (userInfoDiv) {
			userInfoDiv.style.display = "block";
		}
		if (authSectionDiv) {
			authSectionDiv.style.display = "none";
		}
		if (userEmailDisplay) {
			userEmailDisplay.textContent = user.email || "N/A";
		}

		// Always send an immediate payload for signed-in state, even before subscription data arrives.
		// This provides an immediate "signed in" status to the extension.
		const initialPayload: AuthStateUpdatePayload = {
			isSignedIn: true,
			uid: user.uid,
			email: user.email || undefined,
			tier: "free", // Default until actual subscription data is fetched
			isSubscriptionActive: false, // Default until actual subscription data is fetched
		};
		vscode.postMessage({
			command: "authStateUpdated",
			payload: initialPayload,
		});

		if (user.uid) {
			// Ensure uid exists before trying to fetch subscription data
			fetchAndDisplaySubscription(user.uid);
		} else {
			// If for some reason uid is null for a signed-in user (highly unlikely with FirebaseUser),
			// we should ensure any existing subscription listener is cleaned up.
			if (unsubscribeSubscription) {
				unsubscribeSubscription();
				unsubscribeSubscription = null;
			}
			if (subscriptionLoadingSpinner) {
				subscriptionLoadingSpinner.style.display = "none";
			}
			// The initialPayload already covered the state. No further action needed here.
		}
	} else {
		// Signed out case
		if (userInfoDiv) {
			userInfoDiv.style.display = "none";
		}
		if (authSectionDiv) {
			authSectionDiv.style.display = "block";
		}
		if (authFormsDiv) {
			authFormsDiv.style.display = "block";
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
		// When signing out, always clean up the subscription listener first.
		if (unsubscribeSubscription) {
			unsubscribeSubscription();
			unsubscribeSubscription = null;
		}

		// Send the signed-out payload.
		const payload: AuthStateUpdatePayload = {
			isSignedIn: false,
			tier: "free",
			isSubscriptionActive: false,
		};
		vscode.postMessage({ command: "authStateUpdated", payload });
	}
	clearAuthError();
}

async function fetchAndDisplaySubscription(uid: string): Promise<void> {
	if (!fbDb) {
		if (subscriptionStatusDisplay) {
			subscriptionStatusDisplay.textContent = "Database not initialized.";
		}
		if (subscriptionLoadingSpinner) {
			subscriptionLoadingSpinner.style.display = "none";
		}
		return;
	}
	if (subscriptionStatusDisplay) {
		subscriptionStatusDisplay.textContent = "Checking subscription details...";
	}
	if (subscriptionLoadingSpinner) {
		subscriptionLoadingSpinner.style.display = "inline-block";
	}

	if (unsubscribeSubscription) {
		unsubscribeSubscription();
	}

	unsubscribeSubscription = onSnapshot(
		doc(fbDb, "users", uid),
		async (docSnap) => {
			let userTier: UserTier = "free";
			let isSubscriptionActive = false;
			let subStatusText: string;

			if (docSnap.exists()) {
				const subData = docSnap.data() as UserSubscriptionData;

				if (subData.subscriptionStatus === "active") {
					const endDate = subData.subscriptionPeriodEnd?.toDate();
					if (endDate && endDate > new Date()) {
						userTier = "paid";
						isSubscriptionActive = true;
						subStatusText = `Tier - Paid (Active until ${endDate.toLocaleDateString()})`;
						if (manageSubscriptionButton) {
							manageSubscriptionButton.style.display = "inline-block";
						}
					} else if (endDate) {
						subStatusText = `Tier - Paid (Expired on ${endDate.toLocaleDateString()})`;
						if (manageSubscriptionButton && subData.stripeCustomerId) {
							manageSubscriptionButton.style.display = "inline-block";
						}
					} else {
						userTier = "paid"; // Assume active if no end date but status is active
						isSubscriptionActive = true;
						subStatusText = "Tier - Paid (Active)";
						if (manageSubscriptionButton && subData.stripeCustomerId) {
							manageSubscriptionButton.style.display = "inline-block";
						}
					}
				} else if (subData.subscriptionStatus) {
					subStatusText = `Tier - ${userTier} (${subData.subscriptionStatus})`;
					if (manageSubscriptionButton && subData.stripeCustomerId) {
						manageSubscriptionButton.style.display = "inline-block";
					} else if (manageSubscriptionButton) {
						manageSubscriptionButton.style.display = "none";
					}
				} else {
					subStatusText = "Tier - Free";
					if (manageSubscriptionButton) {
						manageSubscriptionButton.style.display = "none";
					}
				}
			} else {
				subStatusText = "Free Tier (No subscription data found for this user)";
				if (manageSubscriptionButton) {
					manageSubscriptionButton.style.display = "none";
				}
			}
			if (subscriptionStatusDisplay) {
				subscriptionStatusDisplay.textContent = subStatusText;
			}
			if (subscriptionLoadingSpinner) {
				subscriptionLoadingSpinner.style.display = "none";
			}

			const payload: AuthStateUpdatePayload = {
				isSignedIn: true,
				uid,
				email: currentFirebaseUser?.email || undefined,
				tier: userTier,
				isSubscriptionActive,
			};
			vscode.postMessage({ command: "authStateUpdated", payload });
		},
		(error) => {
			console.error("Error fetching subscription:", error);
			if (subscriptionStatusDisplay) {
				subscriptionStatusDisplay.textContent =
					"Error loading subscription details.";
			}
			if (subscriptionLoadingSpinner) {
				subscriptionLoadingSpinner.style.display = "none";
			}
			const payload: AuthStateUpdatePayload = {
				isSignedIn: true,
				uid,
				email: currentFirebaseUser?.email || undefined,
				tier: "free",
				isSubscriptionActive: false,
			};
			vscode.postMessage({ command: "authStateUpdated", payload });
		}
	);
}

function initializeFirebase(config: FirebaseConfigPayload): void {
	if (!fbApp) {
		try {
			console.log("[SettingsWebview] Initializing Firebase...");
			fbApp = initializeApp(config);
			fbAuth = getAuth(fbApp);
			fbDb = getFirestore(fbApp);

			onAuthStateChanged(fbAuth, (user) => {
				updateUILoginState(user);
			});
			console.log(
				"[SettingsWebview] Firebase initialized. Setting up auth state listener."
			);
		} catch (e) {
			const error = e as Error;
			console.error("Firebase initialization failed:", error);
			if (authLoadingDiv) {
				authLoadingDiv.textContent = "Error initializing. Check console.";
			}
			showAuthError(
				"Could not connect to authentication service. Please ensure your Firebase configuration is correct."
			);
		}
	}
}

// --- Event Listeners for Auth ---
if (signUpButton) {
	signUpButton.addEventListener("click", async () => {
		if (!fbAuth || !fbDb || !emailInput || !passwordInput) {
			return;
		}
		clearAuthError();
		const email = emailInput.value;
		const password = passwordInput.value;
		if (!email || !password) {
			showAuthError("Email and password are required.");
			return;
		}
		try {
			const userCredential = await createUserWithEmailAndPassword(
				fbAuth,
				email,
				password
			);
			await setDoc(doc(fbDb, "users", userCredential.user.uid), {
				email: userCredential.user.email,
				subscriptionStatus: "free",
				stripeCustomerId: "",
				stripeSubscriptionId: "",
				subscribedTierPriceId: "",
			});
		} catch (e) {
			const error = e as Error;
			showAuthError(error.message);
		}
	});
}

if (signInButton) {
	signInButton.addEventListener("click", async () => {
		if (!fbAuth || !emailInput || !passwordInput) {
			return;
		}
		clearAuthError();
		const email = emailInput.value;
		const password = passwordInput.value;
		if (!email || !password) {
			showAuthError("Email and password are required.");
			return;
		}
		try {
			await signInWithEmailAndPassword(fbAuth, email, password);
		} catch (e) {
			const error = e as Error;
			showAuthError(error.message);
		}
	});
}

if (signOutButton) {
	signOutButton.addEventListener("click", async () => {
		if (!fbAuth) {
			return;
		}
		try {
			await signOut(fbAuth);
		} catch (e) {
			const error = e as Error;
			showAuthError(error.message);
		}
	});
}

if (manageSubscriptionButton) {
	manageSubscriptionButton.addEventListener("click", async () => {
		if (currentFirebaseUser && fbDb) {
			const userDocRef = doc(fbDb, "users", currentFirebaseUser.uid);
			const docSnap = await getDoc(userDocRef);
			if (docSnap.exists()) {
				const userData = docSnap.data() as UserSubscriptionData;
				if (userData.stripeCustomerId) {
					const portalLink = `http://localhost:3000/profile/dashboard/${currentFirebaseUser.uid}`;
					vscode.postMessage({ command: "openUrl", url: portalLink });
				} else {
					showAuthError(
						"Stripe Customer ID not found. Cannot manage subscription directly."
					);
					vscode.postMessage({
						command: "openUrl",
						url: "http://minovativemind.dev/registration/signin",
					}); // Link to pricing/subscribe page
				}
			} else {
				showAuthError("User data not found. Cannot manage subscription.");
			}
		} else {
			showAuthError("Not signed in. Cannot manage subscription.");
		}
	});
}

// --- Event Listeners for Original Buttons ---
if (apiUsageButton) {
	apiUsageButton.addEventListener("click", () => {
		vscode.postMessage({
			type: "openUrl", // Ensure command type is consistent if SettingsProvider expects "command"
			command: "openUrl", // Adding this for consistency with other messages
			url: "https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas",
		});
	});
} else {
	console.warn("API Usage button not found.");
}

if (minovativeMindWebsiteButton) {
	minovativeMindWebsiteButton.addEventListener("click", () => {
		vscode.postMessage({
			type: "openUrl",
			command: "openUrl",
			url: "https://minovativemind.dev",
		});
	});
} else {
	console.warn("Minovative Mind Website button not found.");
}

// --- Handle messages from the extension ---
window.addEventListener("message", (event) => {
	const message = event.data as SettingsWebviewIncomingMessage; // Updated type as per instruction
	console.log(`[SettingsWebview] Message from extension: ${message.command}`);
	switch (message.command) {
		case "initialize":
			console.log(
				`[SettingsWebview] Message from extension: ${message.command}`
			); // Added as per instruction
			if (authLoadingDiv) {
				authLoadingDiv.style.display = "block"; // Ensured as per instruction
			}
			initializeFirebase(message.firebaseConfig);
			break;
		// Add other message handlers if extension needs to push data to settings
	}
});

// --- Initial UI state ---
if (authLoadingDiv) {
	authLoadingDiv.style.display = "block";
}
if (userInfoDiv) {
	userInfoDiv.style.display = "none";
}
if (authFormsDiv) {
	authFormsDiv.style.display = "none";
}
if (subscriptionLoadingSpinner) {
	subscriptionLoadingSpinner.style.display = "none";
}

// Post message to extension indicating webview is ready to receive commands
const sendReadyMessage = () => {
	vscode.postMessage({ command: "settingsWebviewReady" });
	console.log("[SettingsWebview] Posted 'settingsWebviewReady' message.");
};

// Add DOMContentLoaded listener and fallback check as per instruction
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", sendReadyMessage);
} else {
	// DOM is already ready or interactive, send message immediately
	sendReadyMessage();
}

// The webview is ready and will listen for the "initialize" message
// which contains the Firebase config.
console.log("[SettingsWebview] Script loaded. Waiting for initialize message.");

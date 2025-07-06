import { initializeApp, FirebaseApp } from "firebase/app";
import {
	getAuth,
	Auth,
	User,
	signInWithEmailAndPassword,
	onAuthStateChanged,
	signOut,
} from "firebase/auth";
import {
	getFirestore,
	Firestore,
	doc,
	onSnapshot,
	Unsubscribe,
} from "firebase/firestore";
import { FirebaseConfigPayload } from "../sidebar/common/sidebarTypes";

export type FirebaseUser = User;

export const firebaseConfig = {
	apiKey: "AIzaSyDHhKj6_dF-WaUSwE7Ma2Mvjj4MWENiVko",
	authDomain: "minovative-mind.firebaseapp.com",
	projectId: "minovative-mind",
	storageBucket: "minovative-mind.firebasestorage.app",
	messagingSenderId: "752295179042",
	appId: "1:752295179042:web:1ec7c527a7a91be7b5ab7b",
	measurementId: "G-GBDQZ8CPM9",
};

let app: FirebaseApp;
export let auth: Auth;
let db: Firestore;
let unsubscribeFirestoreListener: Unsubscribe | null = null;

// Module-level variables for initial load promise and state tracking
let initialLoadPromise: Promise<void> | null = null;
let resolveInitialLoad: (() => void) | null = null;
let hasFirstAuthStateSet = false;
let onAuthStateChangedFirstFire = true; // New module-level flag

/**
 * Initializes Firebase and sets up auth state and Firestore subscription listeners.
 * @returns A Promise that resolves once the initial authentication state and subscription data has been processed.
 */
export const initializeFirebase = (): Promise<void> => {
	if (initialLoadPromise) {
		console.warn(
			"Firebase app initialization already in progress or completed."
		);
		return initialLoadPromise;
	}

	initialLoadPromise = new Promise<void>((resolve) => {
		resolveInitialLoad = resolve;

		let timeoutId: NodeJS.Timeout; // Declare timeoutId

		// Create a new helper function named safeResolve within the initializeFirebase function's scope.
		const safeResolve = () => {
			if (!hasFirstAuthStateSet) {
				// Ensure it's only called once
				hasFirstAuthStateSet = true;
				resolveInitialLoad?.();
				if (timeoutId) {
					// Clear the timeout if it exists
					clearTimeout(timeoutId);
				}
				console.log(
					"[FirebaseService] Initial Firebase load promise resolved."
				);
			}
		};

		// Introduce a setTimeout call at the very beginning of the Promise constructor for 15 seconds.
		timeoutId = setTimeout(() => {
			if (!hasFirstAuthStateSet) {
				console.log(
					"[FirebaseService] Failsafe: Initial Firebase load timed out after 15 seconds. Resolving with default state."
				);
				// Call onAuthStateChangeCallback with default free state
				safeResolve(); // Resolve using the safeResolve helper
			}
		}, 15000); // 15 seconds

		try {
			app = initializeApp(firebaseConfig);
			auth = getAuth(app);
			db = getFirestore(app);

			onAuthStateChanged(auth, async (user) => {
				if (unsubscribeFirestoreListener) {
					unsubscribeFirestoreListener(); // Clean up previous listener
					unsubscribeFirestoreListener = null;
				}

				if (user) {
					// User signed in. Set up Firestore listener for user's subscription data.
					const userDocRef = doc(db, "users", user.uid);

					unsubscribeFirestoreListener = onSnapshot(
						userDocRef,
						(docSnapshot) => {
							console.log(
								"[FirebaseService] Resolving: User signed in, Firestore snapshot received."
							);
							// Check onAuthStateChangedFirstFire
							if (onAuthStateChangedFirstFire) {
								safeResolve();
								onAuthStateChangedFirstFire = false;
							}
						},
						(error) => {
							console.error("Error listening to user document:", error);
							// Resolve the promise after the first onSnapshot errors
							console.log(
								"[FirebaseService] Resolving: User signed in, Firestore snapshot error."
							);
							// Check onAuthStateChangedFirstFire
							if (onAuthStateChangedFirstFire) {
								safeResolve();
								onAuthStateChangedFirstFire = false;
							}
						}
					);
				} else {
					// User signed out.
					console.log("[FirebaseService] Resolving: No user signed in.");
					// Check onAuthStateChangedFirstFire
					if (onAuthStateChangedFirstFire) {
						safeResolve();
						onAuthStateChangedFirstFire = false;
					}
				}
			});

			console.log("Firebase initialized successfully.");
		} catch (error) {
			console.error("Error initializing Firebase:", error);
			// Ensure the promise resolves even if Firebase initialization itself fails
			console.log(
				"[FirebaseService] Resolving: Firebase initialization failed."
			);
			safeResolve();
		}
	});

	return initialLoadPromise;
};

/**
 * Retrieves the Firebase configuration payload.
 * @returns The FirebaseConfigPayload object.
 */
export const getFirebaseConfig = (): FirebaseConfigPayload => {
	return { ...firebaseConfig }; // Return a copy to prevent external modification
};

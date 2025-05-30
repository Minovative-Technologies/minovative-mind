import { initializeApp, FirebaseApp } from "firebase/app";
import {
	getAuth,
	Auth,
	User,
	signInWithEmailAndPassword,
	createUserWithEmailAndPassword,
	onAuthStateChanged,
	signOut,
} from "firebase/auth";
import {
	getFirestore,
	Firestore,
	doc,
	onSnapshot,
	setDoc,
	Timestamp,
	Unsubscribe,
} from "firebase/firestore";
import {
	FirebaseConfigPayload,
	UserSubscriptionData,
} from "../sidebar/common/sidebarTypes";

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
 * @param onAuthStateChangeCallback Callback function invoked on auth state or subscription data changes.
 * @returns A Promise that resolves once the initial authentication state and subscription data has been processed.
 */
export const initializeFirebase = (
	onAuthStateChangeCallback: (
		user: FirebaseUser | null,
		subscriptionData: UserSubscriptionData | null
	) => void
): Promise<void> => {
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
				onAuthStateChangeCallback(null, {
					subscriptionStatus: "free",
					subscriptionPeriodEnd: null,
					email: "",
					uid: "",
				});
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
							let subscriptionData: UserSubscriptionData | null = null;
							if (docSnapshot.exists()) {
								subscriptionData = docSnapshot.data() as UserSubscriptionData;
							} else {
								// Document doesn't exist, potentially a new user. Create it.
								subscriptionData = {
									subscriptionStatus: "free",
									subscriptionPeriodEnd: null, // MODIFICATION 1: Ensure subscriptionPeriodEnd is null
									email: user.email || "",
									uid: user.uid,
								};
								setDoc(
									userDocRef,
									{
										subscriptionStatus: "free",
										subscriptionPeriodEnd: null,
										email: user.email || "",
									},
									{ merge: true }
								)
									.then(() => {
										console.log("Created user doc for new user:", user.uid);
									})
									.catch((error) => {
										console.error("Error creating user doc:", error);
									});
							}
							onAuthStateChangeCallback(user, subscriptionData);
							// Resolve the promise after the first onSnapshot fires successfully
							console.log(
								"[FirebaseService] Resolving: User signed in, Firestore snapshot received."
							);
							// MODIFICATION: Check onAuthStateChangedFirstFire
							if (onAuthStateChangedFirstFire) {
								safeResolve(); // MODIFICATION 2: Replaced direct resolve
								onAuthStateChangedFirstFire = false;
							}
						},
						(error) => {
							console.error("Error listening to user document:", error);
							onAuthStateChangeCallback(user, null); // Still pass user, but no subscription data
							// Resolve the promise after the first onSnapshot errors
							console.log(
								"[FirebaseService] Resolving: User signed in, Firestore snapshot error."
							);
							// MODIFICATION: Check onAuthStateChangedFirstFire
							if (onAuthStateChangedFirstFire) {
								safeResolve(); // MODIFICATION 2: Replaced direct resolve
								onAuthStateChangedFirstFire = false;
							}
						}
					);
				} else {
					// User signed out.
					onAuthStateChangeCallback(null, null);
					// Resolve the promise immediately if no user is signed in
					console.log("[FirebaseService] Resolving: No user signed in.");
					// MODIFICATION: Check onAuthStateChangedFirstFire
					if (onAuthStateChangedFirstFire) {
						safeResolve(); // MODIFICATION 2: Replaced direct resolve
						onAuthStateChangedFirstFire = false;
					}
				}
			});

			console.log("Firebase initialized successfully.");
		} catch (error) {
			console.error("Error initializing Firebase:", error);
			// Ensure the promise resolves even if Firebase initialization itself fails
			onAuthStateChangeCallback(null, null); // MODIFICATION 2: Ensure callback is called on init failure
			console.log(
				"[FirebaseService] Resolving: Firebase initialization failed."
			);
			safeResolve(); // MODIFICATION 2: Replaced direct resolve
		}
	});

	return initialLoadPromise;
};

/**
 * Signs in a user with email and password.
 * @param email User's email.
 * @param password User's password.
 * @returns Promise that resolves with the user credential.
 */
export const signIn = async (
	email: string,
	password: string
): Promise<User> => {
	if (!auth) {
		throw new Error(
			"Firebase Auth not initialized. Call initializeFirebase first."
		);
	}
	try {
		const userCredential = await signInWithEmailAndPassword(
			auth,
			email,
			password
		);
		return userCredential.user;
	} catch (error) {
		console.error("Error signing in:", error);
		throw error;
	}
};

/**
 * Signs up a new user with email and password.
 * @param email User's email.
 * @param password User's password.
 * @returns Promise that resolves with the user credential.
 */
export const signUp = async (
	email: string,
	password: string
): Promise<User> => {
	if (!auth) {
		throw new Error(
			"Firebase Auth not initialized. Call initializeFirebase first."
		);
	}
	try {
		const userCredential = await createUserWithEmailAndPassword(
			auth,
			email,
			password
		);
		// Optionally create an initial user document in Firestore upon sign up
		await setDoc(
			doc(db, "users", userCredential.user.uid),
			{
				email: userCredential.user.email,
				createdAt: Timestamp.now(),
				subscriptionStatus: "free",
				subscriptionPeriodEnd: null,
			},
			{ merge: true }
		);
		return userCredential.user;
	} catch (error) {
		console.error("Error signing up:", error);
		throw error;
	}
};

/**
 * Signs out the current user.
 * @returns Promise that resolves when the user is signed out.
 */
export const signOutUser = async (): Promise<void> => {
	if (!auth) {
		throw new Error(
			"Firebase Auth not initialized. Call initializeFirebase first."
		);
	}

	try {
		await signOut(auth);
		if (unsubscribeFirestoreListener) {
			unsubscribeFirestoreListener(); // Clean up listener on sign out
			unsubscribeFirestoreListener = null;
		}
		console.log("User signed out successfully.");
	} catch (error) {
		console.error("Error signing out:", error);
		throw error;
	}
};

/**
 * Retrieves the Firebase configuration payload.
 * @returns The FirebaseConfigPayload object.
 */
export const getFirebaseConfig = (): FirebaseConfigPayload => {
	return { ...firebaseConfig }; // Return a copy to prevent external modification
};

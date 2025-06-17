// src/services/authService.ts
import * as vscode from "vscode";
import { SidebarProvider } from "../sidebar/SidebarProvider";
import {
	getFirebaseConfig,
	signIn,
	signOutUser,
} from "../firebase/firebaseService";

export class AuthService {
	constructor(private provider: SidebarProvider) {}

	public async triggerSignIn(email: string, password: string): Promise<void> {
		try {
			await signIn(email, password);
			vscode.window.showInformationMessage("Sign-in successful!");
		} catch (error: any) {
			vscode.window.showErrorMessage(`Sign-in failed: ${error.message}`);
		}
	}

	public async triggerSignOut(): Promise<void> {
		try {
			await signOutUser();
			vscode.window.showInformationMessage("Signed out successfully!");
		} catch (error: any) {
			vscode.window.showErrorMessage(`Sign-out failed: ${error.message}`);
		}
	}

	public async openStripeCustomerPortal(): Promise<void> {
		try {
			if (!this.provider.userUid) {
				throw new Error("User not signed in or UID not available.");
			}

			const firebaseConfig = await getFirebaseConfig();
			if (!firebaseConfig) {
				throw new Error("Firebase configuration not available.");
			}

			// NOTE: The original code had an empty string for the URL.
			// You need to construct the correct Stripe portal link here.
			// Example placeholder:
			const portalUrl = `https://your-functions-url/create-portal-link?uid=${this.provider.userUid}`;

			await vscode.env.openExternal(vscode.Uri.parse(portalUrl));
			vscode.window.showInformationMessage("Opening Stripe Customer Portal...");
		} catch (error: any) {
			vscode.window.showErrorMessage(
				`Failed to open Stripe portal: ${error.message}`
			);
		}
	}
}

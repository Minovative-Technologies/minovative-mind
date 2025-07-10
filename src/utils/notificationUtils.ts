// src/utils/notificationUtils.ts
import * as vscode from "vscode";
import { formatUserFacingErrorMessage } from "./errorFormatter";

/**
 * Displays an information message to the user as a VS Code notification.
 * @param message The message to display.
 * @param items Optional string items for actionable buttons.
 * @returns A promise that resolves to the selected item or undefined if dismissed.
 */
export function showInfoNotification(
	message: string,
	...items: string[]
): Thenable<string | undefined> {
	return vscode.window.showInformationMessage(message, ...items);
}

/**
 * Displays a warning message to the user as a VS Code notification.
 * @param message The message to display.
 * @param items Optional string items for actionable buttons.
 * @returns A promise that resolves to the selected item or undefined if dismissed.
 */
export function showWarningNotification(
	message: string,
	...items: string[]
): Thenable<string | undefined> {
	return vscode.window.showWarningMessage(message, ...items);
}

/**
 * Displays an error message to the user as a critical VS Code notification.
 * This function should be used for critical errors that require immediate user attention.
 * It will format the error message using `formatUserFacingErrorMessage` for readability.
 * @param error The raw error object (can be Error, string, or unknown) or an already formatted string.
 * @param defaultMessage A fallback message if `error` cannot be parsed meaningfully.
 * @param contextPrefix Optional context string to prepend (e.g., "File access failed: ").
 * @param workspaceRootUri Optional workspace root URI for path sanitization.
 * @param items Optional string items for actionable buttons.
 * @returns A promise that resolves to the selected item or undefined if dismissed.
 */
export function showErrorNotification(
	error: any,
	defaultMessage: string = "An unexpected error occurred. Please try again.",
	contextPrefix: string = "",
	workspaceRootUri?: vscode.Uri,
	...items: string[]
): Thenable<string | undefined> {
	const formattedMessage = formatUserFacingErrorMessage(
		error,
		defaultMessage,
		contextPrefix,
		workspaceRootUri
	);
	return vscode.window.showErrorMessage(
		`Minovative Mind: ${formattedMessage}`,
		...items
	);
}

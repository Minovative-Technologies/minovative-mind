import { setIconForButton } from "../utils/iconHelpers";
import { faCheck, faTimes, faRedo } from "@fortawesome/free-solid-svg-icons";
import { postMessageToExtension as vscodePostMessageToExtension } from "../utils/vscodeApi";
import { appState } from "../state/appState";
import { updateStatus } from "./statusManager";
import { PendingPlanData, RequiredDomElements } from "../types/webviewTypes";

/**
 * Dynamically creates and initializes the plan confirmation UI elements if they don't already exist.
 * Attaches event listeners for confirm and cancel actions.
 * This function should only be called once during initialization or when needed to create the UI.
 * @param elements An object containing references to all required static DOM elements, which will be updated with dynamically created ones.
 * @param postMessageToExtension A function to post messages back to the VS Code extension.
 * @param updateStatus A function to update the webview's status display.
 * @param setLoadingState A function to control the overall loading state of the UI.
 */
export function createPlanConfirmationUI(
	elements: RequiredDomElements,
	postMessageToExtension: Function,
	updateStatus: Function,
	setLoadingState: Function
): void {
	// Check if the container is already created and stored in the elements object
	if (!elements.planConfirmationContainer) {
		elements.planConfirmationContainer = document.createElement("div");
		elements.planConfirmationContainer.id = "plan-confirmation-container";
		elements.planConfirmationContainer.style.display = "none"; // Initially hidden

		const textElement = document.createElement("p");
		textElement.textContent = "Review plan and confirm to proceed?";

		elements.confirmPlanButton = document.createElement("button");
		elements.confirmPlanButton.id = "confirm-plan-button";
		elements.confirmPlanButton.title = "Confirm Plan";
		elements.confirmPlanButton.textContent = "Confirm"; // Add text for accessibility/fallback

		elements.cancelPlanButton = document.createElement("button");
		elements.cancelPlanButton.id = "cancel-plan-button";
		elements.cancelPlanButton.title = "Cancel Plan";
		elements.cancelPlanButton.textContent = "Cancel"; // Add text for accessibility/fallback

		elements.planConfirmationContainer.appendChild(textElement);
		elements.planConfirmationContainer.appendChild(elements.confirmPlanButton);
		elements.planConfirmationContainer.appendChild(elements.cancelPlanButton);

		// Insert the new container after the chat container in the DOM
		elements.chatContainer.insertAdjacentElement(
			"afterend",
			elements.planConfirmationContainer
		);

		setIconForButton(elements.confirmPlanButton, faCheck);
		setIconForButton(elements.cancelPlanButton, faTimes);

		// Attach event listeners to the buttons
		elements.confirmPlanButton.addEventListener("click", () =>
			handleConfirmPlanExecution(
				elements,
				postMessageToExtension,
				updateStatus,
				setLoadingState
			)
		);
		elements.cancelPlanButton.addEventListener("click", () =>
			handleCancelPlanExecution(
				elements,
				postMessageToExtension,
				updateStatus,
				setLoadingState
			)
		);

		console.log("Plan confirmation UI created and event listeners attached.");
	}
}

/**
 * Displays the plan confirmation UI with the provided pending plan data.
 * It ensures the UI elements are created (if not already), updates appState,
 * and sets the correct visibility and loading states.
 * @param elements An object containing references to all required DOM elements.
 * @param pendingPlanData The data for the plan that needs confirmation.
 * @param postMessageToExtension A function to post messages back to the VS Code extension.
 * @param updateStatus A function to update the webview's status display.
 * @param setLoadingState A function to control the overall loading state of the UI.
 */
export function showPlanConfirmationUI(
	elements: RequiredDomElements,
	pendingPlanData: PendingPlanData,
	postMessageToExtension: Function,
	updateStatus: Function,
	setLoadingState: Function
): void {
	// Ensure the UI elements are created first. This function is idempotent.
	createPlanConfirmationUI(
		elements,
		postMessageToExtension,
		updateStatus,
		setLoadingState
	);

	if (elements.planConfirmationContainer) {
		appState.pendingPlanData = pendingPlanData; // Update appState with pending data
		elements.planConfirmationContainer.style.display = "flex";
		updateStatus(
			elements,
			"Textual plan generated. Review and confirm to proceed."
		);
		setLoadingState(false, elements);
		// Hide the global cancel generation button when a specific confirmation UI is shown
		if (elements.cancelGenerationButton) {
			elements.cancelGenerationButton.style.display = "none";
		}
		console.log("Plan confirmation UI shown.");
	} else {
		console.error("Plan confirmation container not found for showing.");
		updateStatus(elements, "Error: UI for plan confirmation is missing.", true);
		setLoadingState(false, elements); // Ensure inputs are re-enabled if UI fails to show
	}
}

/**
 * Hides the plan confirmation UI and clears any pending plan data from appState.
 * @param elements An object containing references to all required DOM elements.
 */
export function hidePlanConfirmationUI(elements: RequiredDomElements): void {
	if (elements.planConfirmationContainer) {
		elements.planConfirmationContainer.style.display = "none";
		appState.pendingPlanData = null; // Clear the pending data
		updateStatus(elements, "Plan confirmation UI hidden.");
		console.log("Plan confirmation UI hidden.");
	}
}

/**
 * Updates the disabled state of the commit button based on whether the commit message textarea is empty.
 * @param elements An object containing references to the commit message textarea and confirm button.
 */
export function updateCommitButtonState(elements: RequiredDomElements): void {
	if (elements.commitMessageTextarea && elements.confirmCommitButton) {
		const trimmedMessage = elements.commitMessageTextarea.value.trim();
		elements.confirmCommitButton.disabled = trimmedMessage === "";
		console.log(
			`Commit button state updated. Disabled: ${elements.confirmCommitButton.disabled}`
		);
	} else {
		console.warn(
			"Commit message textarea or confirm commit button not found for state update."
		);
	}
}

/**
 * Displays the plan parse error UI with the given error message and failed JSON content.
 * Also manages loading state and status messages.
 * @param elements An object containing references to the plan parse error UI DOM elements.
 * @param error The error message to display.
 * @param failedJson The raw JSON string that failed to parse.
 * @param postMessageToExtension A function to post messages back to the VS Code extension.
 * @param updateStatus A function to update the webview's status display.
 * @param setLoadingState A function to control the overall loading state of the UI.
 */
export function showPlanParseErrorUI(
	elements: RequiredDomElements,
	error: string,
	failedJson: string,
	postMessageToExtension: Function,
	updateStatus: Function,
	setLoadingState: Function
): void {
	const {
		planParseErrorContainer,
		planParseErrorDisplay,
		failedJsonDisplay,
		retryGenerationButton,
		cancelParseErrorButton,
	} = elements;

	if (planParseErrorContainer && planParseErrorDisplay && failedJsonDisplay) {
		planParseErrorDisplay.textContent = error;
		failedJsonDisplay.textContent = failedJson;
		planParseErrorContainer.style.display = "block";
		updateStatus(
			elements,
			"Structured plan parsing failed. Review error and retry or cancel.",
			true
		);
		setLoadingState(false, elements);

		// Only attach listeners once
		if (
			retryGenerationButton &&
			!retryGenerationButton.dataset.listenerAttached
		) {
			setIconForButton(retryGenerationButton, faRedo);
			retryGenerationButton.addEventListener("click", () =>
				handleRetryStructuredPlanGeneration(
					elements,
					postMessageToExtension,
					updateStatus,
					setLoadingState
				)
			);
			retryGenerationButton.dataset.listenerAttached = "true";
		}
		if (
			cancelParseErrorButton &&
			!cancelParseErrorButton.dataset.listenerAttached
		) {
			setIconForButton(cancelParseErrorButton, faTimes);
			cancelParseErrorButton.addEventListener("click", () =>
				handleCancelPlanExecution(
					elements,
					postMessageToExtension,
					updateStatus,
					setLoadingState
				)
			); // Reuse plan cancel handler
			cancelParseErrorButton.dataset.listenerAttached = "true";
		}

		// Hide the global cancel generation button when a specific error UI is shown
		if (elements.cancelGenerationButton) {
			elements.cancelGenerationButton.style.display = "none";
		}

		console.log("Plan parse error UI shown.");
	} else {
		console.error("Missing elements to display plan parse error UI.");
		updateStatus(
			elements,
			"Error: Failed to display plan parsing error details.",
			true
		);
		setLoadingState(false, elements);
	}
}

/**
 * Hides the plan parse error UI and clears its content.
 * @param elements An object containing references to the plan parse error UI DOM elements.
 */
export function hidePlanParseErrorUI(elements: RequiredDomElements): void {
	const { planParseErrorContainer, planParseErrorDisplay, failedJsonDisplay } =
		elements;
	if (planParseErrorContainer) {
		planParseErrorContainer.style.display = "none";
		if (planParseErrorDisplay) {
			planParseErrorDisplay.textContent = "";
		}
		if (failedJsonDisplay) {
			failedJsonDisplay.textContent = "";
		}
		console.log("Plan parse error UI hidden.");
	}
}

/**
 * Displays the commit review UI with the provided commit message and staged files.
 * Manages loading state and status messages.
 * @param elements An object containing references to the commit review UI DOM elements.
 * @param commitMessage The proposed commit message.
 * @param stagedFiles An array of staged file paths.
 * @param postMessageToExtension A function to post messages back to the VS Code extension.
 * @param updateStatus A function to update the webview's status display.
 * @param setLoadingState A function to control the overall loading state of the UI.
 */
export function showCommitReviewUI(
	elements: RequiredDomElements,
	commitMessage: string,
	stagedFiles: string[],
	postMessageToExtension: Function,
	updateStatus: Function,
	setLoadingState: Function
): void {
	const {
		commitReviewContainer,
		commitMessageTextarea,
		stagedFilesList,
		confirmCommitButton,
		cancelCommitButton,
	} = elements;

	if (
		commitReviewContainer &&
		commitMessageTextarea &&
		stagedFilesList &&
		confirmCommitButton &&
		cancelCommitButton
	) {
		commitMessageTextarea.value = commitMessage;
		// Ensure focus and scroll to top of textarea after it's potentially visible
		setTimeout(() => {
			commitMessageTextarea.focus();
			commitMessageTextarea.scrollTop = 0;
		}, 0);

		updateCommitButtonState(elements); // Call with elements

		stagedFilesList.innerHTML = "";
		if (stagedFiles && stagedFiles.length > 0) {
			stagedFiles.forEach((file) => {
				const li = document.createElement("li");
				li.textContent = file;
				stagedFilesList.appendChild(li);
			});
		} else {
			const li = document.createElement("li");
			li.textContent = "No files to commit.";
			li.style.fontStyle = "italic";
			stagedFilesList.appendChild(li);
		}

		commitReviewContainer.style.display = "flex";
		// Scroll to the bottom of the document to ensure the commit review UI is visible
		document.documentElement.scrollTop = document.documentElement.scrollHeight;
		updateStatus(elements, "Review commit details and confirm.", false);
		setLoadingState(false, elements);

		// Hide the global cancel generation button when a specific review UI is shown
		if (elements.cancelGenerationButton) {
			elements.cancelGenerationButton.style.display = "none";
		}

		// Attach event listeners to buttons if not already attached
		if (!confirmCommitButton.dataset.listenerAttached) {
			setIconForButton(confirmCommitButton, faCheck);
			confirmCommitButton.addEventListener("click", () =>
				handleConfirmCommit(
					elements,
					postMessageToExtension,
					updateStatus,
					setLoadingState
				)
			);
			confirmCommitButton.dataset.listenerAttached = "true";
		}
		if (!cancelCommitButton.dataset.listenerAttached) {
			setIconForButton(cancelCommitButton, faTimes);
			cancelCommitButton.addEventListener("click", () =>
				handleCancelCommit(
					elements,
					postMessageToExtension,
					updateStatus,
					setLoadingState
				)
			);
			cancelCommitButton.dataset.listenerAttached = "true";
		}

		console.log("Commit review UI shown.");
	} else {
		console.error("Missing elements to display commit review UI.");
		updateStatus(elements, "Error: Failed to display commit review UI.", true);
		setLoadingState(false, elements);
	}
}

/**
 * Hides the commit review UI.
 * @param elements An object containing a reference to the commit review container.
 */
export function hideCommitReviewUI(elements: RequiredDomElements): void {
	const { commitReviewContainer } = elements;
	if (commitReviewContainer) {
		commitReviewContainer.style.display = "none";
		console.log("Commit review UI hidden.");
	}
}

/**
 * Hides all confirmation and review UIs (plan confirmation, plan parse error, and commit review).
 * This is useful for resetting the UI state, e.g., when a new chat interaction begins.
 * @param elements An object containing references to all required DOM elements.
 */
export function hideAllConfirmationAndReviewUIs(
	elements: RequiredDomElements
): void {
	hidePlanConfirmationUI(elements);
	hidePlanParseErrorUI(elements);
	hideCommitReviewUI(elements);
	console.log("All confirmation and review UIs hidden.");
}

/**
 * Handles the confirmation of a plan execution.
 * Sends a message to the extension and updates the UI state.
 * @param elements An object containing references to all required DOM elements.
 * @param postMessageToExtension A function to post messages back to the VS Code extension.
 * @param updateStatus A function to update the webview's status display.
 * @param setLoadingState A function to control the overall loading state of the UI.
 */
export function handleConfirmPlanExecution(
	elements: RequiredDomElements,
	postMessageToExtension: Function,
	updateStatus: Function,
	setLoadingState: Function
): void {
	console.log("Confirm Plan button clicked.");
	if (appState.pendingPlanData && elements.planConfirmationContainer) {
		postMessageToExtension({
			type: "confirmPlanExecution",
			value: appState.pendingPlanData,
		});
		updateStatus(elements, "Requesting plan execution...");
		elements.planConfirmationContainer.style.display = "none";
		appState.pendingPlanData = null;
		setLoadingState(true, elements);
	} else {
		updateStatus(elements, "Error: No pending plan data to confirm.", true);
		setLoadingState(false, elements); // Ensure UI is re-enabled if no plan data
	}
}

/**
 * Handles the cancellation of a plan execution.
 * Sends a message to the extension and updates the UI state.
 * @param elements An object containing references to all required DOM elements.
 * @param postMessageToExtension A function to post messages back to the VS Code extension.
 * @param updateStatus A function to update the webview's status display.
 * @param setLoadingState A function to control the overall loading state of the UI.
 */
export function handleCancelPlanExecution(
	elements: RequiredDomElements,
	postMessageToExtension: Function,
	updateStatus: Function,
	setLoadingState: Function
): void {
	console.log("Cancel Plan button clicked.");
	postMessageToExtension({ type: "cancelPlanExecution" });
	updateStatus(elements, "Plan cancelled.");
	if (elements.planConfirmationContainer) {
		elements.planConfirmationContainer.style.display = "none";
	}
	// Also ensure plan parse error UI is hidden if user cancels from there
	if (elements.planParseErrorContainer) {
		elements.planParseErrorContainer.style.display = "none"; // Explicitly set to 'none'
		if (elements.planParseErrorDisplay) {
			elements.planParseErrorDisplay.textContent = "";
		}
		if (elements.failedJsonDisplay) {
			elements.failedJsonDisplay.textContent = "";
		}
	}
	appState.pendingPlanData = null; // Clear pending plan data regardless of which UI it came from
	setLoadingState(false, elements);
}

/**
 * Handles the retry action after a structured plan parsing failure.
 * Hides the error UI, sends a retry message to the extension, and updates loading state.
 * @param elements An object containing references to all required DOM elements.
 * @param postMessageToExtension A function to post messages back to the VS Code extension.
 * @param updateStatus A function to update the webview's status display.
 * @param setLoadingState A function to control the overall loading state of the UI.
 */
export function handleRetryStructuredPlanGeneration(
	elements: RequiredDomElements,
	postMessageToExtension: Function,
	updateStatus: Function,
	setLoadingState: Function
): void {
	console.log("Retry Generation button clicked.");
	hidePlanParseErrorUI(elements);
	postMessageToExtension({ type: "retryStructuredPlanGeneration" });
	updateStatus(elements, "Retrying structured plan generation...");
	setLoadingState(true, elements);
}

/**
 * Handles the confirmation of a Git commit.
 * Reads the commit message, hides the UI, and sends a message to the extension.
 * @param elements An object containing references to all required DOM elements.
 * @param postMessageToExtension A function to post messages back to the VS Code extension.
 * @param updateStatus A function to update the webview's status display.
 * @param setLoadingState A function to control the overall loading state of the UI.
 */
export function handleConfirmCommit(
	elements: RequiredDomElements,
	postMessageToExtension: Function,
	updateStatus: Function,
	setLoadingState: Function
): void {
	console.log("Confirm Commit button clicked.");
	hideCommitReviewUI(elements);
	const editedMessage = elements.commitMessageTextarea?.value || "";
	postMessageToExtension({ type: "confirmCommit", value: editedMessage });
	updateStatus(elements, "Committing changes...", false);
	setLoadingState(true, elements);
}

/**
 * Handles the cancellation of a Git commit.
 * Hides the UI and sends a message to the extension.
 * @param elements An object containing references to all required DOM elements.
 * @param postMessageToExtension A function to post messages back to the VS Code extension.
 * @param updateStatus A function to update the webview's status display.
 * @param setLoadingState A function to control the overall loading state of the UI.
 */
export function handleCancelCommit(
	elements: RequiredDomElements,
	postMessageToExtension: Function,
	updateStatus: Function,
	setLoadingState: Function
): void {
	console.log("Cancel Commit button clicked.");
	hideCommitReviewUI(elements);
	postMessageToExtension({ type: "cancelCommit" });
	updateStatus(elements, "Commit cancelled by user.", false);
	setLoadingState(false, elements);
}

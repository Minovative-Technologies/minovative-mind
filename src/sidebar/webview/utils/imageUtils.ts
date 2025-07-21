interface FileBase64Data {
	mimeType: string;
	data: string;
}

/**
 * Reads a File object and returns a Promise resolving with its mimeType and Base64 encoded data.
 *
 * @param file The File object to read.
 * @returns A Promise that resolves with an object containing the mimeType and Base64 encoded data, or rejects if an error occurs during reading.
 */
export function readFileAsBase64(file: File): Promise<FileBase64Data> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = () => {
			if (typeof reader.result === "string") {
				// Expected format: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA..."
				const parts = reader.result.split(";base64,");
				const mimeType =
					file.type ||
					(parts.length > 1
						? parts[0].split(":")[1]
						: "application/octet-stream");
				const data = parts.length > 1 ? parts[1] : ""; // Get the Base64 data part

				if (!data) {
					reject(
						new Error("File could not be read as Base64. Data part is empty.")
					);
					return;
				}
				resolve({ mimeType, data });
			} else {
				// This case should ideally not happen with readAsDataURL unless there's an internal FileReader error
				reject(new Error("FileReader result is not a string."));
			}
		};

		reader.onerror = (error) => {
			console.error("Error reading file as Base64:", error);
			reject(
				new Error(
					`Failed to read file: ${
						error?.target?.error?.message || "Unknown error"
					}`
				)
			);
		};

		reader.onabort = () => {
			console.warn("File reading was aborted.");
			reject(new Error("File reading was aborted."));
		};

		try {
			reader.readAsDataURL(file);
		} catch (e: unknown) {
			console.error("Error initiating file read as Base64:", e);
			reject(
				new Error(
					`Could not initiate file read: ${
						e instanceof Error ? e.message : String(e)
					}`
				)
			);
		}
	});
}

/**
 * Creates an image preview in the given container. It uses URL.createObjectURL(file) for the img src,
 * adds a remove button, and calls onRemove when the remove button is clicked.
 * It returns the created preview element wrapper (HTMLDivElement).
 *
 * @param file The File object to create a preview for.
 * @param container The HTMLElement to append the preview to.
 * @param onRemove A callback function to be called when the remove button is clicked, receiving the preview element.
 * @returns The created preview element wrapper (HTMLDivElement).
 */
export function displayImagePreview(
	file: File,
	container: HTMLElement,
	onRemove: (previewElement: HTMLDivElement) => void
): HTMLDivElement {
	const previewWrapper = document.createElement("div");
	previewWrapper.classList.add("image-preview-wrapper");

	const filenameSpan = document.createElement("span");
	filenameSpan.classList.add("image-filename-display");
	filenameSpan.textContent = file.name;

	const removeButton = document.createElement("button");
	removeButton.classList.add("image-preview-remove-button");
	removeButton.textContent = "x"; // Simple 'x' for close
	removeButton.title = `Remove ${file.name}`;

	removeButton.addEventListener("click", () => {
		onRemove(previewWrapper); // Notify the caller which preview was removed
		previewWrapper.remove(); // Remove the element from the DOM
	});

	previewWrapper.appendChild(filenameSpan);
	previewWrapper.appendChild(removeButton);
	container.appendChild(previewWrapper);

	return previewWrapper;
}

/**
 * Removes all child elements from the given container.
 * If a child is an image preview created with `displayImagePreview`,
 * its associated object URL is revoked to prevent memory leaks.
 *
 * @param container The HTMLElement whose children are to be removed.
 */
export function clearImagePreviews(container: HTMLElement): void {
	while (container.firstChild) {
		const child = container.firstChild;
		// Check if the child is a preview wrapper
		if (
			child instanceof HTMLDivElement &&
			child.classList.contains("image-preview-wrapper")
		) {
			// The functionality to revoke object URLs for img.image-preview elements has been removed,
			// as image previews no longer use object URLs (they just display filenames).
		}
		container.removeChild(child);
	}
}

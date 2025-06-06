// src/workflow/ProjectChangeLogger.ts
import { FileChangeEntry } from "../types/workflow";

export class ProjectChangeLogger {
	private changes: FileChangeEntry[] = [];

	/**
	 * Logs a new file change entry.
	 * @param entry The FileChangeEntry object to log.
	 */
	logChange(entry: FileChangeEntry) {
		this.changes.push(entry);
		console.log(
			`[ProjectChangeLogger] Logged change for ${entry.filePath}: ${
				entry.summary.split("\n")[0]
			}...`
		);
	}

	/**
	 * Returns the current array of logged file changes.
	 * @returns An array of FileChangeEntry objects.
	 */
	getChangeLog(): FileChangeEntry[] {
		return [...this.changes]; // Return a shallow copy to prevent external modification
	}

	/**
	 * Clears all logged changes, typically at the start of a new plan execution.
	 */
	clear(): void {
		this.changes = [];
		console.log("[ProjectChangeLogger] Change log cleared.");
	}
}

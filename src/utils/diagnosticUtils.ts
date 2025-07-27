import * as vscode from "vscode";
import * as path from "path";

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getSeverityName(severity: vscode.DiagnosticSeverity): string {
	switch (severity) {
		case vscode.DiagnosticSeverity.Error:
			return "Error";
		case vscode.DiagnosticSeverity.Warning:
			return "Warning";
		case vscode.DiagnosticSeverity.Information:
			return "Info";
		case vscode.DiagnosticSeverity.Hint:
			return "Hint";
		default:
			return "Unknown";
	}
}

export class DiagnosticService {
	/**
	 * Retrieves all diagnostics for a given URI.
	 * @param uri The URI of the document.
	 * @returns An array of vscode.Diagnostic objects.
	 */
	public static getDiagnosticsForUri(uri: vscode.Uri): vscode.Diagnostic[] {
		return vscode.languages.getDiagnostics(uri);
	}

	/**
	 * Filters, prioritizes, and formats diagnostics into a string for AI context.
	 *
	 * @param documentUri The URI of the document to get diagnostics for.
	 * @param workspaceRoot The root URI of the workspace for relative paths.
	 * @param selection An optional vscode.Range representing the user's text selection.
	 * @param maxTotalChars The maximum character length for the output string.
	 * @param maxPerSeverity The maximum number of diagnostics to include per severity level when no selection.
	 * @param token An optional CancellationToken to allow for early cancellation of the operation.
	 * @returns A formatted string of diagnostics, or undefined if no relevant diagnostics.
	 */
	public static async formatContextualDiagnostics(
		documentUri: vscode.Uri,
		workspaceRoot: vscode.Uri,
		selection?: vscode.Range,
		maxTotalChars: number = 25000,
		maxPerSeverity: number = 25,
		token?: vscode.CancellationToken, // Make token optional
		// NEW PARAMETER: Specify which severities to include. Defaults to all.
		includeSeverities: vscode.DiagnosticSeverity[] = [
			vscode.DiagnosticSeverity.Error,
			vscode.DiagnosticSeverity.Warning,
			vscode.DiagnosticSeverity.Information,
			vscode.DiagnosticSeverity.Hint,
		]
	): Promise<string | undefined> {
		const allDiagnostics = DiagnosticService.getDiagnosticsForUri(documentUri);
		if (!allDiagnostics || allDiagnostics.length === 0) {
			return undefined;
		}

		let fileContentLines: string[] | undefined;
		try {
			// Read the content of the document URI asynchronously
			// Removed '{ signal: token.signal }' as it's not supported by vscode.workspace.fs.readFile
			const fileBuffer = await vscode.workspace.fs.readFile(documentUri);
			fileContentLines = Buffer.from(fileBuffer)
				.toString("utf8")
				.split(/\r?\n/);
		} catch (error: any) {
			if (token?.isCancellationRequested) {
				// Use optional chaining
				// Propagate cancellation if it occurred during file read
				throw new Error("Operation cancelled during file content read.");
			}
			// Handle specific FileSystemErrors or other errors gracefully
			if (error instanceof vscode.FileSystemError) {
				if (
					error.code === "FileNotFound" ||
					error.code === "EntryIsDirectory"
				) {
					console.warn(
						`[DiagnosticService] Skipping code snippet for '${documentUri.fsPath}': ${error.message}`
					);
				} else {
					console.error(
						`[DiagnosticService] Error reading file content for snippet '${documentUri.fsPath}': ${error.message}`
					);
				}
			} else {
				console.error(
					`[DiagnosticService] Unexpected error reading file content for snippet '${documentUri.fsPath}': ${error.message}`
				);
			}
			// If file cannot be read, fileContentLines remains undefined, and snippet generation will be skipped.
			fileContentLines = undefined;
		}

		let filteredDiagnostics: vscode.Diagnostic[] = [];

		if (selection) {
			// Scenario 1: User has a selection - prioritize diagnostics within selection
			filteredDiagnostics = allDiagnostics.filter(
				(d) =>
					selection?.intersection(d.range) &&
					includeSeverities.includes(d.severity)
			);
			// Sort by severity (Error > Warning > Info > Hint) and then by line number
			filteredDiagnostics.sort((a, b) => {
				if (a.severity !== b.severity) {
					return a.severity - b.severity; // Lower severity value means higher priority (Error=0, Warning=1...)
				}
				return a.range.start.line - b.range.start.line;
			});
		} else {
			// Scenario 2: No selection (whole file) - filter by includeSeverities
			const relevantDiagnostics = allDiagnostics.filter((d) =>
				includeSeverities.includes(d.severity)
			);

			const errors = relevantDiagnostics.filter(
				(d) => d.severity === vscode.DiagnosticSeverity.Error
			);
			const warnings = relevantDiagnostics.filter(
				(d) => d.severity === vscode.DiagnosticSeverity.Warning
			);
			const infos = relevantDiagnostics.filter(
				(d) => d.severity === vscode.DiagnosticSeverity.Information
			);
			const hints = relevantDiagnostics.filter(
				(d) => d.severity === vscode.DiagnosticSeverity.Hint
			);

			// Sort each group by line number
			errors.sort((a, b) => a.range.start.line - b.range.start.line);
			warnings.sort((a, b) => a.range.start.line - b.range.start.line);
			infos.sort((a, b) => a.range.start.line - b.range.start.line);
			hints.sort((a, b) => a.range.start.line - b.range.start.line);

			// Combine: All errors, then limited warnings (if included), then limited infos (if included), etc.
			filteredDiagnostics.push(...errors);
			if (includeSeverities.includes(vscode.DiagnosticSeverity.Warning)) {
				filteredDiagnostics.push(...warnings.slice(0, maxPerSeverity));
			}
			if (includeSeverities.includes(vscode.DiagnosticSeverity.Information)) {
				filteredDiagnostics.push(...infos.slice(0, maxPerSeverity / 2)); // Half as many infos
			}
			if (includeSeverities.includes(vscode.DiagnosticSeverity.Hint)) {
				filteredDiagnostics.push(...hints.slice(0, maxPerSeverity / 4)); // Even fewer hints
			}
		}

		if (filteredDiagnostics.length === 0) {
			return undefined;
		}

		let diagnosticsString = "--- Relevant Diagnostics ---\n";
		let currentLength = diagnosticsString.length;
		const relativePath = path
			.relative(workspaceRoot.fsPath, documentUri.fsPath)
			.replace(/\\/g, "/");

		for (const diag of filteredDiagnostics) {
			if (token?.isCancellationRequested) {
				// Use optional chaining
				// Stop adding diagnostics if cancellation is requested
				diagnosticsString += `... (${
					filteredDiagnostics.length - filteredDiagnostics.indexOf(diag)
				} more diagnostics truncated due to cancellation)\n`;
				break;
			}

			let diagLine = `- [${getSeverityName(diag.severity)}] ${relativePath}:${
				diag.range.start.line + 1
			}:${diag.range.start.character + 1} - ${diag.message}`; // No newline here yet, add after snippet

			let codeSnippetString = "";
			if (fileContentLines && fileContentLines.length > 0) {
				// Calculate snippet lines, ensuring bounds are respected
				const snippetStartLine = Math.max(0, diag.range.start.line - 5);
				const snippetEndLine = Math.min(
					fileContentLines.length - 1,
					diag.range.end.line + 5
				);

				// Ensure snippetEndLine is not less than snippetStartLine (e.g., for very short files or diagnostics at line 0)
				const actualSnippetEndLine = Math.max(snippetStartLine, snippetEndLine);

				const snippetLines = fileContentLines.slice(
					snippetStartLine,
					actualSnippetEndLine + 1
				);

				// Determine markdown language ID based on file extension
				let languageId = path
					.extname(documentUri.fsPath)
					.substring(1)
					.toLowerCase();
				if (!languageId) {
					// Fallback for files without extension (e.g., Dockerfile, LICENSE)
					languageId = path.basename(documentUri.fsPath).toLowerCase();
				}

				// Map common extensions/filenames to widely recognized markdown language IDs
				const languageMap: { [key: string]: string } = {
					ts: "typescript",
					js: "javascript",
					jsx: "javascript",
					tsx: "typescript",
					py: "python",
					java: "java",
					cs: "csharp",
					go: "go",
					rb: "ruby",
					php: "php",
					cpp: "cpp",
					c: "c",
					html: "html",
					css: "css",
					json: "json",
					xml: "xml",
					yml: "yaml",
					yaml: "yaml",
					sh: "bash",
					bat: "batchfile",
					ps1: "powershell",
					md: "markdown",
					sql: "sql",
					dockerfile: "dockerfile",
					makefile: "makefile",
					// Specific files without common extensions
					gitignore: "ignore",
					eslintignore: "ignore",
					prettierignore: "ignore",
					npmrc: "properties",
					yarnrc: "properties",
					bowerrc: "json",
					license: "plaintext",
					changelog: "plaintext",
					readme: "markdown",
					txt: "plaintext",
					log: "plaintext",
					env: "plaintext",
					conf: "plaintext",
					toml: "toml",
					ini: "ini",
				};
				languageId = languageMap[languageId] || "plaintext";

				// Format each snippet line with padded line numbers for alignment
				const maxLineNumLength = String(actualSnippetEndLine + 1).length;
				const formattedSnippetLines = snippetLines
					.map((line, index) => {
						const currentLineNum = snippetStartLine + index + 1; // 1-indexed line number
						const paddedLineNum = String(currentLineNum).padStart(
							maxLineNumLength,
							" "
						);
						return `${paddedLineNum}: ${line}`;
					})
					.join("\n");

				codeSnippetString = `\n  Code snippet:\n\`\`\`${languageId}\n${formattedSnippetLines}\n\`\`\`\n`;
			}

			// Append the code snippet to the diagnostic line
			diagLine += codeSnippetString;
			diagLine += "\n"; // Add the newline character at the very end of the full diagnostic entry

			// Check if adding this diagnostic (with its snippet) would exceed the total character limit
			if (currentLength + diagLine.length > maxTotalChars) {
				diagnosticsString += `... (${
					filteredDiagnostics.length - filteredDiagnostics.indexOf(diag)
				} more diagnostics truncated)\n`;
				break;
			}
			diagnosticsString += diagLine;
			currentLength += diagLine.length;
		}

		diagnosticsString += "--- End Relevant Diagnostics ---\n";
		return diagnosticsString;
	}

	/**
	 * Waits for diagnostics for a given URI to stabilize.
	 * Diagnostics are considered stable if they don't change for a specified duration.
	 * @param uri The URI of the document to monitor.
	 * @param token A CancellationToken to abort the waiting.
	 * @param timeoutMs The maximum time to wait in milliseconds. Defaults to 10000ms (10 seconds).
	 * @param checkIntervalMs The interval between checks in milliseconds. Defaults to 500ms.
	 * @param requiredStableChecks The number of consecutive checks without change required for stability. Defaults to 10.
	 * @returns A Promise that resolves when diagnostics stabilize or timeout/cancellation occurs.
	 */
	public static async waitForDiagnosticsToStabilize(
		uri: vscode.Uri,
		token?: vscode.CancellationToken,
		timeoutMs: number = 10000,
		checkIntervalMs: number = 500,
		requiredStableChecks: number = 10
	): Promise<void> {
		console.log(
			`[DiagnosticService] Waiting for diagnostics to stabilize for ${uri.fsPath} ` +
				`with timeoutMs=${timeoutMs}, checkIntervalMs=${checkIntervalMs}, ` +
				`requiredStableChecks=${requiredStableChecks}...`
		);
		const startTime = Date.now();
		let lastDiagnosticsString: string | undefined;
		let stableCount = 0;

		while (Date.now() - startTime < timeoutMs) {
			// Check for cancellation request
			if (token?.isCancellationRequested) {
				console.log(
					`[DiagnosticService] Waiting for diagnostics cancelled for ${uri.fsPath}.`
				);
				return; // Exit if cancelled
			}

			// Retrieve current diagnostics for the URI
			const currentDiagnostics = vscode.languages.getDiagnostics(uri);

			// Sort diagnostics for consistent stringification.
			// This ensures that the order of diagnostics doesn't affect the stability check.
			currentDiagnostics.sort((a, b) => {
				const cmpSeverity = a.severity - b.severity;
				if (cmpSeverity !== 0) {
					return cmpSeverity;
				}
				const cmpLine = a.range.start.line - b.range.start.line;
				if (cmpLine !== 0) {
					return cmpLine;
				}
				const cmpChar = a.range.start.character - b.range.start.character;
				if (cmpChar !== 0) {
					return cmpChar;
				}
				return a.message.localeCompare(b.message);
			});

			// Stringify the diagnostics for reliable comparison.
			// Include essential properties like severity, message, range, and code.
			const currentDiagnosticsString = JSON.stringify(
				currentDiagnostics.map((d) => ({
					severity: d.severity,
					message: d.message,
					range: d.range,
					code: d.code, // Include code property for more robust comparison
				}))
			);

			// Check if diagnostics have stabilized
			if (lastDiagnosticsString === currentDiagnosticsString) {
				stableCount++;
				// If diagnostics have remained the same for the required number of checks, consider them stable
				if (stableCount >= requiredStableChecks) {
					console.log(
						`[DiagnosticService] Diagnostics stabilized for ${
							uri.fsPath
						} after ${Date.now() - startTime}ms.`
					);
					return; // Stability achieved
				}
			} else {
				stableCount = 0; // Reset counter if diagnostics changed
			}

			// Update the last diagnostics string for the next iteration
			lastDiagnosticsString = currentDiagnosticsString;

			// Wait for the specified interval before the next check
			await sleep(checkIntervalMs); // Assuming sleep is available in scope
		}

		// If the loop finishes due to timeout, log a warning
		console.warn(
			`[DiagnosticService] Timeout (${timeoutMs}ms) waiting for diagnostics to stabilize for ${uri.fsPath}. Diagnostics might not be fully up-to-date.`
		);
	}
}

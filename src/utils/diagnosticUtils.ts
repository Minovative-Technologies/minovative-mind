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

/**
 * Defines the type of request for diagnostic formatting,
 * which influences filtering and prioritization.
 */
export type DiagnosticRequestType = "fix" | "explain" | "general";

/**
 * Defines the context lines for code snippets.
 */
export interface SnippetContextLines {
	before: number;
	after: number;
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
	 * @param maxPerSeverity The maximum number of diagnostics to include per severity level.
	 * @param token An optional CancellationToken to allow for early cancellation of the operation.
	 * @param includeSeverities Which severities to include. Defaults to all for general.
	 * @param requestType An optional parameter to adjust filtering based on the request's intent.
	 * @param snippetContextLines Optional configuration for how many lines before/after a diagnostic to include in the snippet.
	 * @returns A formatted string of diagnostics, or undefined if no relevant diagnostics.
	 */
	public static async formatContextualDiagnostics(
		documentUri: vscode.Uri,
		workspaceRoot: vscode.Uri,
		selection?: vscode.Range,
		maxTotalChars: number = 25000,
		maxPerSeverity: number = 25,
		token?: vscode.CancellationToken,
		includeSeverities: vscode.DiagnosticSeverity[] = [
			vscode.DiagnosticSeverity.Error,
			vscode.DiagnosticSeverity.Warning,
			vscode.DiagnosticSeverity.Information,
			vscode.DiagnosticSeverity.Hint,
		],
		requestType: DiagnosticRequestType = "general",
		snippetContextLines: SnippetContextLines = { before: 3, after: 3 }
	): Promise<string | undefined> {
		const allDiagnostics = DiagnosticService.getDiagnosticsForUri(documentUri);
		if (!allDiagnostics || allDiagnostics.length === 0) {
			return undefined;
		}

		let fileContentLines: string[] | undefined;
		try {
			const fileBuffer = await vscode.workspace.fs.readFile(documentUri);
			fileContentLines = Buffer.from(fileBuffer)
				.toString("utf8")
				.split(/\r?\n/);
		} catch (error: any) {
			if (token?.isCancellationRequested) {
				throw new Error("Operation cancelled during file content read.");
			}
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
			fileContentLines = undefined;
		}

		// Determine effective filtering and limits based on requestType
		let effectiveIncludeSeverities = new Set(includeSeverities);
		let effectiveMaxPerSeverity = maxPerSeverity;
		let effectiveMaxPerSeverityInfo = maxPerSeverity / 2;
		let effectiveMaxPerSeverityHint = maxPerSeverity / 4;

		if (requestType === "fix") {
			effectiveIncludeSeverities = new Set([
				vscode.DiagnosticSeverity.Error,
				vscode.DiagnosticSeverity.Warning,
				...(includeSeverities.includes(vscode.DiagnosticSeverity.Information)
					? [vscode.DiagnosticSeverity.Information]
					: []),
				...(includeSeverities.includes(vscode.DiagnosticSeverity.Hint)
					? [vscode.DiagnosticSeverity.Hint]
					: []),
			]);
			effectiveMaxPerSeverity = Math.max(maxPerSeverity, 50); // More errors/warnings for 'fix'
			effectiveMaxPerSeverityInfo = Math.min(effectiveMaxPerSeverityInfo, 5); // Fewer info for 'fix'
			effectiveMaxPerSeverityHint = Math.min(effectiveMaxPerSeverityHint, 2); // Even fewer hints for 'fix'
		} else if (requestType === "explain" || requestType === "general") {
			effectiveMaxPerSeverity = Math.max(maxPerSeverity, 30); // Broader range for explain/general
			effectiveMaxPerSeverityInfo = Math.max(effectiveMaxPerSeverityInfo, 10);
			effectiveMaxPerSeverityHint = Math.max(effectiveMaxPerSeverityHint, 5);
		}

		let filteredDiagnostics: vscode.Diagnostic[] = [];

		if (selection) {
			// Scenario 1: User has a selection - prioritize diagnostics within selection
			filteredDiagnostics = allDiagnostics.filter(
				(d) =>
					selection?.intersection(d.range) &&
					effectiveIncludeSeverities.has(d.severity)
			);
		} else {
			// Scenario 2: No selection (whole file) - filter by effectiveIncludeSeverities
			const relevantDiagnostics = allDiagnostics.filter((d) =>
				effectiveIncludeSeverities.has(d.severity)
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

			// Sort each group by line number, then character position
			const sortFn = (a: vscode.Diagnostic, b: vscode.Diagnostic) => {
				const lineDiff = a.range.start.line - b.range.start.line;
				if (lineDiff !== 0) {
					return lineDiff;
				}
				return a.range.start.character - b.range.start.character;
			};
			errors.sort(sortFn);
			warnings.sort(sortFn);
			infos.sort(sortFn);
			hints.sort(sortFn);

			// Combine: All errors, then limited warnings, then limited infos, etc.
			filteredDiagnostics.push(...errors);
			if (effectiveIncludeSeverities.has(vscode.DiagnosticSeverity.Warning)) {
				filteredDiagnostics.push(...warnings.slice(0, effectiveMaxPerSeverity));
			}
			if (
				effectiveIncludeSeverities.has(vscode.DiagnosticSeverity.Information)
			) {
				filteredDiagnostics.push(
					...infos.slice(0, effectiveMaxPerSeverityInfo)
				);
			}
			if (effectiveIncludeSeverities.has(vscode.DiagnosticSeverity.Hint)) {
				filteredDiagnostics.push(
					...hints.slice(0, effectiveMaxPerSeverityHint)
				);
			}
		}

		if (filteredDiagnostics.length === 0) {
			return undefined;
		}

		// Final sorting of combined diagnostics: severity (Error > Warning > Info > Hint), then line, then character
		filteredDiagnostics.sort((a, b) => {
			if (a.severity !== b.severity) {
				return a.severity - b.severity; // Lower severity value means higher priority (Error=0, Warning=1...)
			}
			const lineDiff = a.range.start.line - b.range.start.line;
			if (lineDiff !== 0) {
				return lineDiff;
			}
			return a.range.start.character - b.range.start.character;
		});

		let diagnosticsString = "--- Relevant Diagnostics ---\n";
		let currentLength = diagnosticsString.length;
		const relativePath = path
			.relative(workspaceRoot.fsPath, documentUri.fsPath)
			.replace(/\\/g, "/");

		for (const diag of filteredDiagnostics) {
			if (token?.isCancellationRequested) {
				diagnosticsString += `... (${
					filteredDiagnostics.length - filteredDiagnostics.indexOf(diag)
				} more diagnostics truncated due to cancellation)\n`;
				break;
			}

			let diagLine = `- [${getSeverityName(diag.severity)}] ${relativePath}:${
				diag.range.start.line + 1
			}:${diag.range.start.character + 1} - ${diag.message}`;

			if (diag.code) {
				diagLine += ` (Code: ${
					typeof diag.code === "object" ? diag.code.value : diag.code
				})`;
			}
			if (diag.source) {
				diagLine += ` (Source: ${diag.source})`;
			}
			diagLine += "\n"; // Add newline for the diagnostic message itself

			let codeSnippetString = "";
			if (fileContentLines && fileContentLines.length > 0) {
				const diagnosticSpan = diag.range.end.line - diag.range.start.line;

				// Dynamically adjust snippet context based on span
				let linesBefore = snippetContextLines.before;
				let linesAfter = snippetContextLines.after;

				// If it's a multi-line issue, ensure we capture the full span plus a buffer
				if (diagnosticSpan > 0) {
					linesBefore = Math.max(linesBefore, 1); // At least 1 line before
					linesAfter = Math.max(linesAfter, 1); // At least 1 line after
				}

				const snippetStartLine = Math.max(
					0,
					diag.range.start.line - linesBefore
				);
				const snippetEndLine = Math.min(
					fileContentLines.length - 1,
					diag.range.end.line + linesAfter
				);

				const actualSnippetEndLine = Math.max(snippetStartLine, snippetEndLine);

				const snippetLines = fileContentLines.slice(
					snippetStartLine,
					actualSnippetEndLine + 1
				);

				let languageId = path
					.extname(documentUri.fsPath)
					.substring(1)
					.toLowerCase();
				if (!languageId) {
					languageId = path.basename(documentUri.fsPath).toLowerCase();
				}

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

				const maxLineNumLength = String(actualSnippetEndLine + 1).length;
				const formattedSnippetLines: string[] = [];

				for (let i = 0; i < snippetLines.length; i++) {
					const currentFileContentLineNum = snippetStartLine + i; // 0-indexed line number in original file
					const displayLineNum = currentFileContentLineNum + 1; // 1-indexed for display
					const lineContent = snippetLines[i];
					const paddedLineNum = String(displayLineNum).padStart(
						maxLineNumLength,
						" "
					);

					let highlightedLine = `${paddedLineNum}: ${lineContent}`;
					let markerLine = "";

					const isDiagnosticLine =
						currentFileContentLineNum >= diag.range.start.line &&
						currentFileContentLineNum <= diag.range.end.line;

					if (isDiagnosticLine) {
						let startChar = 0;
						let endChar = lineContent.length;

						if (currentFileContentLineNum === diag.range.start.line) {
							startChar = diag.range.start.character;
						}
						if (currentFileContentLineNum === diag.range.end.line) {
							endChar = diag.range.end.character;
						}

						// If startChar is beyond endChar (e.g., empty diagnostic range), adjust
						if (startChar > endChar) {
							startChar = endChar;
						}

						// Create a marker line if there's an actual range to highlight on this line
						if (endChar > startChar) {
							const markerPadding = " ".repeat(
								maxLineNumLength + 2 + startChar
							); // +2 for ": "
							const marker = "^".repeat(endChar - startChar);
							markerLine = `${markerPadding}${marker} <-- ISSUE\n`;
						}
					}
					formattedSnippetLines.push(highlightedLine);
					if (markerLine) {
						formattedSnippetLines.push(markerLine);
					}
				}

				codeSnippetString = `Code snippet (${relativePath}, Line ${
					snippetStartLine + 1
				}):\n\`\`\`${languageId}\n${formattedSnippetLines.join("")}\n\`\`\`\n`; // Join with empty string because newlines are already in `formattedSnippetLines`
			}

			diagLine += codeSnippetString;

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
	 * @param checkIntervalMs The base interval between checks in milliseconds. Defaults to 500ms.
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
				`with timeoutMs=${timeoutMs}, baseCheckIntervalMs=${checkIntervalMs}, ` +
				`requiredStableChecks=${requiredStableChecks}...`
		);
		const startTime = Date.now();
		let lastDiagnosticsString: string | undefined;
		let stableCount = 0;
		let consecutiveUnstableChecks = 0;
		const maxJitter = checkIntervalMs * 0.2; // 20% jitter
		const maxBackoffDelay = 5000; // Max 5 seconds additional backoff per unstable check

		while (Date.now() - startTime < timeoutMs) {
			if (token?.isCancellationRequested) {
				console.log(
					`[DiagnosticService] Waiting for diagnostics cancelled for ${uri.fsPath}.`
				);
				return;
			}

			const currentDiagnostics = vscode.languages.getDiagnostics(uri);

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

			const currentDiagnosticsString = JSON.stringify(
				currentDiagnostics.map((d) => ({
					severity: d.severity,
					message: d.message,
					range: d.range,
					code: d.code,
					source: d.source, // Include source for more robust comparison
				}))
			);

			if (lastDiagnosticsString === currentDiagnosticsString) {
				stableCount++;
				console.log(
					`[DiagnosticService] Diagnostics stable (${stableCount}/${requiredStableChecks}) for ${uri.fsPath}.`
				);
				if (stableCount >= requiredStableChecks) {
					console.log(
						`[DiagnosticService] Diagnostics stabilized for ${
							uri.fsPath
						} after ${Date.now() - startTime}ms.`
					);
					return;
				}
				consecutiveUnstableChecks = 0; // Reset unstable counter on stability
			} else {
				console.log(
					`[DiagnosticService] Diagnostics changed for ${uri.fsPath}. Resetting stability counter.`
				);
				stableCount = 0;
				consecutiveUnstableChecks++;
			}

			lastDiagnosticsString = currentDiagnosticsString;

			let actualCheckInterval = checkIntervalMs;

			// Implement exponential backoff with jitter
			if (consecutiveUnstableChecks > 0) {
				const backoffFactor = Math.pow(1.2, consecutiveUnstableChecks - 1); // Exponential increase
				const jitter = Math.random() * maxJitter;
				actualCheckInterval = Math.min(
					checkIntervalMs * backoffFactor + jitter,
					checkIntervalMs + maxBackoffDelay // Cap the total backoff
				);
			}

			console.log(
				`[DiagnosticService] Next check for ${
					uri.fsPath
				} in ${actualCheckInterval.toFixed(0)}ms.`
			);
			await sleep(actualCheckInterval);
		}

		console.warn(
			`[DiagnosticService] Timeout (${timeoutMs}ms) waiting for diagnostics to stabilize for ${uri.fsPath}. Diagnostics might not be fully up-to-date.`
		);
	}
}

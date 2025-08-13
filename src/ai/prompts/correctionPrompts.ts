import * as vscode from "vscode";
import * as path from "path";
import * as sidebarTypes from "../../sidebar/common/sidebarTypes";

// Helper for formatting location (single or array of vscode.Location objects).
// Attempts to make path relative using a heuristic based on editor context if available.
const formatLocation = (
	location: vscode.Location | vscode.Location[] | undefined,
	editorContext: sidebarTypes.EditorContext | undefined
): string => {
	if (!location) {
		return "N/A";
	}
	const actualLocation = Array.isArray(location)
		? location.length > 0
			? location[0]
			: undefined
		: location;
	if (!actualLocation || !actualLocation.uri) {
		return "N/A";
	}

	let formattedPath = actualLocation.uri.fsPath; // Default to absolute path

	// Heuristically try to make path relative if within the assumed workspace
	if (editorContext) {
		// Find the common root by looking for common project structures (like 'src/', 'pages/', 'app/')
		const editorPathSegments = editorContext.documentUri.fsPath.split(path.sep);
		let commonRootIndex = -1;
		// Find the deepest common ancestor that looks like a project root or a folder above src/
		for (let i = editorPathSegments.length - 1; i >= 0; i--) {
			const segment = editorPathSegments[i].toLowerCase();
			if (["src", "pages", "app"].includes(segment) && i > 0) {
				commonRootIndex = i - 1; // Take the directory above src/pages/app as root
				break;
			}
		}
		let inferredRootPath = "";
		if (commonRootIndex !== -1) {
			inferredRootPath = editorPathSegments
				.slice(0, commonRootIndex + 1)
				.join(path.sep);
		} else {
			// If no specific project structure is found, use the current workspace folder's root
			// This is a best-effort guess without an explicit workspaceRootUri being passed in.
			if (
				vscode.workspace.workspaceFolders &&
				vscode.workspace.workspaceFolders.length > 0
			) {
				inferredRootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
			}
		}

		if (
			inferredRootPath &&
			actualLocation.uri.fsPath.startsWith(inferredRootPath)
		) {
			formattedPath = path
				.relative(inferredRootPath, actualLocation.uri.fsPath)
				.replace(/\\/g, "/");
		} else {
			// Fallback to absolute if the heuristic doesn't find a good relative path
			formattedPath = actualLocation.uri.fsPath;
		}
	}

	return `${formattedPath}:${actualLocation.range.start.line + 1}`;
};

// Helper for formatting arrays of vscode.Location objects.
const formatLocations = (
	locations: vscode.Location[] | undefined,
	limit: number = 5,
	editorContext: sidebarTypes.EditorContext | undefined
): string => {
	if (!locations || locations.length === 0) {
		return "None";
	}
	const limited = locations.slice(0, limit);
	const formatted = limited
		.map((loc) => formatLocation(loc, editorContext))
		.join(", ");
	return locations.length > limit
		? `${formatted}, ... (${locations.length - limit} more)`
		: formatted;
};

// Helper for formatting Call Hierarchy (Incoming/Outgoing) data.
const formatCallHierarchy = (
	calls:
		| vscode.CallHierarchyIncomingCall[]
		| vscode.CallHierarchyOutgoingCall[]
		| undefined,
	limit: number = 5,
	editorContext: sidebarTypes.EditorContext | undefined
): string => {
	if (!calls || calls.length === 0) {
		return `No Calls`;
	}
	const limitedCalls = calls.slice(0, limit);
	const formatted = limitedCalls
		.map((call) => {
			let uri: vscode.Uri | undefined;
			let name: string = "Unknown";
			let detail: string | undefined;
			let rangeStartLine: number | undefined;

			if ("from" in call) {
				// IncomingCall
				uri = call.from.uri;
				name = call.from.name;
				detail = call.from.detail;
				rangeStartLine =
					call.fromRanges.length > 0
						? call.fromRanges[0].start.line + 1
						: undefined;
			} else if ("to" in call) {
				// OutgoingCall
				uri = call.to.uri;
				name = call.to.name;
				detail = call.to.detail;
				rangeStartLine = call.to.range.start.line + 1;
			}

			if (!uri) {
				return `${name} (N/A:URI_Missing)`;
			}

			let formattedPath = uri.fsPath; // Default to absolute path

			// Heuristically try to make path relative if within the assumed workspace
			if (editorContext) {
				const editorPathSegments = editorContext.documentUri.fsPath.split(
					path.sep
				);
				let commonRootIndex = -1;
				for (let i = editorPathSegments.length - 1; i >= 0; i--) {
					const segment = editorPathSegments[i].toLowerCase();
					if (["src", "pages", "app"].includes(segment) && i > 0) {
						commonRootIndex = i - 1;
						break;
					}
				}
				let inferredRootPath = "";
				if (commonRootIndex !== -1) {
					inferredRootPath = editorPathSegments
						.slice(0, commonRootIndex + 1)
						.join(path.sep);
				} else {
					if (
						vscode.workspace.workspaceFolders &&
						vscode.workspace.workspaceFolders.length > 0
					) {
						inferredRootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
					}
				}

				if (inferredRootPath && uri.fsPath.startsWith(inferredRootPath)) {
					formattedPath = path
						.relative(inferredRootPath, uri.fsPath)
						.replace(/\\/g, "/");
				} else {
					formattedPath = uri.fsPath;
				}
			}

			const lineInfo = rangeStartLine ? `:${rangeStartLine}` : "";
			const detailInfo = detail ? ` (Detail: ${detail})` : "";
			return `${name} (${formattedPath}${lineInfo})${detailInfo}`;
		})
		.join("\n    - ");
	const more =
		calls.length > limit ? `\n    ... (${calls.length - limit} more)` : "";
	return `    - ${formatted}${more}`;
};

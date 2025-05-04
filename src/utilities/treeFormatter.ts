// src/utilities/treeFormatter.ts

/**
 * Represents a node in the directory tree structure.
 * Keys are file/directory names.
 * Value is null for files, or another TreeNode for directories.
 */
interface TreeNode {
	[key: string]: TreeNode | null;
}

/**
 * Builds an intermediate tree data structure from a list of relative paths.
 * @param paths - An array of normalized relative file paths (using '/').
 * @returns A TreeNode object representing the directory structure.
 */
function buildTreeData(paths: string[]): TreeNode {
	const tree: TreeNode = {};
	// Sort paths alphabetically for consistent tree structure
	paths.sort();

	for (const p of paths) {
		const segments = p.split("/");
		let currentLevel = tree;

		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];
			// Skip empty segments that might arise from leading/trailing slashes
			if (!segment) {
				continue;
			}

			if (i === segments.length - 1) {
				// Last segment is a file
				currentLevel[segment] = null;
			} else {
				// Directory segment
				if (!currentLevel[segment]) {
					// Create directory node if it doesn't exist
					currentLevel[segment] = {};
				}
				// Ensure we are traversing an object. Handle potential errors if a path incorrectly
				// tries to treat a file as a directory (e.g., "file.txt/something").
				if (
					typeof currentLevel[segment] !== "object" ||
					currentLevel[segment] === null
				) {
					// Overwrite or handle error - for simplicity, we might skip or log here.
					// Let's log a warning and potentially skip deeper traversal for this path.
					console.warn(
						`Path structure conflict detected near '${segment}' in path '${p}'. Treating as file.`
					);
					// Make sure it's marked as a file if there's a conflict.
					currentLevel[segment] = null;
					break; // Stop processing this path further down
				}
				currentLevel = currentLevel[segment] as TreeNode; // Move deeper
			}
		}
	}
	return tree;
}

/**
 * Recursively formats a TreeNode into an ASCII-like string.
 * @param node - The current node (directory) to format.
 * @param prefix - The string prefix (indentation and connectors) for the current level.
 * @returns The formatted string for the current node and its children.
 */
function formatNode(node: TreeNode, prefix: string = ""): string {
	const entries = Object.keys(node).sort(); // Sort entries at each level
	let result = "";

	entries.forEach((key, index) => {
		const isLast = index === entries.length - 1;
		const connector = isLast ? "└── " : "├── ";
		const isDirectory = node[key] !== null && typeof node[key] === "object";

		result += prefix + connector + key + "\n";

		if (isDirectory) {
			// Recursively format subdirectory, updating the prefix
			const newPrefix = prefix + (isLast ? "    " : "│   ");
			result += formatNode(node[key] as TreeNode, newPrefix);
		}
	});
	return result;
}

/**
 * Creates an ASCII-like directory tree string from a list of relative paths.
 * @param relativePaths - Array of relative file paths (use '/' as separator).
 * @param rootName - The name of the project root directory.
 * @returns A string representing the file structure tree.
 */
export function createAsciiTree(
	relativePaths: string[],
	rootName: string
): string {
	if (!relativePaths || relativePaths.length === 0) {
		return `${rootName}/\n(No relevant files found or included)`;
	}
	const treeData = buildTreeData(relativePaths);
	// Start formatting from the root data structure
	return `${rootName}/\n${formatNode(treeData)}`;
}

import * as vscode from "vscode";

export function repairJsonEscapeSequences(jsonString: string): string {
	// Regex to find JSON string literals, capturing the content inside.
	// Handles basic string structures, including escaped quotes and backslashes using `\\. `.
	const stringLiteralRegex = /"((?:[^"\\]|\\.)*)"/g;
	let repairedJson = jsonString;

	const matches: { index: number; content: string; length: number }[] = [];
	let match;
	// Find all string literals in the JSON string.
	while ((match = stringLiteralRegex.exec(jsonString)) !== null) {
		matches.push({
			index: match.index, // Start index of the full match (including quotes)
			content: match[1], // The captured content *inside* the quotes
			length: match[0].length, // The total length of the matched string literal
		});
	}

	// Process matches in reverse order to avoid index shifts affecting subsequent matches.
	for (let k = matches.length - 1; k >= 0; k--) {
		const { index, content } = matches[k];
		let modifiedContent = "";

		// Iterate through the content of the string literal character by character.
		for (let m = 0; m < content.length; m++) {
			const char = content[m];
			if (char === "\\") {
				// Escape literal backslash: '\' -> '\\'
				modifiedContent += "\\\\";
			} else if (char === '"') {
				// Escape literal double quote: '"' -> '\"'
				modifiedContent += '\\"';
			} else {
				// Append other characters as they are.
				modifiedContent += char;
			}
		}

		// Reconstruct the JSON string with the modified string literal.
		const startIndex = index; // Start of the full match (includes opening quote)
		const endIndex = index + matches[k].length; // End of the full match (includes closing quote)

		repairedJson =
			repairedJson.substring(0, startIndex) +
			`"${modifiedContent}"` + // Re-insert the string literal with escaped content
			repairedJson.substring(endIndex);
	}

	return repairedJson;
}

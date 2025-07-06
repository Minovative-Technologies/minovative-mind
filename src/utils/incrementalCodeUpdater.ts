import * as vscode from "vscode";
import { diff_match_patch } from "diff-match-patch";

export interface CodeChange {
	type: "insert" | "delete" | "replace" | "modify";
	range: vscode.Range;
	newText: string;
	oldText?: string;
	description: string;
	priority: "low" | "medium" | "high" | "critical";
}

export interface IncrementalUpdateResult {
	changes: CodeChange[];
	summary: string;
	estimatedImpact: "minimal" | "moderate" | "significant";
	validationRequired: boolean;
}

export class IncrementalCodeUpdater {
	private static readonly dmp = new diff_match_patch();

	/**
	 * Generate incremental changes between original and target content
	 */
	public static async generateIncrementalChanges(
		originalContent: string,
		targetContent: string,
		filePath: string,
		document?: vscode.TextDocument
	): Promise<IncrementalUpdateResult> {
		const changes: CodeChange[] = [];

		// Use diff algorithm to identify minimal changes
		const diffs = this.dmp.diff_main(originalContent, targetContent);

		let originalPosOffset = 0;
		let changeCount = 0;

		for (const diff of diffs) {
			const [type, text] = diff;

			if (type === diff_match_patch.DIFF_EQUAL) {
				// No change needed, just advance position
				originalPosOffset += text.length;
			} else if (type === diff_match_patch.DIFF_INSERT) {
				// Insert new text
				const range = this.createRangeFromOffset(
					originalPosOffset,
					undefined,
					document
				);
				changes.push({
					type: "insert",
					range,
					newText: text,
					description: `Insert ${text.length} characters`,
					priority: this.calculatePriority(text, "insert"),
				});
				changeCount++;
			} else if (type === diff_match_patch.DIFF_DELETE) {
				// Delete existing text
				const range = this.createRangeFromOffset(
					originalPosOffset,
					originalPosOffset + text.length,
					document
				);
				changes.push({
					type: "delete",
					range,
					newText: "",
					oldText: text,
					description: `Delete ${text.length} characters`,
					priority: this.calculatePriority(text, "delete"),
				});
				originalPosOffset += text.length;
				changeCount++;
			}
		}

		// Consolidate adjacent changes for better performance
		const consolidatedChanges = this.consolidateChanges(changes);

		return {
			changes: consolidatedChanges,
			summary: this.generateChangeSummary(consolidatedChanges),
			estimatedImpact: this.estimateImpact(
				consolidatedChanges,
				originalContent
			),
			validationRequired: this.requiresValidation(consolidatedChanges),
		};
	}

	/**
	 * Apply incremental changes to an editor
	 */
	public static async applyIncrementalChanges(
		editor: vscode.TextEditor,
		changes: CodeChange[],
		token: vscode.CancellationToken
	): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}

		if (changes.length === 0) {
			return;
		}

		// Sort changes by position to apply them in order
		const sortedChanges = [...changes].sort((a, b) => {
			const aStart = a.range.start.line * 1000 + a.range.start.character;
			const bStart = b.range.start.line * 1000 + b.range.start.character;
			return aStart - bStart;
		});

		// Apply changes in reverse order to maintain line numbers
		const reverseSortedChanges = sortedChanges.reverse();

		await editor.edit(
			(editBuilder) => {
				for (const change of reverseSortedChanges) {
					if (token.isCancellationRequested) {
						break;
					}

					switch (change.type) {
						case "insert":
							editBuilder.insert(change.range.start, change.newText);
							break;
						case "delete":
							editBuilder.delete(change.range);
							break;
						case "replace":
						case "modify":
							editBuilder.replace(change.range, change.newText);
							break;
					}
				}
			},
			{
				undoStopBefore: true,
				undoStopAfter: true,
			}
		);
	}

	/**
	 * Generate minimal changes for specific modifications
	 */
	public static async generateMinimalChanges(
		originalContent: string,
		modificationPrompt: string,
		context: {
			projectContext: string;
			relevantSnippets: string;
			filePath: string;
		},
		aiService: any,
		modelName: string,
		token?: vscode.CancellationToken
	): Promise<CodeChange[]> {
		// Create a focused prompt for minimal changes
		const minimalChangePrompt = this.createMinimalChangePrompt(
			originalContent,
			modificationPrompt,
			context
		);

		// Generate the modified content
		const modifiedContent = await aiService.generateWithRetry(
			minimalChangePrompt,
			modelName,
			undefined,
			"minimal-change-generation",
			undefined,
			undefined,
			token
		);

		// Generate incremental changes
		const result = await this.generateIncrementalChanges(
			originalContent,
			modifiedContent,
			context.filePath
		);

		return result.changes;
	}

	/**
	 * Create a prompt optimized for minimal changes
	 */
	private static createMinimalChangePrompt(
		originalContent: string,
		modificationPrompt: string,
		context: any
	): string {
		return `You are an expert software engineer. Make ONLY the minimal changes required to implement the requested modification.

**CRITICAL REQUIREMENTS:**
- Make ONLY the necessary changes
- Preserve all existing functionality
- Maintain the current code structure and style
- Do not rewrite the entire file unless absolutely necessary
- Focus on surgical precision

**MODIFICATION REQUEST:**
${modificationPrompt}

**CURRENT FILE CONTENT:**
\`\`\`
${originalContent}
\`\`\`

**PROJECT CONTEXT:**
${context.projectContext}

**RELEVANT SNIPPETS:**
${context.relevantSnippets}

**INSTRUCTIONS:**
1. Analyze the current code carefully
2. Identify the minimal changes needed
3. Preserve all existing imports, structure, and functionality
4. Make only the requested modifications
5. Ensure the code remains functional and error-free

Provide ONLY the complete modified file content without any markdown formatting or explanations:`;
	}

	/**
	 * Create a range from character offset
	 */
	private static createRangeFromOffset(
		startOffset: number,
		endOffset?: number,
		document?: vscode.TextDocument
	): vscode.Range {
		if (!document) {
			// Fallback to line-based positioning
			const startLine = Math.floor(startOffset / 100); // Rough estimate
			const startChar = startOffset % 100;
			const endLine = endOffset ? Math.floor(endOffset / 100) : startLine;
			const endChar = endOffset ? endOffset % 100 : startChar;

			return new vscode.Range(
				new vscode.Position(startLine, startChar),
				new vscode.Position(endLine, endChar)
			);
		}

		const startPos = document.positionAt(startOffset);
		const endPos = endOffset ? document.positionAt(endOffset) : startPos;

		return new vscode.Range(startPos, endPos);
	}

	/**
	 * Calculate priority based on change type and content
	 */
	private static calculatePriority(
		text: string,
		type: "insert" | "delete"
	): "low" | "medium" | "high" | "critical" {
		const length = text.length;

		if (type === "delete") {
			if (length > 1000) {
				return "critical";
			}
			if (length > 500) {
				return "high";
			}
			if (length > 100) {
				return "medium";
			}
			return "low";
		} else {
			if (length > 2000) {
				return "critical";
			}
			if (length > 1000) {
				return "high";
			}
			if (length > 200) {
				return "medium";
			}
			return "low";
		}
	}

	/**
	 * Consolidate adjacent changes for better performance
	 */
	private static consolidateChanges(changes: CodeChange[]): CodeChange[] {
		if (changes.length <= 1) {
			return changes;
		}

		const consolidated: CodeChange[] = [];
		let currentChange: CodeChange | null = null;

		for (const change of changes) {
			if (!currentChange) {
				currentChange = { ...change };
				continue;
			}

			// Check if changes are adjacent
			const isAdjacent = this.areChangesAdjacent(currentChange, change);

			if (isAdjacent && currentChange.type === change.type) {
				// Merge adjacent changes of the same type
				currentChange.newText += change.newText;
				if (change.oldText) {
					currentChange.oldText =
						(currentChange.oldText || "") + change.oldText;
				}
				currentChange.description = `Combined ${currentChange.type} operations`;
				currentChange.priority = this.getHigherPriority(
					currentChange.priority,
					change.priority
				);
			} else {
				// Add current change and start new one
				consolidated.push(currentChange);
				currentChange = { ...change };
			}
		}

		if (currentChange) {
			consolidated.push(currentChange);
		}

		return consolidated;
	}

	/**
	 * Check if two changes are adjacent
	 */
	private static areChangesAdjacent(
		change1: CodeChange,
		change2: CodeChange
	): boolean {
		const end1 = change1.range.end;
		const start2 = change2.range.start;

		// Consider changes adjacent if they're within 1 character of each other
		return (
			Math.abs(end1.line - start2.line) <= 1 &&
			Math.abs(end1.character - start2.character) <= 1
		);
	}

	/**
	 * Get the higher priority between two priorities
	 */
	private static getHigherPriority(
		priority1: "low" | "medium" | "high" | "critical",
		priority2: "low" | "medium" | "high" | "critical"
	): "low" | "medium" | "high" | "critical" {
		const priorityOrder: ("low" | "medium" | "high" | "critical")[] = [
			"low",
			"medium",
			"high",
			"critical",
		];
		const index1 = priorityOrder.indexOf(priority1);
		const index2 = priorityOrder.indexOf(priority2);

		return priorityOrder[Math.max(index1, index2)] || "low";
	}

	/**
	 * Generate a summary of changes
	 */
	private static generateChangeSummary(changes: CodeChange[]): string {
		const insertions = changes.filter((c) => c.type === "insert").length;
		const deletions = changes.filter((c) => c.type === "delete").length;
		const replacements = changes.filter(
			(c) => c.type === "replace" || c.type === "modify"
		).length;

		const parts: string[] = [];
		if (insertions > 0) {
			parts.push(`${insertions} insertion(s)`);
		}
		if (deletions > 0) {
			parts.push(`${deletions} deletion(s)`);
		}
		if (replacements > 0) {
			parts.push(`${replacements} replacement(s)`);
		}

		return parts.join(", ") || "No changes";
	}

	/**
	 * Estimate the impact of changes
	 */
	private static estimateImpact(
		changes: CodeChange[],
		originalContent: string
	): "minimal" | "moderate" | "significant" {
		const totalChanges = changes.length;
		const totalModifiedChars = changes.reduce((sum, change) => {
			return sum + change.newText.length + (change.oldText?.length || 0);
		}, 0);

		const changeRatio = totalModifiedChars / originalContent.length;

		if (totalChanges <= 2 && changeRatio < 0.05) {
			return "minimal";
		}
		if (totalChanges <= 5 && changeRatio < 0.15) {
			return "moderate";
		}
		return "significant";
	}

	/**
	 * Determine if validation is required
	 */
	private static requiresValidation(changes: CodeChange[]): boolean {
		return changes.some(
			(change) =>
				change.priority === "high" ||
				change.priority === "critical" ||
				change.type === "replace" ||
				change.type === "modify"
		);
	}
}

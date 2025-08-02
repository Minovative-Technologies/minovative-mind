import { AIRequestService } from "../../services/aiRequestService";
import { DEFAULT_FLASH_LITE_MODEL } from "../../sidebar/common/sidebarConstants";
import { ERROR_OPERATION_CANCELLED } from "../gemini";
import * as vscode from "vscode";

export async function generateLightweightPlanPrompt(
	aiMessageContent: string,
	modelName: string,
	aiRequestService: AIRequestService,
	token?: vscode.CancellationToken
): Promise<string> {
	const prompt = `
	Given the following AI response, generate a concise summary for the user to implement, according to the AI response. Focus on the core actionable intent and summary. Do not include any extraneous text. Only use the "/plan implement this:" at the beginning	of the response.
	AI Response: ${aiMessageContent}`;

	try {
		const result = await aiRequestService.generateWithRetry(
			[{ text: prompt }],
			DEFAULT_FLASH_LITE_MODEL,
			undefined, // No history needed for this type of request
			"lightweight plan prompt",
			undefined, // No specific generation config needed
			undefined, // No streaming callbacks needed
			token
		);

		if (token?.isCancellationRequested) {
			throw new Error(ERROR_OPERATION_CANCELLED);
		}

		if (!result || result.toLowerCase().startsWith("error:")) {
			throw new Error(
				result ||
					"Empty or erroneous response from lightweight AI for plan prompt."
			);
		}
		return result.trim(); // Trim any leading/trailing whitespace
	} catch (error: any) {
		console.error("Error generating lightweight plan prompt:", error);
		if (error.message === ERROR_OPERATION_CANCELLED) {
			throw error; // Re-throw cancellation error directly
		}
		throw new Error(`Failed to generate /plan prompt: ${error.message}`);
	}
}

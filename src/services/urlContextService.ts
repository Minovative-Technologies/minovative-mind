import * as vscode from "vscode";

export interface UrlContext {
	url: string;
	title?: string;
	content?: string;
	error?: string;
}

export class UrlContextService {
	constructor() {}

	/**
	 * Extracts URLs from a message text using regex patterns
	 */
	public extractUrls(text: string): string[] {
		const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
		const matches = text.match(urlRegex);
		const urls = matches ? [...new Set(matches)] : [];
		if (urls.length > 0) {
			console.log(`[UrlContextService] Extracted ${urls.length} URLs:`, urls);
		}
		return urls;
	}

	/**
	 * Fetches content from a URL and returns context information
	 */
	public async fetchUrlContext(url: string): Promise<UrlContext> {
		try {
			console.log(`[UrlContextService] Fetching content from: ${url}`);
			// Use VS Code's built-in fetch capabilities
			const response = await fetch(url, {
				method: "GET",
				headers: {
					"User-Agent": "Minovative-Mind-VSCode-Extension/1.0",
				},
			});

			if (!response.ok) {
				return {
					url,
					error: `HTTP ${response.status}: ${response.statusText}`,
				};
			}

			const contentType = response.headers.get("content-type") || "";
			const isHtml = contentType.includes("text/html");
			const isText =
				contentType.includes("text/") ||
				contentType.includes("application/json");

			if (!isHtml && !isText) {
				return {
					url,
					error: `Unsupported content type: ${contentType}`,
				};
			}

			const content = await response.text();

			if (isHtml) {
				return this.parseHtmlContent(url, content);
			} else {
				return {
					url,
					content: this.truncateContent(content, 2000),
					title: url,
				};
			}
		} catch (error) {
			console.log(`[UrlContextService] Error fetching ${url}:`, error);
			return {
				url,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Parses HTML content to extract title and clean text
	 */
	private parseHtmlContent(url: string, htmlContent: string): UrlContext {
		try {
			// Extract title from HTML
			const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
			const title = titleMatch ? titleMatch[1].trim() : url;

			// Remove script and style tags
			let cleanContent = htmlContent
				.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
				.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
				.replace(/<[^>]+>/g, " ") // Remove all HTML tags
				.replace(/\s+/g, " ") // Normalize whitespace
				.trim();

			return {
				url,
				title,
				content: this.truncateContent(cleanContent, 2000),
			};
		} catch (error) {
			return {
				url,
				title: url,
				content: this.truncateContent(htmlContent, 2000),
			};
		}
	}

	/**
	 * Truncates content to a reasonable length for AI context
	 */
	private truncateContent(content: string, maxLength: number): string {
		if (content.length <= maxLength) {
			return content;
		}
		return content.substring(0, maxLength) + "...";
	}

	/**
	 * Processes a message and extracts URL context for all URLs found
	 */
	public async processMessageForUrlContext(
		message: string
	): Promise<UrlContext[]> {
		const urls = this.extractUrls(message);
		const contexts: UrlContext[] = [];

		for (const url of urls) {
			const context = await this.fetchUrlContext(url);
			contexts.push(context);
		}

		return contexts;
	}

	/**
	 * Formats URL contexts into a readable string for AI consumption
	 */
	public formatUrlContexts(contexts: UrlContext[]): string {
		if (contexts.length === 0) {
			return "";
		}

		const validContexts = contexts.filter((ctx) => !ctx.error);
		const errorContexts = contexts.filter((ctx) => ctx.error);

		let formatted = "";

		if (validContexts.length > 0) {
			formatted += "URL Context Information:\n\n";
			validContexts.forEach((ctx, index) => {
				formatted += `URL ${index + 1}: ${ctx.url}\n`;
				if (ctx.title && ctx.title !== ctx.url) {
					formatted += `Title: ${ctx.title}\n`;
				}
				if (ctx.content) {
					formatted += `Content: ${ctx.content}\n`;
				}
				formatted += "\n";
			});
		}

		if (errorContexts.length > 0) {
			formatted += "Failed to fetch content from:\n";
			errorContexts.forEach((ctx) => {
				formatted += `- ${ctx.url}: ${ctx.error}\n`;
			});
			formatted += "\n";
		}

		return formatted;
	}
}

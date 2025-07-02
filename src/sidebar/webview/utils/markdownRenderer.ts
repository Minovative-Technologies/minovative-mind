import MarkdownIt from "markdown-it";
import hljs from "highlight.js";

/**
 * Configured MarkdownIt instance for rendering markdown content.
 * It includes support for HTML, linkification, typography, and syntax highlighting
 * using highlight.js.
 */
export const md: MarkdownIt = new MarkdownIt({
	html: true, // Allow HTML tags in Markdown output
	linkify: true, // Automatically convert URLs to links
	typographer: true, // Enable some smart typography replacements
	highlight: function (str: string, lang: string): string {
		// If a language is specified and highlight.js supports it
		if (lang && hljs.getLanguage(lang)) {
			try {
				// Highlight the string and return the HTML value
				return hljs.highlight(str, { language: lang, ignoreIllegals: true })
					.value;
			} catch (__) {
				// Fallback in case of highlighting error
				console.warn(`[MarkdownIt] Highlight.js failed for language ${lang}.`);
			}
		}
		// Fallback for unsupported language or no language specified:
		// Render as a basic preformatted code block with escaped HTML.
		// This uses md.utils.escapeHtml, which is part of the MarkdownIt instance itself,
		// ensuring it remains self-contained.
		return (
			'<pre class="hljs"><code>' + md.utils.escapeHtml(str) + "</code></pre>"
		);
	},
});

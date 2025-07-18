import MarkdownIt from "markdown-it";
import hljs from "highlight.js";

const faCopySvg = `<svg class="fa-icon" aria-hidden="true" focusable="false" data-prefix="fas" data-icon="copy" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M384 336H192c-8.8 0-16-7.2-16-16V64c0-8.8 7.2-16 16-16h149.2c1.7 0 3.3.7 4.5 1.9l49.2 49.2c1.2 1.2 1.9 2.9 1.9 4.5V320c0 8.8-7.2 16-16 16zM288 64V.9c0-.4.2-.7.5-.9l49.2-49.2c.2-.2.5-.3.9-.3H416c8.8 0 16 7.2 16 16v304c0 8.8-7.2 16-16 16H288v-64h96c8.8 0 16-7.2 16-16V80h-96c-8.8 0-16-7.2-16-16zM128 128H32c-8.8 0-16 7.2-16 16v320c0 8.8 7.2 16 16 16h256c8.8 0 16-7.2 16-16V352h-64v96H48V160h80v-32z"></path></svg>`;
const copyButtonHtml = `\n    <button class="code-copy-button" title="Copy code">\n        ${faCopySvg}\n    </button>\n`;

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
				// Highlight the string and return the HTML value with language data attribute
				const highlightedCode = hljs.highlight(str, {
					language: lang,
					ignoreIllegals: true,
				}).value;
				return `<pre class="hljs has-copy-button" data-language="${lang}">${copyButtonHtml}<code>${highlightedCode}</code></pre>`;
			} catch (__) {
				// Fallback in case of highlighting error
				console.warn(`[MarkdownIt] Highlight.js failed for language ${lang}.`);
			}
		}
		// Fallback for unsupported language or no language specified:
		// Render as a basic preformatted code block with escaped HTML.
		// This uses md.utils.escapeHtml, which is part of the MarkdownIt instance itself,
		// ensuring it remains self-contained.
		const languageAttr = lang ? ` data-language="${lang}"` : "";
		return `<pre class="hljs has-copy-button"${languageAttr}>${copyButtonHtml}<code>${md.utils.escapeHtml(
			str
		)}</code></pre>`;
	},
});

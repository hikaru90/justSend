/**
 * Markdown → email-safe HTML for Owl text slots.
 * Slot values stay as markdown source; this runs at compose/apply time.
 */
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

marked.setOptions({ gfm: true, breaks: false });

const ALLOWED_TAGS = [
	'a',
	'b',
	'strong',
	'i',
	'em',
	'u',
	'br',
	'p',
	'ul',
	'ol',
	'li',
	'code',
	'pre',
	'blockquote',
	'h1',
	'h2',
	'h3',
	'span',
];

const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'style'];

/** Tags that must not wrap block markdown (use inline parse). */
const INLINE_HOST_TAGS = new Set([
	'a',
	'span',
	'strong',
	'em',
	'b',
	'i',
	'u',
	'label',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'button',
]);

/** Default body-link color when no design token is provided (matches Owl starters). */
export const OWL_MARKDOWN_LINK_COLOR = '#0A2540';

export type OwlMarkdownOptions = {
	/** Inline link color (brand primary). Falls back to {@link OWL_MARKDOWN_LINK_COLOR}. */
	linkColor?: string;
};

function sanitize(html: string): string {
	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		ALLOW_DATA_ATTR: false,
	});
}

/** Unwrap a single outer `<p>…</p>` so we can nest cleanly inside a host `<p>`/`<td>`. */
function unwrapSingleParagraph(html: string): string {
	const trimmed = html.trim();
	const match = trimmed.match(/^<p(?:\s[^>]*)?>([\s\S]*)<\/p>$/i);
	if (!match) return trimmed;
	// Reject if there are other top-level block siblings (multiple paragraphs).
	if (/<\/p>\s*</i.test(match[1]) || /<p[\s>]/i.test(match[1])) return trimmed;
	return match[1];
}

function linkInlineStyle(linkColor?: string): string {
	const color = linkColor?.trim() || OWL_MARKDOWN_LINK_COLOR;
	return `color:${color};text-decoration:underline;font-weight:400;`;
}

/**
 * Email clients need inline styles on body links. Also ensure target/rel for
 * outbound URLs (see email formatting rules).
 */
function decorateMarkdownLinks(html: string, linkColor?: string): string {
	const style = linkInlineStyle(linkColor);
	return html.replace(/<a\b([^>]*)>/gi, (_full, rawAttrs: string) => {
		let attrs = rawAttrs;

		if (/\bstyle\s*=/i.test(attrs)) {
			attrs = attrs.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i, (_s, q: string, existing: string) => {
				const merged = `${style}${existing.trim()}`;
				return `style=${q}${merged}${q}`;
			});
		} else {
			attrs += ` style="${style}"`;
		}

		if (!/\btarget\s*=/i.test(attrs)) attrs += ' target="_blank"';
		if (!/\brel\s*=/i.test(attrs)) attrs += ' rel="noopener noreferrer"';

		return `<a${attrs}>`;
	});
}

/**
 * Render markdown for a text slot host element.
 * Inline hosts (`a`, `span`, headings) use inline parse; others use block + unwrap.
 * Links get email-safe underline + brand color inline styles.
 */
export function renderOwlMarkdown(
	text: string,
	hostTagName?: string,
	options?: OwlMarkdownOptions,
): string {
	const tag = (hostTagName ?? 'div').toLowerCase();
	let html: string;
	if (INLINE_HOST_TAGS.has(tag)) {
		html = marked.parseInline(text, { async: false }) as string;
		html = sanitize(html.trim());
	} else {
		html = marked.parse(text, { async: false }) as string;
		html = sanitize(unwrapSingleParagraph(html));
	}
	return decorateMarkdownLinks(html, options?.linkColor);
}

export function isInlineMarkdownHost(tagName: string): boolean {
	return INLINE_HOST_TAGS.has(tagName.toLowerCase());
}

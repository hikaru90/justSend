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

/**
 * Legacy default when callers pass an explicit fallback. Prefer design tokens or
 * `inherit` (match surrounding body text — email formatting rules) over this.
 */
export const OWL_MARKDOWN_LINK_COLOR = '#0A2540';

export type OwlMarkdownOptions = {
	/**
	 * Inline link color (brand primary / link token).
	 * Omit or pass `inherit` to match surrounding text (no browser-blue default).
	 */
	linkColor?: string;
};

const LIGHT_LINK_TOKEN_KEYS = [
	'link',
	'link_color',
	'primary',
	'brand_primary',
	'accent',
	'brand',
	'text',
	'foreground',
	'body',
] as const;

function isHexColor(value: string): boolean {
	return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim());
}

/** Pick a hex token by exact key, then by key ending with `_name`. */
export function pickDesignHexToken(
	tokens: Record<string, string> | undefined,
	names: readonly string[],
): string | undefined {
	if (!tokens) return undefined;
	for (const name of names) {
		const direct = tokens[name]?.trim();
		if (direct && isHexColor(direct)) return direct;
	}
	const entries = Object.entries(tokens);
	for (const name of names) {
		const hit = entries.find(([key, value]) => {
			if (!isHexColor(value)) return false;
			if (key === name || key.endsWith(`_${name}`)) return true;
			if (key.startsWith(`${name}_`)) return true;
			return false;
		});
		if (hit) return hit[1].trim();
	}
	return undefined;
}

/**
 * Resolve the markdown link color from design.md tokens.
 * Falls back to `inherit` (match body text) — never browser default blue.
 */
export function resolveMarkdownLinkColors(
	tokens?: Record<string, string>,
): Pick<OwlMarkdownOptions, 'linkColor'> {
	const light = pickDesignHexToken(tokens, LIGHT_LINK_TOKEN_KEYS);
	return { linkColor: light ?? 'inherit' };
}

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
	const color = linkColor?.trim() || 'inherit';
	return `color:${color};text-decoration:underline;font-weight:400;`;
}

/**
 * Email clients need inline styles on body links. Also ensure target/rel for
 * outbound URLs (see email formatting rules).
 */
function decorateMarkdownLinks(html: string, options?: OwlMarkdownOptions): string {
	const style = linkInlineStyle(options?.linkColor);

	return html.replace(/<a\b([^>]*)>/gi, (_full, rawAttrs: string) => {
		let attrs = rawAttrs;

		if (/\bstyle\s*=/i.test(attrs)) {
			attrs = attrs.replace(
				/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i,
				(_s, q: string, existing: string) => {
					const merged = `${style}${existing.trim()}`;
					return `style=${q}${merged}${q}`;
				},
			);
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
 * Links get email-safe underline + design-system (or inherited) colors.
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
	return decorateMarkdownLinks(html, options);
}

export function isInlineMarkdownHost(tagName: string): boolean {
	return INLINE_HOST_TAGS.has(tagName.toLowerCase());
}

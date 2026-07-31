export type DesignTokens = {
	colors: string[];
	fontFamilies: string[];
};

const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const FONT_FAMILY_RE =
	/(?:font-family\s*[:=]\s*|fonts?\s*[:=]\s*|`|"|')([A-Za-z][A-Za-z0-9\s-]{1,40})(?:`|"|'|;|,|$)/gi;
const TYPOGRAPHY_HEADING_RE = /^#{1,4}\s*.*(typography|font|typeface)/i;

const MAX_COLORS = 12;
const MAX_FONTS = 6;

const GENERIC_FONTS = new Set([
	'sans-serif',
	'serif',
	'monospace',
	'cursive',
	'fantasy',
	'system-ui',
	'ui-sans-serif',
	'ui-serif',
	'ui-monospace',
	'ui-rounded',
	'emoji',
	'math',
	'fangsong',
	'inherit',
	'initial',
	'unset',
	'default'
]);

function normalizeHex(hex: string): string {
	const h = hex.toLowerCase();
	if (h.length === 4) {
		return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
	}
	return h;
}

function normalizeFontFamily(name: string): string {
	return name
		.trim()
		.replace(/\s+/g, ' ')
		.replace(/^(font|fonts|typography)\s+/i, '');
}

function isLikelyFontName(name: string): boolean {
	const n = name.trim();
	if (n.length < 2 || n.length > 40) return false;
	if (GENERIC_FONTS.has(n.toLowerCase())) return false;
	if (/^\d+$/.test(n)) return false;
	if (/^(weight|size|style|color|primary|secondary|heading|body|text)$/i.test(n)) return false;
	return /^[A-Za-z]/.test(n);
}

/**
 * Best-effort extraction of design tokens from design.md for live previews.
 */
export function extractDesignTokens(md: string): DesignTokens {
	const colors: string[] = [];
	const colorSeen = new Set<string>();

	for (const match of md.matchAll(HEX_RE)) {
		const hex = normalizeHex(match[0]);
		if (colorSeen.has(hex)) continue;
		colorSeen.add(hex);
		colors.push(hex);
		if (colors.length >= MAX_COLORS) break;
	}

	const fontFamilies: string[] = [];
	const fontSeen = new Set<string>();
	const lines = md.split(/\r?\n/);

	function addFont(raw: string) {
		const name = normalizeFontFamily(raw);
		if (!isLikelyFontName(name)) return;
		const key = name.toLowerCase();
		if (fontSeen.has(key)) return;
		fontSeen.add(key);
		fontFamilies.push(name);
	}

	let inTypographySection = false;
	for (const line of lines) {
		if (TYPOGRAPHY_HEADING_RE.test(line)) {
			inTypographySection = true;
			continue;
		}
		if (/^#{1,4}\s+/.test(line) && !TYPOGRAPHY_HEADING_RE.test(line)) {
			inTypographySection = false;
		}

		if (inTypographySection || /font-family|typeface/i.test(line)) {
			for (const m of line.matchAll(FONT_FAMILY_RE)) {
				addFont(m[1]);
				if (fontFamilies.length >= MAX_FONTS) break;
			}
			// Backtick-quoted names: `Inter`
			for (const m of line.matchAll(/`([A-Za-z][A-Za-z0-9\s-]{1,40})`/g)) {
				addFont(m[1]);
				if (fontFamilies.length >= MAX_FONTS) break;
			}
		}
		if (fontFamilies.length >= MAX_FONTS) break;
	}

	// Fallback: scan whole doc for font-family: declarations
	if (fontFamilies.length === 0) {
		for (const m of md.matchAll(/font-family\s*[:=]\s*[`'"]?([A-Za-z][A-Za-z0-9\s-]{1,40})/gi)) {
			addFont(m[1]);
			if (fontFamilies.length >= MAX_FONTS) break;
		}
	}

	return { colors, fontFamilies };
}

const COLORS_HEADING_RE = /^#{1,4}\s*.*colors?\b/i;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Expand short hex (#abc) to long (#aabbcc) for <input type="color">. */
export function hexForColorInput(hex: string): string {
	const normalized = normalizeHex(hex);
	return normalized.length === 4
		? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
		: normalized;
}

function isValidHex(value: string): boolean {
	return /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value.trim());
}

/**
 * Replace every occurrence of `from` hex (any casing / short form) with `to`.
 */
export function replaceHexColor(md: string, from: string, to: string): string {
	if (!isValidHex(from) || !isValidHex(to)) return md;
	const target = normalizeHex(to);
	const fromNorm = normalizeHex(from);
	const short =
		fromNorm.length === 7 &&
		fromNorm[1] === fromNorm[2] &&
		fromNorm[3] === fromNorm[4] &&
		fromNorm[5] === fromNorm[6]
			? `#${fromNorm[1]}${fromNorm[3]}${fromNorm[5]}`
			: null;

	const patterns = [fromNorm];
	if (short && short !== fromNorm) patterns.push(short);
	if (from.toLowerCase() !== fromNorm) patterns.push(from.toLowerCase());

	let result = md;
	for (const pattern of patterns) {
		result = result.replace(new RegExp(escapeRegExp(pattern), 'gi'), target);
	}
	return result;
}

/**
 * Append a color to the Colors section, or create one if missing.
 */
export function addHexColor(md: string, hex: string, label = 'Accent'): string {
	if (!isValidHex(hex)) return md;
	const color = normalizeHex(hex);
	const existing = extractDesignTokens(md).colors;
	if (existing.some((c) => normalizeHex(c) === color)) return md;

	const lines = md.split(/\r?\n/);
	let colorsHeadingIdx = -1;
	let nextHeadingIdx = lines.length;

	for (let i = 0; i < lines.length; i++) {
		if (COLORS_HEADING_RE.test(lines[i])) {
			colorsHeadingIdx = i;
			continue;
		}
		if (colorsHeadingIdx >= 0 && /^#{1,4}\s+/.test(lines[i])) {
			nextHeadingIdx = i;
			break;
		}
	}

	const bullet = `- ${label}: \`${color}\``;
	if (colorsHeadingIdx < 0) {
		const block = ['', '## Colors', bullet, ''];
		const trimmed = md.trimEnd();
		return trimmed ? `${trimmed}\n${block.join('\n')}` : `## Colors\n${bullet}\n`;
	}

	let insertAt = nextHeadingIdx;
	while (insertAt > colorsHeadingIdx + 1 && lines[insertAt - 1].trim() === '') {
		insertAt--;
	}
	lines.splice(insertAt, 0, bullet);
	return lines.join('\n');
}

/**
 * Remove a hex color from design.md (list lines that only carry that swatch, else strip the hex).
 */
export function removeHexColor(md: string, hex: string): string {
	if (!isValidHex(hex)) return md;
	const target = normalizeHex(hex);
	const short =
		target.length === 7 &&
		target[1] === target[2] &&
		target[3] === target[4] &&
		target[5] === target[6]
			? `#${target[1]}${target[3]}${target[5]}`
			: null;
	const hexAlt = short ? `${escapeRegExp(target)}|${escapeRegExp(short)}` : escapeRegExp(target);
	const hexRe = new RegExp(hexAlt, 'i');

	const lines = md.split(/\r?\n/);
	const kept: string[] = [];
	for (const line of lines) {
		if (!hexRe.test(line)) {
			kept.push(line);
			continue;
		}
		const withoutHex = line.replace(new RegExp(hexAlt, 'gi'), '').replace(/\s+/g, ' ').trim();
		// Drop bullet/definition lines that only existed for this color
		if (/^[-*+]\s*`?[^`]*`?:?\s*$/.test(withoutHex) || /^[-*+]\s*$/.test(withoutHex)) {
			continue;
		}
		if (/^[-*+]\s+[A-Za-z][\w\s-]*:\s*$/.test(withoutHex)) {
			continue;
		}
		kept.push(line.replace(new RegExp(hexAlt, 'gi'), '').replace(/[ \t]+\n/g, '\n').replace(/`\s*`/g, '').trimEnd());
	}
	return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

export type EmailLogoPair<T> = {
	light: T;
	dark: T;
};

export function isDarkLogoAsset(asset: { name: string; filename: string }): boolean {
	return /dark/i.test(asset.name) || /dark/i.test(asset.filename);
}

/**
 * Deterministic light/dark logo pairing for email.
 * Classifies by name/filename (`dark` → dark; otherwise light), stable-sorts by name then id.
 * If only one logo exists, both slots point at it.
 */
export function pickEmailLogos<T extends { id: string; name: string; filename: string }>(
	logos: T[]
): EmailLogoPair<T> | undefined {
	if (logos.length === 0) return undefined;

	const sorted = [...logos].sort(
		(a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
	);
	const light = sorted.find((a) => !isDarkLogoAsset(a)) ?? sorted[0];
	const dark = sorted.find((a) => isDarkLogoAsset(a)) ?? light;
	return { light, dark };
}

/**
 * Force light/dark for in-app preview (OS prefers-color-scheme cannot be toggled on {@html}).
 * Rewrites a copy only — never mutate stored template HTML.
 */
export function applyPreviewColorScheme(html: string, scheme: 'light' | 'dark'): string {
	const darkMediaRe = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/gi;

	let result =
		scheme === 'dark'
			? unwrapPrefersColorSchemeBlocks(html, darkMediaRe, 'keep')
			: unwrapPrefersColorSchemeBlocks(html, darkMediaRe, 'strip');

	if (scheme === 'dark') {
		result +=
			'<style data-owlery-preview-scheme>.logo-light{display:none!important}.logo-dark{display:inline-block!important}</style>';
	} else {
		result +=
			'<style data-owlery-preview-scheme>.logo-dark{display:none!important}.logo-light{display:inline-block!important}</style>';
	}

	return result;
}

/**
 * Walk CSS-ish text and either strip or unwrap `@media (prefers-color-scheme: dark) { ... }` blocks.
 * Handles nested braces.
 */
function unwrapPrefersColorSchemeBlocks(
	html: string,
	mediaStartRe: RegExp,
	mode: 'keep' | 'strip'
): string {
	let out = '';
	let i = 0;
	const re = new RegExp(mediaStartRe.source, mediaStartRe.flags);

	while (i < html.length) {
		re.lastIndex = i;
		const match = re.exec(html);
		if (!match) {
			out += html.slice(i);
			break;
		}

		out += html.slice(i, match.index);
		const bodyStart = match.index + match[0].length;
		let depth = 1;
		let j = bodyStart;
		while (j < html.length && depth > 0) {
			const ch = html[j];
			if (ch === '{') depth++;
			else if (ch === '}') depth--;
			j++;
		}
		const body = html.slice(bodyStart, j - 1);
		if (mode === 'keep') {
			out += body;
		}
		// mode === 'strip': omit media query and body
		i = j;
	}

	return out;
}

const PLACEHOLDER_LOGO =
	"data:image/svg+xml," +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="140" height="40" viewBox="0 0 140 40"><rect width="140" height="40" rx="6" fill="#e2e8f0"/><text x="70" y="25" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#64748b">Logo</text></svg>`
	);
const PLACEHOLDER_IMAGE =
	"data:image/svg+xml," +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300"><rect width="600" height="300" rx="12" fill="#e2e8f0"/><text x="300" y="155" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#64748b">Image</text></svg>`
	);

/** Sample prop / {{placeholder}} values for design-system and template previews. */
export function previewSampleValues(overrides?: Record<string, string>): Record<string, string> {
	return {
		cta_label: 'Click here',
		cta_url: 'https://example.com',
		button_label: 'Get started',
		button_url: 'https://example.com',
		link_label: 'Learn more',
		link_url: 'https://example.com',
		primary_cta_label: 'Get started',
		primary_cta_url: 'https://example.com',
		secondary_cta_label: 'Learn more',
		secondary_cta_url: 'https://example.com',
		header_url: 'https://example.com',
		header_text: 'Weekly digest',
		brand_name: 'Acme Inc',
		eyebrow: 'New this week',
		headline: 'Welcome aboard',
		title: 'Hello there',
		body: 'A short supporting sentence that shows how this section reads in email.',
		body_text: 'A short supporting sentence that shows how this section reads in email.',
		subject: 'Your weekly update',
		name: 'Alex',
		first_name: 'Alex',
		firstName: 'Alex',
		last_name: 'River',
		lastName: 'River',
		company: 'Acme Inc',
		email: 'alex@example.com',
		unsubscribe_label: 'Unsubscribe',
		unsubscribe_url: 'https://example.com/unsubscribe',
		logo: PLACEHOLDER_LOGO,
		logo_url: PLACEHOLDER_LOGO,
		logo_light: PLACEHOLDER_LOGO,
		logo_dark: PLACEHOLDER_LOGO,
		logo_dark_url: PLACEHOLDER_LOGO,
		image: PLACEHOLDER_IMAGE,
		image_url: PLACEHOLDER_IMAGE,
		year: String(new Date().getFullYear()),
		...overrides
	};
}

function resolvePreviewSample(
	key: string,
	samples: Record<string, string>,
	overrides?: Record<string, string>
): string {
	const lower = key.toLowerCase();
	const byLower = new Map(Object.entries(samples).map(([k, v]) => [k.toLowerCase(), v]));
	const exact = byLower.get(lower);
	if (exact !== undefined) return exact;
	if (overrides) {
		for (const [overrideKey, value] of Object.entries(overrides)) {
			if (overrideKey.toLowerCase() === lower) return value;
		}
	}
	if (lower.includes('url') || lower.includes('href') || lower.includes('link')) {
		return 'https://example.com';
	}
	if (lower.includes('logo')) return samples.logo_url ?? PLACEHOLDER_LOGO;
	if (lower.includes('image') || lower.includes('img')) {
		return samples.image_url ?? PLACEHOLDER_IMAGE;
	}
	if (
		lower.includes('label') ||
		lower.includes('text') ||
		lower.includes('title') ||
		lower.includes('headline') ||
		lower.includes('body') ||
		lower.includes('eyebrow')
	) {
		return 'Sample text';
	}
	if (lower === 'name' || lower.endsWith('_name')) {
		return 'Sample text';
	}
	return key.replace(/_/g, ' ');
}

/**
 * Substitute {{variable}} placeholders with sample values for preview only.
 * Pass `overrides` to inject real design-system URLs (e.g. logo).
 */
export function substitutePreviewPlaceholders(
	html: string,
	overrides?: Record<string, string>
): string {
	const samples = previewSampleValues(overrides);

	return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) =>
		resolvePreviewSample(key, samples, overrides)
	);
}

/**
 * Turn a Svelte email component source into static HTML for preview,
 * filling $props() with sample / design-system values.
 */
export function renderSvelteComponentPreview(
	source: string,
	overrides?: Record<string, string>
): string {
	const samples = previewSampleValues(overrides);
	let markup = source.replace(/<script[\s\S]*?<\/script>/gi, '');

	// Unwrap {#if} blocks from the inside out (keep truthy branch; drop {:else…}).
	const innermostIf =
		/\{#if\s+[^}]+\}((?:(?!\{#if)[\s\S])*?)(?:\{:else(?:\s+if\s+[^}]+)?\}(?:(?!\{#if)[\s\S])*?)?\{\/if\}/g;
	let previous = '';
	while (markup !== previous) {
		previous = markup;
		markup = markup.replace(innermostIf, '$1');
	}

	const sampleFor = (key: string) => resolvePreviewSample(key, samples, overrides);

	// Attribute bindings: src={logo_url}, href={primary_cta_url || '#'}, alt={brand_name || 'Logo'}
	markup = markup.replace(
		/\b([a-zA-Z_:][a-zA-Z0-9_:-]*)=\{([a-z][a-z0-9_]*)(?:\s*\|\|\s*(?:'[^']*'|"[^"]*"|[a-z][a-z0-9_]*))?\}/g,
		(_full, attr: string, key: string) => `${attr}="${sampleFor(key)}"`
	);

	// Text expressions: {headline}, {body || body_text}, {brand_name || 'Logo'}
	markup = markup.replace(
		/\{([a-z][a-z0-9_]*)(?:\s*\|\|\s*(?:'[^']*'|"[^"]*"|([a-z][a-z0-9_]*)))?\}/g,
		(_full, key: string, altKey?: string) => {
			const primary = sampleFor(key);
			if (primary && primary !== key.replace(/_/g, ' ')) return primary;
			if (altKey) return sampleFor(altKey);
			return primary;
		}
	);

	return substitutePreviewPlaceholders(markup.trim(), overrides);
}

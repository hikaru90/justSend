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

/**
 * Substitute {{variable}} placeholders with sample values for preview only.
 * Pass `overrides` to inject real design-system URLs (e.g. logo).
 */
export function substitutePreviewPlaceholders(
	html: string,
	overrides?: Record<string, string>
): string {
	const samples: Record<string, string> = {
		cta_label: 'Click here',
		cta_url: 'https://example.com',
		button_label: 'Get started',
		button_url: 'https://example.com',
		link_label: 'Learn more',
		link_url: 'https://example.com',
		headline: 'Welcome aboard',
		title: 'Hello there',
		subject: 'Your weekly update',
		name: 'Alex',
		first_name: 'Alex',
		company: 'Acme Inc',
		email: 'alex@example.com',
		unsubscribe_url: 'https://example.com/unsubscribe',
		logo: 'https://placehold.co/120x40/png?text=Logo',
		logo_url: 'https://placehold.co/120x40/png?text=Logo',
		logo_light: 'https://placehold.co/120x40/png?text=Logo',
		logo_dark: 'https://placehold.co/120x40/png?text=Logo',
		logo_dark_url: 'https://placehold.co/120x40/png?text=Logo',
		image: 'https://placehold.co/600x300/png?text=Image',
		image_url: 'https://placehold.co/600x300/png?text=Image',
		year: String(new Date().getFullYear()),
		...overrides
	};

	return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, key: string) => {
		const lower = key.toLowerCase();
		if (samples[lower]) return samples[lower];
		if (overrides) {
			for (const [overrideKey, value] of Object.entries(overrides)) {
				if (lower.includes(overrideKey.toLowerCase())) return value;
			}
		}
		if (lower.includes('url') || lower.includes('href') || lower.includes('link')) {
			return 'https://example.com';
		}
		if (lower.includes('logo') || lower.includes('image') || lower.includes('img')) {
			return samples.logo;
		}
		if (lower.includes('label') || lower.includes('text') || lower.includes('title')) {
			return 'Sample text';
		}
		return full.replace(/[{}]/g, '').replace(/_/g, ' ');
	});
}

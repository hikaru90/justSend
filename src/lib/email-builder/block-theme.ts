/**
 * Map design.md color tokens onto default email-builder block props/styles.
 */
import { BLOCK_FACTORIES, EMPTY_DOCUMENT, type TEditorBlock, type TEditorConfiguration } from './types';

export type BlockTheme = {
	primary: string;
	onPrimary: string;
	text: string;
	muted: string;
	canvas: string;
	backdrop: string;
	/** Dark-mode defaults stored on new blocks / empty docs (not derived at render). */
	darkCanvas: string;
	darkBackdrop: string;
	darkText: string;
	darkPrimary: string;
	darkOnPrimary: string;
	darkMuted: string;
};

const DEFAULT_THEME: BlockTheme = {
	primary: '#000000',
	onPrimary: '#FFFFFF',
	text: '#262626',
	muted: '#CCCCCC',
	canvas: '#FFFFFF',
	backdrop: '#F5F5F5',
	darkCanvas: '#1a1a1a',
	darkBackdrop: '#0a0a0a',
	darkText: '#f2f2f2',
	darkPrimary: '#FFFFFF',
	darkOnPrimary: '#111111',
	darkMuted: '#555555',
};

function normalizeHex(hex: string): string {
	const h = hex.trim().toLowerCase();
	if (/^#[0-9a-f]{3}$/.test(h)) {
		return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
	}
	if (/^#[0-9a-f]{6}$/.test(h)) return h;
	return '';
}

function luminance(hex: string): number {
	const n = normalizeHex(hex);
	if (!n) return 0;
	const r = parseInt(n.slice(1, 3), 16) / 255;
	const g = parseInt(n.slice(3, 5), 16) / 255;
	const b = parseInt(n.slice(5, 7), 16) / 255;
	const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastOn(bg: string): string {
	return luminance(bg) > 0.45 ? '#111111' : '#FFFFFF';
}

function isNearWhite(hex: string): boolean {
	return luminance(hex) > 0.85;
}

function isNearBlack(hex: string): boolean {
	return luminance(hex) < 0.12;
}

function formatHex(r: number, g: number, b: number): string {
	return (
		'#' +
		[r, g, b]
			.map((c) =>
				Math.max(0, Math.min(255, Math.round(c)))
					.toString(16)
					.padStart(2, '0'),
			)
			.join('')
	);
}

/** Darken a light hex toward near-black for dark-mode canvas/backdrop defaults. */
function darkenForDarkMode(hex: string, targetLuma: number): string {
	const n = normalizeHex(hex);
	if (!n) return formatHex(Math.round(targetLuma * 255), Math.round(targetLuma * 255), Math.round(targetLuma * 255));
	const L = luminance(n);
	if (L <= targetLuma + 0.05) return n;
	const v = Math.round(targetLuma * 255);
	return formatHex(v, v, v);
}

/** Derive a usable block theme from design.md color tokens (first colors win). */
export function resolveBlockTheme(colors: string[] | null | undefined): BlockTheme {
	const normalized = (colors ?? []).map(normalizeHex).filter(Boolean);
	if (normalized.length === 0) return { ...DEFAULT_THEME };

	const byLuma = [...normalized].sort((a, b) => luminance(a) - luminance(b));
	const darkest = byLuma[0]!;
	const lightest = byLuma[byLuma.length - 1]!;

	// First non-white token is usually the brand primary in design.md order.
	const primary =
		normalized.find((c) => !isNearWhite(c)) ?? normalized[0] ?? DEFAULT_THEME.primary;

	const text = isNearBlack(darkest) || luminance(darkest) < 0.4 ? darkest : DEFAULT_THEME.text;
	const canvas = isNearWhite(lightest) ? lightest : DEFAULT_THEME.canvas;
	const muted =
		normalized.find(
			(c) =>
				c !== primary &&
				c !== text &&
				!isNearWhite(c) &&
				!isNearBlack(c) &&
				luminance(c) > 0.35,
		) ?? DEFAULT_THEME.muted;
	const backdrop =
		normalized.find((c) => c !== canvas && luminance(c) > 0.7 && luminance(c) < 0.95) ??
		DEFAULT_THEME.backdrop;

	const darkText = isNearWhite(lightest) ? lightest : DEFAULT_THEME.darkText;
	const darkCanvas = darkenForDarkMode(canvas, 0.1);
	const darkBackdrop = darkenForDarkMode(backdrop, 0.04);
	// Prefer a light brand accent as dark-mode primary when available; else invert contrast.
	const darkPrimary =
		normalized.find((c) => !isNearBlack(c) && luminance(c) > 0.5 && c !== canvas) ??
		(luminance(primary) > 0.45 ? primary : DEFAULT_THEME.darkPrimary);
	const darkOnPrimary = contrastOn(darkPrimary);
	const darkMuted =
		normalized.find(
			(c) =>
				c !== darkPrimary &&
				c !== darkText &&
				!isNearWhite(c) &&
				luminance(c) > 0.15 &&
				luminance(c) < 0.55,
		) ?? DEFAULT_THEME.darkMuted;

	return {
		primary,
		onPrimary: contrastOn(primary),
		text,
		muted,
		canvas,
		backdrop,
		darkCanvas,
		darkBackdrop,
		darkText,
		darkPrimary,
		darkOnPrimary,
		darkMuted,
	};
}

/** Apply brand colors onto a freshly created factory block. */
export function applyBlockTheme(block: TEditorBlock, theme: BlockTheme | null | undefined): TEditorBlock {
	if (!theme) return block;
	const style = { ...(block.data.style ?? {}) } as Record<string, unknown>;
	const darkStyle = { ...(block.data.darkStyle ?? {}) } as Record<string, unknown>;
	const props = { ...(block.data.props ?? {}) } as Record<string, unknown>;

	switch (block.type) {
		case 'Heading':
			return {
				...block,
				data: {
					...block.data,
					style: { ...style, color: theme.text },
					darkStyle: { ...darkStyle, color: theme.darkText },
				},
			};
		case 'Text':
			return {
				...block,
				data: {
					...block.data,
					style: { ...style, color: theme.text, fontWeight: style.fontWeight ?? 'normal' },
					darkStyle: { ...darkStyle, color: theme.darkText },
				},
			};
		case 'Button':
			return {
				...block,
				data: {
					...block.data,
					props: {
						...props,
						buttonBackgroundColor: theme.primary,
						buttonTextColor: theme.onPrimary,
						buttonBackgroundColorDark: theme.darkPrimary,
						buttonTextColorDark: theme.darkOnPrimary,
					},
				},
			};
		case 'Divider':
			return {
				...block,
				data: {
					...block.data,
					props: {
						...props,
						lineColor: theme.muted,
						lineColorDark: theme.darkMuted,
					},
				},
			};
		default:
			return block;
	}
}

/** Create a built-in block, optionally themed from design.md colors. */
export function createFactoryBlock(
	type: string,
	theme?: BlockTheme | null,
): TEditorBlock | null {
	const factory = BLOCK_FACTORIES.find((f) => f.type === type);
	if (!factory) return null;
	return applyBlockTheme(factory.create(), theme);
}

/** Theme EmailLayout root colors when the document is still the stock empty canvas. */
export function themeEmptyDocument(
	document: TEditorConfiguration,
	theme?: BlockTheme | null,
): TEditorConfiguration {
	if (!theme) return document;
	const root = document.root;
	if (!root || root.type !== 'EmailLayout') return document;
	const children = root.data.childrenIds ?? [];
	if (children.length > 0) return document;

	const empty = EMPTY_DOCUMENT.root.data;
	const isStock =
		(root.data.backdropColor ?? empty.backdropColor) === empty.backdropColor &&
		(root.data.canvasColor ?? empty.canvasColor) === empty.canvasColor &&
		(root.data.textColor ?? empty.textColor) === empty.textColor;

	if (!isStock) return document;

	return {
		...document,
		root: {
			...root,
			data: {
				...root.data,
				backdropColor: theme.backdrop,
				canvasColor: theme.canvas,
				textColor: theme.text,
				darkBackdropColor: theme.darkBackdrop,
				darkCanvasColor: theme.darkCanvas,
				darkTextColor: theme.darkText,
			},
		},
	};
}

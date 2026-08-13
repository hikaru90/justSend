/**
 * Enforce explicit opaque inline colors on every visible body element.
 *
 * Apple Mail (WebKit) auto-inverts when background/text colors are implicit,
 * transparent, or cascade-dependent. Filling every node with an explicit hex
 * `background-color` and `color` (inherited from the nearest ancestor) keeps
 * the light look identical in dark mode — layered on top of the existing
 * light-override shield.
 *
 * Skip rules (filling these would break rendering):
 * - `<img>` — transparent PNGs must not get a colored box
 * - `display:none` — no visual surface (e.g. preheader)
 * - `.gmail-blend-screen` / `.gmail-blend-difference` — must stay transparent
 *   so the compiler's Gmail blend CSS (`background:#000;mix-blend-mode:…`)
 *   can apply (inline bg would override it)
 *
 * Idempotent: only fills missing/no-op values (`override: false`), never
 * overwrites authored colors. Recompiling compiled output is a fixed point.
 */
import { type Document, type Element } from './parser';
import { OWL_CLASS, type OwlIssue } from './format';
import { mergeStyleDecls, parseStyleDecls, type Decl } from './style';

const DEFAULT_BG = '#FFFFFF';
const DEFAULT_COLOR = '#262626';

/** Values that do not count as an explicit opaque color. */
const NO_OP = new Set(['inherit', 'initial', 'unset', 'transparent', 'none', 'auto']);

function declOf(el: Element, prop: string): string | undefined {
	const decl = parseStyleDecls(el.getAttribute('style')).find(([p]) => p === prop);
	return decl?.[1];
}

function isNoOp(value: string | undefined): boolean {
	return !value || NO_OP.has(value.toLowerCase());
}

function hasClass(el: Element, cls: string): boolean {
	const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
	return classes.includes(cls);
}

function isDisplayNone(el: Element): boolean {
	const display = declOf(el, 'display');
	return Boolean(display && display.toLowerCase() === 'none');
}

/** Elements that must not receive filled background-color / color. */
function shouldSkipFill(el: Element): boolean {
	const tag = el.tagName.toLowerCase();
	if (tag === 'img') return true;
	if (isDisplayNone(el)) return true;
	if (hasClass(el, OWL_CLASS.gmailBlendScreen)) return true;
	if (hasClass(el, OWL_CLASS.gmailBlendDifference)) return true;
	return false;
}

/** Whether children of a skipped element should still be visited. */
function shouldWalkChildren(el: Element): boolean {
	// display:none subtree has no visual surface — skip descendants too.
	if (isDisplayNone(el)) return false;
	return true;
}

function fillMissing(
	el: Element,
	inheritedBg: string,
	inheritedColor: string,
): {
	bg: string;
	color: string;
} {
	const fills: Decl[] = [];
	const existingBg = declOf(el, 'background-color');
	const existingColor = declOf(el, 'color');

	let nextBg = inheritedBg;
	let nextColor = inheritedColor;

	if (isNoOp(existingBg)) {
		fills.push(['background-color', inheritedBg]);
		nextBg = inheritedBg;
	} else {
		nextBg = existingBg!;
	}

	if (isNoOp(existingColor)) {
		fills.push(['color', inheritedColor]);
		nextColor = inheritedColor;
	} else {
		nextColor = existingColor!;
	}

	if (fills.length > 0) {
		el.setAttribute(
			'style',
			mergeStyleDecls(el.getAttribute('style'), fills, /* override */ false),
		);
	}

	return { bg: nextBg, color: nextColor };
}

function visit(el: Element, inheritedBg: string, inheritedColor: string): void {
	if (shouldSkipFill(el)) {
		if (!shouldWalkChildren(el)) return;
		for (const child of el.childNodes ?? []) {
			if ((child as Element).tagName) {
				visit(child as Element, inheritedBg, inheritedColor);
			}
		}
		return;
	}

	const { bg, color } = fillMissing(el, inheritedBg, inheritedColor);

	for (const child of el.childNodes ?? []) {
		if ((child as Element).tagName) {
			visit(child as Element, bg, color);
		}
	}
}

/**
 * Walk the body tree and fill missing opaque inline background-color / color
 * on every visible element, inheriting from the nearest ancestor.
 */
export function enforceExplicitColors(doc: Document): OwlIssue[] {
	const body = doc.body;
	if (!body) return [];

	const bodyBg = isNoOp(declOf(body, 'background-color'))
		? DEFAULT_BG
		: declOf(body, 'background-color')!;
	const bodyColor = isNoOp(declOf(body, 'color')) ? DEFAULT_COLOR : declOf(body, 'color')!;

	// Body itself needs an explicit color (shell already has background-color).
	const { bg, color } = fillMissing(body, bodyBg, bodyColor);

	for (const child of body.childNodes ?? []) {
		if ((child as Element).tagName) {
			visit(child as Element, bg, color);
		}
	}

	return [];
}

/**
 * Light-pinning dark-mode override (the "always light" shield).
 *
 * Emails are always light. The shell pins `color-scheme: light only`, but a
 * handful of clients still force a dark transform on top of that (Apple Mail
 * inverts pure-white canvases when a meta is present, Outlook.com/apps do a
 * partial invert, Gmail apps ignore every opt-out). This pass injects
 * compiler-owned markup that re-asserts the SAME light colors:
 *
 * - `<style data-owl-light-css>` in <head> holding:
 *   * `@media (prefers-color-scheme: dark)` rules that pin every inline color
 *     back to its light value with `!important` (Apple Mail/iOS, Samsung,
 *     Proton, Outlook Mac, …),
 *   * `u + .body` Gmail blend-mode rules. Gmail cannot be opted out, so the
 *     email's own `.gmail-blend-screen`/`.gmail-blend-difference` wrappers
 *     keep white-on-color sections faithful through Gmail's conversion.
 * - `owll-<data-owl-id>` classes on every element that carries an inline
 *   color, so the media block has a stable, recompile-proof selector.
 * - `data-ogsc` / `data-ogsb` attributes stamped with the light values for
 *   Outlook.com / Outlook mobile dark mode.
 *
 * Values are read from the final compiled inline styles (after token
 * resolution) so pins always match the light design. Recompiling compiled
 * output is a fixed point: stale classes/attributes are cleared first.
 */
import { walkElements, type Document, type Element } from './parser';
import { OWL, OWL_CLASS, type OwlCompileContext, type OwlIssue } from './format';
import { addClass, parseStyleDecls, removeClassesByPrefix } from './style';

/** Inline properties that drive the light look and get pinned. */
const COLOR_PROPS = ['color', 'background-color', 'border-color', 'border-top-color'] as const;

/** Values that must not be pinned (no-op or non-literal). */
const NO_OP_VALUES = new Set(['inherit', 'initial', 'unset', 'auto', 'transparent']);

const GMAIL_BLEND_CSS =
	`u + .body .${OWL_CLASS.gmailBlendScreen}{background:#000;mix-blend-mode:screen;}` +
	`u + .body .${OWL_CLASS.gmailBlendDifference}{background:#000;mix-blend-mode:difference;}`;

function lightCssElement(doc: Document): Element {
	const existing = doc.head.querySelector(`style[${OWL.lightCss}]`);
	if (existing) return existing as Element;
	const style = doc.createElement('style');
	style.setAttribute(OWL.lightCss, '');
	doc.head.appendChild(style);
	return style;
}

function owlClassOf(el: Element): string {
	const id = el.getAttribute(OWL.id);
	return `${OWL_CLASS.lightOverride}-${id ?? 'x'}`;
}

/** [property, value] pairs that pin the light look for an element. */
function pinsOf(el: Element): Array<[prop: string, value: string]> {
	const out: Array<[prop: string, value: string]> = [];
	const decls = parseStyleDecls(el.getAttribute('style'));
	for (const prop of COLOR_PROPS) {
		const decl = decls.find(([p]) => p === prop);
		if (decl && decl[1] && !NO_OP_VALUES.has(decl[1].toLowerCase())) {
			out.push([decl[0], decl[1]]);
		}
	}
	return out;
}

export function applyLightOverride(doc: Document, ctx: OwlCompileContext): OwlIssue[] {
	// Clear stale compiler classes/attributes so a recompile is a fixed point.
	for (const el of walkElements(doc)) {
		removeClassesByPrefix(el, `${OWL_CLASS.lightOverride}-`);
		el.removeAttribute('data-ogsc');
		el.removeAttribute('data-ogsb');
	}

	const mediaRules: string[] = [];

	for (const el of walkElements(doc)) {
		// The <body> is a root element with no data-owl-id; pin it by tag.
		if (el.tagName.toLowerCase() === 'body') {
			const bg = parseStyleDecls(el.getAttribute('style')).find(([p]) => p === 'background-color');
			if (bg && bg[1] && !NO_OP_VALUES.has(bg[1].toLowerCase())) {
				mediaRules.push(`body{background-color:${bg[1]}!important;}`);
				el.setAttribute('data-ogsb', bg[1]);
			}
			continue;
		}

		const pins = pinsOf(el);
		if (pins.length === 0) continue;

		// Elements without a stable id can't get a pinned class; their colors
		// cascade from the canvas, which is pinned itself.
		const id = el.getAttribute(OWL.id);
		if (!id) continue;

		addClass(el, owlClassOf(el));
		mediaRules.push(
			`.${owlClassOf(el)}{${pins.map(([p, v]) => `${p}:${v}!important`).join(';')};}`,
		);

		const color = pins.find(([p]) => p === 'color');
		const bg = pins.find(([p]) => p === 'background-color');
		if (color) el.setAttribute('data-ogsc', color[1]);
		if (bg) el.setAttribute('data-ogsb', bg[1]);
	}

	const css = `@media (prefers-color-scheme:dark){${mediaRules.join('')}}${GMAIL_BLEND_CSS}`;
	lightCssElement(doc).textContent = css;
	return [];
}

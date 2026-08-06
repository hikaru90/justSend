/**
 * Dark-mode compilation.
 *
 * Every element with `data-owl-dark-style` gets:
 *   - class `owld-<data-owl-id>` (stable across compiles)
 *   - a rule in `<style data-owl-dark-css>` targeting that class with
 *     `@media (prefers-color-scheme: dark)` + `!important`
 *   - mirrored `data-ogsc` (color) / `data-ogsb` (background-color)
 *     attributes for Outlook.com / Outlook mobile dark mode.
 *
 * For forced-dark previews (ctx.colorScheme === 'dark') the dark styles are
 * promoted onto the inline `style` instead and the media block is cleared.
 */
import { walkElements, type Document, type Element } from './parser';
import { OWL, OWL_CLASS, type OwlCompileContext, type OwlIssue } from './format';
import { addClass, mergeStyleDecls, parseStyleDecls, removeClassesByPrefix } from './style';

function darkCssElement(doc: Document): Element {
	const existing = doc.head.querySelector(`style[${OWL.darkCss}]`);
	if (existing) return existing as Element;
	const style = doc.createElement('style');
	style.setAttribute(OWL.darkCss, '');
	doc.head.appendChild(style);
	return style;
}

function owlClassOf(el: Element): string {
	const id = el.getAttribute(OWL.id);
	return `${OWL_CLASS.darkOverride}-${id ?? 'x'}`;
}

export function applyDarkStyles(doc: Document, ctx: OwlCompileContext): OwlIssue[] {
	if (ctx.colorScheme === 'dark') {
		promoteDarkStyles(doc);
		return [];
	}

	// Clear stale compiler classes so a recompile is a fixed point.
	for (const el of walkElements(doc)) {
		removeClassesByPrefix(el, `${OWL_CLASS.darkOverride}-`);
		el.removeAttribute('data-ogsc');
		el.removeAttribute('data-ogsb');
	}

	const rules: string[] = [];
	for (const el of walkElements(doc)) {
		const darkStyle = el.getAttribute(OWL.darkStyle);
		if (!darkStyle) continue;
		const decls = parseStyleDecls(darkStyle);
		if (decls.length === 0) continue;

		addClass(el, owlClassOf(el));
		rules.push(`.${owlClassOf(el)}{${decls.map(([p, v]) => `${p}:${v}!important`).join(';')};}`);

		const color = decls.find(([p]) => p === 'color');
		const bg = decls.find(([p]) => p === 'background-color');
		if (color) el.setAttribute('data-ogsc', color[1]);
		if (bg) el.setAttribute('data-ogsb', bg[1]);
	}

	if (rules.length) {
		darkCssElement(doc).textContent = `@media (prefers-color-scheme:dark){${rules.join('')}}`;
	} else {
		darkCssElement(doc).textContent = '';
	}
	return [];
}

/** Promote dark styles onto inline style and clear the media block (preview). */
export function promoteDarkStyles(doc: Document): void {
	for (const el of walkElements(doc)) {
		const darkStyle = el.getAttribute(OWL.darkStyle);
		if (!darkStyle) continue;
		const existing = el.getAttribute('style');
		el.setAttribute('style', mergeStyleDecls(existing, parseStyleDecls(darkStyle), true));
		el.removeAttribute(OWL.darkStyle);
		removeClassesByPrefix(el, `${OWL_CLASS.darkOverride}-`);
		el.removeAttribute('data-ogsc');
		el.removeAttribute('data-ogsb');
	}
	const css = doc.head.querySelector(`style[${OWL.darkCss}]`) as Element | null;
	if (css) css.textContent = '';
}

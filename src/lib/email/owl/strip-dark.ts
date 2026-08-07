/**
 * Strip authored dark-mode variants.
 *
 * Emails are always light (see email-formatting-rules: "never author
 * dark-mode variants"). Templates authored before that rule — or by an AI
 * that ignored it — can still carry dual light/dark markup:
 *
 * - duplicate `<img data-owl-variant="dark">` / `.logo-dark` / `.owl-dark`
 *   elements next to the light one,
 * - `data-owl-dark-style` attributes and `<style data-owl-dark-css>` blocks,
 * - authored `@media (prefers-color-scheme: dark)` swap rules (e.g. in a
 *   doc-embedded base css),
 * - `color-scheme: light dark` metas that opt the email INTO dark mode.
 *
 * All of it passes straight through compile unless removed, and clients that
 * honor the dark media query (Apple Mail) then render the dark asset while
 * the browser preview shows the light one. This pass deletes the dark
 * variants and neutralizes the swap, keeping only the light markup. The
 * compiler-owned `data-owl-light-css` block is untouched — applyLightOverride
 * rewrites it wholesale later in the pipeline.
 */
import { walkElements, type Document } from './parser';
import { OWL, type OwlIssue } from './format';

const DARK_CLASSES = new Set(['logo-dark', 'owl-dark']);
const VARIANT_CLASSES = new Set(['logo-light', 'logo-dark', 'owl-light', 'owl-dark']);
const VARIANT_ATTRS = ['data-owl-variant', 'data-owl-variant-group', 'data-owl-dark-style'];

/** Remove `@media (prefers-color-scheme: dark) { … }` blocks (nested braces). */
function stripDarkMediaBlocks(css: string): string {
	const re = /@media[^{}]*prefers-color-scheme\s*:\s*dark[^{}]*\{/gi;
	let out = '';
	let i = 0;
	for (;;) {
		re.lastIndex = i;
		const m = re.exec(css);
		if (!m) {
			out += css.slice(i);
			return out;
		}
		out += css.slice(i, m.index);
		let depth = 1;
		let j = re.lastIndex;
		while (j < css.length && depth > 0) {
			if (css[j] === '{') depth += 1;
			else if (css[j] === '}') depth -= 1;
			j += 1;
		}
		i = j;
	}
}

/** Remove orphaned `.<dark-class>{…}` rules left behind by removed variants. */
function stripDarkClassRules(css: string): string {
	return css.replace(/[^{}]*(?:logo-dark|owl-dark)[^{}]*\{[^{}]*\}/g, '');
}

export function stripDarkVariants(doc: Document): OwlIssue[] {
	const issues: OwlIssue[] = [];
	let removed = 0;

	for (const el of [...walkElements(doc)]) {
		const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
		if (
			el.getAttribute('data-owl-variant') === 'dark' ||
			classes.some((c) => DARK_CLASSES.has(c))
		) {
			el.remove();
			removed += 1;
			continue;
		}
		for (const attr of VARIANT_ATTRS) el.removeAttribute(attr);
		const kept = classes.filter((c) => !VARIANT_CLASSES.has(c));
		if (kept.length !== classes.length) {
			if (kept.length) el.setAttribute('class', kept.join(' '));
			else el.removeAttribute('class');
		}
	}

	for (const el of [...walkElements(doc)]) {
		const tag = el.tagName.toLowerCase();
		if (tag === 'style') {
			if (el.hasAttribute(OWL.lightCss)) continue;
			if (el.hasAttribute('data-owl-dark-css')) {
				el.remove();
				continue;
			}
			const css = el.textContent ?? '';
			const stripped = stripDarkClassRules(stripDarkMediaBlocks(css));
			if (stripped !== css) el.textContent = stripped;
			continue;
		}
		if (tag === 'meta') {
			const name = (el.getAttribute('name') ?? '').toLowerCase();
			if (name === 'color-scheme' || name === 'supported-color-schemes') {
				el.setAttribute('content', 'light only');
			}
		}
	}

	if (removed > 0) {
		issues.push({
			code: 'strip-dark.variants',
			severity: 'warning',
			message: `Removed ${removed} dark-mode variant element(s) — emails are always light.`,
		});
	}
	return issues;
}

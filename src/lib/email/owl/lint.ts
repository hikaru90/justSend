/**
 * Static email-compatibility lint. Produces issues but never throws — the
 * compiler always emits output. Rules are grounded in caniemail.org support
 * data (style block size, alt/href hygiene).
 */
import { walkElements, type Document } from './parser';
import { OWL, OWL_CLASS, type OwlIssue } from './format';
import { parseStyleDecls } from './style';

const GMAIL_STYLE_LIMIT = 16 * 1024;
const INERT_CLASS_PREFIXES = new Set([
	OWL_CLASS.stack,
	OWL_CLASS.gmailBlendScreen,
	OWL_CLASS.gmailBlendDifference,
	`${OWL_CLASS.lightOverride}-`,
]);

function hasText(el: { textContent?: string | null }): boolean {
	return Boolean(el.textContent?.trim());
}

export function lintDocument(doc: Document, renderedHtml?: string): OwlIssue[] {
	const issues: OwlIssue[] = [];
	const html = renderedHtml ?? '';
	const idOf = (el: { getAttribute(name: string): string | null }) =>
		el.getAttribute(OWL.id) ?? undefined;

	// Global structure.
	if (!doc.documentElement?.getAttribute('lang')) {
		issues.push({ code: 'lint.missing-lang', severity: 'warning', message: 'Missing lang attribute on <html>.', owlId: 'html' });
	}

	// Marketing templates must carry an unsubscribe placeholder.
	if (renderedHtml && !/unsubscribe_url/.test(html)) {
		issues.push({
			code: 'lint.unsubscribe-missing',
			severity: 'error',
			message: 'Marketing email has no {{unsubscribe_url}} placeholder.',
			owlId: 'body',
		});
	}

	// Head style budget (Gmail ignores styles over 16 KB).
	const styleTotal = [...(doc.head?.childNodes ?? [])]
		.filter((n) => (n as Element).tagName?.toLowerCase() === 'style')
		.map((n) => (n as Element).textContent ?? '')
		.join('').length;
	if (styleTotal > GMAIL_STYLE_LIMIT) {
		issues.push({
			code: 'lint.style-size',
			severity: 'warning',
			message: `Embedded <style> is ${styleTotal} bytes; Gmail caps at ${GMAIL_STYLE_LIMIT}.`,
			owlId: 'head',
		});
	}

	for (const el of walkElements(doc)) {
		const tag = el.tagName.toLowerCase();
		const owlId = idOf(el);

		if (tag === 'img') {
			if (!el.getAttribute('src')) {
				issues.push({ code: 'lint.img-missing-src', severity: 'error', message: '<img> has no src.', owlId });
			}
			if (!el.getAttribute('alt')) {
				issues.push({ code: 'lint.img-missing-alt', severity: 'warning', message: '<img> is missing alt text.', owlId });
			}
		}

		if (tag === 'a') {
			const href = el.getAttribute('href');
			if (!href || href === '#') {
				issues.push({ code: 'lint.a-missing-href', severity: 'warning', message: '<a> has no usable href.', owlId });
			}
		}

		if (tag === 'table') {
			const role = el.getAttribute('role');
			const isComponentRoot = Boolean(el.getAttribute(OWL.component));
			if (!role && !isComponentRoot) {
				issues.push({
					code: 'lint.table-role',
					severity: 'warning',
					message: 'Layout <table> should use role="presentation".',
					owlId,
				});
			}
		}

		if (tag === 'td' || tag === 'th') {
			if (el.getAttribute('background') && !el.getAttribute('bgcolor')) {
				issues.push({
					code: 'lint.bg-color',
					severity: 'warning',
					message: 'Cells with a background image should also set bgcolor (Outlook falls back to it).',
					owlId,
				});
			}
		}

		// Muted footer text below 14px is intentional and easy to miss; warn.
		if (hasText(el)) {
			const fontSize = parseStyleDecls(el.getAttribute('style')).find(([p]) => p === 'font-size');
			if (fontSize) {
				const px = parseFloat(fontSize[1]);
				if (Number.isFinite(px) && px < 14) {
					issues.push({
						code: 'lint.body-font-size',
						severity: 'warning',
						message: `Text at ${px}px is hard to read on small screens; prefer 14px+ (16px for body copy).`,
						owlId,
					});
				}
			}
		}

		// Class-based styling without an inline fallback is a delivery risk.
		const cls = el.getAttribute('class') ?? '';
		const classes = cls.split(/\s+/).filter(Boolean);
		const hasInline = Boolean(el.getAttribute('style'));
		const nonInert = classes.filter((c) => ![...INERT_CLASS_PREFIXES].some((p) => c === p || c.startsWith(p)));
		if (nonInert.length > 0 && !hasInline) {
			issues.push({
				code: 'lint.class-without-inline',
				severity: 'warning',
				message: `Element uses class(es) [${nonInert.join(', ')}] but has no inline style; some clients will drop it.`,
				owlId,
			});
		}
	}

	return issues;
}

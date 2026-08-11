/**
 * Heal: make incoming HTML (human- or AI-authored) structurally valid and
 * email-safe before normalize/compile. Mutates the parsed document.
 * Deterministic: same input -> same mutated tree.
 */
import { walkElements, type Document, type Element } from './parser';
import type { OwlIssue } from './format';

const BANNED_TAGS = new Set([
	'script',
	'iframe',
	'object',
	'embed',
	'form',
	'input',
	'button',
	'select',
	'textarea',
	'link',
	'meta',
	'noscript',
]);

function setAttrSafe(el: Element, name: string, value: string): void {
	try {
		el.setAttribute(name, value);
	} catch {
		/* invalid attribute name — drop it */
	}
}

export function healDocument(doc: Document): OwlIssue[] {
	const issues: OwlIssue[] = [];

	// 1. Drop banned elements (scripts, form controls, external links, ...).
	for (const el of [...walkElements(doc)]) {
		const tag = el.tagName.toLowerCase();
		const inHead = el.parentNode === doc.head || el.closest('head');
		if (BANNED_TAGS.has(tag) && !(inHead && (tag === 'meta' || tag === 'link'))) {
			const id = el.getAttribute('data-owl-id') ?? '';
			el.remove();
			if (tag === 'script') {
				issues.push({
					code: 'heal.banned-tag',
					severity: 'error',
					message: `Removed <${tag}> — scripts are not allowed in email HTML.`,
					owlId: id || undefined,
				});
			}
		}
	}

	// 2. Move <style> elements out of the body into <head>.
	const head = doc.head;
	if (head) {
		for (const el of [...walkElements(doc.body ?? doc)]) {
			if (el.tagName.toLowerCase() === 'style') {
				el.remove();
				head.appendChild(el);
			}
		}
	}

	// 3. Wrap bare <tr> runs inside <tbody>.
	for (const el of [...walkElements(doc)]) {
		if (el.tagName.toLowerCase() !== 'table') continue;
		const children = [...el.childNodes];
		let tbody: Element | null = null;
		for (const child of children) {
			const isTr = (child as Element).tagName?.toLowerCase() === 'tr';
			if (isTr) {
				if (!tbody) {
					tbody = doc.createElement('tbody');
					el.insertBefore(tbody as unknown as Node, child);
				}
				(tbody as Element).appendChild(child);
			} else {
				tbody = null;
			}
		}
	}

	// 4. Attribute hygiene.
	for (const el of [...walkElements(doc)]) {
		for (const attr of [...el.attributes]) {
			if (/^on/i.test(attr.name)) {
				el.removeAttribute(attr.name);
				continue;
			}
			if (attr.name === 'href' || attr.name === 'src' || attr.name === 'background') {
				const value = attr.value.trim().toLowerCase();
				if (
					value.startsWith('javascript:') ||
					value.startsWith('vbscript:') ||
					value.startsWith('data:')
				) {
					setAttrSafe(el, attr.name, value.startsWith('data:') ? '' : '#');
				}
			}
		}
	}

	return issues;
}

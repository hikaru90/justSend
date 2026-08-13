/**
 * Normalize: assign stable `data-owl-id` values to every element in the body
 * in document order. Existing ids are preserved (so the editor / compiled
 * output stay stable across recompiles); only missing ids are minted.
 */
import { walkElements, type Document } from './parser';
import { OWL } from './format';

export function normalizeDocument(doc: Document): void {
	let counter = 0;
	const root = doc.body ?? doc.documentElement ?? doc;
	for (const el of walkElements(root)) {
		const tag = el.tagName.toLowerCase();
		if (tag === 'head' || tag === 'html') continue;
		if (el.getAttribute(OWL.id)) continue;
		counter += 1;
		el.setAttribute(OWL.id, `w${counter}`);
	}
}

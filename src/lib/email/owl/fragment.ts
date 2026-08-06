/**
 * Server-safe helpers for Owl section fragments (linkedom — no browser DOMParser).
 */
import { OWL } from './format';
import { normalizeDocument } from './normalize';
import { importNodes, parseDocument, parseFragment, serialize, walkElements } from './parser';

/** Normalize ids and return canonical fragment HTML for library storage. */
export function prepareOwlSectionFragment(html: string): string {
	const trimmed = html.trim();
	if (!trimmed) return '';

	const nodes = parseFragment(trimmed);
	if (nodes.length === 0) return trimmed;

	const doc = parseDocument('<!DOCTYPE html><html><head></head><body></body></html>');
	importNodes(doc, nodes, doc.body);
	normalizeDocument(doc);

	return [...doc.body.childNodes].map((node) => serialize(node)).join('');
}

/** Ensure the section root carries owl component markers for the library. */
export function annotateOwlSectionRoot(html: string, componentKey: string): string {
	const prepared = prepareOwlSectionFragment(html);
	if (!prepared) return prepared;

	const nodes = parseFragment(prepared);
	if (nodes.length === 0) return prepared;

	const doc = parseDocument('<!DOCTYPE html><html><head></head><body></body></html>');
	importNodes(doc, nodes, doc.body);

	const root = doc.body.firstElementChild;
	if (root) {
		if (!root.getAttribute(OWL.role)) root.setAttribute(OWL.role, 'section');
		if (!root.getAttribute(OWL.component)) root.setAttribute(OWL.component, componentKey);
	}

	return [...doc.body.childNodes].map((node) => serialize(node)).join('');
}

export function isOwlSectionHtml(html: string): boolean {
	return /\bdata-owl-(component|role|slot)\b/.test(html);
}

/** First element with data-owl-role="section", else first element child. */
export function owlSectionRootKey(html: string): string | null {
	const nodes = parseFragment(html.trim());
	if (nodes.length === 0) return null;

	const doc = parseDocument('<!DOCTYPE html><html><head></head><body></body></html>');
	importNodes(doc, nodes, doc.body);

	for (const el of walkElements(doc.body)) {
		if (el.getAttribute(OWL.role) === 'section') {
			return el.getAttribute(OWL.component)?.trim() || null;
		}
	}

	const root = doc.body.firstElementChild;
	return root?.getAttribute(OWL.component)?.trim() || null;
}

/**
 * Pinned parser + serializer for Owl HTML.
 *
 * linkedom is the single source of truth for parsing/serializing. The
 * serializer emits a deterministic fixed point: re-parsing a serialized
 * document and re-serializing yields byte-identical output. A small entity
 * post-pass keeps `&nbsp;` / `&zwnj;` readable while remaining idempotent.
 */
import { parseHTML } from 'linkedom';
import type { Document, Element, Node } from 'linkedom';

export type OwlDocument = Document;

const WRAP = (inner: string) => `<!DOCTYPE html><html><head></head><body>${inner}</body></html>`;

/** Parse a full HTML document (canonical for templates/shells). */
export function parseDocument(html: string): Document {
	return parseHTML(html).document;
}

/** Parse an HTML fragment (a component/section) into detached body child nodes. */
export function parseFragment(html: string): Node[] {
	const { document } = parseHTML(WRAP(html));
	return [...document.body.childNodes];
}

/** Serialize a document/node tree with the canonical entity post-pass. */
export function serialize(doc: Document | Element | Node): string {
	return entityPostPass(doc.toString());
}

function entityPostPass(html: string): string {
	return html
		.replace(/&#160;/g, '&nbsp;')
		.replace(/\u00a0/g, '&nbsp;')
		.replace(/\u200c/g, '&zwnj;');
}

/** Depth-first walk over every node (elements, text, comments). */
export function* walk(node: Node): Generator<Node> {
	for (const child of node.childNodes ?? []) {
		yield child;
		if (child.childNodes?.length) yield* walk(child);
	}
}

/** Depth-first walk over element nodes only. */
export function* walkElements(node: Node): Generator<Element> {
	for (const child of node.childNodes ?? []) {
		if ((child as Element).tagName) yield child as Element;
		if (child.childNodes?.length) yield* walkElements(child);
	}
}

/** Find the first comment whose trimmed nodeValue equals `anchor`. */
export function findComment(root: Node, anchor: string): Node | null {
	for (const node of walk(root)) {
		if (node.nodeType === 8 && (node.nodeValue ?? '').trim() === anchor) return node;
	}
	return null;
}

/** Import detached nodes (from a fragment parse) into a document's tree. */
export function importNodes(doc: Document, nodes: Node[], target: Node): void {
	for (const node of nodes) {
		target.appendChild(doc.importNode(node, true));
	}
}

/** Replace a marker comment with detached fragment nodes. */
export function spliceAtComment(root: Node, anchor: string, fragmentHtml: string): boolean {
	const doc =
		root.nodeType === 9
			? (root as unknown as Document)
			: (root as { ownerDocument?: Document }).ownerDocument;
	const marker = findComment(root, anchor);
	const parent = marker?.parentNode;
	if (!marker || !parent || !doc) return false;
	const nodes = parseFragment(fragmentHtml);
	for (const node of nodes) parent.insertBefore(doc.importNode(node, true), marker);
	(marker as unknown as { remove(): void }).remove();
	return true;
}

/** Replace a marker comment with a raw string (for the preheader fallback). */
export function spliceRawAtComment(root: Node, anchor: string, html: string): boolean {
	const marker = findComment(root, anchor);
	if (!marker) return false;
	(marker as unknown as { replaceWith(n: unknown): void }).replaceWith(html);
	return true;
}

export type { Document, Element, Node };

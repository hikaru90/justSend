/**
 * Slots: declared content targets (`data-owl-slot`). Extraction drives the
 * Content panel and AI scaffold; `applySlotValues` fills values into the DOM
 * at compose time (deterministic). Text slots accept Markdown and are rendered
 * to sanitized HTML (preheader stays plain text).
 */
import { normalizeDesignAssetSrc } from '$lib/design-asset-urls';
import { walkElements, parseFragment, parseDocument, importNodes, type Document, type Element } from './parser';
import { normalizeDocument } from './normalize';
import { OWL, OWL_SLOT_TYPES, type OwlSlot, type OwlSlotType, type OwlSlotValues } from './format';
import { renderOwlMarkdown, type OwlMarkdownOptions } from './markdown';
import { mergeStyleDecls, removeStyleDecls } from './style';

function slotTypeOf(el: Element): OwlSlotType {
	const raw = el.getAttribute(OWL.slotType) ?? 'text';
	return (OWL_SLOT_TYPES as readonly string[]).includes(raw) ? (raw as OwlSlotType) : 'text';
}

export function extractSlots(doc: Document): OwlSlot[] {
	const slots: OwlSlot[] = [];
	for (const el of walkElements(doc)) {
		const name = el.getAttribute(OWL.slot);
		if (!name) continue;
		slots.push({
			name,
			type: slotTypeOf(el),
			label: el.getAttribute(OWL.slotLabel) ?? undefined,
			owlId: el.getAttribute(OWL.id) ?? '',
		});
	}
	return slots;
}

/**
 * Resolve a slot value for an element. Values are keyed per-instance by the
 * element's `data-owl-id` (so two instances of the same component are
 * independent); the slot name is a backward-compatible fallback used by
 * legacy envelopes, migration, and AI generation.
 */
function slotValueFor(el: Element, name: string, values: OwlSlotValues): unknown {
	const id = el.getAttribute(OWL.id);
	if (id && values[id] !== undefined) return values[id];
	return values[name];
}

function isPreheaderEl(el: Element): boolean {
	return el.hasAttribute(OWL.preheader) || el.getAttribute(OWL.slot) === 'preheader';
}

/** Plain text only — keeps preheader filler text nodes intact. */
function setPlainText(el: Element, value: string): void {
	let target: Node | null = null;
	for (const child of el.childNodes ?? []) {
		if (child.nodeType === 3) {
			target = child;
			break;
		}
	}
	if (target) {
		target.nodeValue = value;
	} else {
		el.textContent = value;
	}
}

export type ApplySlotValuesOptions = OwlMarkdownOptions;

/**
 * Fill a text slot: markdown → sanitized HTML (bold, italic, links, lists).
 * Preheader stays plain text for inbox preview clients.
 */
function setText(el: Element, value: string, options?: ApplySlotValuesOptions): void {
	if (isPreheaderEl(el)) {
		setPlainText(el, value);
		return;
	}

	const html = renderOwlMarkdown(value, el.tagName, options);
	const doc = el.ownerDocument as Document | null;
	if (!doc) {
		el.textContent = value;
		return;
	}

	while (el.firstChild) el.removeChild(el.firstChild);
	if (!html) return;
	importNodes(doc, parseFragment(html), el);
}

export function applySlotValues(
	doc: Document,
	values: OwlSlotValues,
	options?: ApplySlotValuesOptions,
): void {
	for (const el of walkElements(doc)) {
		const name = el.getAttribute(OWL.slot);
		if (!name) continue;
		const value = slotValueFor(el, name, values);
		if (value === undefined || value === null) continue;
		const type = slotTypeOf(el);

		switch (type) {
			case 'text': {
				setText(el, String(value), options);
				break;
			}
			case 'url': {
				el.setAttribute('href', String(value));
				break;
			}
			case 'image': {
				const src = normalizeDesignAssetSrc(String(value));
				el.setAttribute('src', src);
				break;
			}
			case 'color': {
				el.setAttribute(
					'style',
					mergeStyleDecls(el.getAttribute('style'), [['color', String(value)]], true),
				);
				break;
			}
			case 'boolean': {
				if (value === false) {
					el.setAttribute(
						'style',
						mergeStyleDecls(el.getAttribute('style'), [
							['display', 'none'],
							['mso-hide', 'all'],
						], true),
					);
				} else {
					el.setAttribute(
						'style',
						removeStyleDecls(el.getAttribute('style'), ['display', 'mso-hide']),
					);
				}
				break;
			}
		}
	}
}

/** Analyze a component fragment (no <html>/<head>/<body> wrapper needed). */
export function slotsFromFragment(fragmentHtml: string): OwlSlot[] {
	const nodes = parseFragment(fragmentHtml);
	if (nodes.length === 0) return [];
	const wrapper = parseDocument('<!DOCTYPE html><html><head></head><body></body></html>');
	for (const node of nodes) wrapper.body.appendChild(wrapper.importNode(node, true));
	normalizeDocument(wrapper);
	return extractSlots(wrapper);
}

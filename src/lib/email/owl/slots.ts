/**
 * Slots: declared content targets (`data-owl-slot`). Extraction drives the
 * Content panel and AI scaffold; `applySlotValues` fills values into the DOM
 * at compose time (deterministic). Text slots accept Markdown and are rendered
 * to sanitized HTML (preheader stays plain text).
 *
 * Light/dark content pairs (`.owl-light`/`.owl-dark` or legacy
 * `.logo-light`/`.logo-dark`) sharing `data-owl-variant-group` sync image
 * `src` when the light slot is filled. An optional `<slot>_dark` value fills
 * the dark partner independently.
 */
import { normalizeDesignAssetSrc } from '$lib/design-asset-urls';
import { walkElements, parseFragment, parseDocument, importNodes, type Document, type Element } from './parser';
import { normalizeDocument } from './normalize';
import { OWL, OWL_CLASS, OWL_SLOT_TYPES, type OwlSlot, type OwlSlotType, type OwlSlotValues } from './format';
import { renderOwlMarkdown, type OwlMarkdownOptions } from './markdown';
import { mergeStyleDecls, removeStyleDecls } from './style';

const LIGHT_CLASSES = new Set([OWL_CLASS.light, OWL_CLASS.logoLight]);
const DARK_CLASSES = new Set([OWL_CLASS.dark, OWL_CLASS.logoDark]);

function slotTypeOf(el: Element): OwlSlotType {
	const raw = el.getAttribute(OWL.slotType) ?? 'text';
	return (OWL_SLOT_TYPES as readonly string[]).includes(raw) ? (raw as OwlSlotType) : 'text';
}

function classListOf(el: Element): string[] {
	return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

function hasAnyClass(el: Element, classes: Set<string>): boolean {
	return classListOf(el).some((c) => classes.has(c));
}

function isLightVariant(el: Element): boolean {
	const v = el.getAttribute(OWL.variant);
	if (v === 'light') return true;
	if (v === 'dark') return false;
	return hasAnyClass(el, LIGHT_CLASSES);
}

function isDarkVariant(el: Element): boolean {
	const v = el.getAttribute(OWL.variant);
	if (v === 'dark') return true;
	if (v === 'light') return false;
	return hasAnyClass(el, DARK_CLASSES);
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

/** Find the dark partner for a light-variant element (same group, or sibling logo-dark). */
export function findVariantPartner(el: Element, prefer: 'light' | 'dark'): Element | null {
	const group = el.getAttribute(OWL.variantGroup);
	const doc = el.ownerDocument;

	if (group && doc) {
		for (const candidate of walkElements(doc as Document)) {
			if (candidate === el) continue;
			if (candidate.getAttribute(OWL.variantGroup) !== group) continue;
			if (prefer === 'dark' && isDarkVariant(candidate)) return candidate;
			if (prefer === 'light' && isLightVariant(candidate)) return candidate;
		}
	}

	// Legacy logo pair: sibling <img class="logo-dark"> under the same parent.
	if (prefer === 'dark' && hasAnyClass(el, LIGHT_CLASSES)) {
		const parent = el.parentNode as Element | null;
		if (!parent) return null;
		for (const sibling of [...(parent.childNodes ?? [])] as Element[]) {
			if (sibling === el) continue;
			if (sibling.tagName?.toLowerCase() === 'img' && hasAnyClass(sibling, DARK_CLASSES)) {
				return sibling;
			}
		}
	}

	return null;
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

/**
 * When filling an image slot on a light-variant element, sync `src` onto the
 * dark partner unless a per-instance (`data-owl-id`) or legacy `<slot>_dark`
 * override is present in values (handled separately).
 */
function setVariantPair(el: Element, src: string, values: OwlSlotValues): void {
	if (!isLightVariant(el)) return;
	const partner = findVariantPartner(el, 'dark');
	if (!partner) return;
	const slotName = el.getAttribute(OWL.slot);
	const partnerId = partner.getAttribute(OWL.id);
	if (slotName && partnerId && values[partnerId] !== undefined) return;
	if (slotName && values[`${slotName}_dark`] !== undefined) return;
	partner.setAttribute('src', src);
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

/** Apply per-instance / `<slot>_dark` values onto dark partners of light slots. */
function applyDarkSlotOverrides(
	doc: Document,
	values: OwlSlotValues,
	options?: ApplySlotValuesOptions,
): void {
	for (const el of walkElements(doc)) {
		const name = el.getAttribute(OWL.slot);
		if (!name) continue;
		if (!isLightVariant(el)) continue;
		const partner = findVariantPartner(el, 'dark');
		if (!partner) continue;
		const partnerId = partner.getAttribute(OWL.id);
		const darkValue =
			(partnerId && values[partnerId] !== undefined ? values[partnerId] : undefined) ??
			values[`${name}_dark`];
		if (darkValue === undefined || darkValue === null) continue;
		const type = slotTypeOf(el);
		if (type === 'image') {
			partner.setAttribute('src', normalizeDesignAssetSrc(String(darkValue)));
		} else if (type === 'text') {
			setText(partner, String(darkValue), options);
		} else if (type === 'url') {
			partner.setAttribute('href', String(darkValue));
		}
	}
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
				setVariantPair(el, src, values);
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
	applyDarkSlotOverrides(doc, values, options);
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

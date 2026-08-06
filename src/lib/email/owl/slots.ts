/**
 * Slots: declared content targets (`data-owl-slot`). Extraction drives the
 * Content panel and AI scaffold; `applySlotValues` fills values into the DOM
 * at compose time (deterministic).
 *
 * Light/dark content pairs (`.owl-light`/`.owl-dark` or legacy
 * `.logo-light`/`.logo-dark`) sharing `data-owl-variant-group` sync image
 * `src` when the light slot is filled. An optional `<slot>_dark` value fills
 * the dark partner independently.
 */
import { walkElements, parseFragment, parseDocument, type Document, type Element } from './parser';
import { normalizeDocument } from './normalize';
import { OWL, OWL_CLASS, OWL_SLOT_TYPES, type OwlSlot, type OwlSlotType, type OwlSlotValues } from './format';
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
 * When filling an image slot on a light-variant element, sync `src` onto the
 * dark partner unless `<slot>_dark` is present in values (handled separately).
 */
function setVariantPair(el: Element, src: string, values: OwlSlotValues): void {
	if (!isLightVariant(el)) return;
	const slotName = el.getAttribute(OWL.slot);
	if (slotName && values[`${slotName}_dark`] !== undefined) return;
	const partner = findVariantPartner(el, 'dark');
	if (!partner) return;
	partner.setAttribute('src', src);
}

function setText(el: Element, value: string): void {
	// Preserve the first text node (e.g. preheader filler lives after it).
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

/** Apply `<slot>_dark` values onto dark partners of matching light slots. */
function applyDarkSlotOverrides(doc: Document, values: OwlSlotValues): void {
	for (const el of walkElements(doc)) {
		const name = el.getAttribute(OWL.slot);
		if (!name) continue;
		const darkKey = `${name}_dark`;
		const darkValue = values[darkKey];
		if (darkValue === undefined || darkValue === null) continue;
		if (!isLightVariant(el)) continue;
		const partner = findVariantPartner(el, 'dark');
		if (!partner) continue;
		const type = slotTypeOf(el);
		if (type === 'image') {
			partner.setAttribute('src', String(darkValue));
		} else if (type === 'text') {
			setText(partner, String(darkValue));
		} else if (type === 'url') {
			partner.setAttribute('href', String(darkValue));
		}
	}
}

export function applySlotValues(doc: Document, values: OwlSlotValues): void {
	for (const el of walkElements(doc)) {
		const name = el.getAttribute(OWL.slot);
		if (!name) continue;
		const value = values[name];
		if (value === undefined || value === null) continue;
		const type = slotTypeOf(el);

		switch (type) {
			case 'text': {
				setText(el, String(value));
				break;
			}
			case 'url': {
				el.setAttribute('href', String(value));
				break;
			}
			case 'image': {
				const src = String(value);
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
	applyDarkSlotOverrides(doc, values);
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

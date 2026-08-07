/**
 * Server-side Owl Studio helpers: compile an `OwlDoc` to final HTML (used by
 * live preview and Save) and migrate legacy email-builder templates into Owl.
 * Runs only on the server (imports the linkedom pipeline).
 */
import { parseDocument, parseFragment, serialize, walkElements, type Element } from './parser';
import type { Document, Node } from 'linkedom';
import { composeEmailHtml } from './shell';
import { compileOwlHtml } from './compile';
import { applySlotValues, slotsFromFragment } from './slots';
import { starterByKey } from './starters';
import { OWL } from './format';
import { newSectionId, parseOwlDoc, type OwlDoc, type OwlSection } from './studio';
import { rewriteDesignAssetUrls } from '$lib/design-asset-urls';
import type { OwlIssue, OwlSlot } from './format';
import { resolveMarkdownLinkColors } from './markdown';

export type OwlSectionSlots = Record<string, OwlSlot[]>;

export type OwlCompilePreview = {
	html: string;
	issues: OwlIssue[];
	sectionSlots: OwlSectionSlots;
	/** Compiled fragment (inner section root) per section id — for thumbnails. */
	sectionHtml: Record<string, string>;
};

/** Compiled section roots in document order (`data-owl-role="section"`). */
function compiledSectionRoots(html: string): Element[] {
	const doc = parseDocument(html);
	const roots: Element[] = [];
	for (const el of walkElements(doc)) {
		if (el.getAttribute(OWL.role) === 'section') roots.push(el);
	}
	return roots;
}

/** Map compiled section root outerHTML back to OwlDoc section ids (same order). */
function extractSectionHtml(compiledHtml: string, sections: OwlSection[]): Record<string, string> {
	const roots = compiledSectionRoots(compiledHtml);
	const out: Record<string, string> = {};
	for (let i = 0; i < sections.length; i++) {
		const root = roots[i];
		if (root) out[sections[i].id] = root.toString();
	}
	return out;
}

export function defaultOwlShell(): string {
	return starterByKey('base-layout')?.html ?? '';
}

/**
 * Compose + compile an OwlDoc. Deterministic; issues are returned alongside
 * output, never thrown. `origin` rewrites `/api/design-asset/...` to absolute
 * URLs for iframe preview; omit it when persisting final HTML.
 */
export function compileOwlDoc(
	doc: OwlDoc,
	ctx: { origin?: string; tokens?: Record<string, string> } = {},
): OwlCompilePreview {
	const composed = composeEmailHtml(
		doc.shell,
		doc.sections.map((s) => s.html),
		{ preheader: doc.preheader },
	);

	const parsed = parseDocument(composed.html);
	const mdColors = resolveMarkdownLinkColors(ctx.tokens);
	applySlotValues(parsed, doc.slotValues, mdColors);

	const result = compileOwlHtml(serialize(parsed), {
		kind: 'marketing',
		tokens: ctx.tokens,
	});

	const html = ctx.origin ? rewriteDesignAssetUrls(result.html, ctx.origin) : result.html;

	const sectionSlots: OwlSectionSlots = {};
	for (const section of doc.sections) {
		sectionSlots[section.id] = slotsFromFragment(section.html);
	}

	return {
		html,
		issues: [...composed.issues, ...result.issues],
		sectionSlots,
		sectionHtml: extractSectionHtml(html, doc.sections),
	};
}

export type MigrateInput = {
	content?: string | null;
	html?: string | null;
	preheader?: string;
};

export type OwlMigrationResult = {
	doc: OwlDoc;
	migrated: boolean;
	note?: string;
};

function extractSectionsFromHtml(html: string): OwlSection[] {
	const doc = parseDocument(html);
	const sections: OwlSection[] = [];
	for (const el of walkElements(doc)) {
		if (el.getAttribute(OWL.component) && el.getAttribute(OWL.role) !== 'shell') {
			sections.push({
				id: newSectionId(),
				key: el.getAttribute(OWL.component) ?? '',
				label: el.getAttribute(OWL.component) ?? 'Section',
				html: el.toString(),
			});
		}
	}
	return sections;
}

/**
 * Merge Pi-edited compiled email HTML back into an OwlDoc. Preserves section
 * ids when keys match by index; keeps shell, preheader, and slot values.
 */
export function mergeEditedHtmlIntoOwlDoc(doc: OwlDoc, editedHtml: string): OwlDoc {
	const extracted = extractSectionsFromHtml(editedHtml);
	if (extracted.length === 0) {
		throw new Error(
			'Edited HTML has no Owl sections. Pi must preserve data-owl-component and data-owl-role="section" on each section.',
		);
	}
	const sections = extracted.map((section, index) => {
		const prev = doc.sections[index];
		if (prev && prev.key === section.key) {
			return {
				...section,
				id: prev.id,
				label: prev.label || section.label,
			};
		}
		return section;
	});
	return { ...doc, sections };
}

export type ComponentPiScope = 'element' | 'section';

export type ComponentPiFragment = {
	html: string;
	name: string;
	scope: ComponentPiScope;
	inShell: boolean;
	sectionId: string | null;
};

function sectionContainsOwlId(sectionHtml: string, owlId: string): boolean {
	return sectionHtml.includes(`${OWL.id}="${owlId}"`);
}

/** Resolve the Owl section that owns `owlId`, or null when it lives in the shell. */
export function findSectionForOwlId(doc: OwlDoc, owlId: string): OwlSection | null {
	for (const section of doc.sections) {
		if (sectionContainsOwlId(section.html, owlId)) return section;
	}
	return null;
}

function findElementByOwlId(root: Element, owlId: string): Element | null {
	for (const el of walkElements(root)) {
		if (el.getAttribute(OWL.id) === owlId) return el;
	}
	return null;
}

/** Outer HTML of the element marked with `owlId` inside a section fragment. */
function elementOuterHtmlInFragment(fragmentHtml: string, owlId: string): string | null {
	const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${fragmentHtml}</body></html>`);
	const el = findElementByOwlId(doc.body as Element, owlId);
	return el ? serialize(el) : null;
}

/** Outer HTML of the element marked with `owlId` inside a full shell document. */
function elementOuterHtmlInShell(shellHtml: string, owlId: string): string | null {
	const doc = parseDocument(shellHtml);
	if (!doc.body) return null;
	const el = findElementByOwlId(doc.body as Element, owlId);
	return el ? serialize(el) : null;
}

/**
 * Replace the element with `owlId` in a section fragment with `editedHtml`.
 * Re-attaches `data-owl-id` on the replacement root when Pi drops it.
 */
export function replaceElementInFragment(
	fragmentHtml: string,
	owlId: string,
	editedHtml: string,
): string | null {
	const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${fragmentHtml}</body></html>`);
	const el = findElementByOwlId(doc.body as Element, owlId);
	if (!el || !el.parentNode) return null;

	const imported = importReplacementNodes(doc, editedHtml, owlId);
	if (!imported) return null;

	const parent = el.parentNode;
	for (const node of imported) parent.insertBefore(node, el);
	parent.removeChild(el);

	return [...doc.body.childNodes].map((node) => serialize(node)).join('');
}

/**
 * Replace the element with `owlId` in a full shell document with `editedHtml`.
 */
export function replaceElementInShell(
	shellHtml: string,
	owlId: string,
	editedHtml: string,
): string | null {
	const doc = parseDocument(shellHtml);
	if (!doc.body) return null;
	const el = findElementByOwlId(doc.body as Element, owlId);
	if (!el || !el.parentNode) return null;

	const imported = importReplacementNodes(doc, editedHtml, owlId);
	if (!imported) return null;

	const parent = el.parentNode;
	for (const node of imported) parent.insertBefore(node, el);
	parent.removeChild(el);

	const serialized = serialize(doc);
	return shellHtml.trim().toLowerCase().startsWith('<!doctype')
		? serialized
		: serialized.replace(/^<!DOCTYPE html>\n?/i, '');
}

function importReplacementNodes(
	doc: Document,
	editedHtml: string,
	owlId: string,
): Node[] | null {
	const nodes = parseFragment(editedHtml.trim() || '<!-- empty -->');
	const imported = nodes.map((node) => doc.importNode(node, true));
	const first = imported.find((n) => (n as Element).tagName) as Element | undefined;
	if (!first) return null;
	if (!first.getAttribute(OWL.id)) first.setAttribute(OWL.id, owlId);
	return imported;
}

/**
 * Extract the HTML fragment Pi should edit for a selected owl element.
 * - `element`: the selected element's outerHTML
 * - `section`: the whole section.html (or the element when it lives in the shell)
 */
export function extractComponentPiFragment(
	doc: OwlDoc,
	owlId: string,
	scope: ComponentPiScope,
): ComponentPiFragment {
	const section = findSectionForOwlId(doc, owlId);
	if (section) {
		if (scope === 'section') {
			return {
				html: section.html,
				name: section.label || section.key || 'Section',
				scope: 'section',
				inShell: false,
				sectionId: section.id,
			};
		}
		const html = elementOuterHtmlInFragment(section.html, owlId);
		if (!html) {
			throw new Error(`Element ${owlId} not found in section ${section.id}`);
		}
		return {
			html,
			name: section.label || section.key || 'Element',
			scope: 'element',
			inShell: false,
			sectionId: section.id,
		};
	}

	if (!doc.shell.includes(`${OWL.id}="${owlId}"`)) {
		throw new Error(`Element ${owlId} not found in the template`);
	}
	const html = elementOuterHtmlInShell(doc.shell, owlId);
	if (!html) {
		throw new Error(`Element ${owlId} not found in the shell`);
	}
	return {
		html,
		name: 'Shell element',
		scope: 'element',
		inShell: true,
		sectionId: null,
	};
}

/**
 * Patch Pi's edited fragment back into the OwlDoc without touching other sections.
 */
export function applyComponentPiEdit(
	doc: OwlDoc,
	owlId: string,
	scope: ComponentPiScope,
	editedHtml: string,
): OwlDoc {
	const section = findSectionForOwlId(doc, owlId);

	if (section && scope === 'section') {
		return applySectionPiEdit(doc, section.id, editedHtml);
	}

	if (section) {
		const next = replaceElementInFragment(section.html, owlId, editedHtml);
		if (!next) {
			throw new Error(`Could not patch element ${owlId} in section ${section.id}`);
		}
		return {
			...doc,
			sections: doc.sections.map((s) => (s.id === section.id ? { ...s, html: next } : s)),
		};
	}

	const nextShell = replaceElementInShell(doc.shell, owlId, editedHtml);
	if (!nextShell) {
		throw new Error(`Could not patch element ${owlId} in the shell`);
	}
	return { ...doc, shell: nextShell };
}

/** Extract a whole section for Pi (by section id). */
export function extractSectionPiFragment(doc: OwlDoc, sectionId: string): ComponentPiFragment {
	const section = doc.sections.find((s) => s.id === sectionId);
	if (!section) {
		throw new Error(`Section ${sectionId} not found in the template`);
	}
	return {
		html: section.html,
		name: section.label || section.key || 'Section',
		scope: 'section',
		inShell: false,
		sectionId: section.id,
	};
}

/** Replace one section's HTML after a whole-component Pi edit. */
export function applySectionPiEdit(doc: OwlDoc, sectionId: string, editedHtml: string): OwlDoc {
	if (!doc.sections.some((s) => s.id === sectionId)) {
		throw new Error(`Section ${sectionId} not found in the template`);
	}
	return {
		...doc,
		sections: doc.sections.map((s) =>
			s.id === sectionId ? { ...s, html: editedHtml.trim() || s.html } : s,
		),
	};
}

/** Read preheader / slot values out of a legacy email-builder content blob. */
function parseLegacyContent(
	content: string | null | undefined,
): { preheader?: string; slotValues: Record<string, string> } {
	if (!content?.trim()) return { slotValues: {} };
	try {
		const parsed = JSON.parse(content) as Record<string, unknown>;
		const preheader =
			typeof parsed.preheader === 'string' && parsed.preheader
				? parsed.preheader
				: undefined;
		const scaffold = (typeof parsed.scaffold === 'object' && !Array.isArray(parsed.scaffold)
			? parsed.scaffold
			: {}) as Record<string, unknown>;
		const preheader2 =
			typeof scaffold.preheader === 'string' && scaffold.preheader ? scaffold.preheader : undefined;
		const slots = (typeof scaffold.slots === 'object' && !Array.isArray(scaffold.slots)
			? (scaffold.slots as Record<string, unknown>)
			: {}) as Record<string, unknown>;
		const slotValues: Record<string, string> = {};
		for (const [key, value] of Object.entries(slots)) {
			if (typeof value === 'string') slotValues[key] = value;
		}
		return { preheader: preheader ?? preheader2, slotValues };
	} catch {
		return { slotValues: {} };
	}
}

/**
 * Return an OwlDoc for a template. If `content` is already an Owl envelope it
 * is returned as-is; otherwise the legacy email-builder source is converted
 * (sections extracted from the compiled HTML when annotated, preheader and
 * slot values carried over from the legacy content JSON).
 */
export function migrateToOwlDoc(input: MigrateInput): OwlMigrationResult {
	const existing = parseOwlDoc(input.content);
	if (existing) return { doc: existing, migrated: false };

	const legacy = parseLegacyContent(input.content);
	const doc: OwlDoc = {
		owl: 'v1',
		shell: defaultOwlShell(),
		sections: [],
		preheader: input.preheader ?? legacy.preheader,
		slotValues: { ...legacy.slotValues },
	};

	if (input.html?.trim()) {
		const extracted = extractSectionsFromHtml(input.html);
		if (extracted.length > 0) {
			doc.sections = extracted;
			return { doc, migrated: true, note: 'Imported sections from the existing compiled email.' };
		}
	}

	return {
		doc,
		migrated: doc.sections.length > 0,
		note:
			doc.sections.length > 0
				? undefined
				: 'No sections found yet — add sections from the library to start composing.',
	};
}

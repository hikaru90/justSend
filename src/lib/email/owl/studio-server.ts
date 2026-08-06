/**
 * Server-side Owl Studio helpers: compile an `OwlDoc` to final HTML (used by
 * live preview and Save) and migrate legacy email-builder templates into Owl.
 * Runs only on the server (imports the linkedom pipeline).
 */
import { parseDocument, serialize, walkElements, type Element } from './parser';
import { composeEmailHtml } from './shell';
import { compileOwlHtml } from './compile';
import { applySlotValues, slotsFromFragment } from './slots';
import { starterByKey } from './starters';
import { OWL } from './format';
import { newSectionId, parseOwlDoc, type OwlDoc, type OwlSection } from './studio';
import { rewriteDesignAssetUrls } from '$lib/design-asset-urls';
import type { OwlIssue, OwlSlot } from './format';

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
	ctx: { origin?: string; colorScheme?: 'light' | 'dark'; tokens?: Record<string, string> } = {},
): OwlCompilePreview {
	const composed = composeEmailHtml(
		doc.shell,
		doc.sections.map((s) => s.html),
		{ preheader: doc.preheader },
	);

	const parsed = parseDocument(composed.html);
	applySlotValues(parsed, doc.slotValues);

	const result = compileOwlHtml(serialize(parsed), {
		kind: 'marketing',
		colorScheme: ctx.colorScheme,
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

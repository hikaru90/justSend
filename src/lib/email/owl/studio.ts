/**
 * Owl Studio document model — the client/server contract for the editor.
 *
 * An `OwlDoc` is a plain JSON envelope stored in `templates.content`:
 * the shell HTML, an ordered list of section fragments, the preheader, and
 * slot values keyed by slot name. It is the editable source of truth; the
 * compiler turns it into the final HTML stored in `templates.html`.
 *
 * This module is intentionally free of server-only imports so it can be
 * used from Svelte components and the client bundle.
 */
import type { OwlSlotValues } from './format';

export const OWL_DOC_VERSION = 'v1';

export type OwlSection = {
	/** Stable id unique within the document (inspector keys, reorder). */
	id: string;
	/** Library key (starter) or design-component id, when known. */
	key: string;
	/** Human label shown in the section list. */
	label: string;
	/** Section fragment HTML (a `<table role="presentation">` root). */
	html: string;
};

export type OwlDoc = {
	owl: 'v1';
	shell: string;
	sections: OwlSection[];
	preheader?: string;
	slotValues: OwlSlotValues;
};

export function parseOwlDoc(content: string | null | undefined): OwlDoc | null {
	if (!content?.trim()) return null;
	try {
		const parsed = JSON.parse(content) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const doc = parsed as OwlDoc;
		if (
			doc.owl !== OWL_DOC_VERSION ||
			typeof doc.shell !== 'string' ||
			!Array.isArray(doc.sections)
		) {
			return null;
		}
		const slotValues = doc.slotValues;
		return {
			owl: OWL_DOC_VERSION,
			shell: doc.shell,
			sections: doc.sections
				.filter((s) => s && typeof s.id === 'string' && typeof s.html === 'string')
				.map((s) => ({
					id: s.id,
					key: typeof s.key === 'string' ? s.key : '',
					label: typeof s.label === 'string' && s.label ? s.label : s.key || 'Section',
					html: s.html,
				})),
			preheader: typeof doc.preheader === 'string' ? doc.preheader : undefined,
			slotValues:
				slotValues && typeof slotValues === 'object' && !Array.isArray(slotValues)
					? (slotValues as OwlSlotValues)
					: {},
		};
	} catch {
		return null;
	}
}

export function serializeOwlDoc(doc: OwlDoc): string {
	return JSON.stringify(doc);
}

export type TemplateStudioSnapshot = {
	testVariables?: Partial<Record<'email' | 'firstName' | 'lastName', string>>;
};

export function parseTemplateStudioSnapshot(
	raw: string | null | undefined,
): TemplateStudioSnapshot {
	if (!raw?.trim()) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const tv = (parsed as TemplateStudioSnapshot).testVariables;
		if (tv && typeof tv === 'object' && !Array.isArray(tv)) {
			return { testVariables: tv };
		}
	} catch {
		// ignore invalid legacy snapshots
	}
	return {};
}

export function serializeTemplateStudioSnapshot(snapshot: TemplateStudioSnapshot): string {
	return JSON.stringify(snapshot);
}

export function emptyOwlDoc(shell: string, preheader = ''): OwlDoc {
	return { owl: OWL_DOC_VERSION, shell, sections: [], preheader, slotValues: {} };
}

let sectionSeq = 0;

export function newSectionId(): string {
	sectionSeq += 1;
	return `sec_${Date.now().toString(36)}_${sectionSeq}`;
}

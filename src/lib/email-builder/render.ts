import { mergeSectionDocuments } from './component-document';
import { renderBlock } from './render-html';
import type { TEditorConfiguration, EmailBuilderContent } from './types';
import { EMPTY_DOCUMENT } from './types';

export type ScaffoldSlots = {
	subject?: string;
	preheader?: string;
	slots: Record<string, string>;
};

/**
 * Enable markdown for every Text block at render time so existing docs and
 * slot-filled copy get bold/links/lists without a data migration.
 */
export function enableTextBlockMarkdown(document: TEditorConfiguration): TEditorConfiguration {
	const next = cloneDocument(document);
	for (const block of Object.values(next)) {
		if (block?.type !== 'Text') continue;
		const props = (block.data.props ?? {}) as Record<string, unknown>;
		block.data.props = { ...props, markdown: true };
	}
	return next;
}

/** Render EmailBuilder document to a full HTML email string. */
export function renderEmailHtml(document: TEditorConfiguration): string {
	return renderBlock(enableTextBlockMarkdown(document), 'root');
}

/** Inner HTML for a single block (canvas leaves / previews). */
export function renderBlockInnerHtml(document: TEditorConfiguration, blockId: string): string {
	const html = renderBlock(enableTextBlockMarkdown(document), blockId);
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
	return (bodyMatch?.[1] ?? html).trim();
}

export function parseEmailBuilderContent(raw: string | null | undefined): {
	document: TEditorConfiguration | null;
	scaffold: ScaffoldSlots;
} {
	const emptyScaffold: ScaffoldSlots = { slots: {} };
	if (!raw?.trim()) return { document: null, scaffold: emptyScaffold };
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { document: null, scaffold: emptyScaffold };
		}
		const obj = parsed as Record<string, unknown>;

		if (obj.format === 'email-builder' && obj.document && typeof obj.document === 'object') {
			const scaffoldRaw = obj.scaffold;
			let scaffold = emptyScaffold;
			if (scaffoldRaw && typeof scaffoldRaw === 'object' && !Array.isArray(scaffoldRaw)) {
				const s = scaffoldRaw as Record<string, unknown>;
				const slots: Record<string, string> = {};
				if (s.slots && typeof s.slots === 'object' && !Array.isArray(s.slots)) {
					for (const [k, v] of Object.entries(s.slots as Record<string, unknown>)) {
						if (typeof v === 'string') slots[k] = v;
					}
				}
				scaffold = {
					subject: typeof s.subject === 'string' ? s.subject : undefined,
					preheader: typeof s.preheader === 'string' ? s.preheader : undefined,
					slots,
				};
			}
			return {
				document: obj.document as TEditorConfiguration,
				scaffold,
			};
		}

		const slots: Record<string, string> = {};
		const slotSrc =
			obj.slots && typeof obj.slots === 'object' && !Array.isArray(obj.slots)
				? (obj.slots as Record<string, unknown>)
				: {};
		for (const [k, v] of Object.entries(slotSrc)) {
			if (typeof v === 'string') slots[k] = v;
		}
		return {
			document: null,
			scaffold: {
				subject: typeof obj.subject === 'string' ? obj.subject : undefined,
				preheader: typeof obj.preheader === 'string' ? obj.preheader : undefined,
				slots,
			},
		};
	} catch {
		return { document: null, scaffold: emptyScaffold };
	}
}

export function serializeEmailBuilderContent(
	document: TEditorConfiguration,
	scaffold?: ScaffoldSlots,
): string {
	const payload: EmailBuilderContent = {
		format: 'email-builder',
		document,
		...(scaffold ? { scaffold } : {}),
	};
	return JSON.stringify(payload);
}

/** Seed an editable document from composed section HTML (one Html block). */
export function documentFromComposedHtml(html: string): TEditorConfiguration {
	let contents = html.trim();
	const bodyMatch = contents.match(/<body[^>]*>([\s\S]*)<\/body>/i);
	if (bodyMatch) contents = bodyMatch[1].trim();

	return {
		root: {
			type: 'EmailLayout',
			data: {
				backdropColor: '#F5F5F5',
				canvasColor: '#FFFFFF',
				textColor: '#262626',
				fontFamily: 'MODERN_SANS',
				childrenIds: ['composed-html'],
			},
		},
		'composed-html': {
			type: 'Html',
			data: {
				props: { contents },
				style: { padding: { top: 0, bottom: 0, left: 0, right: 0 } },
			},
		},
	};
}

/** Merge composed sections into one email-builder document (block trees preferred). */
export function documentFromComposedSections(
	sections: Array<{
		html: string;
		tree?: { blocks: TEditorConfiguration; childrenIds: string[] };
		componentId?: string;
		componentName?: string;
		slots?: Record<string, string>;
	}>,
): TEditorConfiguration {
	const trees = sections.filter((s) => s.tree).map((s) => s.tree!);
	if (trees.length === sections.length && trees.length > 0) {
		return mergeSectionDocuments(trees);
	}

	// Mixed or legacy HTML sections → one Html block per section.
	const childrenIds: string[] = [];
	const document: TEditorConfiguration = {
		root: {
			type: 'EmailLayout',
			data: {
				backdropColor: '#F5F5F5',
				canvasColor: '#FFFFFF',
				textColor: '#262626',
				fontFamily: 'MODERN_SANS',
				childrenIds,
			},
		},
	};

	sections.forEach((section, index) => {
		if (section.tree) {
			Object.assign(document, section.tree.blocks);
			childrenIds.push(...section.tree.childrenIds);
			return;
		}
		const id = `section-${index + 1}`;
		childrenIds.push(id);
		document[id] = {
			type: 'Html',
			data: {
				props: { contents: section.html },
				style: { padding: { top: 0, bottom: 0, left: 0, right: 0 } },
			},
		};
	});

	if (childrenIds.length === 0) {
		return EMPTY_DOCUMENT;
	}

	return document;
}

export function cloneDocument(doc: TEditorConfiguration): TEditorConfiguration {
	// structuredClone throws DataCloneError on Svelte 5 reactive ($state) proxies,
	// so deep-clone manually. Email documents are plain JSON, so this is equivalent.
	if (doc === null || typeof doc !== 'object') return doc;
	if (Array.isArray(doc)) {
		const arr: unknown[] = [];
		for (let i = 0; i < doc.length; i++) arr[i] = cloneDocument(doc[i] as TEditorConfiguration);
		return arr as unknown as TEditorConfiguration;
	}
	const obj: Record<string, unknown> = {};
	for (const key in doc) {
		if (Object.prototype.hasOwnProperty.call(doc, key)) {
			obj[key] = cloneDocument((doc as Record<string, unknown>)[key] as TEditorConfiguration);
		}
	}
	return obj as TEditorConfiguration;
}

export { EMPTY_DOCUMENT };

import { renderToStaticMarkup } from '@usewaypoint/email-builder';
import type { TEditorConfiguration, EmailBuilderContent } from './types';
import { EMPTY_DOCUMENT } from './types';

export type ScaffoldSlots = {
	subject?: string;
	preheader?: string;
	slots: Record<string, string>;
};

/** Render EmailBuilder document to a full HTML email string. */
export function renderEmailHtml(document: TEditorConfiguration): string {
	return renderToStaticMarkup(document as never, { rootBlockId: 'root' });
}

/** Strip outer html/body wrappers from a single-block render for canvas leaves. */
export function renderBlockInnerHtml(document: TEditorConfiguration, blockId: string): string {
	const full = renderToStaticMarkup(document as never, { rootBlockId: blockId });
	const bodyMatch = full.match(/<body[^>]*>([\s\S]*)<\/body>/i);
	return (bodyMatch?.[1] ?? full).trim();
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
					slots
				};
			}
			return {
				document: obj.document as TEditorConfiguration,
				scaffold
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
				slots
			}
		};
	} catch {
		return { document: null, scaffold: emptyScaffold };
	}
}

export function serializeEmailBuilderContent(
	document: TEditorConfiguration,
	scaffold?: ScaffoldSlots
): string {
	const payload: EmailBuilderContent = {
		format: 'email-builder',
		document,
		...(scaffold ? { scaffold } : {})
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
				childrenIds: ['composed-html']
			}
		},
		'composed-html': {
			type: 'Html',
			data: {
				props: { contents },
				style: { padding: { top: 0, bottom: 0, left: 0, right: 0 } }
			}
		}
	};
}

export function cloneDocument(doc: TEditorConfiguration): TEditorConfiguration {
	return structuredClone(doc);
}

export { EMPTY_DOCUMENT };

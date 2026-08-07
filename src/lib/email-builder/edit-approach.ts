/**
 * Infer whether a design-system component AI edit should use structured blocks
 * or raw HTML, and apply Pi HTML results back into a block-tree document.
 */
import type { ComponentSlot, TEditorBlock, TEditorConfiguration } from './types';
import { EMPTY_DOCUMENT, newBlockId } from './types';

export type EditApproach = 'blocks' | 'html';

export function isEmptyComponentDocument(document: TEditorConfiguration): boolean {
	const children = document.root?.data?.childrenIds;
	return !Array.isArray(children) || children.length === 0;
}

const HTML_INSTRUCTION_RE =
	/\b(raw\s*html|custom\s*html|inline\s*css|markup)\b|@media\b/i;

const CONTENT_BLOCK_TYPES = new Set([
	'Heading',
	'Text',
	'Button',
	'Image',
	'Divider',
	'Spacer',
	'Html',
	'Container',
	'ColumnsContainer',
]);

/** Resolve approach from an explicit client value, otherwise infer. */
export function resolveEditApproach(opts: {
	approach?: string | null;
	instruction: string;
	document: TEditorConfiguration;
	html?: string | null;
}): EditApproach {
	const explicit = String(opts.approach ?? '')
		.trim()
		.toLowerCase();
	if (explicit === 'blocks' || explicit === 'html') return explicit;
	return inferEditApproach(opts);
}

/**
 * Infer blocks vs HTML from instruction cues and current component shape.
 *
 * HTML when:
 * - instruction mentions raw/custom HTML or @media
 * - document is empty and stored html exists (legacy)
 * - document is empty (create with HTML cues already covered; empty alone stays blocks unless html stored)
 * - document is only Html block(s) with real contents
 *
 * Otherwise blocks.
 */
export function inferEditApproach(opts: {
	instruction: string;
	document: TEditorConfiguration;
	html?: string | null;
}): EditApproach {
	if (HTML_INSTRUCTION_RE.test(opts.instruction.trim())) return 'html';

	const storedHtml = opts.html?.trim() ?? '';
	if (isEmptyComponentDocument(opts.document)) {
		return storedHtml ? 'html' : 'blocks';
	}

	if (isHtmlOnlyDocument(opts.document)) return 'html';

	return 'blocks';
}

/** True when every content block under root is an Html block with non-empty contents. */
export function isHtmlOnlyDocument(document: TEditorConfiguration): boolean {
	const rootChildren = document.root?.data?.childrenIds;
	if (!Array.isArray(rootChildren) || rootChildren.length === 0) return false;

	const contentIds = collectContentBlockIds(document, rootChildren);
	if (contentIds.length === 0) return false;

	for (const id of contentIds) {
		const block = document[id];
		if (!block || block.type !== 'Html') return false;
		const contents = String(
			(block.data.props as { contents?: string } | undefined)?.contents ?? '',
		).trim();
		if (!contents) return false;
	}
	return true;
}

function collectContentBlockIds(document: TEditorConfiguration, startIds: string[]): string[] {
	const out: string[] = [];
	const visit = (ids: string[]) => {
		for (const id of ids) {
			const block = document[id];
			if (!block || !CONTENT_BLOCK_TYPES.has(block.type)) continue;
			if (block.type === 'Container') {
				const kids = (block.data.props as { childrenIds?: string[] } | undefined)?.childrenIds ?? [];
				visit(kids);
				continue;
			}
			if (block.type === 'ColumnsContainer') {
				const cols =
					(block.data.props as { columns?: Array<{ childrenIds: string[] }> } | undefined)
						?.columns ?? [];
				for (const col of cols) visit(col.childrenIds ?? []);
				continue;
			}
			out.push(id);
		}
	};
	visit(startIds);
	return out;
}

/** Strip full-email wrappers so Pi output can live inside an Html block. */
export function extractHtmlFragment(html: string): string {
	const trimmed = html.trim();
	if (!trimmed) return '';

	const bodyMatch = trimmed.match(/<body[^>]*>([\s\S]*)<\/body>/i);
	if (bodyMatch) {
		const inner = bodyMatch[1].trim();
		// Prefer canvas cell contents when Pi returns a full Owlery email layout.
		const canvasMatch = inner.match(
			/<table[^>]*class="[^"]*owl-email-canvas[^"]*"[^>]*>[\s\S]*?<td[^>]*>([\s\S]*)<\/td>\s*<\/tr>\s*<\/table>/i,
		);
		if (canvasMatch) return canvasMatch[1].trim();
		return inner;
	}

	return trimmed;
}

export type ApplyHtmlToComponentResult = {
	document: TEditorConfiguration;
	slots: ComponentSlot[];
	html: string;
};

/**
 * Land Pi HTML output into a component document:
 * - Prefer updating a single top-level Html block's props.contents
 * - Otherwise replace root children with one Html block
 * - Keep slots that still point at surviving blocks; drop the rest
 */
export function applyHtmlToComponentDocument(opts: {
	document: TEditorConfiguration;
	slots: ComponentSlot[];
	html: string;
}): ApplyHtmlToComponentResult {
	const fragment = extractHtmlFragment(opts.html);
	const html = fragment || opts.html.trim();

	const base = cloneDoc(opts.document?.root ? opts.document : EMPTY_DOCUMENT);
	const root = base.root;
	if (!root || root.type !== 'EmailLayout') {
		return {
			document: documentFromHtmlFragment(html),
			slots: [],
			html,
		};
	}

	const childrenIds = [...(root.data.childrenIds ?? [])];
	const topLevelHtmlIds = childrenIds.filter((id) => base[id]?.type === 'Html');

	if (topLevelHtmlIds.length === 1 && childrenIds.length === 1) {
		const blockId = topLevelHtmlIds[0];
		const existing = base[blockId];
		base[blockId] = {
			...existing,
			type: 'Html',
			data: {
				...existing.data,
				props: {
					...(existing.data.props ?? {}),
					contents: html,
				},
				style: {
					fontSize: 16,
					padding: { top: 16, bottom: 16, left: 24, right: 24 },
					...(existing.data.style ?? {}),
				},
			},
		};
		const surviving = new Set(Object.keys(base));
		const slots = opts.slots.filter((s) => surviving.has(s.blockId));
		return { document: base, slots, html };
	}

	const blockId = newBlockId();
	const htmlBlock: TEditorBlock = {
		type: 'Html',
		data: {
			props: { contents: html },
			style: {
				fontSize: 16,
				padding: { top: 16, bottom: 16, left: 24, right: 24 },
			},
		},
	};

	const next: TEditorConfiguration = {
		root: {
			...root,
			data: {
				...root.data,
				childrenIds: [blockId],
			},
		},
		[blockId]: htmlBlock,
	};

	return { document: next, slots: [], html };
}

function documentFromHtmlFragment(html: string): TEditorConfiguration {
	const blockId = newBlockId();
	return {
		root: {
			type: 'EmailLayout',
			data: {
				backdropColor: '#F5F5F5',
				canvasColor: '#FFFFFF',
				textColor: '#262626',
				fontFamily: 'MODERN_SANS',
				childrenIds: [blockId],
			},
		},
		[blockId]: {
			type: 'Html',
			data: {
				props: { contents: html },
				style: {
					fontSize: 16,
					padding: { top: 16, bottom: 16, left: 24, right: 24 },
				},
			},
		},
	};
}

function cloneDoc(document: TEditorConfiguration): TEditorConfiguration {
	return structuredClone(document);
}

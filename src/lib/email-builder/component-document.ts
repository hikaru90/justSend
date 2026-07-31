import type { ComponentSlot, TEditorBlock, TEditorConfiguration } from '$lib/email-builder/types';
import { cloneDocument, EMPTY_DOCUMENT } from '$lib/email-builder/render';

function setAtPath(obj: Record<string, unknown>, path: string, value: unknown) {
	const parts = path.split('.');
	let cur: Record<string, unknown> = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i];
		const next = cur[key];
		if (!next || typeof next !== 'object' || Array.isArray(next)) {
			cur[key] = {};
		}
		cur = cur[key] as Record<string, unknown>;
	}
	cur[parts[parts.length - 1]] = value;
}

function renameIdsInBlock(block: TEditorBlock, map: Map<string, string>): TEditorBlock {
	const next = structuredClone(block);
	if (next.type === 'EmailLayout' && next.data.childrenIds) {
		next.data.childrenIds = next.data.childrenIds.map((id) => map.get(id) ?? id);
	}
	const props = next.data.props as Record<string, unknown> | undefined;
	if (props && Array.isArray(props.childrenIds)) {
		props.childrenIds = (props.childrenIds as string[]).map((id) => map.get(id) ?? id);
	}
	if (next.type === 'ColumnsContainer' && props && Array.isArray(props.columns)) {
		props.columns = (props.columns as Array<{ childrenIds: string[] }>).map((col) => ({
			...col,
			childrenIds: (col.childrenIds ?? []).map((id) => map.get(id) ?? id)
		}));
	}
	return next;
}

/**
 * Clone a component document, apply slot values, and namespace all block ids
 * with a prefix so multiple sections can be merged into one email document.
 * Returns the non-root blocks plus the root's childrenIds (namespaced).
 */
export function materializeComponentDocument(opts: {
	document: TEditorConfiguration;
	slots: ComponentSlot[];
	slotValues: Record<string, string>;
	idPrefix: string;
}): { blocks: TEditorConfiguration; childrenIds: string[] } {
	const source = cloneDocument(opts.document);
	const byName = new Map(opts.slots.map((s) => [s.name, s]));

	for (const [name, value] of Object.entries(opts.slotValues)) {
		const slot = byName.get(name);
		if (!slot || !source[slot.blockId]) continue;
		const block = source[slot.blockId];
		const data = { ...(block.data as Record<string, unknown>) };
		setAtPath(data, slot.prop, value);
		source[slot.blockId] = { ...block, data: data as TEditorBlock['data'] };
	}

	const idMap = new Map<string, string>();
	for (const id of Object.keys(source)) {
		if (id === 'root') continue;
		idMap.set(id, `${opts.idPrefix}${id}`);
	}

	const blocks: TEditorConfiguration = {};
	for (const [id, block] of Object.entries(source)) {
		if (id === 'root') continue;
		const newId = idMap.get(id)!;
		blocks[newId] = renameIdsInBlock(block, idMap);
	}

	const rootChildren = (source.root?.data.childrenIds ?? []).map((id) => idMap.get(id) ?? id);
	return { blocks, childrenIds: rootChildren };
}

/** Merge section block trees under a single EmailLayout root. */
export function mergeSectionDocuments(
	sections: Array<{ blocks: TEditorConfiguration; childrenIds: string[] }>
): TEditorConfiguration {
	const document = cloneDocument(EMPTY_DOCUMENT);
	const rootChildren: string[] = [];
	for (const section of sections) {
		Object.assign(document, section.blocks);
		rootChildren.push(...section.childrenIds);
	}
	document.root = {
		...document.root,
		data: {
			...document.root.data,
			childrenIds: rootChildren
		}
	};
	return document;
}

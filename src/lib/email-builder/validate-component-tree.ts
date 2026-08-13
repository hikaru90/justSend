import type { ComponentSlot, TEditorBlock, TEditorConfiguration } from '$lib/email-builder/types';
import { BLOCK_FACTORIES } from '$lib/email-builder/types';

const ALLOWED_TYPES = new Set(['EmailLayout', ...BLOCK_FACTORIES.map((f) => f.type)]);

const SLOT_TYPES = new Set(['text', 'url', 'asset', 'color']);

function getChildrenIds(block: TEditorBlock): string[] {
	if (block.type === 'EmailLayout') return block.data.childrenIds ?? [];
	const props = block.data.props as { childrenIds?: string[] } | undefined;
	return props?.childrenIds ?? [];
}

function allReferencedIds(doc: TEditorConfiguration): Set<string> {
	const ids = new Set<string>();
	for (const block of Object.values(doc)) {
		for (const id of getChildrenIds(block)) ids.add(id);
		if (block.type === 'ColumnsContainer') {
			const cols = (block.data.props as { columns?: Array<{ childrenIds: string[] }> })?.columns;
			for (const col of cols ?? []) {
				for (const id of col.childrenIds ?? []) ids.add(id);
			}
		}
	}
	return ids;
}

function pathExists(block: TEditorBlock, propPath: string): boolean {
	const parts = propPath.split('.');
	let cur: unknown = block.data;
	for (const part of parts) {
		if (!cur || typeof cur !== 'object') return false;
		cur = (cur as Record<string, unknown>)[part];
	}
	return true;
}

export type ValidateComponentTreeResult =
	| { ok: true; document: TEditorConfiguration; slots: ComponentSlot[] }
	| { ok: false; error: string };

/** Validate a Pi/AI-produced component block tree + slots. */
export function validateComponentTree(raw: unknown): ValidateComponentTreeResult {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { ok: false, error: 'Response must be a JSON object' };
	}
	const obj = raw as Record<string, unknown>;
	const document = (obj.document ?? obj) as TEditorConfiguration;
	if (!document || typeof document !== 'object' || Array.isArray(document)) {
		return { ok: false, error: 'Missing document object' };
	}
	if (!document.root || document.root.type !== 'EmailLayout') {
		return { ok: false, error: 'document.root must be an EmailLayout block' };
	}

	for (const [id, block] of Object.entries(document)) {
		if (!block || typeof block !== 'object' || typeof block.type !== 'string') {
			return { ok: false, error: `Block "${id}" is invalid` };
		}
		if (!ALLOWED_TYPES.has(block.type)) {
			return { ok: false, error: `Block "${id}" has unsupported type "${block.type}"` };
		}
	}

	const referenced = allReferencedIds(document);
	for (const id of referenced) {
		if (!document[id]) {
			return { ok: false, error: `Referenced block "${id}" is missing` };
		}
	}

	const slotsRaw = obj.slots;
	const slots: ComponentSlot[] = [];
	if (slotsRaw != null) {
		if (!Array.isArray(slotsRaw)) {
			return { ok: false, error: 'slots must be an array' };
		}
		for (const item of slotsRaw) {
			if (!item || typeof item !== 'object') continue;
			const s = item as Record<string, unknown>;
			const name = String(s.name ?? '').trim();
			const blockId = String(s.blockId ?? '').trim();
			const prop = String(s.prop ?? '').trim();
			const type = String(s.type ?? 'text');
			if (!name || !blockId || !prop) continue;
			if (!SLOT_TYPES.has(type)) {
				return { ok: false, error: `Slot "${name}" has invalid type "${type}"` };
			}
			if (!document[blockId]) {
				return { ok: false, error: `Slot "${name}" points at missing block "${blockId}"` };
			}
			if (!pathExists(document[blockId], prop)) {
				return {
					ok: false,
					error: `Slot "${name}" prop "${prop}" not found on block "${blockId}"`,
				};
			}
			slots.push({
				name,
				blockId,
				prop,
				type: type as ComponentSlot['type'],
				...(typeof s.label === 'string' && s.label.trim() ? { label: s.label.trim() } : {}),
			});
		}
	}

	return { ok: true, document, slots };
}

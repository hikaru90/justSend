import { BLOCK_FACTORIES, EMPTY_DOCUMENT, newBlockId, type TEditorBlock, type TEditorConfiguration } from './types';
import { cloneDocument } from './render';

export type EditorTab = 'editor' | 'preview' | 'html' | 'json' | 'ai';

function getChildrenIds(block: TEditorBlock | undefined): string[] {
	if (!block) return [];
	if (block.type === 'EmailLayout') return block.data.childrenIds ?? [];
	const props = block.data.props as { childrenIds?: string[] } | undefined;
	return props?.childrenIds ?? [];
}

function setChildrenIds(block: TEditorBlock, childrenIds: string[]): TEditorBlock {
	if (block.type === 'EmailLayout') {
		return { ...block, data: { ...block.data, childrenIds } };
	}
	return {
		...block,
		data: {
			...block.data,
			props: { ...(block.data.props ?? {}), childrenIds }
		}
	};
}

function findParentId(document: TEditorConfiguration, blockId: string): string | null {
	for (const [id, block] of Object.entries(document)) {
		if (id === blockId) continue;
		if (getChildrenIds(block).includes(blockId)) return id;
		if (block.type === 'ColumnsContainer') {
			const cols = (block.data.props as { columns?: Array<{ childrenIds: string[] }> })?.columns;
			if (cols?.some((c) => c.childrenIds.includes(blockId))) return id;
		}
	}
	return null;
}

/** Mutable EmailBuilder editor state (Svelte 5 runes class). */
export class EmailEditorState {
	document = $state<TEditorConfiguration>(cloneDocument(EMPTY_DOCUMENT));
	selectedBlockId = $state<string | null>(null);
	tab = $state<EditorTab>('editor');
	screen = $state<'desktop' | 'mobile'>('desktop');
	/** Preview-only: force light/dark email color scheme (ignores OS preference). */
	colorScheme = $state<'light' | 'dark'>('light');
	inspectorOpen = $state(true);

	load(doc: TEditorConfiguration | null | undefined) {
		this.document = cloneDocument(doc && Object.keys(doc).length ? doc : EMPTY_DOCUMENT);
		this.selectedBlockId = null;
	}

	select(blockId: string | null) {
		this.selectedBlockId = blockId;
		if (blockId) this.inspectorOpen = true;
	}

	updateBlock(blockId: string, block: TEditorBlock) {
		this.document = { ...this.document, [blockId]: block };
	}

	patchBlockData(blockId: string, data: TEditorBlock['data']) {
		const existing = this.document[blockId];
		if (!existing) return;
		this.updateBlock(blockId, { ...existing, data });
	}

	insertBlock(parentId: string, index: number, factoryType: string) {
		const factory = BLOCK_FACTORIES.find((f) => f.type === factoryType);
		if (!factory) return;
		const blockId = newBlockId();
		const block = factory.create();
		const parent = this.document[parentId];
		if (!parent) return;

		if (parent.type === 'ColumnsContainer') {
			// Insert into first column by default when parent is columns
			const props = {
				...((parent.data.props as Record<string, unknown>) ?? {}),
				columns: (
					(parent.data.props as { columns?: Array<{ childrenIds: string[] }> })?.columns ?? [
						{ childrenIds: [] }
					]
				).map((c, i) =>
					i === 0
						? {
								childrenIds: [
									...c.childrenIds.slice(0, index),
									blockId,
									...c.childrenIds.slice(index)
								]
							}
						: c
				)
			};
			this.document = {
				...this.document,
				[blockId]: block,
				[parentId]: { ...parent, data: { ...parent.data, props } }
			};
		} else {
			const kids = [...getChildrenIds(parent)];
			kids.splice(index, 0, blockId);
			this.document = {
				...this.document,
				[blockId]: block,
				[parentId]: setChildrenIds(parent, kids)
			};
		}
		this.selectedBlockId = blockId;
	}

	insertBlockIntoList(parentId: string, childrenIds: string[], index: number, factoryType: string) {
		const factory = BLOCK_FACTORIES.find((f) => f.type === factoryType);
		if (!factory) return;
		this.insertBlockAt(parentId, childrenIds, index, factory.create());
	}

	/** Insert any block (built-in factory or design-system Html) at index. */
	insertBlockAt(
		parentId: string,
		childrenIds: string[],
		index: number,
		block: TEditorBlock,
		columnIndex?: number
	) {
		const blockId = newBlockId();
		const parent = this.document[parentId];
		if (!parent) return;

		if (columnIndex != null && parent.type === 'ColumnsContainer') {
			const cols = [
				...((parent.data.props as { columns?: Array<{ childrenIds: string[] }> })?.columns ?? [])
			];
			const col = cols[columnIndex];
			if (!col) return;
			const kids = [...col.childrenIds];
			kids.splice(index, 0, blockId);
			cols[columnIndex] = { childrenIds: kids };
			this.document = {
				...this.document,
				[blockId]: block,
				[parentId]: {
					...parent,
					data: {
						...parent.data,
						props: { ...(parent.data.props as object), columns: cols }
					}
				}
			};
			this.selectedBlockId = blockId;
			return;
		}

		const kids = [...childrenIds];
		kids.splice(index, 0, blockId);

		if (parent.type === 'ColumnsContainer') {
			const propsCols = (parent.data.props as { columns?: Array<{ childrenIds: string[] }> })
				?.columns;
			const mapped =
				propsCols?.map((c) => {
					if (c.childrenIds === childrenIds) return { childrenIds: kids };
					return c;
				}) ?? propsCols;
			this.document = {
				...this.document,
				[blockId]: block,
				[parentId]: {
					...parent,
					data: {
						...parent.data,
						props: { ...(parent.data.props as object), columns: mapped }
					}
				}
			};
		} else {
			this.document = {
				...this.document,
				[blockId]: block,
				[parentId]: setChildrenIds(parent, kids)
			};
		}
		this.selectedBlockId = blockId;
	}

	/**
	 * Insert a design-system component tree: merge named blocks into the document
	 * and splice their root childrenIds into the parent at `index`.
	 */
	insertComponentTree(
		parentId: string,
		childrenIds: string[],
		index: number,
		blocks: TEditorConfiguration,
		treeChildrenIds: string[],
		columnIndex?: number
	) {
		const parent = this.document[parentId];
		if (!parent || treeChildrenIds.length === 0) return;

		const kids = [...childrenIds];
		kids.splice(index, 0, ...treeChildrenIds);

		let nextDoc: TEditorConfiguration = { ...this.document, ...blocks };

		if (columnIndex != null && parent.type === 'ColumnsContainer') {
			const cols = [
				...((parent.data.props as { columns?: Array<{ childrenIds: string[] }> })?.columns ?? [])
			];
			const col = cols[columnIndex];
			if (!col) return;
			const colKids = [...col.childrenIds];
			colKids.splice(index, 0, ...treeChildrenIds);
			cols[columnIndex] = { childrenIds: colKids };
			nextDoc = {
				...nextDoc,
				[parentId]: {
					...parent,
					data: {
						...parent.data,
						props: { ...(parent.data.props as object), columns: cols }
					}
				}
			};
		} else if (parent.type === 'ColumnsContainer') {
			const propsCols = (parent.data.props as { columns?: Array<{ childrenIds: string[] }> })
				?.columns;
			const mapped =
				propsCols?.map((c) => {
					if (c.childrenIds === childrenIds) return { childrenIds: kids };
					return c;
				}) ?? propsCols;
			nextDoc = {
				...nextDoc,
				[parentId]: {
					...parent,
					data: {
						...parent.data,
						props: { ...(parent.data.props as object), columns: mapped }
					}
				}
			};
		} else {
			nextDoc = {
				...nextDoc,
				[parentId]: setChildrenIds(parent, kids)
			};
		}

		this.document = nextDoc;
		this.selectedBlockId = treeChildrenIds[0] ?? null;
	}

	deleteBlock(blockId: string) {
		if (blockId === 'root') return;
		const next = { ...this.document };
		for (const [id, block] of Object.entries(next)) {
			if (id === blockId) continue;
			if (getChildrenIds(block).includes(blockId)) {
				next[id] = setChildrenIds(
					block,
					getChildrenIds(block).filter((c) => c !== blockId)
				);
			}
			if (block.type === 'ColumnsContainer') {
				const cols = (block.data.props as { columns?: Array<{ childrenIds: string[] }> })?.columns;
				if (cols) {
					next[id] = {
						...block,
						data: {
							...block.data,
							props: {
								...(block.data.props as object),
								columns: cols.map((c) => ({
									childrenIds: c.childrenIds.filter((cId) => cId !== blockId)
								}))
							}
						}
					};
				}
			}
		}
		delete next[blockId];
		this.document = next;
		if (this.selectedBlockId === blockId) this.selectedBlockId = null;
	}

	moveBlock(blockId: string, direction: 'up' | 'down') {
		const parentId = findParentId(this.document, blockId);
		if (!parentId) return;
		const parent = this.document[parentId];
		if (!parent) return;

		const move = (ids: string[]) => {
			const i = ids.indexOf(blockId);
			if (i < 0) return ids;
			const next = [...ids];
			const j = direction === 'up' ? i - 1 : i + 1;
			if (j < 0 || j >= next.length) return ids;
			[next[i], next[j]] = [next[j], next[i]];
			return next;
		};

		if (parent.type === 'ColumnsContainer') {
			const cols = (parent.data.props as { columns?: Array<{ childrenIds: string[] }> })?.columns;
			if (!cols) return;
			this.document = {
				...this.document,
				[parentId]: {
					...parent,
					data: {
						...parent.data,
						props: {
							...(parent.data.props as object),
							columns: cols.map((c) =>
								c.childrenIds.includes(blockId) ? { childrenIds: move(c.childrenIds) } : c
							)
						}
					}
				}
			};
		} else {
			this.document = {
				...this.document,
				[parentId]: setChildrenIds(parent, move(getChildrenIds(parent)))
			};
		}
	}

	duplicateBlock(blockId: string) {
		if (blockId === 'root') return;
		const parentId = findParentId(this.document, blockId);
		if (!parentId) return;
		const source = this.document[blockId];
		if (!source) return;
		const newId = newBlockId();
		const clone = cloneDocument({ [blockId]: source })[blockId];
		const parent = this.document[parentId];
		if (!parent || !clone) return;

		const insertAfter = (ids: string[]) => {
			const i = ids.indexOf(blockId);
			const next = [...ids];
			next.splice(i + 1, 0, newId);
			return next;
		};

		if (parent.type === 'ColumnsContainer') {
			const cols = (parent.data.props as { columns?: Array<{ childrenIds: string[] }> })?.columns;
			if (!cols) return;
			this.document = {
				...this.document,
				[newId]: clone,
				[parentId]: {
					...parent,
					data: {
						...parent.data,
						props: {
							...(parent.data.props as object),
							columns: cols.map((c) =>
								c.childrenIds.includes(blockId) ? { childrenIds: insertAfter(c.childrenIds) } : c
							)
						}
					}
				}
			};
		} else {
			this.document = {
				...this.document,
				[newId]: clone,
				[parentId]: setChildrenIds(parent, insertAfter(getChildrenIds(parent)))
			};
		}
		this.selectedBlockId = newId;
	}
}

export function getBlockChildrenIds(block: TEditorBlock): string[] {
	return getChildrenIds(block);
}

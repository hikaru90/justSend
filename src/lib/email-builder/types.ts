/** EmailBuilder.js-compatible document model (ported to Svelte). */

export type Padding = {
	top?: number;
	bottom?: number;
	left?: number;
	right?: number;
};

export type TEditorBlock = {
	type: string;
	data: {
		style?: Record<string, unknown>;
		props?: Record<string, unknown>;
		// EmailLayout stores children on data directly
		childrenIds?: string[];
		backdropColor?: string;
		canvasColor?: string;
		textColor?: string;
		fontFamily?: string;
		borderColor?: string;
		borderRadius?: number;
	};
};

export type TEditorConfiguration = Record<string, TEditorBlock>;

/** A typed pointer from a design-system component into a block prop. */
export type ComponentSlot = {
	name: string;
	blockId: string;
	prop: string;
	type: 'text' | 'url' | 'asset' | 'color';
	label?: string;
};

/** Persisted shape of a design-system component authored as a block tree. */
export type ComponentDocument = {
	document: TEditorConfiguration;
	slots: ComponentSlot[];
};

export type EmailBuilderContent = {
	format: 'email-builder';
	document: TEditorConfiguration;
	/** Optional AI scaffold retained for regeneration */
	scaffold?: {
		subject?: string;
		preheader?: string;
		slots: Record<string, string>;
	};
};

export const EMPTY_DOCUMENT: TEditorConfiguration = {
	root: {
		type: 'EmailLayout',
		data: {
			backdropColor: '#F5F5F5',
			canvasColor: '#FFFFFF',
			textColor: '#262626',
			fontFamily: 'MODERN_SANS',
			childrenIds: []
		}
	}
};

export function newBlockId(): string {
	return `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const BLOCK_FACTORIES: Array<{
	label: string;
	type: string;
	create: () => TEditorBlock;
}> = [
	{
		label: 'Heading',
		type: 'Heading',
		create: () => ({
			type: 'Heading',
			data: {
				props: { text: 'Hello friend' },
				style: { padding: { top: 16, bottom: 16, left: 24, right: 24 } }
			}
		})
	},
	{
		label: 'Text',
		type: 'Text',
		create: () => ({
			type: 'Text',
			data: {
				props: { text: 'My new text block', markdown: true },
				style: {
					padding: { top: 16, bottom: 16, left: 24, right: 24 },
					fontWeight: 'normal'
				}
			}
		})
	},
	{
		label: 'Button',
		type: 'Button',
		create: () => ({
			type: 'Button',
			data: {
				props: { text: 'Button', url: 'https://example.com' },
				style: { padding: { top: 16, bottom: 16, left: 24, right: 24 } }
			}
		})
	},
	{
		label: 'Image',
		type: 'Image',
		create: () => ({
			type: 'Image',
			data: {
				props: {
					url: 'https://placehold.co/600x200/F8F8F8/CCC?text=Image',
					alt: 'Image',
					contentAlignment: 'middle',
					linkHref: null
				},
				style: { padding: { top: 16, bottom: 16, left: 24, right: 24 } }
			}
		})
	},
	{
		label: 'Divider',
		type: 'Divider',
		create: () => ({
			type: 'Divider',
			data: {
				style: { padding: { top: 16, right: 0, bottom: 16, left: 0 } },
				props: { lineColor: '#CCCCCC' }
			}
		})
	},
	{
		label: 'Spacer',
		type: 'Spacer',
		create: () => ({
			type: 'Spacer',
			data: { props: { height: 16 } }
		})
	},
	{
		label: 'Html',
		type: 'Html',
		create: () => ({
			type: 'Html',
			data: {
				props: { contents: '<strong>Hello world</strong>' },
				style: {
					fontSize: 16,
					padding: { top: 16, bottom: 16, left: 24, right: 24 }
				}
			}
		})
	},
	{
		label: 'Container',
		type: 'Container',
		create: () => ({
			type: 'Container',
			data: {
				style: { padding: { top: 16, bottom: 16, left: 24, right: 24 } },
				props: { childrenIds: [] }
			}
		})
	},
	{
		label: 'Columns',
		type: 'ColumnsContainer',
		create: () => ({
			type: 'ColumnsContainer',
			data: {
				props: {
					columnsGap: 16,
					columnsCount: 2,
					columns: [{ childrenIds: [] }, { childrenIds: [] }]
				},
				style: { padding: { top: 16, bottom: 16, left: 24, right: 24 } }
			}
		})
	}
];

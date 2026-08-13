import type { DesignLibraryComponent } from './library';
import type { ComponentSlot, TEditorBlock, TEditorConfiguration } from './types';
import { materializeComponentDocument } from './component-document';

/** Parse a library component's stored document JSON. */
export function parseLibraryComponentDocument(
	component: Pick<DesignLibraryComponent, 'document' | 'html'> & { document?: string },
): TEditorConfiguration | null {
	const raw = component.document?.trim();
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as TEditorConfiguration;
		if (parsed?.root?.type === 'EmailLayout') return parsed;
	} catch {
		/* ignore */
	}
	return null;
}

/**
 * Clone a design-system component's block tree into the email document,
 * namespaced so ids do not collide. Returns blocks to merge + children to insert.
 */
export function cloneComponentIntoEmail(
	component: DesignLibraryComponent & { document?: string; parsedSlots?: ComponentSlot[] },
	idPrefix: string,
	slotValues: Record<string, string> = {},
): { blocks: TEditorConfiguration; childrenIds: string[] } | null {
	const doc = parseLibraryComponentDocument(component);
	if (!doc) return null;
	const slots = component.parsedSlots ?? [];
	return materializeComponentDocument({
		document: doc,
		slots,
		slotValues,
		idPrefix,
	});
}

/** Fallback: wrap legacy HTML as a single Html block. */
export function legacyHtmlBlock(html: string, _blockId: string): TEditorBlock {
	return {
		type: 'Html',
		data: {
			props: { contents: html },
			style: { padding: { top: 0, bottom: 0, left: 0, right: 0 } },
		},
	};
}

// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import {
	findPreviewElByOwlId,
	highlightTargetsFor,
	scrubLegacyInlineOutlines,
	syncInlinePreviewOutlines,
} from './preview-outline';

function mountTable(): { root: HTMLDivElement; row: HTMLTableRowElement; cells: HTMLTableCellElement[] } {
	const root = document.createElement('div');
	root.innerHTML = `
		<table data-owl-id="w0">
			<tbody data-owl-id="w00">
				<tr data-owl-id="w1">
					<td data-owl-id="w2">A</td>
					<td data-owl-id="w3">B</td>
				</tr>
			</tbody>
		</table>
	`;
	document.body.appendChild(root);
	const row = root.querySelector('tr') as HTMLTableRowElement;
	const cells = [...row.querySelectorAll('td')] as HTMLTableCellElement[];
	return { root, row, cells };
}

describe('preview outline sync', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('highlights row cells, not the row itself', () => {
		const { row, cells } = mountTable();
		expect(highlightTargetsFor(row)).toEqual(cells);
	});

	it('highlights all section cells for table hover', () => {
		const { root } = mountTable();
		const table = root.querySelector('table') as HTMLTableElement;
		expect(highlightTargetsFor(table)).toHaveLength(2);
	});

	it('findPreviewElByOwlId matches section root table id', () => {
		const { root } = mountTable();
		const section = root.querySelector('table') as HTMLTableElement;
		section.setAttribute('data-owl-role', 'section');
		const tableId = section.getAttribute('data-owl-id')!;
		expect(findPreviewElByOwlId(root, section, tableId)).toBe(section);
	});

	it('paints inline styles on table row targets', () => {
		const { root, row, cells } = mountTable();
		syncInlinePreviewOutlines(root, { hoverEl: row, selectedEl: null });
		for (const cell of cells) {
			expect(cell.style.outline).toContain('2px solid');
			expect(cell.hasAttribute('data-owl-hover')).toBe(true);
		}
	});

	it('scrubs inline styles from painted cells', () => {
		const { root, cells } = mountTable();
		for (const cell of cells) {
			cell.setAttribute('data-owl-hover', '1');
			cell.setAttribute('data-owl-prev-outline', '');
			cell.style.outline = '2px solid #6366f1';
		}
		scrubLegacyInlineOutlines(root);
		for (const cell of cells) {
			expect(cell.style.outline).toBe('');
			expect(cell.hasAttribute('data-owl-hover')).toBe(false);
		}
	});

	it('ignores detached hover elements', () => {
		const { root, row } = mountTable();
		const detached = row;
		root.innerHTML = '<p data-owl-id="w9">gone</p>';
		syncInlinePreviewOutlines(root, { hoverEl: detached, selectedEl: null });
		expect(root.querySelector('[data-owl-hover]')).toBeNull();
	});
});

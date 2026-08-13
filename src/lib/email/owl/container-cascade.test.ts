/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { renderOwlMarkupHtml } from './render-doc';
import { applyShellInspectorPatch, mintOwlIdsInShell, shellCanvasCrumb } from './studio-client';
import { emptyOwlDoc, newSectionId } from './studio';
import { starterByKey } from './starters';
import { parseDocument } from './parser';

function redCanvasShell(): string {
	const shell = mintOwlIdsInShell(starterByKey('base-layout')!.html);
	const canvasId = shellCanvasCrumb(shell)!.owlId;
	const canvasDoc = parseDocument(shell);
	const canvasEl = canvasDoc.querySelector(`[data-owl-id="${canvasId}"]`);
	const styleRows = (canvasEl?.getAttribute('style') ?? '')
		.split(';')
		.map((chunk) => {
			const idx = chunk.indexOf(':');
			return idx > 0
				? { prop: chunk.slice(0, idx).trim(), value: chunk.slice(idx + 1).trim() }
				: null;
		})
		.filter((r): r is { prop: string; value: string } => r !== null && r.prop !== '')
		.map((r) => (r.prop === 'background-color' ? { ...r, value: '#FF0000' } : r));
	return applyShellInspectorPatch(shell, canvasId, { styleRows })!;
}

function withoutBackgrounds(html: string): string {
	const fragDoc = parseDocument(`<div>${html}</div>`);
	for (const el of fragDoc.querySelectorAll('[style]')) {
		el.setAttribute(
			'style',
			(el.getAttribute('style') ?? '')
				.split(';')
				.filter((chunk) => !chunk.toLowerCase().includes('background-color'))
				.join(';'),
		);
	}
	return (fragDoc.firstElementChild?.innerHTML ?? '').trim();
}

describe('studio: container background cascade', () => {
	it('sections without authored backgrounds inherit the container color', () => {
		const doc = emptyOwlDoc(redCanvasShell(), 'Preview');
		doc.sections.push({
			id: newSectionId(),
			key: 'text',
			label: 'Text',
			html: withoutBackgrounds(starterByKey('text')!.html),
		});

		const { html } = renderOwlMarkupHtml(doc);
		// enforceExplicitColors falls back to the nearest ancestor background —
		// the red container — instead of hard-coded white.
		expect(html).toContain('background-color:#FF0000');
		expect(html).not.toContain('background-color:#FFFFFF');
	});

	it('authored accent surfaces still survive recoloring (by design)', () => {
		const doc = emptyOwlDoc(redCanvasShell(), 'Preview');
		doc.sections.push({
			id: newSectionId(),
			key: 'cta-button',
			label: 'CTA',
			html: starterByKey('cta-button')!.html,
		});
		const { html } = renderOwlMarkupHtml(doc);
		expect(html).toContain('background-color:#FF0000');
		// The authored button surface inside the section also remains.
		expect(html).toContain('background-color:#0A2540');
		// Starters no longer bake white section backgrounds — the section
		// wrapper inherits the red container instead.
		expect(html).not.toContain('background-color:#FFFFFF');
	});
});

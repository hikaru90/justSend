// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { compileOwlDoc, defaultOwlShell } from './studio-server';
import { emptyOwlDoc, newSectionId } from './studio';
import { starterByKey } from './starters';
import { extractPreviewBodyInnerHtml, mintOwlDocSections } from './studio-client';
import { OWL } from './format';

import { findPreviewElByOwlId } from './preview-outline';

function findInSectionScope(scope: Element, owlId: string): HTMLElement | null {
	const scoped = scope.querySelector(`[${OWL.id}="${owlId}"]`);
	return scoped instanceof HTMLElement ? scoped : null;
}

describe('previewElForOwlId querySelector scope bug', () => {
	it('querySelector misses the section root table id', () => {
		const text = starterByKey('text')!;
		let doc = emptyOwlDoc(defaultOwlShell(), 'Preview');
		doc.sections.push({ id: newSectionId(), key: 'text', label: 'Text', html: text.html });
		doc = mintOwlDocSections(doc);
		const { html } = compileOwlDoc(doc, { origin: 'http://localhost' });
		const body = extractPreviewBodyInnerHtml(html);
		const root = document.createElement('div');
		root.innerHTML = body;
		const section = root.querySelector(`[${OWL.role}="section"]`) as HTMLElement;
		const tableId = section.getAttribute(OWL.id)!;
		expect(findInSectionScope(section, tableId)).toBeNull();
		expect(findPreviewElByOwlId(root, section, tableId)).toBe(section);
		expect(section.matches(`[${OWL.id}="${tableId}"]`)).toBe(true);
	});

	it('querySelector finds tbody and tr descendants', () => {
		const text = starterByKey('text')!;
		let doc = emptyOwlDoc(defaultOwlShell(), 'Preview');
		doc.sections.push({ id: newSectionId(), key: 'text', label: 'Text', html: text.html });
		doc = mintOwlDocSections(doc);
		const frag = doc.sections[0].html;
		const tbodyId = frag.match(/<tbody[^>]*data-owl-id="(w\d+)"/)?.[1];
		const trId = frag.match(/<tr[^>]*data-owl-id="(w\d+)"/)?.[1];
		expect(tbodyId).toBeDefined();
		expect(trId).toBeDefined();
		const { html } = compileOwlDoc(doc, { origin: 'http://localhost' });
		const body = extractPreviewBodyInnerHtml(html);
		const root = document.createElement('div');
		root.innerHTML = body;
		const section = root.querySelector(`[${OWL.role}="section"]`) as HTMLElement;
		expect(findInSectionScope(section, tbodyId!)).not.toBeNull();
		expect(findInSectionScope(section, trId!)).not.toBeNull();
	});
});

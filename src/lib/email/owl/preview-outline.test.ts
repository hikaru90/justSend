import { describe, expect, it } from 'vitest';
import { compileOwlDoc, defaultOwlShell } from './studio-server';
import { emptyOwlDoc, newSectionId } from './studio';
import { starterByKey } from './starters';
import { extractPreviewBodyInnerHtml } from './studio-client';

describe('preview outline ids', () => {
	it('compiled preview body includes data-owl-id on structural tags', () => {
		const text = starterByKey('text')!;
		const doc = emptyOwlDoc(defaultOwlShell(), 'Preview');
		doc.sections.push({ id: newSectionId(), key: 'text', label: 'Text', html: text.html });
		const { html } = compileOwlDoc(doc, { origin: 'http://localhost' });
		const body = extractPreviewBodyInnerHtml(html);
		const ids = body.match(/data-owl-id="/g) ?? [];
		expect(ids.length).toBeGreaterThan(0);
		for (const t of ['table', 'tbody', 'tr', 'td', 'p']) {
			expect(body, t).toMatch(new RegExp(`<${t}\\b[\\s\\S]*?data-owl-id="w\\d+"`, 'i'));
		}
	});
});

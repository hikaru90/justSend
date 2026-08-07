import { describe, expect, it } from 'vitest';
import { renderOwlDocHtml } from './render-doc';
import { compileOwlDoc } from './studio-server';
import { emptyOwlDoc, newSectionId, type OwlDoc } from './studio';

const SHELL = `<!DOCTYPE html><html><head></head><body>
<div data-owl-preheader>Fallback preheader</div>
<!--owl:sections-->
</body></html>`;

const SECTION = `<p data-owl-slot="body" data-owl-slot-type="text">Hello</p>`;

function doc(): OwlDoc {
	const d = emptyOwlDoc(SHELL, 'Preheader text');
	d.sections.push({ id: newSectionId(), key: 'text', label: 'Text', html: SECTION });
	d.slotValues = { body: '**Buy now** {{firstName}}' };
	return d;
}

describe('renderOwlDocHtml', () => {
	it('is byte-identical to compileOwlDoc (single pipeline parity)', () => {
		const d = doc();
		const render = renderOwlDocHtml(d);
		const compile = compileOwlDoc(d);
		expect(render.html).toBe(compile.html);
		expect(render.issues).toEqual(compile.issues);
	});

	it('matches compileOwlDoc when tokens + origin are provided', () => {
		const d = doc();
		const ctx = { tokens: { primary: '#123456' }, origin: 'https://preview.example.com' };
		expect(renderOwlDocHtml(d, ctx).html).toBe(compileOwlDoc(d, ctx).html);
		expect(renderOwlDocHtml(d, ctx).issues).toEqual(compileOwlDoc(d, ctx).issues);
	});

	it('applies slot values into the composed body', () => {
		const html = renderOwlDocHtml(doc()).html;
		expect(html).toContain('Buy now');
		expect(html).toContain('{{firstName}}');
	});

	it('rewrites design-asset URLs when an origin is provided', () => {
		const d = doc();
		d.sections[0].html = `<img src="/api/design-asset/abc123" alt="x">`;
		const relative = renderOwlDocHtml(d).html;
		const absolute = renderOwlDocHtml(d, { origin: 'https://mail.example.com' }).html;
		expect(relative).toContain('src="/api/design-asset/abc123"');
		expect(absolute).toContain('src="https://mail.example.com/api/design-asset/abc123"');
	});
});

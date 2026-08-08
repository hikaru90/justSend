import { describe, expect, it } from 'vitest';
import { renderOwlDocHtml, renderOwlMarkupHtml } from './render-doc';
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

describe('renderOwlDocHtml (delivery)', () => {
	it('is byte-identical to compileOwlDoc (single pipeline parity)', async () => {
		const d = doc();
		const render = await renderOwlDocHtml(d);
		const compile = await compileOwlDoc(d);
		expect(render.html).toBe(compile.html);
		expect(render.issues).toEqual(compile.issues);
	});

	it('matches compileOwlDoc when tokens + origin are provided', async () => {
		const d = doc();
		const ctx = { tokens: { primary: '#123456' }, origin: 'https://preview.example.com' };
		expect((await renderOwlDocHtml(d, ctx)).html).toBe((await compileOwlDoc(d, ctx)).html);
		expect((await renderOwlDocHtml(d, ctx)).issues).toEqual((await compileOwlDoc(d, ctx)).issues);
	});

	it('applies slot values into the composed body', async () => {
		const html = await renderOwlDocHtml(doc()).then((r) => r.html);
		expect(html).toContain('Buy now');
		expect(html).toContain('{{firstName}}');
	});

	it('rewrites design-asset URLs when an origin is provided', async () => {
		const d = doc();
		d.sections[0].html = `<img src="/api/design-asset/abc123" alt="x">`;
		const relative = await renderOwlDocHtml(d).then((r) => r.html);
		const absolute = await renderOwlDocHtml(d, { origin: 'https://mail.example.com' }).then(
			(r) => r.html,
		);
		expect(relative).toContain('src="/api/design-asset/abc123"');
		expect(absolute).toContain('src="https://mail.example.com/api/design-asset/abc123"');
	});

	it('is deterministic across runs', async () => {
		const d = doc();
		const a = await renderOwlDocHtml(d);
		const b = await renderOwlDocHtml(d);
		expect(a.html).toBe(b.html);
	});

	it('delivers through MJML', async () => {
		const html = await renderOwlDocHtml(doc()).then((r) => r.html);
		expect(html).toMatch(/^<!doctype html>/i);
		expect(html).toContain('urn:schemas-microsoft-com:vml');
		expect(html).toContain('<!--[if mso');
		expect(html).toContain('data-owl-mjml');
	});
});

describe('renderOwlMarkupHtml (C1 — Pi feed)', () => {
	it('returns the pre-MJML studio markup', () => {
		const { html } = renderOwlMarkupHtml(doc());
		expect(html).toContain('Buy now');
		expect(html).not.toContain('data-owl-mjml');
		expect(html).not.toContain('urn:schemas-microsoft-com:vml');
	});
});

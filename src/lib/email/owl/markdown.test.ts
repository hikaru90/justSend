import { describe, expect, it } from 'vitest';
import { pickDesignHexToken, renderOwlMarkdown, resolveMarkdownLinkColors } from './markdown';
import { applySlotValues } from './slots';
import { parseDocument, serialize } from './parser';
import { starterByKey } from './starters';
import { OWL } from './format';
import { compileOwlDoc, defaultOwlShell } from './studio-server';
import { newSectionId, type OwlDoc } from './studio';

describe('owl markdown', () => {
	it('renders bold, italic, and underlined links that inherit text color by default', () => {
		const html = renderOwlMarkdown('Hello **world** and *italics* and [site](https://example.com)');
		expect(html).toMatch(/<(strong|b)>world<\/(strong|b)>/);
		expect(html).toMatch(/<(em|i)>italics<\/(em|i)>/);
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('site');
		expect(html).toContain('color:inherit');
		expect(html).toContain('text-decoration:underline');
		expect(html).toContain('font-weight:400');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).not.toMatch(/color:\s*#(?:0000ee|00e|0066cc|0a2540)/i);
	});

	it('uses brand linkColor when provided', () => {
		const html = renderOwlMarkdown('[Go](https://example.com)', 'p', { linkColor: '#c45c26' });
		expect(html).toContain('color:#c45c26');
		expect(html).toContain('text-decoration:underline');
	});

	it('writes brand link color inline', () => {
		const html = renderOwlMarkdown('[Go](https://example.com)', 'p', {
			linkColor: '#c45c26',
		});
		expect(html).toContain('color:#c45c26');
		expect(html).toContain('text-decoration:underline');
		expect(html).not.toContain('data-owl-dark-style');
	});

	it('unwraps a single paragraph for block hosts', () => {
		const html = renderOwlMarkdown('Just a line', 'p');
		expect(html).not.toMatch(/^<p[\s>]/i);
		expect(html).toBe('Just a line');
	});

	it('uses inline parse for headings and anchors', () => {
		const heading = renderOwlMarkdown('Hello **friend**', 'h2');
		expect(heading).toMatch(/<(strong|b)>friend<\/(strong|b)>/);
		expect(heading).not.toContain('<p>');

		const link = renderOwlMarkdown('Click **here**', 'a');
		expect(link).toMatch(/<(strong|b)>here<\/(strong|b)>/);
		expect(link).not.toContain('<p>');
	});

	it('strips dangerous tags', () => {
		const html = renderOwlMarkdown('Hi <script>alert(1)</script> **ok**');
		expect(html).not.toContain('<script');
		expect(html).toMatch(/<(strong|b)>ok<\/(strong|b)>/);
	});

	it('applySlotValues renders markdown into text slots with link styles', () => {
		const frag = starterByKey('text')!.html;
		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${frag}</body></html>`);
		const slot = doc.querySelector(`[${OWL.slot}="text"]`);
		expect(slot).toBeTruthy();
		applySlotValues(
			doc,
			{
				text: 'Welcome **{{firstName}}** — [learn more](https://example.com)',
			},
			{ linkColor: '#123456' },
		);
		const html = serialize(doc);
		expect(html).toMatch(/<(strong|b)>\{\{firstName\}\}<\/(strong|b)>/);
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('color:#123456');
		expect(html).toContain('text-decoration:underline');
		expect(html).not.toContain('**{{firstName}}**');
	});

	it('keeps preheader as plain text', () => {
		const shell = starterByKey('base-layout')!.html;
		const doc = parseDocument(shell);
		applySlotValues(doc, { preheader: 'Sale on **now**' });
		const el = doc.querySelector(`[${OWL.preheader}]`);
		expect(el?.textContent).toContain('Sale on **now**');
		expect(el?.innerHTML ?? '').not.toMatch(/<(strong|b)>/);
	});
});

describe('resolveMarkdownLinkColors', () => {
	it('picks primary / link tokens', () => {
		expect(resolveMarkdownLinkColors({ primary: '#c45c26', link_dark: '#f5e6d3' })).toEqual({
			linkColor: '#c45c26',
		});
	});

	it('inherits when design system has no link/primary token', () => {
		expect(resolveMarkdownLinkColors({})).toEqual({ linkColor: 'inherit' });
		expect(resolveMarkdownLinkColors(undefined)).toEqual({ linkColor: 'inherit' });
	});

	it('pickDesignHexToken matches suffix keys', () => {
		expect(pickDesignHexToken({ brand_primary: '#aabbcc' }, ['primary'])).toBe('#aabbcc');
	});
});

describe('compileOwlDoc markdown links follow design tokens', () => {
	it('uses design primary for links', async () => {
		const text = starterByKey('text')!.html;
		const doc: OwlDoc = {
			owl: 'v1',
			shell: defaultOwlShell(),
			preheader: '',
			sections: [{ id: newSectionId(), key: 'text', label: 'Text', html: text }],
			slotValues: {
				text: 'See [docs](https://example.com) for details.',
			},
		};

		const compiled = await compileOwlDoc(doc, { tokens: { primary: '#c45c26' } });
		expect(compiled.html).toContain('color:#c45c26');
		expect(compiled.html).toMatch(/href="https:\/\/example\.com"[^>]*color:#c45c26/i);
		expect(compiled.html).not.toContain('data-owl-dark-style');
	});
});

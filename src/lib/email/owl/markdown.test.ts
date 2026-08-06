import { describe, expect, it } from 'vitest';
import { OWL_MARKDOWN_LINK_COLOR, renderOwlMarkdown } from './markdown';
import { applySlotValues } from './slots';
import { parseDocument, serialize } from './parser';
import { starterByKey } from './starters';
import { OWL } from './format';

describe('owl markdown', () => {
	it('renders bold, italic, and styled links', () => {
		const html = renderOwlMarkdown('Hello **world** and *italics* and [site](https://example.com)');
		expect(html).toMatch(/<(strong|b)>world<\/(strong|b)>/);
		expect(html).toMatch(/<(em|i)>italics<\/(em|i)>/);
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('site');
		expect(html).toContain(`color:${OWL_MARKDOWN_LINK_COLOR}`);
		expect(html).toContain('text-decoration:underline');
		expect(html).toContain('font-weight:400');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	it('uses brand linkColor when provided', () => {
		const html = renderOwlMarkdown('[Go](https://example.com)', 'p', { linkColor: '#c45c26' });
		expect(html).toContain('color:#c45c26');
		expect(html).toContain('text-decoration:underline');
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

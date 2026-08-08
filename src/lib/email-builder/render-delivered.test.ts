import { describe, expect, it } from 'vitest';
import { toMjmlDocument } from './to-mjml';
import { renderDeliveredEmailHtml } from './render-delivered';
import { isMjmlDelivered } from '$lib/email/mjml/postprocess';
import type { TEditorConfiguration } from './types';

function doc(colors: { backdrop?: string; canvas?: string } = {}): TEditorConfiguration {
	const textId = 'text1';
	const btnId = 'btn1';
	return {
		root: {
			type: 'EmailLayout',
			data: {
				backdropColor: colors.backdrop ?? '#F5F5F5',
				canvasColor: colors.canvas ?? '#FFFFFF',
				textColor: '#262626',
				fontFamily: 'MODERN_SANS',
				childrenIds: [textId, btnId],
			},
		},
		[textId]: {
			type: 'Text',
			data: {
				props: { text: '**Hello** world', markdown: true },
				style: {
					color: '#333333',
					fontSize: 16,
					padding: { top: 8, right: 16, bottom: 8, left: 16 },
				},
			},
		},
		[btnId]: {
			type: 'Button',
			data: {
				props: {
					text: 'Buy now',
					url: 'https://example.com/buy',
					buttonBackgroundColor: '#0A2540',
					buttonTextColor: '#FFFFFF',
				},
				style: { padding: { top: 0, right: 16, bottom: 0, left: 16 } },
			},
		},
	};
}

describe('toMjmlDocument', () => {
	it('maps the layout scaffold onto mjml', () => {
		const xml = toMjmlDocument(doc());
		expect(xml).toContain('<mjml');
		expect(xml).toContain('background-color="#F5F5F5"');
		expect(xml).toContain('width="600px"');
		expect(xml).toContain('<mj-wrapper background-color="#FFFFFF">');
	});

	it('keeps block render output verbatim in mj-raw with blend wrappers', () => {
		const xml = toMjmlDocument(doc());
		expect(xml).toContain(
			'<mj-raw><div class="gmail-blend-screen"><div class="gmail-blend-difference">',
		);
		expect(xml).toContain('owl-block-');
		expect(xml).toContain('Buy now');
	});
});

describe('renderDeliveredEmailHtml', () => {
	it('delivers an MJML document with the light-only shield', async () => {
		const html = await renderDeliveredEmailHtml(doc());
		expect(html).toMatch(/^<!doctype html>/i);
		expect(html).toContain('urn:schemas-microsoft-com:vml');
		expect(html).toContain('<!--[if mso');
		expect(isMjmlDelivered(html)).toBe(true);
		expect(html).toContain('class="body"');
		expect(html).toMatch(
			/<meta[^>]*content="light only"[^>]*name="color-scheme"|<meta[^>]*name="color-scheme"[^>]*content="light only"/,
		);
		expect(html).toContain('@media (prefers-color-scheme:dark)');
		expect(html).toContain('u + .body .gmail-blend-difference');
	});

	it('renders markdown text + CTA verbatim', async () => {
		const html = await renderDeliveredEmailHtml(doc());
		expect(html).toContain('<strong');
		expect(html).toContain('Hello</strong>');
		expect(html).toContain('href="https://example.com/buy"');
		expect(html).toContain('Buy now');
	});

	it('honors custom backdrop/canvas colors', async () => {
		const html = await renderDeliveredEmailHtml(doc({ backdrop: '#112233', canvas: '#FEFEFE' }));
		expect(html).toContain('background-color:#112233');
		expect(html).toContain('background:#FEFEFE');
	});

	it('is deterministic across runs', async () => {
		const a = await renderDeliveredEmailHtml(doc());
		const b = await renderDeliveredEmailHtml(doc());
		expect(a).toBe(b);
	});
});

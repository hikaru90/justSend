import { describe, expect, it } from 'vitest';
import { fluidifyEmailHtml } from './fluidify-email-html';

describe('fluidifyEmailHtml', () => {
	it('converts fixed width=600 tables to fluid max-width tables', () => {
		const html =
			'<table role="presentation" width="600" cellpadding="0"><tr><td>x</td></tr></table>';
		const out = fluidifyEmailHtml(html);
		expect(out).toContain('width="100%"');
		expect(out).toContain('max-width:600px');
		expect(out).not.toMatch(/width=["']600["']/);
	});

	it('preserves existing max-width while making width fluid', () => {
		const html =
			'<table width="620" style="background:#fff;max-width:620px"><tr><td>x</td></tr></table>';
		const out = fluidifyEmailHtml(html);
		expect(out).toContain('width="100%"');
		expect(out).toContain('max-width:620px');
	});

	it('adds max-width and height:auto to images', () => {
		const html = '<img src="https://example.com/logo.svg" alt="Logo" width="120" height="auto">';
		const out = fluidifyEmailHtml(html);
		expect(out).toContain('max-width:100%');
		expect(out).toContain('height:auto');
		expect(out).not.toMatch(/height=["']auto["']/);
	});

	it('leaves already-fluid images alone structurally', () => {
		const html =
			'<img src="https://example.com/a.png" style="display:block;max-width:100%;height:auto;" />';
		expect(fluidifyEmailHtml(html)).toBe(html);
	});
});

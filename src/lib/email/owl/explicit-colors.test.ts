import { describe, expect, it } from 'vitest';
import { compileOwlHtml, composeEmailHtml } from './index';
import { parseDocument, walkElements } from './parser';
import { parseStyleDecls } from './style';
import { STARTERS, starterByKey } from './starters';

const SHELL = starterByKey('base-layout')!.html;

const SAMPLE_SECTION = `<table role="presentation" data-owl-component="cta-button" width="100%" cellpadding="0" cellspacing="0" border="0">
<tbody><tr><td style="padding:16px 24px;">
<a href="https://example.com" style="display:inline-block;background-color:#0A2540;color:#FFFFFF;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:bold;" data-owl-slot="cta_text" data-owl-slot-type="text"><span>Get started</span></a>
</td></tr></tbody></table>`;

function styleOf(html: string, selector: RegExp): string {
	const match = html.match(selector);
	expect(match).toBeTruthy();
	return match![1] ?? '';
}

function hasDecl(style: string, prop: string, value?: string): boolean {
	const decls = parseStyleDecls(style);
	const found = decls.find(([p]) => p === prop);
	if (!found) return false;
	if (value === undefined) return true;
	return found[1].toLowerCase() === value.toLowerCase();
}

describe('owl: enforce-explicit-colors', () => {
	it('fills missing background-color and color on a bare td', () => {
		const composed = composeEmailHtml(SHELL, [
			`<table role="presentation"><tbody><tr><td style="padding:8px 24px;"><p style="color:#262626;">Hello</p></td></tr></tbody></table>`,
		]).html;
		const { html } = compileOwlHtml(composed);
		const tdStyle = styleOf(html, /<td[^>]*style="([^"]*)"[^>]*>\s*<p/i);
		expect(hasDecl(tdStyle, 'background-color', '#FFFFFF')).toBe(true);
		expect(hasDecl(tdStyle, 'color', '#262626')).toBe(true);
	});

	it('fills missing background-color on a p that already has color', () => {
		const composed = composeEmailHtml(SHELL, [
			`<table role="presentation" style="background-color:#FFFFFF;color:#262626;"><tbody><tr><td style="background-color:#FFFFFF;color:#262626;"><p style="color:#262626;">Hello</p></td></tr></tbody></table>`,
		]).html;
		const { html } = compileOwlHtml(composed);
		const pStyle = styleOf(html, /<p[^>]*style="([^"]*)"/i);
		expect(hasDecl(pStyle, 'background-color', '#FFFFFF')).toBe(true);
		expect(hasDecl(pStyle, 'color', '#262626')).toBe(true);
	});

	it('keeps CTA link colors and fills the inner span from the link', () => {
		const composed = composeEmailHtml(SHELL, [SAMPLE_SECTION]).html;
		const { html } = compileOwlHtml(composed);

		const aStyle = styleOf(html, /<a[^>]*style="([^"]*)"[^>]*>\s*<span/i);
		expect(hasDecl(aStyle, 'background-color', '#0A2540')).toBe(true);
		expect(hasDecl(aStyle, 'color', '#FFFFFF')).toBe(true);

		const spanStyle = styleOf(html, /<span[^>]*style="([^"]*)"/i);
		expect(hasDecl(spanStyle, 'background-color', '#0A2540')).toBe(true);
		expect(hasDecl(spanStyle, 'color', '#FFFFFF')).toBe(true);
	});

	it('does not add background-color to img elements', () => {
		const composed = composeEmailHtml(SHELL, [starterByKey('logo-header')!.html]).html;
		const { html } = compileOwlHtml(composed);
		const imgMatch = html.match(/<img[^>]*>/i);
		expect(imgMatch).toBeTruthy();
		expect(imgMatch![0]).not.toMatch(/background-color/i);
	});

	it('does not add inline background-color to gmail-blend wrappers', () => {
		const composed = composeEmailHtml(SHELL, [SAMPLE_SECTION]).html;
		const { html } = compileOwlHtml(composed);

		const screenMatch = html.match(/<div\b[^>]*class="[^"]*\bgmail-blend-screen\b[^"]*"[^>]*>/i);
		const diffMatch = html.match(/<div\b[^>]*class="[^"]*\bgmail-blend-difference\b[^"]*"[^>]*>/i);
		expect(screenMatch).toBeTruthy();
		expect(diffMatch).toBeTruthy();
		expect(screenMatch![0]).not.toMatch(/background-color/i);
		expect(diffMatch![0]).not.toMatch(/background-color/i);
	});

	it('does not touch the display:none preheader', () => {
		const composed = composeEmailHtml(SHELL, [SAMPLE_SECTION]).html;
		const { html } = compileOwlHtml(composed);
		const preheaderMatch = html.match(/<div[^>]*data-owl-preheader[^>]*>/i);
		expect(preheaderMatch).toBeTruthy();
		const style = preheaderMatch![0].match(/style="([^"]*)"/)?.[1] ?? '';
		expect(style).toContain('display:none');
		expect(hasDecl(style, 'background-color')).toBe(false);
		expect(hasDecl(style, 'color')).toBe(false);
	});

	it('recompiling compiled output is a fixed point', () => {
		const composed = composeEmailHtml(SHELL, [
			starterByKey('heading')!.html,
			SAMPLE_SECTION,
			starterByKey('footer-legal')!.html,
		]).html;
		const first = compileOwlHtml(composed).html;
		const second = compileOwlHtml(first).html;
		expect(second).toBe(first);
	});

	it('gives every visible table, td, p, and span an explicit background-color and color', () => {
		const sections = STARTERS.filter((s) => s.key !== 'base-layout').map((s) => s.html);
		const composed = composeEmailHtml(SHELL, sections).html;
		const { html } = compileOwlHtml(composed, { kind: 'marketing' });
		const doc = parseDocument(html);

		const checked: string[] = [];
		for (const el of walkElements(doc.body ?? doc)) {
			const tag = el.tagName.toLowerCase();
			if (!['table', 'td', 'p', 'span', 'h2', 'a', 'div'].includes(tag)) continue;
			if (tag === 'img') continue;

			const cls = el.getAttribute('class') ?? '';
			if (cls.includes('gmail-blend-screen') || cls.includes('gmail-blend-difference')) continue;

			const display = parseStyleDecls(el.getAttribute('style')).find(([p]) => p === 'display');
			if (display?.[1]?.toLowerCase() === 'none') continue;

			const style = el.getAttribute('style') ?? '';
			const id = el.getAttribute('data-owl-id') ?? '?';
			if (!hasDecl(style, 'background-color')) {
				throw new Error(`${tag}#${id} missing background-color`);
			}
			if (!hasDecl(style, 'color')) {
				throw new Error(`${tag}#${id} missing color`);
			}
			checked.push(tag);
		}
		expect(checked.length).toBeGreaterThan(10);
	});

	it('inherits backdrop color into outer shell cells and canvas color into sections', () => {
		const composed = composeEmailHtml(SHELL, [
			`<table role="presentation"><tbody><tr><td style="padding:8px;"><span>x</span></td></tr></tbody></table>`,
		]).html;
		const { html } = compileOwlHtml(composed);

		// Outer shell td keeps the #F5F5F5 backdrop.
		expect(html).toMatch(/padding:32px 12px;[^"]*background-color:#F5F5F5/);

		// Section content inherits the white canvas.
		const spanStyle = styleOf(html, /<span[^>]*style="([^"]*)"/i);
		expect(hasDecl(spanStyle, 'background-color', '#FFFFFF')).toBe(true);
		expect(hasDecl(spanStyle, 'color', '#262626')).toBe(true);
	});
});

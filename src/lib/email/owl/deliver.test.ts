import { describe, expect, it } from 'vitest';
import { buildOwlMjmlDocument } from './mjml-map';
import { deliverOwlHtml } from './deliver';
import { finalizeDeliveryHtml, isMjmlDelivered, MJML_MARKER } from '../mjml/postprocess';
import { renderOwlMarkupHtml } from './render-doc';
import { emptyOwlDoc, newSectionId, type OwlDoc } from './studio';
import { starterByKey } from './starters';
import { defaultOwlShell } from './studio-server';

function doc(): OwlDoc {
	const d = emptyOwlDoc(defaultOwlShell(), 'Sneak peek');
	d.sections.push({
		id: newSectionId(),
		key: 'cta-button',
		label: 'CTA',
		html: starterByKey('cta-button')!.html,
	});
	d.slotValues = { cta_text: 'Buy now', cta_url: 'https://example.com/buy' };
	return d;
}

describe('buildOwlMjmlDocument', () => {
	it('maps backdrop/canvas/width into the MJML shell', () => {
		const { xml } = buildOwlMjmlDocument(renderOwlMarkupHtml(doc()).html);
		expect(xml).toContain('<mjml');
		expect(xml).toContain('background-color="#F5F5F5"');
		expect(xml).toContain('width="620px"');
		expect(xml).toContain('<mj-wrapper background-color="#FFFFFF">');
	});

	it('puts sections + preheader in mj-raw blocks', () => {
		const { xml } = buildOwlMjmlDocument(renderOwlMarkupHtml(doc()).html);
		expect(xml).toMatch(/<mj-raw>[\s\S]*data-owl-component="cta-button"[\s\S]*<\/mj-raw>/);
		expect(xml).toContain('data-owl-preheader');
		expect(xml).toContain('Sneak peek');
	});

	it('returns the canvas owl id for post-processing', () => {
		const { canvasOwlId } = buildOwlMjmlDocument(renderOwlMarkupHtml(doc()).html);
		expect(canvasOwlId).toMatch(/^w\d+$/);
	});
});

describe('deliverOwlHtml', () => {
	it('wraps compiled markup in an MJML document', async () => {
		const html = await deliverOwlHtml(renderOwlMarkupHtml(doc()).html);
		expect(html).toMatch(/^<!doctype html>/i);
		expect(html).toContain('urn:schemas-microsoft-com:vml');
		expect(html).toContain('<!--[if mso');
		expect(html).toContain('max-width:620px');
		expect(html).toContain(MJML_MARKER);
		expect(html).toContain('Buy now');
		expect(html).toContain('href="https://example.com/buy"');
		expect(html).toContain('Sneak peek');
	});

	it('preserves data-owl-id annotations on sections', async () => {
		const html = await deliverOwlHtml(renderOwlMarkupHtml(doc()).html);
		expect(html).toContain('data-owl-component="cta-button"');
		expect(html).toContain('data-owl-role="section"');
		expect(html).toMatch(/data-owl-id="w\d+"/);
	});

	it('keeps the light-only shield: metas, class=body, light css, blend css', async () => {
		const html = await deliverOwlHtml(renderOwlMarkupHtml(doc()).html);
		const metaRe = (name: string) =>
			new RegExp(
				`<meta[^>]*content="light only"[^>]*name="${name}"|<meta[^>]*name="${name}"[^>]*content="light only"`,
			);
		expect(html).toMatch(metaRe('color-scheme'));
		expect(html).toMatch(metaRe('supported-color-schemes'));
		expect(html).toContain('class="body"');
		expect(html).toContain('@media (prefers-color-scheme:dark)');
		expect(html).toContain('u + .body .gmail-blend-screen');
		expect(html).toContain('owll-');
	});

	it('re-stamps the canvas wrapper div with the shell canvas owl id', async () => {
		const markup = renderOwlMarkupHtml(doc()).html;
		const { canvasOwlId } = buildOwlMjmlDocument(markup);
		const html = await deliverOwlHtml(markup);
		// The canvas id must exist exactly once (on the MJML wrapper), not duplicated.
		const occurrences = html.split(`data-owl-id="${canvasOwlId}"`).length - 1;
		expect(occurrences).toBe(1);
	});

	it('carries the shell canvas text styles onto the raw wrapper', () => {
		const { xml } = buildOwlMjmlDocument(renderOwlMarkupHtml(doc()).html);
		expect(xml).toContain("font-family:'Helvetica Neue',Helvetica,Arial,sans-serif");
		expect(xml).toContain('color:#262626');
		expect(xml).toContain('font-size:16px');
		expect(xml).toContain('line-height:1.5');
	});

	it('is deterministic across runs', async () => {
		const markup = renderOwlMarkupHtml(doc()).html;
		const a = await deliverOwlHtml(markup);
		const b = await deliverOwlHtml(markup);
		expect(a).toBe(b);
	});

	it('generates section pins against forced dark mode', async () => {
		const html = await deliverOwlHtml(renderOwlMarkupHtml(doc()).html);
		expect(html).toMatch(/\.owll-w\d+\{[^}]*!important/);
	});
});

describe('finalizeDeliveryHtml', () => {
	it('marks MJML output and skips fluidify via isMjmlDelivered', async () => {
		const html = await deliverOwlHtml(renderOwlMarkupHtml(doc()).html);
		expect(isMjmlDelivered(html)).toBe(true);
		expect(isMjmlDelivered(renderOwlMarkupHtml(doc()).html)).toBe(false);
	});

	it('is idempotent enough for re-finalizing (no duplicate metas)', async () => {
		const html = await deliverOwlHtml(renderOwlMarkupHtml(doc()).html);
		const again = finalizeDeliveryHtml(html);
		expect(again.split('name="color-scheme"').length - 1).toBe(1);
		expect(again.split(`${MJML_MARKER}=`).length - 1).toBe(1);
	});
});

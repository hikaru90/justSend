import { describe, expect, it } from 'vitest';

import { transpileMjml } from './transpile';

const SAMPLE = `<mjml lang="de"><mj-body background-color="#f5f5f5"><mj-wrapper background-color="#ffffff"><mj-raw><section class="owl-section"><h1>Hello</h1></section></mj-raw></mj-wrapper></mj-body></mjml>`;

describe('transpileMjml', () => {
	it('returns a full html document', async () => {
		const { html, errors } = await transpileMjml(SAMPLE);
		expect(errors).toEqual([]);
		expect(html.startsWith('<!doctype html>')).toBe(true);
		expect(html).toContain('urn:schemas-microsoft-com:vml');
	});

	it('keeps mj-raw sections verbatim', async () => {
		const { html } = await transpileMjml(SAMPLE);
		expect(html).toContain('<section class="owl-section">');
		expect(html).toContain('<h1>Hello</h1>');
	});

	it('reads lang from the mjml root', async () => {
		const { html } = await transpileMjml(SAMPLE);
		expect(html).toMatch(/<html[^>]*lang="de"/);
	});

	it('is deterministic across runs', async () => {
		const a = await transpileMjml(SAMPLE);
		const b = await transpileMjml(SAMPLE);
		expect(a.html).toBe(b.html);
	});

	it('throws on non-mjml input', async () => {
		await expect(transpileMjml('hello')).rejects.toThrow();
	});
});

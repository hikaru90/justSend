import { describe, it, expect } from 'vitest';
import { absolutizeEmailAssetUrls } from './absolutize-email-urls';

describe('absolutizeEmailAssetUrls', () => {
	const base = 'https://mail.example.com';

	it('absolutizes img src design-asset paths', () => {
		expect(
			absolutizeEmailAssetUrls('<img src="/api/design-asset/abc123" alt="" />', base)
		).toBe('<img src="https://mail.example.com/api/design-asset/abc123" alt="" />');
	});

	it('absolutizes background-image url() forms', () => {
		expect(
			absolutizeEmailAssetUrls(
				'style="background-image:url(/api/design-asset/bg1)"',
				base
			)
		).toBe('style="background-image:url(https://mail.example.com/api/design-asset/bg1)"');

		expect(
			absolutizeEmailAssetUrls(
				'style="background-image:url(\'/api/design-asset/bg2\')"',
				base
			)
		).toBe('style="background-image:url(\'https://mail.example.com/api/design-asset/bg2\')"');
	});

	it('leaves already-absolute URLs alone', () => {
		const html = '<img src="https://cdn.example/x.png" />';
		expect(absolutizeEmailAssetUrls(html, base)).toBe(html);
	});

	it('strips trailing slash on base', () => {
		expect(
			absolutizeEmailAssetUrls('<img src="/api/design-asset/x" />', `${base}/`)
		).toBe('<img src="https://mail.example.com/api/design-asset/x" />');
	});
});

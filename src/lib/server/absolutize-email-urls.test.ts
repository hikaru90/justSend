import { describe, it, expect } from 'vitest';
import { absolutizeEmailAssetUrls } from './absolutize-email-urls';

describe('absolutizeEmailAssetUrls', () => {
	const base = 'https://mail.example.com';

	it('absolutizes img src design-asset paths', () => {
		expect(
			absolutizeEmailAssetUrls('<img src="/api/design-asset/abc123" alt="" />', base)
		).toBe(
			'<img style="display:block;max-width:100%;height:auto;border:0;" src="https://mail.example.com/api/design-asset/abc123" alt="" />'
		);
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
		const html =
			'<img src="https://cdn.example/x.png" style="display:block;max-width:100%;height:auto;" />';
		expect(absolutizeEmailAssetUrls(html, base)).toBe(html);
	});

	it('strips trailing slash on base', () => {
		expect(
			absolutizeEmailAssetUrls(
				'<img src="/api/design-asset/x" style="max-width:100%;height:auto;" />',
				`${base}/`
			)
		).toBe(
			'<img src="https://mail.example.com/api/design-asset/x" style="max-width:100%;height:auto;display:block" />'
		);
	});

	it('fluidifies fixed-width tables on the way out', () => {
		const out = absolutizeEmailAssetUrls(
			'<table width="600"><tr><td><img src="/api/design-asset/x" /></td></tr></table>',
			base
		);
		expect(out).toContain('width="100%"');
		expect(out).toContain('max-width:600px');
		expect(out).toContain('https://mail.example.com/api/design-asset/x');
	});
});

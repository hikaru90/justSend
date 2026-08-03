import { describe, it, expect } from 'vitest';
import {
	designAssetPath,
	designAssetUrl,
	relativizeDesignAssetUrls,
	rewriteDesignAssetUrls,
} from './design-asset-urls';

describe('designAssetPath / designAssetUrl', () => {
	it('builds relative paths by default', () => {
		expect(designAssetPath('abc')).toBe('/api/design-asset/abc');
		expect(designAssetUrl('abc')).toBe('/api/design-asset/abc');
		expect(designAssetUrl('abc', '')).toBe('/api/design-asset/abc');
	});

	it('prefixes an origin when provided', () => {
		expect(designAssetUrl('abc', 'https://mail.example.com')).toBe(
			'https://mail.example.com/api/design-asset/abc',
		);
		expect(designAssetUrl('abc', 'https://mail.example.com/')).toBe(
			'https://mail.example.com/api/design-asset/abc',
		);
	});
});

describe('relativizeDesignAssetUrls', () => {
	it('strips hosts from design-asset URLs', () => {
		expect(
			relativizeDesignAssetUrls(
				'<img src="http://localhost:5173/api/design-asset/abc" /><img src="https://prod.example/api/design-asset/xyz" />',
			),
		).toBe('<img src="/api/design-asset/abc" /><img src="/api/design-asset/xyz" />');
	});

	it('leaves non-design-asset absolute URLs alone', () => {
		const html = '<img src="https://cdn.example/logo.png" />';
		expect(relativizeDesignAssetUrls(html)).toBe(html);
	});
});

describe('rewriteDesignAssetUrls', () => {
	const base = 'https://mail.example.com';

	it('absolutizes relative paths', () => {
		expect(rewriteDesignAssetUrls('<img src="/api/design-asset/abc" />', base)).toBe(
			'<img src="https://mail.example.com/api/design-asset/abc" />',
		);
	});

	it('rewrites localhost absolute URLs onto the new base', () => {
		expect(
			rewriteDesignAssetUrls('<img src="http://localhost:5173/api/design-asset/abc" />', base),
		).toBe('<img src="https://mail.example.com/api/design-asset/abc" />');
	});

	it('rewrites background-image url() forms', () => {
		expect(
			rewriteDesignAssetUrls(
				'style="background-image:url(http://localhost:5173/api/design-asset/bg)"',
				base,
			),
		).toBe('style="background-image:url(https://mail.example.com/api/design-asset/bg)"');
	});
});

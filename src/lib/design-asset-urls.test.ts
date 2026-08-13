import { describe, it, expect } from 'vitest';
import {
	designAssetPath,
	designAssetUrl,
	normalizeBareDesignAssetUrlsInDocument,
	normalizeBareDesignAssetUrlsInHtml,
	normalizeDesignAssetSrc,
	normalizeDesignAssetSlotValues,
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

describe('normalizeDesignAssetSrc', () => {
	it('wraps bare cuid (24 hex) and sha256 (64 hex) ids', () => {
		expect(normalizeDesignAssetSrc('174e2ac4d3aa4de49eb17b86')).toBe(
			'/api/design-asset/174e2ac4d3aa4de49eb17b86',
		);
		const sha = 'a'.repeat(64);
		expect(normalizeDesignAssetSrc(sha)).toBe(`/api/design-asset/${sha}`);
	});

	it('leaves already-prefixed and absolute URLs alone', () => {
		expect(normalizeDesignAssetSrc('/api/design-asset/174e2ac4d3aa4de49eb17b86')).toBe(
			'/api/design-asset/174e2ac4d3aa4de49eb17b86',
		);
		expect(normalizeDesignAssetSrc('https://cdn.example/logo.png')).toBe(
			'https://cdn.example/logo.png',
		);
		expect(normalizeDesignAssetSrc('/logo.png')).toBe('/logo.png');
	});

	it('normalizes slot value maps', () => {
		expect(
			normalizeDesignAssetSlotValues({
				logo: '174e2ac4d3aa4de49eb17b86',
				cta_url: 'https://example.com',
				hero: '/api/design-asset/abc',
			}),
		).toEqual({
			logo: '/api/design-asset/174e2ac4d3aa4de49eb17b86',
			cta_url: 'https://example.com',
			hero: '/api/design-asset/abc',
		});
	});

	it('returns the same object when nothing changes', () => {
		const values = { hero: '/api/design-asset/abc', cta: 'https://x.io' };
		expect(normalizeDesignAssetSlotValues(values)).toBe(values);
	});
});

describe('normalizeBareDesignAssetUrlsInHtml', () => {
	it('rewrites bare ids in src and url()', () => {
		expect(
			normalizeBareDesignAssetUrlsInHtml(
				'<img src="174e2ac4d3aa4de49eb17b86"><div style="background-image:url(5b638723b5fc4c20997f1496)">',
			),
		).toBe(
			'<img src="/api/design-asset/174e2ac4d3aa4de49eb17b86"><div style="background-image:url(/api/design-asset/5b638723b5fc4c20997f1496)">',
		);
	});

	it('leaves prefixed srcs alone', () => {
		const html = '<img src="/api/design-asset/174e2ac4d3aa4de49eb17b86">';
		expect(normalizeBareDesignAssetUrlsInHtml(html)).toBe(html);
	});
});

describe('normalizeBareDesignAssetUrlsInDocument', () => {
	it('rewrites Image props.url and Container backgroundImage', () => {
		const doc = {
			root: { type: 'EmailLayout', data: { childrenIds: ['img', 'hero'] } },
			img: { type: 'Image', data: { props: { url: '174e2ac4d3aa4de49eb17b86' } } },
			hero: {
				type: 'Container',
				data: { style: { backgroundImage: '5b638723b5fc4c20997f1496' } },
			},
		};
		expect(normalizeBareDesignAssetUrlsInDocument(doc)).toBe(true);
		expect(doc.img.data.props.url).toBe('/api/design-asset/174e2ac4d3aa4de49eb17b86');
		expect(doc.hero.data.style.backgroundImage).toBe('/api/design-asset/5b638723b5fc4c20997f1496');
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

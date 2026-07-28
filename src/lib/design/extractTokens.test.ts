import { describe, expect, it } from 'vitest';
import {
	applyPreviewColorScheme,
	extractDesignTokens,
	pickEmailLogos,
	substitutePreviewPlaceholders
} from './extractTokens';

describe('extractDesignTokens', () => {
	it('extracts unique hex colors', () => {
		const md = '# Brand\nPrimary: #112233\nSecondary: #abc\nPrimary again: #112233';
		const tokens = extractDesignTokens(md);
		expect(tokens.colors).toEqual(['#112233', '#aabbcc']);
	});

	it('extracts font families from typography section', () => {
		const md = `# Typography
- Heading: \`Inter\`
- Body font-family: Roboto
`;
		const tokens = extractDesignTokens(md);
		expect(tokens.fontFamilies).toContain('Inter');
		expect(tokens.fontFamilies).toContain('Roboto');
	});
});

describe('substitutePreviewPlaceholders', () => {
	it('replaces known placeholders', () => {
		const html = '<a href="{{cta_url}}">{{cta_label}}</a>';
		expect(substitutePreviewPlaceholders(html)).toBe(
			'<a href="https://example.com">Click here</a>'
		);
	});

	it('uses design-system logo overrides', () => {
		const html = '<img src="{{logo}}" alt="{{logo}}" />';
		expect(
			substitutePreviewPlaceholders(html, {
				logo: '/api/design-asset/abc',
				logo_url: '/api/design-asset/abc'
			})
		).toBe('<img src="/api/design-asset/abc" alt="/api/design-asset/abc" />');
	});
});

describe('pickEmailLogos', () => {
	it('pairs light and dark logos deterministically', () => {
		const logos = [
			{ id: 'z', name: 'Primary Logo dark', filename: 'logo-dark-whole.svg' },
			{ id: 'a', name: 'Primary Logo', filename: 'logo-whole.svg' }
		];
		const pair = pickEmailLogos(logos);
		expect(pair?.light.id).toBe('a');
		expect(pair?.dark.id).toBe('z');
	});

	it('falls back dark to light when only one logo exists', () => {
		const logos = [{ id: '1', name: 'Primary Logo', filename: 'logo.svg' }];
		const pair = pickEmailLogos(logos);
		expect(pair?.light.id).toBe('1');
		expect(pair?.dark.id).toBe('1');
	});

	it('returns undefined for empty list', () => {
		expect(pickEmailLogos([])).toBeUndefined();
	});
});

describe('applyPreviewColorScheme', () => {
	const html = `
<style>
body { background: #fff; color: #111; }
@media (prefers-color-scheme: dark) {
  body { background: #111; color: #fff; }
}
</style>
<img class="logo-light" src="/light.svg" />
<img class="logo-dark" src="/dark.svg" />
`;

	it('strips dark media queries in light mode', () => {
		const out = applyPreviewColorScheme(html, 'light');
		expect(out).not.toContain('prefers-color-scheme');
		expect(out).not.toContain('background: #111');
		expect(out).toContain('background: #fff');
		expect(out).toContain('.logo-dark{display:none!important}');
	});

	it('unwraps dark media queries in dark mode', () => {
		const out = applyPreviewColorScheme(html, 'dark');
		expect(out).not.toContain('prefers-color-scheme');
		expect(out).toContain('background: #111');
		expect(out).toContain('.logo-light{display:none!important}');
	});
});

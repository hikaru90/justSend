import { describe, expect, it } from 'vitest';
import {
	addHexColor,
	applyPreviewColorScheme,
	extractDesignTokens,
	hexForColorInput,
	pickEmailLogos,
	removeHexColor,
	replaceHexColor,
	renderSvelteComponentPreview,
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

describe('design.md color edits', () => {
	it('replaces hex colors case-insensitively', () => {
		const md = 'Primary: #AbC\nCTA uses #AABBCC';
		expect(replaceHexColor(md, '#abc', '#112233')).toBe('Primary: #112233\nCTA uses #112233');
	});

	it('adds a color under an existing Colors section', () => {
		const md = '## Colors\n- Primary: `#111111`\n\n## Typography\n';
		const next = addHexColor(md, '#ff0000', 'Accent');
		expect(next).toContain('- Accent: `#ff0000`');
		expect(next.indexOf('Accent')).toBeLessThan(next.indexOf('## Typography'));
		expect(extractDesignTokens(next).colors).toContain('#ff0000');
	});

	it('creates a Colors section when missing', () => {
		const next = addHexColor('# Brand\n', '#00ff00');
		expect(next).toContain('## Colors');
		expect(next).toContain('#00ff00');
	});

	it('removes a color list item', () => {
		const md = '## Colors\n- Primary: `#111111`\n- Accent: `#ff0000`\n';
		const next = removeHexColor(md, '#ff0000');
		expect(next).not.toContain('#ff0000');
		expect(next).toContain('#111111');
	});

	it('expands short hex for color inputs', () => {
		expect(hexForColorInput('#abc')).toBe('#aabbcc');
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

	it('replaces contact variables', () => {
		const html = 'Hi {{firstName}} {{lastName}} &lt;{{email}}&gt;';
		expect(substitutePreviewPlaceholders(html)).toBe(
			'Hi Alex River &lt;alex@example.com&gt;'
		);
	});

	it('uses contact variable overrides', () => {
		const html = 'Hi {{firstName}}';
		expect(substitutePreviewPlaceholders(html, { firstName: 'Ada' })).toBe('Hi Ada');
	});

	it('leaves unsubscribe merge tags intact instead of example.com', () => {
		const html =
			'<a href="{{owlery_unsubscribe_url}}">{{unsubscribe_label}}</a>' +
			'<a href="{{unsubscribe_url}}">Unsub</a>';
		expect(substitutePreviewPlaceholders(html)).toBe(
			'<a href="{{owlery_unsubscribe_url}}">Unsubscribe</a>' +
				'<a href="{{unsubscribe_url}}">Unsub</a>'
		);
	});
});

describe('renderSvelteComponentPreview', () => {
	it('fills Svelte props and unwraps if blocks', () => {
		const source = `<script>
	let { logo_url = '', headline = '', primary_cta_label = '', primary_cta_url = '' } = $props();
</script>
{#if logo_url}
	<img src={logo_url} alt="Logo" />
{/if}
<h1>{headline}</h1>
{#if primary_cta_label}
	<a href={primary_cta_url || '#'}>{primary_cta_label}</a>
{/if}`;

		const html = renderSvelteComponentPreview(source);
		expect(html).toContain('src="data:image/svg+xml,');
		expect(html).toContain('<h1>Welcome aboard</h1>');
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('>Get started</a>');
		expect(html).not.toContain('{logo_url}');
		expect(html).not.toContain('{#if');
		expect(html).not.toContain('<script');
	});

	it('prefers design-system logo overrides', () => {
		const source = `<img src={logo_url} class="logo-light" />`;
		const html = renderSvelteComponentPreview(source, {
			logo_url: '/api/design-asset/logo-1'
		});
		expect(html).toContain('src="/api/design-asset/logo-1"');
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
		expect(out).toContain('color-scheme:light');
	});

	it('unwraps dark media queries in dark mode', () => {
		const out = applyPreviewColorScheme(html, 'dark');
		expect(out).not.toContain('prefers-color-scheme');
		expect(out).toContain('background: #111');
		expect(out).toContain('.logo-light{display:none!important}');
		expect(out).toContain('color-scheme:dark');
	});

	it('darkens light inline backgrounds and lightens dark text (client auto-darken)', () => {
		const email = `<body style="background-color:#F5F5F5;color:#262626" bgcolor="#F5F5F5">
<table bgcolor="#FFFFFF" style="background-color:#FFFFFF;color:#111111">
<a style="background-color:#000000;color:#FFFFFF">CTA</a>
</table></body>`;
		const out = applyPreviewColorScheme(email, 'dark');
		expect(out).toContain('background-color:#101010');
		expect(out).toContain('background-color:#0c0c0c');
		expect(out).toContain('bgcolor="#101010"');
		expect(out).toContain('bgcolor="#0c0c0c"');
		expect(out).toContain('color:#d9d9d9');
		expect(out).toContain('color:#eeeeee');
		// Dark CTA fill / light label stay put
		expect(out).toContain('background-color:#000000');
		expect(out).toContain('color:#FFFFFF');
	});
});

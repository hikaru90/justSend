import { describe, expect, it } from 'vitest';
import {
	addHexColor,
	buildDesignColorOptions,
	extractDesignTokens,
	hexForColorInput,
	orderDesignColorOptions,
	parseDesignTokenMap,
	pickEmailLogo,
	removeHexColor,
	replaceHexColor,
	renderSvelteComponentPreview,
	substitutePreviewPlaceholders,
} from './extractTokens';

describe('extractDesignTokens', () => {
	it('extracts unique hex colors', () => {
		const md = '# Brand\nPrimary: #112233\nSecondary: #abc\nPrimary again: #112233';
		const tokens = extractDesignTokens(md);
		expect(tokens.colors).toEqual(['#112233', '#aabbcc']);
	});

	it('extracts named token map for compile', () => {
		const md = '## Colors\n- Primary: `#112233`\n- Accent: #ff0000';
		expect(parseDesignTokenMap(md)).toEqual({
			primary: '#112233',
			accent: '#ff0000',
		});
	});

	it('buildDesignColorOptions merges named tokens and swatches', () => {
		const md = '## Colors\n- Primary: `#112233`\n- Accent: #ff0000';
		const tokens = parseDesignTokenMap(md);
		const colors = extractDesignTokens(md).colors;
		expect(buildDesignColorOptions(colors, tokens)).toEqual([
			{ label: 'primary', value: '#112233' },
			{ label: 'accent', value: '#ff0000' },
		]);
	});

	it('orderDesignColorOptions puts recommended hex first', () => {
		const options = [
			{ label: 'primary', value: '#112233' },
			{ label: 'accent', value: '#ff0000' },
		];
		expect(orderDesignColorOptions(options, '#ff0000')).toEqual([
			{ label: 'accent', value: '#ff0000' },
			{ label: 'primary', value: '#112233' },
		]);
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
			'<a href="https://example.com">Click here</a>',
		);
	});

	it('uses design-system logo overrides', () => {
		const html = '<img src="{{logo}}" alt="{{logo}}" />';
		expect(
			substitutePreviewPlaceholders(html, {
				logo: '/api/design-asset/abc',
				logo_url: '/api/design-asset/abc',
			}),
		).toBe('<img src="/api/design-asset/abc" alt="/api/design-asset/abc" />');
	});

	it('replaces contact variables', () => {
		const html = 'Hi {{firstName}} {{lastName}} &lt;{{email}}&gt;';
		expect(substitutePreviewPlaceholders(html)).toBe('Hi Alex River &lt;alex@example.com&gt;');
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
				'<a href="{{unsubscribe_url}}">Unsub</a>',
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
			logo_url: '/api/design-asset/logo-1',
		});
		expect(html).toContain('src="/api/design-asset/logo-1"');
	});
});

describe('pickEmailLogo', () => {
	it('skips dark-named logos and picks the light one deterministically', () => {
		const logos = [
			{ id: 'z', name: 'Primary Logo dark', filename: 'logo-dark-whole.svg' },
			{ id: 'a', name: 'Primary Logo', filename: 'logo-whole.svg' },
		];
		expect(pickEmailLogo(logos)?.id).toBe('a');
	});

	it('falls back to the first logo when only dark variants exist', () => {
		const logos = [{ id: 'z', name: 'Primary Logo dark', filename: 'logo-dark.svg' }];
		expect(pickEmailLogo(logos)?.id).toBe('z');
	});

	it('returns undefined for empty list', () => {
		expect(pickEmailLogo([])).toBeUndefined();
	});
});

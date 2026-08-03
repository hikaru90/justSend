import { describe, expect, it } from 'vitest';
import {
	assertSafeEmailComponentSource,
	compileComponentSources,
	healDuplicateScripts,
	healMissingPropBindings,
	healTableRowPlacement,
	linkCompiledComponents,
	loadLinkedComponent,
	TemplateCompileError,
	validateComponentSource,
} from './template-compile-service';
import { render } from 'svelte/server';

describe('healMissingPropBindings', () => {
	it('injects undeclared markup identifiers into $props', () => {
		const healed = healMissingPropBindings(
			`<script>
	let { headline } = $props();
</script>
<img src={logo_url} alt={headline} />`,
		);
		expect(healed).toContain("logo_url = ''");
		expect(healed).toContain('headline');
	});

	it('injects shorthand prop passes on child components', () => {
		const healed = healMissingPropBindings(
			`<script>
	import Header from './Header.svelte';
</script>
<Header {logo_url} />`,
		);
		expect(healed).toMatch(/let \{[^}]*logo_url = ''/);
	});
});

describe('healDuplicateScripts', () => {
	it('merges two instance script tags into one', () => {
		const source = `<script>
	import Header from './Header.svelte';
</script>
<script>
	let { headline } = $props();
</script>
<Header {headline} />`;
		const healed = healDuplicateScripts(source);
		expect(healed.match(/<script\b/gi)?.length).toBe(1);
		expect(healed).toContain("import Header from './Header.svelte'");
		expect(healed).toContain('let { headline } = $props()');
		expect(() => validateComponentSource('Root', healed)).not.toThrow();
	});

	it('is a no-op for a single script', () => {
		const source = `<script>
	let { x } = $props();
</script>
<p>{x}</p>`;
		expect(healDuplicateScripts(source)).toBe(source);
	});

	it('validates Root that had duplicate scripts after heal chain', () => {
		const source = `<script>
	import Header from './Header.svelte';
</script>
<script>
	let { headline } = $props();
</script>
<table><tr><td><Header {headline} /></td></tr></table>`;
		expect(() => validateComponentSource('Root', source)).not.toThrow();
	});
});

describe('healTableRowPlacement', () => {
	it('wraps bare tr children of table in tbody', () => {
		const healed = healTableRowPlacement('<table><tr><td>Hi</td></tr></table>');
		expect(healed).toBe('<table><tbody><tr><td>Hi</td></tr></tbody></table>');
	});

	it('wraps consecutive tr runs and leaves thead alone', () => {
		const healed = healTableRowPlacement(
			'<table><thead><tr><td>H</td></tr></thead><tr><td>A</td></tr><tr><td>B</td></tr></table>',
		);
		expect(healed).toBe(
			'<table><thead><tr><td>H</td></tr></thead><tbody><tr><td>A</td></tr><tr><td>B</td></tr></tbody></table>',
		);
	});

	it('heals nested tables', () => {
		const healed = healTableRowPlacement(
			'<table><tr><td><table><tr><td>in</td></tr></table></td></tr></table>',
		);
		expect(healed).toBe(
			'<table><tbody><tr><td><table><tbody><tr><td>in</td></tr></tbody></table></td></tr></tbody></table>',
		);
	});

	it('is a no-op when tbody already present', () => {
		const src = '<table><tbody><tr><td>Hi</td></tr></tbody></table>';
		expect(healTableRowPlacement(src)).toBe(src);
	});
});

describe('assertSafeEmailComponentSource', () => {
	it('allows markup-only components', () => {
		expect(() =>
			assertSafeEmailComponentSource('<table><tr><td>Hi</td></tr></table>', 'Plain'),
		).not.toThrow();
	});

	it('allows $props and relative imports', () => {
		const source = `<script>
	import Header from './Header.svelte';
	let { headline, cta_url } = $props();
</script>
<Header {headline} />
<a href={cta_url}>Go</a>`;
		expect(() => assertSafeEmailComponentSource(source, 'Root')).not.toThrow();
	});

	it('rejects script module', () => {
		expect(() =>
			assertSafeEmailComponentSource('<script module>export const x = 1;</script><p>x</p>', 'Bad'),
		).toThrow(TemplateCompileError);
	});

	it('rejects arbitrary JS', () => {
		expect(() =>
			assertSafeEmailComponentSource(
				'<script>let x = fetch("https://evil");</script><p></p>',
				'Bad',
			),
		).toThrow(/only/);
	});

	it('rejects non-relative imports', () => {
		expect(() =>
			assertSafeEmailComponentSource(`<script>import fs from 'fs';</script><p></p>`, 'Bad'),
		).toThrow(/relative/);
	});
});

describe('compile + link + render', () => {
	it('compiles a root with a child and SSR-renders props', async () => {
		const header = `<script>
	let { headline } = $props();
</script>
<h1>{headline}</h1>`;

		const root = `<script>
	import Header from './Header.svelte';
	let { headline, cta_label, cta_url } = $props();
</script>
<table role="presentation" width="100%">
	<tbody>
		<tr><td><Header {headline} /></td></tr>
		<tr><td><a href={cta_url}>{cta_label}</a></td></tr>
	</tbody>
</table>`;

		validateComponentSource('Header', header);
		validateComponentSource('Root', root);

		const compiled = compileComponentSources(
			[
				{ name: 'Root', source: root, kind: 'root' },
				{ name: 'Header', source: header, kind: 'component' },
			],
			'server',
		);

		expect(compiled.rootName).toBe('Root');
		expect(compiled.jsByName.Root).toBeTruthy();
		expect(compiled.jsByName.Header).toBeTruthy();

		const linked = await linkCompiledComponents(compiled, 'server');
		const Root = await loadLinkedComponent(linked);
		const out = render(Root, {
			props: {
				headline: 'Hello',
				cta_label: 'Shop',
				cta_url: 'https://example.com',
			},
		});

		expect(out.body).toContain('Hello');
		expect(out.body).toContain('Shop');
		expect(out.body).toContain('https://example.com');
	});

	it('SSR-renders when logo_url is used but not declared (healed)', async () => {
		const source = `<img src={logo_url} alt="Logo" />`;
		validateComponentSource('T', source);
		const compiled = compileComponentSources([{ name: 'T', source, kind: 'root' }], 'server');
		const linked = await linkCompiledComponents(compiled, 'server');
		const T = await loadLinkedComponent(linked);
		const out = render(T, { props: { logo_url: 'https://cdn.example/logo.png' } });
		expect(out.body).toContain('https://cdn.example/logo.png');
	});

	it('compiles bare table/tr markup after tbody heal', () => {
		expect(() =>
			validateComponentSource('Plain', '<table><tr><td>Hi</td></tr></table>'),
		).not.toThrow();
	});
});

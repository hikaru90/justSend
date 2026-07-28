import { describe, expect, it } from 'vitest';
import juice from 'juice';
import { render } from 'svelte/server';
import {
	compileComponentSources,
	linkCompiledComponents,
	loadLinkedComponent
} from './template-compile-service';

describe('template render pipeline', () => {
	it('SSR + juice inlines styles from a component tree', async () => {
		const header = `<script>
	let { headline } = $props();
</script>
<h1 class="title">{headline}</h1>
<style>
	.title { color: #112233; }
</style>`;

		const root = `<script>
	import Header from './Header.svelte';
	let { headline, cta_label, cta_url } = $props();
</script>
<table role="presentation" width="100%">
	<tbody>
		<tr><td><Header {headline} /></td></tr>
		<tr><td><a class="cta" href={cta_url}>{cta_label}</a></td></tr>
	</tbody>
</table>
<style>
	.cta { background: #0066ff; color: #fff; padding: 8px 16px; }
</style>`;

		const compiled = compileComponentSources(
			[
				{ name: 'Root', source: root, kind: 'root' },
				{ name: 'Header', source: header, kind: 'component' }
			],
			'server'
		);
		const linked = await linkCompiledComponents(compiled, 'server');
		const Root = await loadLinkedComponent(linked);
		const out = render(Root, {
			props: {
				headline: 'Welcome',
				cta_label: 'Shop',
				cta_url: 'https://shop.example'
			}
		});

		const doc = `<!DOCTYPE html><html><head>${out.head}</head><body>${out.body}</body></html>`;
		const inlined = juice(doc, { removeStyleTags: true, preserveMediaQueries: true });

		expect(inlined).toContain('Welcome');
		expect(inlined).toContain('Shop');
		expect(inlined).toContain('https://shop.example');
		expect(inlined).toMatch(/color:\s*#112233/i);
		expect(inlined).toMatch(/background:\s*#0066ff/i);
	});
});

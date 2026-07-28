<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import CodeBlock from '$lib/components/CodeBlock.svelte';
	import PiEditField from '$lib/components/PiEditField.svelte';
	import { copyablePre } from '$lib/actions/copyablePre';
	import { Check, Copy } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import {
		extractDesignTokens,
		substitutePreviewPlaceholders
	} from '$lib/design/extractTokens';

	let { data, form } = $props();

	let editComponentId = $state<string | null>(null);
	let editName = $state('');
	let editDescription = $state('');
	let editHtml = $state('');
	let piInstruction = $state('');
	let piEditing = $state(false);
	let inferring = $state(false);
	let componentView = $state<Record<string, 'preview' | 'code'>>({});
	let mdCopied = $state(false);
	let mdCopyTimeout: ReturnType<typeof setTimeout> | undefined;

	let designMdDraft = $derived(data.designMd);

	const tokens = $derived(extractDesignTokens(designMdDraft));
	const renderedMd = $derived(
		DOMPurify.sanitize(marked.parse(designMdDraft || '_No design.md yet._', { async: false }) as string)
	);

	const fontAssets = $derived(data.assets.filter((a) => a.kind === 'font'));
	const logoAssets = $derived(data.assets.filter((a) => a.kind === 'logo'));

	const fontFaceCss = $derived.by(() => {
		return fontAssets
			.map((asset) => {
				const url = resolve(`/api/design-asset/${asset.id}`);
				const format = asset.mime.includes('woff2')
					? 'woff2'
					: asset.mime.includes('woff')
						? 'woff'
						: asset.mime.includes('ttf')
							? 'truetype'
							: asset.mime.includes('otf')
								? 'opentype'
								: 'woff2';
				const family = asset.name.replace(/['"]/g, '');
				return `@font-face{font-family:'${family}';src:url('${url}') format('${format}');font-display:swap;}`;
			})
			.join('\n');
	});

	const primaryColor = $derived(tokens.colors[0] ?? 'hsl(var(--primary))');
	const primaryFont = $derived(tokens.fontFamilies[0] ?? 'system-ui, sans-serif');

	async function copyDesignMd() {
		try {
			await navigator.clipboard.writeText(designMdDraft);
			mdCopied = true;
			clearTimeout(mdCopyTimeout);
			mdCopyTimeout = setTimeout(() => {
				mdCopied = false;
				mdCopyTimeout = undefined;
			}, 2000);
		} catch {
			// clipboard unavailable or denied
		}
	}

	function startEdit(component: {
		id: string;
		name: string;
		description: string | null;
		html: string;
	}) {
		editComponentId = component.id;
		editName = component.name;
		editDescription = component.description ?? '';
		editHtml = component.html;
	}

	function cancelEdit() {
		editComponentId = null;
		editName = '';
		editDescription = '';
		editHtml = '';
		piInstruction = '';
		piEditing = false;
	}

	function looksLikeSvelte(code: string): boolean {
		return /\$props\s*\(/.test(code) || /<\/?script\b/i.test(code);
	}

	function getView(id: string, code?: string): 'preview' | 'code' {
		if (componentView[id]) return componentView[id];
		if (code && looksLikeSvelte(code)) return 'code';
		return 'preview';
	}

	function setView(id: string, view: 'preview' | 'code') {
		componentView = { ...componentView, [id]: view };
	}

	function previewSrcdoc(html: string): string {
		const body = substitutePreviewPlaceholders(html);
		const faces = fontFaceCss;
		return `<!doctype html><html><head><meta charset="utf-8"><style>
			html,body{margin:0;padding:12px;background:#fff;color:#111;font-family:system-ui,sans-serif;}
			img{max-width:100%;height:auto;}
			${faces}
		</style></head><body>${body}</body></html>`;
	}

	function contrastText(hex: string): string {
		const h = hex.replace('#', '');
		const full =
			h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
		if (full.length !== 6) return '#fff';
		const r = parseInt(full.slice(0, 2), 16);
		const g = parseInt(full.slice(2, 4), 16);
		const b = parseInt(full.slice(4, 6), 16);
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return luminance > 0.55 ? '#111' : '#fff';
	}

	$effect(() => {
		if (!browser) return;
		const el = document.createElement('style');
		el.setAttribute('data-owlery-design-fonts', '');
		el.textContent = fontFaceCss;
		document.head.appendChild(el);
		return () => el.remove();
	});
</script>

<h1 class="mb-2 text-2xl font-semibold">Design System</h1>
<p class="mb-6 text-sm text-[hsl(var(--muted-foreground))]">
	Team-wide baseline for AI-generated email templates: design.md, fonts, assets, and reusable
	components.
</p>

{#if form?.error}
	<p class="mb-4 text-sm text-[hsl(var(--destructive))]">{form.error}</p>
{/if}
{#if form?.success && form.saved === 'infer'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Inferred design system from URL
		{#if form.componentsCreated}
			· added {form.componentsCreated} component{form.componentsCreated === 1 ? '' : 's'}
		{/if}
		{#if form.assetsDownloaded}
			· downloaded {form.assetsDownloaded} asset{form.assetsDownloaded === 1 ? '' : 's'}
		{/if}
		. Review and edit below.
	</p>
{:else if form?.success}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Saved.</p>
{/if}

<Card
	title="Infer from URL"
	description="Fetch a public site and ask AI to draft design.md plus email components"
	class="mb-6"
>
	<form
		method="POST"
		action="?/inferFromUrl"
		use:enhance={() => {
			inferring = true;
			return async ({ update }) => {
				await update();
				inferring = false;
			};
		}}
		class="flex flex-wrap items-end gap-3"
	>
		<div class="min-w-50 flex-1 space-y-1">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="infer-url">Website URL</label>
			<Input
				id="infer-url"
				name="url"
				type="url"
				placeholder="https://example.com"
				required
			/>
		</div>
		<Button type="submit" disabled={inferring}>
			{inferring ? 'Inferring…' : 'Infer design system'}
		</Button>
	</form>

	{#if inferring}
		<div class="mt-4 space-y-1.5" aria-live="polite">
			<div class="h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--secondary))]">
				<div class="infer-progress-bar h-full w-1/3 rounded-full bg-[hsl(var(--primary))]"></div>
			</div>
			<p class="text-xs text-[hsl(var(--muted-foreground))]">
				Fetching page, generating design system, and downloading logo/fonts…
			</p>
		</div>
	{/if}

	<p class="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
		Requires OPENROUTER_API_KEY. Overwrites design.md, appends suggested components, and attempts to
		download the logo and web fonts from the site.
	</p>
</Card>

{#if logoAssets.length > 0 || fontAssets.length > 0}
	<div class="design-preview mb-6 flex flex-wrap items-center gap-4 rounded-md border border-[hsl(var(--border))] p-4">
		{#each logoAssets as logo (logo.id)}
			<img
				src={resolve(`/api/design-asset/${logo.id}`)}
				alt={logo.name}
				class="h-12 max-w-40 object-contain"
			/>
		{/each}
		{#if fontAssets.length > 0}
			<p class="text-sm text-[hsl(var(--muted-foreground))]">
				Fonts: {fontAssets.map((f) => f.name).join(', ')}
			</p>
		{/if}
	</div>
{/if}

<Card title="design.md" description="Brand tokens, typography, colors, spacing, and guidelines" class="mb-6">
	<div class="design-preview grid gap-4 lg:grid-cols-2">
		<form method="POST" action="?/saveMd" use:enhance class="space-y-3">
			<div class="relative">
				<textarea
					name="designMd"
					rows="16"
					bind:value={designMdDraft}
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 pr-10 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
					placeholder="# Brand — colors, typography, spacing, tone"
				></textarea>
				<button
					type="button"
					class="absolute right-1.5 top-1.5 z-10 rounded p-1 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
					aria-label={mdCopied ? 'Copied' : 'Copy design.md'}
					onclick={copyDesignMd}
				>
					{#if mdCopied}
						<Check size={14} aria-hidden="true" />
					{:else}
						<Copy size={14} aria-hidden="true" />
					{/if}
				</button>
			</div>
			<Button type="submit">Save design.md</Button>
		</form>

		<div class="space-y-4">
			{#if tokens.colors.length > 0}
				<div>
					<p class="mb-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
						Colors
					</p>
					<div class="flex flex-wrap gap-2">
						{#each tokens.colors as color (color)}
							<div
								class="flex h-14 w-20 flex-col items-center justify-center rounded-md border border-[hsl(var(--border))] text-[10px] font-mono"
								style:background={color}
								style:color={contrastText(color)}
								title={color}
							>
								{color}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if tokens.fontFamilies.length > 0}
				<div>
					<p class="mb-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
						Typography
					</p>
					<div class="space-y-2">
						{#each tokens.fontFamilies as family (family)}
							<p class="text-lg" style:font-family="'{family}', system-ui, sans-serif">
								{family} — The quick brown fox jumps over the lazy dog
							</p>
						{/each}
					</div>
				</div>
			{/if}

			<div>
				<p class="mb-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
					Samples
				</p>
				<div class="flex flex-wrap items-center gap-4" style:font-family="'{primaryFont}', system-ui, sans-serif">
					<button
						type="button"
						class="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
						style:background={primaryColor}
						style:color={typeof primaryColor === 'string' && primaryColor.startsWith('#')
							? contrastText(primaryColor)
							: '#fff'}
					>
						Primary button
					</button>
					<a
						href="https://example.com"
						class="text-sm underline underline-offset-2"
						style:color={primaryColor}
						target="_blank"
						rel="noreferrer"
					>
						Sample link
					</a>
				</div>
			</div>

			<div
				class="prose-design max-h-80 overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-4 text-sm"
				use:copyablePre
			>
				{@html renderedMd}
			</div>
		</div>
	</div>
</Card>

<Card title="Fonts & assets" description="Upload logos, images, and font files" class="mb-6">
	<form
		method="POST"
		action="?/uploadAsset"
		enctype="multipart/form-data"
		use:enhance
		class="mb-4 flex flex-wrap items-end gap-3"
	>
		<div class="min-w-35 flex-1 space-y-1">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="asset-name">Name</label>
			<Input id="asset-name" name="name" placeholder="Primary logo" required />
		</div>
		<div class="space-y-1">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="asset-kind">Kind</label>
			<select
				id="asset-kind"
				name="kind"
				class="flex h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
			>
				<option value="logo">Logo</option>
				<option value="image">Image</option>
				<option value="font">Font</option>
			</select>
		</div>
		<div class="space-y-1">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="asset-file">File</label>
			<input
				id="asset-file"
				name="file"
				type="file"
				required
				class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[hsl(var(--secondary))] file:px-3 file:py-1.5 file:text-sm"
			/>
		</div>
		<Button type="submit">Upload</Button>
	</form>

	{#if data.assets.length === 0}
		<p class="text-sm text-[hsl(var(--muted-foreground))]">No assets uploaded yet.</p>
	{:else}
		<ul class="divide-y divide-[hsl(var(--border))]">
			{#each data.assets as asset (asset.id)}
				<li class="flex items-center justify-between gap-3 py-3">
					<div class="flex min-w-0 items-center gap-3">
						{#if asset.kind === 'logo' || asset.kind === 'image'}
							<img
								src={resolve(`/api/design-asset/${asset.id}`)}
								alt=""
								class="h-10 w-10 rounded object-contain"
							/>
						{:else if asset.kind === 'font'}
							<span
								class="flex h-10 w-10 items-center justify-center rounded bg-[hsl(var(--muted))] text-lg"
								style:font-family="'{asset.name}', system-ui, sans-serif"
								aria-hidden="true"
							>
								Aa
							</span>
						{/if}
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{asset.name}</p>
							<p class="truncate text-xs text-[hsl(var(--muted-foreground))]">
								{asset.kind} · {asset.filename} · {(asset.size / 1024).toFixed(1)} KB
							</p>
							<a
								href={resolve(`/api/design-asset/${asset.id}`)}
								class="text-xs text-[hsl(var(--muted-foreground))] hover:underline"
								target="_blank"
								rel="noreferrer">Open</a
							>
						</div>
					</div>
					<form method="POST" action="?/deleteAsset" use:enhance>
						<input type="hidden" name="id" value={asset.id} />
						<Button type="submit" size="sm" variant="destructive">Delete</Button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</Card>

<Card title="Components" description="Reusable HTML snippets for the AI to follow">
	<form method="POST" action="?/saveComponent" use:enhance class="mb-6 space-y-3">
		<Input
			name="name"
			placeholder="Component name (e.g. Primary Button)"
			required
		/>
		<Input name="description" placeholder="Optional description" />
		<textarea
			name="html"
			rows="6"
			class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
			placeholder={'<a href="{{cta_url}}" style="...">{{cta_label}}</a>'}
		></textarea>
		<Button type="submit">Add component</Button>
	</form>

	{#if data.components.length === 0}
		<p class="text-sm text-[hsl(var(--muted-foreground))]">No components yet.</p>
	{:else}
		<ul class="space-y-3">
			{#each data.components as component (component.id)}
				<li class="rounded-md border border-[hsl(var(--border))] p-4">
					<div class="mb-2 flex items-start justify-between gap-3">
						<div>
							<p class="font-medium">{component.name}</p>
							{#if component.description}
								<p class="text-xs text-[hsl(var(--muted-foreground))]">{component.description}</p>
							{/if}
						</div>
						<div class="flex gap-2">
							{#if editComponentId !== component.id}
								<div class="flex rounded-md border border-[hsl(var(--border))] text-xs">
									<button
										type="button"
										class="px-2 py-1 {getView(component.id, component.html) === 'preview'
											? 'bg-[hsl(var(--secondary))] font-medium'
											: ''}"
										onclick={() => setView(component.id, 'preview')}
									>
										Preview
									</button>
									<button
										type="button"
										class="px-2 py-1 {getView(component.id, component.html) === 'code'
											? 'bg-[hsl(var(--secondary))] font-medium'
											: ''}"
										onclick={() => setView(component.id, 'code')}
									>
										Code
									</button>
								</div>
							{/if}
							{#if editComponentId === component.id}
								<Button size="sm" variant="outline" disabled>Editing</Button>
							{:else}
								<Button size="sm" variant="outline" onclick={() => startEdit(component)}>Edit</Button>
							{/if}
							<form method="POST" action="?/deleteComponent" use:enhance>
								<input type="hidden" name="id" value={component.id} />
								<Button type="submit" size="sm" variant="destructive">Delete</Button>
							</form>
						</div>
					</div>
					{#if editComponentId === component.id}
						<iframe
							title={editName || component.name}
							srcdoc={previewSrcdoc(editHtml)}
							sandbox=""
							class="h-48 w-full rounded border border-[hsl(var(--border))] bg-white"
						></iframe>
						<div class="mt-3 space-y-3">
							{#if data.piConfigured}
								<form
									method="POST"
									action="?/piEditComponent"
									use:enhance={() => {
										piEditing = true;
										return async ({ result, update }) => {
											piEditing = false;
											if (
												result.type === 'success' &&
												result.data &&
												typeof result.data === 'object' &&
												'html' in result.data &&
												typeof result.data.html === 'string'
											) {
												editHtml = result.data.html;
												piInstruction = '';
												return;
											}
											await update({ reset: false });
										};
									}}
								>
									<input type="hidden" name="html" value={editHtml} />
									<input type="hidden" name="name" value={editName} />
									<input type="hidden" name="description" value={editDescription} />
									<PiEditField
										bind:value={piInstruction}
										busy={piEditing}
										placeholder="e.g. Make the button larger and use brand primary color"
										hint="Pi updates the HTML draft below — click Update component to save."
									/>
								</form>
							{:else}
								<p class="text-xs text-[hsl(var(--muted-foreground))]">
									Set OPENROUTER_API_KEY to edit components with Pi (speak or type).
								</p>
							{/if}
							<form
								method="POST"
								action="?/saveComponent"
								use:enhance={() =>
									async ({ result, update }) => {
										await update();
										if (result.type === 'success') cancelEdit();
									}}
								class="space-y-3"
							>
								<input type="hidden" name="id" value={component.id} />
								<Input
									name="name"
									placeholder="Component name"
									bind:value={editName}
									required
								/>
								<Input
									name="description"
									placeholder="Optional description"
									bind:value={editDescription}
								/>
								<textarea
									name="html"
									rows="6"
									bind:value={editHtml}
									class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
								></textarea>
								<div class="flex gap-2">
									<Button type="submit">Update component</Button>
									<Button type="button" variant="ghost" onclick={cancelEdit}>Cancel</Button>
								</div>
							</form>
						</div>
					{:else if getView(component.id, component.html) === 'preview'}
						{#if looksLikeSvelte(component.html)}
							<p class="mb-2 text-xs text-[hsl(var(--muted-foreground))]">
								Svelte email component — live preview works best on a template. Showing markup
								snapshot:
							</p>
						{/if}
						<iframe
							title={component.name}
							srcdoc={previewSrcdoc(component.html)}
							sandbox=""
							class="h-48 w-full rounded border border-[hsl(var(--border))] bg-white"
						></iframe>
					{:else}
						<CodeBlock code={component.html} />
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Card>

<style>
	@keyframes infer-progress {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(400%);
		}
	}
	.infer-progress-bar {
		animation: infer-progress 1.1s ease-in-out infinite;
	}

	.prose-design :global(h1) {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0.75rem 0 0.35rem;
	}
	.prose-design :global(h2) {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0.65rem 0 0.3rem;
	}
	.prose-design :global(h3) {
		font-size: 1rem;
		font-weight: 600;
		margin: 0.5rem 0 0.25rem;
	}
	.prose-design :global(p),
	.prose-design :global(ul),
	.prose-design :global(ol) {
		margin: 0.35rem 0;
	}
	.prose-design :global(ul) {
		list-style: disc;
		padding-left: 1.25rem;
	}
	.prose-design :global(ol) {
		list-style: decimal;
		padding-left: 1.25rem;
	}
	.prose-design :global(code) {
		font-family: ui-monospace, monospace;
		font-size: 0.85em;
		background: hsl(var(--muted));
		padding: 0.1em 0.3em;
		border-radius: 0.2rem;
	}
	.prose-design :global(pre) {
		overflow-x: auto;
		background: hsl(var(--muted));
		padding: 0.75rem 2.5rem 0.75rem 0.75rem;
		border-radius: 0.35rem;
		font-size: 0.75rem;
	}
	.prose-design :global([data-copyable-wrap]) {
		margin: 0.35rem 0;
	}
</style>

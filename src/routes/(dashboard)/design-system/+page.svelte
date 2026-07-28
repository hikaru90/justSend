<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { data, form } = $props();

	let editComponentId = $state<string | null>(null);
	let editName = $state('');
	let editDescription = $state('');
	let editHtml = $state('');
	let inferring = $state(false);

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
	}
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
				Fetching page and generating design system — this can take a few seconds…
			</p>
		</div>
	{/if}

	<p class="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
		Requires OPENROUTER_API_KEY. Overwrites design.md and appends suggested components. Logos and
		fonts still need manual upload.
	</p>
</Card>

<Card title="design.md" description="Brand tokens, typography, colors, spacing, and guidelines" class="mb-6">
	<form method="POST" action="?/saveMd" use:enhance class="space-y-3">
		<textarea
			name="designMd"
			rows="16"
			value={data.designMd}
			class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
			placeholder="# Brand — colors, typography, spacing, tone"
		></textarea>
		<Button type="submit">Save design.md</Button>
	</form>
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
	<form
		method="POST"
		action="?/saveComponent"
		use:enhance={() => async ({ update }) => update({ reset: false })}
		class="mb-6 space-y-3"
	>
		<input type="hidden" name="id" value={editComponentId ?? ''} />
		<Input
			name="name"
			placeholder="Component name (e.g. Primary Button)"
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
			placeholder={'<a href="{{cta_url}}" style="...">{{cta_label}}</a>'}
		></textarea>
		<div class="flex gap-2">
			<Button type="submit">{editComponentId ? 'Update component' : 'Add component'}</Button>
			{#if editComponentId}
				<Button type="button" variant="ghost" onclick={cancelEdit}>Cancel</Button>
			{/if}
		</div>
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
							<Button size="sm" variant="outline" onclick={() => startEdit(component)}>Edit</Button>
							<form method="POST" action="?/deleteComponent" use:enhance>
								<input type="hidden" name="id" value={component.id} />
								<Button type="submit" size="sm" variant="destructive">Delete</Button>
							</form>
						</div>
					</div>
				<pre class="overflow-x-auto rounded bg-[hsl(var(--muted))] p-3 text-xs">{component.html}</pre>
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
</style>

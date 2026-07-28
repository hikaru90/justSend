<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { data, form } = $props();
	let generating = $state(false);
	let prompt = $derived(data.template.prompt ?? '');
</script>

<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
	<div>
		<a
			href={resolve('/templates')}
			class="text-sm text-[hsl(var(--muted-foreground))] hover:underline">← Templates</a
		>
		<h1 class="mt-1 text-2xl font-semibold">{data.template.name}</h1>
		<p class="text-sm text-[hsl(var(--muted-foreground))]">
			Generate from your
			<a href={resolve('/design-system')} class="underline">design system</a>
			+ required elements
		</p>
	</div>
	<form method="POST" action="?/delete" use:enhance>
		<Button type="submit" variant="destructive" size="sm">Delete template</Button>
	</form>
</div>

{#if form?.error}
	<p class="mb-4 text-sm text-[hsl(var(--destructive))]">{form.error}</p>
{/if}
{#if form?.success && form.saved === 'generate'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Template generated with AI.</p>
{/if}

{#if !data.designReady}
	<Card title="Design system missing" class="mb-6">
		<p class="mb-3 text-sm text-[hsl(var(--muted-foreground))]">
			AI generation works best with a team design system (design.md, components, assets).
		</p>
		<Button href={resolve('/design-system')} size="sm">Open design system</Button>
	</Card>
{:else}
	<p class="mb-6 text-xs text-[hsl(var(--muted-foreground))]">
		Using design system
		{#if data.designSummary.hasMd}· design.md{/if}
		{#if data.designSummary.componentCount > 0}
			· {data.designSummary.componentCount} component{data.designSummary.componentCount === 1
				? ''
				: 's'}
		{/if}
		{#if data.designSummary.assetCount > 0}
			· {data.designSummary.assetCount} asset{data.designSummary.assetCount === 1 ? '' : 's'}
		{/if}
	</p>
{/if}

<div class="grid gap-6 xl:grid-cols-2">
	<div class="space-y-6">
		<Card title="1. Template details">
			<form method="POST" action="?/updateMeta" use:enhance class="space-y-3">
				<Input name="name" value={data.template.name} required />
				<Input name="subject" value={data.template.subject} required />
				<Button type="submit" size="sm">Save details</Button>
			</form>
		</Card>

		<Card
			title="2. Required elements"
			description="Fixed pieces the AI must include — logo, CTA, links, copy blocks, etc."
		>
			<form method="POST" action="?/addElement" use:enhance class="mb-4 flex flex-wrap items-end gap-3">
				<div class="min-w-35 flex-1 space-y-1">
					<label class="text-xs text-[hsl(var(--muted-foreground))]" for="el-label">Label</label>
					<Input id="el-label" name="label" placeholder="Primary CTA" required />
				</div>
				<div class="space-y-1">
					<label class="text-xs text-[hsl(var(--muted-foreground))]" for="el-type">Type</label>
					<select
						id="el-type"
						name="type"
						class="flex h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
					>
						<option value="logo">Logo</option>
						<option value="text">Text</option>
						<option value="button">Button</option>
						<option value="cta">CTA</option>
						<option value="link">Link</option>
						<option value="image">Image</option>
					</select>
				</div>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" name="required" checked class="rounded border" />
					Required
				</label>
				<Button type="submit">Add</Button>
			</form>

			{#if data.elements.length === 0}
				<p class="text-sm text-[hsl(var(--muted-foreground))]">
					Add at least a logo and CTA so the AI knows what must appear.
				</p>
			{:else}
				<ul class="divide-y divide-[hsl(var(--border))]">
					{#each data.elements as element (element.id)}
						<li class="flex items-center justify-between gap-3 py-3">
							<div>
								<p class="text-sm font-medium">{element.label}</p>
								<p class="text-xs text-[hsl(var(--muted-foreground))]">
									{element.type}{element.required ? ' · required' : ' · optional'}
								</p>
							</div>
							<form method="POST" action="?/deleteElement" use:enhance>
								<input type="hidden" name="id" value={element.id} />
								<Button type="submit" size="sm" variant="destructive">Remove</Button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<Card
			title="3. Generate with AI"
			description="OpenRouter uses your design system + elements to produce the email HTML"
		>
			<form
				method="POST"
				action="?/generate"
				use:enhance={() => {
					generating = true;
					return async ({ update }) => {
						await update();
						generating = false;
					};
				}}
				class="space-y-3"
			>
				<textarea
					name="prompt"
					rows="6"
					bind:value={prompt}
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
					placeholder="Describe the email: tone, sections, offer, audience…"
				></textarea>
				<Button type="submit" disabled={generating}>
					{generating
						? 'Generating…'
						: data.template.html
							? 'Regenerate HTML'
							: 'Generate HTML'}
				</Button>
				<p class="text-xs text-[hsl(var(--muted-foreground))]">
					Requires OPENROUTER_API_KEY. Output replaces the current HTML.
				</p>
			</form>
		</Card>
	</div>

	<div class="space-y-6">
		<Card title="Preview" description="Generated HTML from the design system">
			{#if data.template.html}
				<iframe
					title="Email preview"
					sandbox=""
					srcdoc={data.template.html}
					class="min-h-[420px] w-full rounded-md border border-[hsl(var(--border))] bg-white"
				></iframe>
			{:else}
				<p class="text-sm text-[hsl(var(--muted-foreground))]">
					No HTML yet. Add required elements, write a prompt, and generate.
				</p>
			{/if}
		</Card>
	</div>
</div>

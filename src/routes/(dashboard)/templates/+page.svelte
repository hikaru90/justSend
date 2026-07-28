<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { data, form } = $props();
</script>

<h1 class="mb-2 text-2xl font-semibold">Templates</h1>
<p class="mb-6 text-sm text-[hsl(var(--muted-foreground))]">
	Build emails from your
	<a href={resolve('/design-system')} class="underline">design system</a>
	with required elements and AI generation.
</p>

{#if data.needsDomain}
	<Card title="Select a domain">
		<p class="text-sm text-[hsl(var(--muted-foreground))]">
			Choose a domain in the sidebar to manage templates for that project.
		</p>
	</Card>
{:else}
	{#if !data.designReady}
		<Card title="Set up your design system" class="mb-6">
			<p class="mb-3 text-sm text-[hsl(var(--muted-foreground))]">
				Templates are generated from your team design system (design.md, fonts, assets, and
				components). Add that baseline first for best results.
			</p>
			<Button href={resolve('/design-system')} size="sm">Open design system</Button>
		</Card>
	{:else}
		<p class="mb-4 text-xs text-[hsl(var(--muted-foreground))]">
			Design system ready
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

	<Card
		title="New template"
		description="Create a shell, then define required elements and generate HTML with AI"
		class="mb-6"
	>
		<form method="POST" action="?/create" use:enhance class="space-y-3">
			<Input name="name" placeholder="Name (e.g. Welcome email)" required />
			<Input name="subject" placeholder="Subject line" required />
			<textarea
				name="prompt"
				rows="4"
				class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
				placeholder="Optional brief for the AI (welcome series, product launch, password reset…)"
			></textarea>
			<Button type="submit">Continue — define elements &amp; generate</Button>
		</form>
		{#if form?.error}
			<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>
		{/if}
	</Card>

	<div class="space-y-4">
		{#each data.templates as template (template.id)}
			<Card title={template.name}>
				<p class="mb-1 text-sm text-[hsl(var(--muted-foreground))]">{template.subject}</p>
				<p class="mb-3 text-xs text-[hsl(var(--muted-foreground))]">
					{#if template.html}
						AI HTML ready
					{:else}
						Not generated yet
					{/if}
					{#if template.prompt}
						· has prompt
					{/if}
				</p>
				<div class="flex flex-wrap gap-2">
					<Button size="sm" href={resolve(`/templates/${template.id}`)}>
						{template.html ? 'Edit / regenerate' : 'Define elements & generate'}
					</Button>
					<form method="POST" action="?/delete" use:enhance>
						<input type="hidden" name="id" value={template.id} />
						<Button type="submit" size="sm" variant="destructive">Delete</Button>
					</form>
				</div>
			</Card>
		{/each}
	</div>
{/if}

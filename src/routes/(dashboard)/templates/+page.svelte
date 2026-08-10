<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';

	type TemplateRow = {
		id: string;
		name: string;
		subject: string;
		html: string | null;
		prompt: string | null;
		tagList: string[];
	};

	let { data, form } = $props();

	let search = $state('');
	let statusFilter = $state<'all' | 'ready' | 'draft'>('all');
	let selectedTags = $state<string[]>([]);
	let untaggedOnly = $state(false);
	let groupByTag = $state(false);
	let tagDrafts = $state<Record<string, string>>({});
	let savingTagsFor = $state<string | null>(null);

	const templates = $derived((data.templates ?? []) as TemplateRow[]);
	const allTags = $derived((data.allTags ?? []) as string[]);

	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return templates.filter((t) => {
			if (statusFilter === 'ready' && !t.html) return false;
			if (statusFilter === 'draft' && t.html) return false;
			if (untaggedOnly && t.tagList.length > 0) return false;
			if (selectedTags.length > 0 && !selectedTags.every((tag) => t.tagList.includes(tag))) {
				return false;
			}
			if (!q) return true;
			return (
				t.name.toLowerCase().includes(q) ||
				t.subject.toLowerCase().includes(q) ||
				t.tagList.some((tag) => tag.includes(q))
			);
		});
	});

	const grouped = $derived.by(() => {
		if (!groupByTag) return null;
		const map: Record<string, TemplateRow[]> = {};
		const untagged: TemplateRow[] = [];
		for (const t of filtered) {
			if (t.tagList.length === 0) {
				untagged.push(t);
				continue;
			}
			for (const tag of t.tagList) {
				(map[tag] ??= []).push(t);
			}
		}
		const sections = Object.entries(map)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([tag, items]) => ({ key: tag, label: tag, items }));
		if (untagged.length) {
			sections.push({ key: '__untagged__', label: 'Untagged', items: untagged });
		}
		return sections;
	});

	function toggleTagFilter(tag: string) {
		untaggedOnly = false;
		if (selectedTags.includes(tag)) {
			selectedTags = selectedTags.filter((t) => t !== tag);
		} else {
			selectedTags = [...selectedTags, tag];
		}
	}

	function clearFilters() {
		search = '';
		statusFilter = 'all';
		selectedTags = [];
		untaggedOnly = false;
	}

	function draftFor(id: string) {
		return tagDrafts[id] ?? '';
	}

	function setDraft(id: string, value: string) {
		tagDrafts = { ...tagDrafts, [id]: value };
	}

	async function persistTags(template: TemplateRow, nextTags: string[]) {
		savingTagsFor = template.id;
		const body = new FormData();
		body.set('id', template.id);
		body.set('tags', JSON.stringify(nextTags));
		try {
			const res = await fetch('?/setTags', {
				method: 'POST',
				body,
				headers: { accept: 'application/json' },
			});
			if (!res.ok) throw new Error('Failed to save tags');
			await invalidateAll();
		} finally {
			savingTagsFor = null;
		}
	}

	async function addTag(template: TemplateRow) {
		const raw = draftFor(template.id).trim().toLowerCase();
		if (!raw) return;
		const next = [...new Set([...template.tagList, raw])];
		setDraft(template.id, '');
		await persistTags(template, next);
	}

	async function removeTag(template: TemplateRow, tag: string) {
		await persistTags(
			template,
			template.tagList.filter((t) => t !== tag),
		);
	}
</script>

{#snippet templateRow(template: TemplateRow)}
	<li
		class="flex flex-col gap-3 border-b border-[hsl(var(--border))] px-4 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"
	>
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2">
				<a
					href={resolve(`/templates/${template.id}`)}
					class="truncate font-medium text-[hsl(var(--foreground))] hover:underline"
				>
					{template.name}
				</a>
				{#if template.html}
					<Badge variant="success">Ready</Badge>
				{:else}
					<Badge variant="secondary">Draft</Badge>
				{/if}
			</div>
			<p class="mt-0.5 truncate text-sm text-[hsl(var(--muted-foreground))]">{template.subject}</p>

			<div class="mt-2 flex flex-wrap items-center gap-1.5">
				{#each template.tagList as tag (tag)}
					<span
						class="inline-flex items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-0.5 text-xs"
					>
						{tag}
						<button
							type="button"
							class="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
							aria-label={`Remove tag ${tag}`}
							disabled={savingTagsFor === template.id}
							onclick={() => removeTag(template, tag)}
						>
							×
						</button>
					</span>
				{/each}
				<form
					class="flex items-center gap-1"
					onsubmit={(e) => {
						e.preventDefault();
						void addTag(template);
					}}
				>
					<input
						class="h-7 w-28 rounded-md border border-[hsl(var(--input))] bg-transparent px-2 text-xs placeholder:text-[hsl(var(--muted-foreground))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:outline-none"
						placeholder="Add tag…"
						value={draftFor(template.id)}
						disabled={savingTagsFor === template.id}
						oninput={(e) => setDraft(template.id, e.currentTarget.value)}
					/>
					<button
						type="submit"
						class="h-7 rounded-md px-2 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
						disabled={savingTagsFor === template.id || !draftFor(template.id).trim()}
					>
						Add
					</button>
				</form>
			</div>
		</div>

		<div class="flex shrink-0 flex-wrap gap-2">
			<Button size="sm" href={resolve(`/templates/${template.id}`)}>
				{template.html ? 'Edit' : 'Generate'}
			</Button>
			<form
				method="POST"
				action="?/delete"
				use:enhance
				onsubmit={(e) => !confirm(`Delete “${template.name}”?`) && e.preventDefault()}
			>
				<input type="hidden" name="id" value={template.id} />
				<Button type="submit" size="sm" variant="destructive">Delete</Button>
			</form>
		</div>
	</li>
{/snippet}

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
			<Input name="tags" placeholder="Tags (comma-separated, optional)" />
			<textarea
				name="prompt"
				rows="4"
				class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:outline-none"
				placeholder="Optional brief for the AI (welcome series, product launch, password reset…)"
			></textarea>
			<Button type="submit">Continue — define elements &amp; generate</Button>
		</form>
		{#if form?.error}
			<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>
		{/if}
	</Card>

	<div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex flex-1 flex-wrap items-center gap-2">
			<Input
				class="max-w-sm"
				placeholder="Search name, subject, or tag…"
				bind:value={search}
				type="search"
			/>
			<select
				bind:value={statusFilter}
				class="h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:outline-none"
			>
				<option value="all">All statuses</option>
				<option value="ready">Ready</option>
				<option value="draft">Draft</option>
			</select>
			<label class="inline-flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
				<input
					type="checkbox"
					bind:checked={groupByTag}
					class="rounded border-[hsl(var(--input))]"
				/>
				Group by tag
			</label>
		</div>
		<p class="text-xs text-[hsl(var(--muted-foreground))]">
			{filtered.length} of {templates.length}
		</p>
	</div>

	{#if allTags.length > 0 || selectedTags.length > 0 || untaggedOnly}
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<span class="text-xs text-[hsl(var(--muted-foreground))]">Tags:</span>
			{#each allTags as tag (tag)}
				<button
					type="button"
					class="rounded-md border px-2 py-0.5 text-xs transition-colors {selectedTags.includes(tag)
						? 'border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] text-[hsl(var(--background))]'
						: 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]'}"
					onclick={() => toggleTagFilter(tag)}
				>
					{tag}
				</button>
			{/each}
			<button
				type="button"
				class="rounded-md border px-2 py-0.5 text-xs transition-colors {untaggedOnly
					? 'border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] text-[hsl(var(--background))]'
					: 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]'}"
				onclick={() => {
					untaggedOnly = !untaggedOnly;
					if (untaggedOnly) selectedTags = [];
				}}
			>
				Untagged
			</button>
			{#if selectedTags.length > 0 || untaggedOnly || search || statusFilter !== 'all'}
				<button
					type="button"
					class="text-xs text-[hsl(var(--muted-foreground))] underline"
					onclick={clearFilters}
				>
					Clear filters
				</button>
			{/if}
		</div>
	{/if}

	{#if templates.length === 0}
		<p
			class="rounded-md border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted-foreground))]"
		>
			No templates yet — create one above.
		</p>
	{:else if filtered.length === 0}
		<p
			class="rounded-md border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted-foreground))]"
		>
			No templates match your search or filters.
			<button type="button" class="underline" onclick={clearFilters}>Clear filters</button>
		</p>
	{:else if grouped}
		<div class="space-y-6">
			{#each grouped as section (section.key)}
				<section>
					<h2 class="mb-2 text-sm font-medium text-[hsl(var(--muted-foreground))] capitalize">
						{section.label}
						<span class="font-normal">({section.items.length})</span>
					</h2>
					<ul class="overflow-hidden rounded-md border border-[hsl(var(--border))]">
						{#each section.items as template (template.id + section.key)}
							{@render templateRow(template)}
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{:else}
		<ul class="overflow-hidden rounded-md border border-[hsl(var(--border))]">
			{#each filtered as template (template.id)}
				{@render templateRow(template)}
			{/each}
		</ul>
	{/if}
{/if}

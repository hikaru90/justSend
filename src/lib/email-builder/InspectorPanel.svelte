<script lang="ts">
	import { getContext } from 'svelte';
	import { EDITOR_KEY } from './context';
	import { LIBRARY_KEY, EmailBuilderLibrary } from './library-context.svelte';
	import type { EmailEditorState } from './editor-state.svelte';

	const editor = getContext<EmailEditorState>(EDITOR_KEY);
	const library = getContext<EmailBuilderLibrary>(LIBRARY_KEY);
	const designColors = $derived(library?.colors ?? []);
	const selectedId = $derived(editor.selectedBlockId);
	const block = $derived(selectedId ? editor.document[selectedId] : null);

	function setProps(patch: Record<string, unknown>) {
		if (!selectedId || !block) return;
		editor.updateBlock(selectedId, {
			...block,
			data: {
				...block.data,
				props: { ...(block.data.props ?? {}), ...patch }
			}
		});
	}

	function setLayoutField(key: string, value: string) {
		if (!selectedId || !block || block.type !== 'EmailLayout') return;
		editor.updateBlock(selectedId, {
			...block,
			data: { ...block.data, [key]: value }
		});
	}

	const textValue = $derived(String((block?.data.props as { text?: string })?.text ?? ''));
	const urlValue = $derived(String((block?.data.props as { url?: string })?.url ?? ''));
	const htmlValue = $derived(String((block?.data.props as { contents?: string })?.contents ?? ''));
	const imageUrl = $derived(String((block?.data.props as { url?: string })?.url ?? ''));
	const imageAlt = $derived(String((block?.data.props as { alt?: string })?.alt ?? ''));
</script>

{#snippet colorSwatches(value: string | null, onSelect: (color: string | null) => void)}
	{#if designColors.length}
		<div class="mt-1 flex flex-wrap gap-1">
			<button
				type="button"
				title="Remove color"
				aria-label="Remove color"
				class="size-5 rounded border {value === null
					? 'border-[hsl(var(--ring))] ring-2 ring-[hsl(var(--ring))]'
					: 'border-[hsl(var(--border))]'} flex items-center justify-center bg-white text-[hsl(var(--muted-foreground))]"
				onclick={() => onSelect(null)}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
			</button>
			{#each designColors as color (color)}
				<button
					type="button"
					title={color}
					aria-label={color}
					class="size-5 rounded border {value?.toLowerCase() === color.toLowerCase()
						? 'border-[hsl(var(--ring))] ring-2 ring-[hsl(var(--ring))]'
						: 'border-[hsl(var(--border))]'}"
					style="background: {color}"
					onclick={() => onSelect(color)}
				></button>
			{/each}
		</div>
	{/if}
{/snippet}

{#if !block || !selectedId}
	<div class="space-y-2">
		<p class="text-sm font-medium">Styles</p>
		<p class="text-xs text-[hsl(var(--muted-foreground))]">
			Click a block in the email to edit its copy and styles here. Use the + buttons between blocks
			to add Heading, Text, Button, Image, and more.
		</p>
		{#if editor.document.root?.type === 'EmailLayout'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Canvas background</span>
				<input
					type="color"
					class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
					value={String(editor.document.root.data.canvasColor ?? '#FFFFFF')}
					oninput={(e) => {
						const root = editor.document.root;
						if (!root) return;
						editor.updateBlock('root', {
							...root,
							data: { ...root.data, canvasColor: e.currentTarget.value }
						});
					}}
				/>
				{@render colorSwatches(String(editor.document.root.data.canvasColor ?? '#FFFFFF'), (color) => {
					const root = editor.document.root;
					if (!root) return;
					editor.updateBlock('root', {
						...root,
						data: { ...root.data, canvasColor: color ?? '' }
					});
				})}
			</label>
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Backdrop</span>
				<input
					type="color"
					class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
					value={String(editor.document.root.data.backdropColor ?? '#F5F5F5')}
					oninput={(e) => {
						const root = editor.document.root;
						if (!root) return;
						editor.updateBlock('root', {
							...root,
							data: { ...root.data, backdropColor: e.currentTarget.value }
						});
					}}
				/>
				{@render colorSwatches(String(editor.document.root.data.backdropColor ?? '#F5F5F5'), (color) => {
					const root = editor.document.root;
					if (!root) return;
					editor.updateBlock('root', {
						...root,
						data: { ...root.data, backdropColor: color ?? '' }
					});
				})}
			</label>
		{/if}
	</div>
{:else}
	<div class="space-y-3">
		<p class="text-sm font-medium">{block.type} block</p>

		{#if block.type === 'Heading' || block.type === 'Text' || block.type === 'Button'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">
					{block.type === 'Button' ? 'Label' : 'Content'}
				</span>
				<textarea
					rows={block.type === 'Text' ? 5 : 2}
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={textValue}
					oninput={(e) => setProps({ text: e.currentTarget.value })}
				></textarea>
			</label>
		{/if}

		{#if block.type === 'Button'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">URL</span>
				<input
					type="url"
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={urlValue}
					oninput={(e) => setProps({ url: e.currentTarget.value })}
				/>
			</label>
		{/if}

		{#if block.type === 'Image'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Image URL</span>
				<input
					type="url"
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={imageUrl}
					oninput={(e) => setProps({ url: e.currentTarget.value })}
				/>
			</label>
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Alt text</span>
				<input
					type="text"
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={imageAlt}
					oninput={(e) => setProps({ alt: e.currentTarget.value })}
				/>
			</label>
		{/if}

		{#if block.type === 'Html'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">HTML</span>
				<textarea
					rows={12}
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 font-mono text-xs"
					value={htmlValue}
					oninput={(e) => setProps({ contents: e.currentTarget.value })}
				></textarea>
			</label>
			<p class="text-xs text-[hsl(var(--muted-foreground))]">
				Tip: replace this with Heading / Text / Button blocks (+ between sections) for easier
				copy editing.
			</p>
		{/if}

		{#if block.type === 'Heading'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Level</span>
				<select
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={String((block.data.props as { level?: string })?.level ?? 'h2')}
					onchange={(e) => setProps({ level: e.currentTarget.value })}
				>
					<option value="h1">H1</option>
					<option value="h2">H2</option>
					<option value="h3">H3</option>
				</select>
			</label>
		{/if}

		{#if block.type === 'EmailLayout'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Canvas color</span>
				<input
					type="color"
					class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
					value={String(block.data.canvasColor ?? '#FFFFFF')}
					oninput={(e) => setLayoutField('canvasColor', e.currentTarget.value)}
				/>
				{@render colorSwatches(String(block.data.canvasColor ?? '#FFFFFF'), (color) =>
					setLayoutField('canvasColor', color ?? ''))}
			</label>
		{/if}
	</div>
{/if}

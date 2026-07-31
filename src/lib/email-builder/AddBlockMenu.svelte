<script lang="ts">
	import { getContext } from 'svelte';
	import DOMPurify from 'isomorphic-dompurify';
	import {
		renderSvelteComponentPreview,
		substitutePreviewPlaceholders
	} from '$lib/design/extractTokens';
	import { EDITOR_KEY } from './context';
	import type { EmailEditorState } from './editor-state.svelte';
	import type { DesignLibraryComponent } from './library';
	import { BLOCK_FACTORIES, type TEditorBlock } from './types';

	let {
		index,
		parentId,
		childrenIds,
		columnIndex,
		components = [],
		previewOverrides = {},
		onClose
	}: {
		index: number;
		parentId: string;
		childrenIds: string[];
		columnIndex?: number;
		components?: DesignLibraryComponent[];
		previewOverrides?: Record<string, string>;
		onClose: () => void;
	} = $props();

	const editor = getContext<EmailEditorState>(EDITOR_KEY);
	let tab = $state<'blocks' | 'library'>('library');

	const sanitizeOpts = {
		ADD_TAGS: ['style'],
		ADD_ATTR: [
			'target',
			'style',
			'class',
			'id',
			'bgcolor',
			'align',
			'valign',
			'width',
			'height',
			'cellpadding',
			'cellspacing',
			'border'
		]
	};

	function previewHtml(html: string): string {
		const rendered =
			html.includes('$props') || html.includes('<script')
				? renderSvelteComponentPreview(html, previewOverrides)
				: substitutePreviewPlaceholders(html, previewOverrides);
		return DOMPurify.sanitize(rendered, sanitizeOpts);
	}

	function insert(block: TEditorBlock) {
		editor.insertBlockAt(parentId, childrenIds, index, block, columnIndex);
		onClose();
	}

	function addFactory(type: string) {
		const factory = BLOCK_FACTORIES.find((f) => f.type === type);
		if (!factory) return;
		insert(factory.create());
	}

	function addComponent(component: DesignLibraryComponent) {
		const contents =
			component.html.includes('$props') || component.html.includes('<script')
				? renderSvelteComponentPreview(component.html, previewOverrides)
				: substitutePreviewPlaceholders(component.html, previewOverrides);

		insert({
			type: 'Html',
			data: {
				props: {
					contents,
					owlDesignComponentId: component.id,
					owlDesignComponentName: component.name
				},
				style: { padding: { top: 0, bottom: 0, left: 0, right: 0 } }
			}
		});
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
		role="dialog"
	aria-label="Add block"
	tabindex="-1"
	class="absolute left-1/2 z-30 mt-1 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-[hsl(var(--border))] bg-white text-[hsl(var(--foreground))] shadow-xl"
	onclick={(e) => e.stopPropagation()}
>
	<div class="flex items-center gap-1 border-b border-[hsl(var(--border))] p-2">
		<button
			type="button"
			class="rounded px-2 py-1 text-xs {tab === 'library'
				? 'bg-[hsl(var(--secondary))] font-medium'
				: 'hover:bg-[hsl(var(--muted))]'}"
			onclick={() => (tab = 'library')}
		>
			Design system
		</button>
		<button
			type="button"
			class="rounded px-2 py-1 text-xs {tab === 'blocks'
				? 'bg-[hsl(var(--secondary))] font-medium'
				: 'hover:bg-[hsl(var(--muted))]'}"
			onclick={() => (tab = 'blocks')}
		>
			Basic blocks
		</button>
		<button
			type="button"
			class="ml-auto rounded px-2 py-1 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
			onclick={onClose}
		>
			Close
		</button>
	</div>

	{#if tab === 'library'}
		{#if components.length === 0}
			<p class="p-4 text-sm text-[hsl(var(--muted-foreground))]">
				No design-system components yet. Add some on the Design system page.
			</p>
		{:else}
			<div class="grid max-h-80 grid-cols-2 gap-2 overflow-auto p-2 sm:grid-cols-3">
				{#each components as component (component.id)}
					<button
						type="button"
						class="flex flex-col overflow-hidden rounded-md border border-[hsl(var(--border))] text-left hover:border-[hsl(var(--ring))] hover:bg-[hsl(var(--muted))]/30"
						onclick={() => addComponent(component)}
					>
						<div class="h-28 overflow-hidden bg-[#f8f8f8] p-1.5 text-[11px] leading-snug text-[#111]">
							{@html previewHtml(component.html)}
						</div>
						<div class="border-t border-[hsl(var(--border))] px-2 py-1.5">
							<p class="truncate text-xs font-medium">{component.name}</p>
							<p class="truncate text-[10px] text-[hsl(var(--muted-foreground))]">
								{component.kind}{component.starterKey ? ` · ${component.starterKey}` : ''}
							</p>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="grid max-h-72 grid-cols-2 gap-1 p-2">
			{#each BLOCK_FACTORIES as factory (factory.type)}
				<button
					type="button"
					class="rounded border border-[hsl(var(--border))] px-2 py-2 text-left text-xs hover:bg-[hsl(var(--muted))]"
					onclick={() => addFactory(factory.type)}
				>
					<span class="font-medium">{factory.label}</span>
					<span class="mt-0.5 block text-[10px] text-[hsl(var(--muted-foreground))]"
						>{factory.type}</span
					>
				</button>
			{/each}
		</div>
	{/if}
</div>

<script lang="ts">
	import { getContext } from 'svelte';
	import { ArrowDown, ArrowUp, Copy, Trash2 } from '@lucide/svelte';
	import { EDITOR_KEY } from './context';
	import type { EmailEditorState } from './editor-state.svelte';

	let { blockId, children }: { blockId: string; children: import('svelte').Snippet } = $props();

	const editor = getContext<EmailEditorState>(EDITOR_KEY);
	const selected = $derived(editor.selectedBlockId === blockId);

	function selectBlock(e: Event) {
		e.stopPropagation();
		editor.select(blockId);
	}

	function onSelectKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			selectBlock(e);
		}
	}
</script>

<div class="relative">
	{#if selected}
		<div
			role="toolbar"
			aria-label="Block actions"
			class="absolute top-0 -left-12 z-10 flex flex-col rounded-full border border-[hsl(var(--border))] bg-white p-0.5 shadow"
		>
			<button
				type="button"
				class="rounded p-1 hover:bg-[hsl(var(--muted))]"
				title="Move up"
				onclick={() => editor.moveBlock(blockId, 'up')}
			>
				<ArrowUp class="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				class="rounded p-1 hover:bg-[hsl(var(--muted))]"
				title="Move down"
				onclick={() => editor.moveBlock(blockId, 'down')}
			>
				<ArrowDown class="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				class="rounded p-1 hover:bg-[hsl(var(--muted))]"
				title="Duplicate"
				onclick={() => editor.duplicateBlock(blockId)}
			>
				<Copy class="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				class="rounded p-1 hover:bg-[hsl(var(--muted))]"
				title="Delete"
				onclick={() => editor.deleteBlock(blockId)}
			>
				<Trash2 class="h-3.5 w-3.5" />
			</button>
		</div>
	{/if}
	<div
		role="button"
		tabindex="0"
		aria-pressed={selected}
		aria-label="Select block"
		class="relative outline-offset-[-1px] {selected
			? 'outline outline-2 outline-[#0079cc]'
			: 'hover:outline hover:outline-2 hover:outline-[#0079cc]/50'}"
		onclick={selectBlock}
		onkeydown={onSelectKeydown}
	>
		{@render children()}
	</div>
</div>

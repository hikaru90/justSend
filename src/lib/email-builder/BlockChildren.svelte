<script lang="ts">
	import { getContext } from 'svelte';
	import { Plus } from '@lucide/svelte';
	import { EDITOR_KEY } from './context';
	import type { EmailEditorState } from './editor-state.svelte';
	import { LIBRARY_KEY, EmailBuilderLibrary } from './library-context.svelte';
	import BlockNode from './BlockNode.svelte';
	import AddBlockMenu from './AddBlockMenu.svelte';

	let {
		parentId,
		childrenIds,
		columnIndex
	}: {
		parentId: string;
		childrenIds: string[];
		columnIndex?: number;
	} = $props();

	const editor = getContext<EmailEditorState>(EDITOR_KEY);
	const library = getContext<EmailBuilderLibrary>(LIBRARY_KEY);

	let menuAt = $state<number | null>(null);
</script>

{#each [...childrenIds, null] as childId, i (childId ?? `slot-${i}`)}
	{#if childId}
		<BlockNode blockId={childId} />
	{/if}
	<div class="relative py-1">
		<button
			type="button"
			class="mx-auto flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-[#0079cc]/60 bg-white text-[#0079cc] opacity-60 hover:opacity-100"
			title="Add block or design-system component"
			onclick={(e) => {
				e.stopPropagation();
				menuAt = menuAt === i ? null : i;
			}}
		>
			<Plus class="h-3.5 w-3.5" />
		</button>
		{#if menuAt === i}
			<AddBlockMenu
				index={i}
				{parentId}
				{childrenIds}
				{columnIndex}
				components={library.components}
				previewOverrides={library.previewOverrides}
				onClose={() => (menuAt = null)}
			/>
		{/if}
	</div>
{/each}

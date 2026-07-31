<script lang="ts">
	import { getContext } from 'svelte';
	import { EDITOR_KEY } from './context';
	import type { EmailEditorState } from './editor-state.svelte';
	import BlockNode from './BlockNode.svelte';

	const editor = getContext<EmailEditorState>(EDITOR_KEY);
</script>

{#if editor.document.root}
	<BlockNode blockId="root" />
{:else}
	<p class="text-sm text-[#666]">Empty document</p>
{/if}

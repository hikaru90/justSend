<script lang="ts">
	import { getContext } from 'svelte';
	import { EDITOR_KEY } from './context';
	import type { EmailEditorState } from './editor-state.svelte';
	import { getBlockChildrenIds } from './editor-state.svelte';
	import { renderBlockInnerHtml } from './render';
	import BlockChildren from './BlockChildren.svelte';
	import BlockWrapper from './BlockWrapper.svelte';

	let { blockId }: { blockId: string } = $props();

	const editor = getContext<EmailEditorState>(EDITOR_KEY);
	const block = $derived(editor.document[blockId]);

	function fontFamily(name: string | undefined): string {
		switch (name) {
			case 'BOOK_SANS':
				return 'Optima, Candara, "Noto Sans", source-sans-pro, sans-serif';
			case 'MODERN_SERIF':
				return 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif';
			case 'MONOSPACE':
				return '"Nimbus Mono PS", "Courier New", monospace';
			default:
				return '"Helvetica Neue", "Arial Nova", Arial, sans-serif';
		}
	}
</script>

{#if !block}
	<!-- missing -->
{:else if block.type === 'EmailLayout'}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		role="presentation"
		style:background-color={block.data.backdropColor ?? '#F5F5F5'}
		style:color={block.data.textColor ?? '#262626'}
		style:font-family={fontFamily(block.data.fontFamily)}
		style="font-size:16px;line-height:1.5;padding:32px 0;width:100%;min-height:100%"
		onclick={() => editor.select(null)}
	>
		<table
			align="center"
			width="100%"
			role="presentation"
			cellspacing="0"
			cellpadding="0"
			border={0}
			style="margin:0 auto;max-width:600px;background-color:{block.data.canvasColor ?? '#FFFFFF'}"
		>
			<tbody>
				<tr style="width:100%">
					<td>
						<BlockChildren parentId={blockId} childrenIds={block.data.childrenIds ?? []} />
					</td>
				</tr>
			</tbody>
		</table>
	</div>
{:else if block.type === 'Container'}
	<BlockWrapper {blockId}>
		<div style="padding:{(block.data.style as { padding?: { top?: number } })?.padding?.top ?? 0}px 0">
			<BlockChildren
				parentId={blockId}
				childrenIds={getBlockChildrenIds(block)}
			/>
		</div>
	</BlockWrapper>
{:else if block.type === 'ColumnsContainer'}
	{@const cols =
		(block.data.props as { columns?: Array<{ childrenIds: string[] }> })?.columns ?? []}
	<BlockWrapper {blockId}>
		<div class="grid gap-4" style="grid-template-columns: repeat({Math.max(cols.length, 1)}, 1fr); padding: 16px 24px">
			{#each cols as col, colIndex (colIndex)}
				<div>
					<BlockChildren parentId={blockId} childrenIds={col.childrenIds} columnIndex={colIndex} />
				</div>
			{/each}
		</div>
	</BlockWrapper>
{:else}
	<BlockWrapper {blockId}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- EmailBuilder leaf HTML from trusted document / renderToStaticMarkup -->
		{@html renderBlockInnerHtml(editor.document, blockId)}
	</BlockWrapper>
{/if}

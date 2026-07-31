<script lang="ts">
	import { getContext } from 'svelte';
	import { EDITOR_KEY } from './context';
	import type { EmailEditorState } from './editor-state.svelte';
	import { getBlockChildrenIds } from './editor-state.svelte';
	import { renderBlockInnerHtml } from './render';
	import { substitutePreviewPlaceholders } from '$lib/design/extractTokens';
	import { LIBRARY_KEY, EmailBuilderLibrary } from './library-context.svelte';
	import BlockChildren from './BlockChildren.svelte';
	import BlockWrapper from './BlockWrapper.svelte';

	let { blockId }: { blockId: string } = $props();

	const editor = getContext<EmailEditorState>(EDITOR_KEY);
	const library = getContext<EmailBuilderLibrary>(LIBRARY_KEY);
	const block = $derived(editor.document[blockId]);

	const leafHtml = $derived(
		block && block.type !== 'EmailLayout' && block.type !== 'Container' && block.type !== 'ColumnsContainer'
			? substitutePreviewPlaceholders(
					renderBlockInnerHtml(editor.document, blockId),
					library.previewOverrides
				)
			: ''
	);

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

	type BlockStyle = {
		backgroundColor?: string | null;
		borderColor?: string | null;
		borderRadius?: number | null;
		padding?: { top?: number; bottom?: number; left?: number; right?: number } | null;
		backgroundImage?: string | null;
		backgroundSize?: 'cover' | 'contain' | null;
		backgroundPosition?: string | null;
		backgroundRepeat?: 'no-repeat' | 'repeat' | null;
		minHeight?: number | null;
		overlayColor?: string | null;
	};

	function containerCss(style: BlockStyle | undefined): string {
		if (!style) return '';
		const parts: string[] = [];
		if (style.backgroundColor) parts.push(`background-color:${style.backgroundColor}`);
		if (style.backgroundImage) {
			const url = style.backgroundImage.replace(/["'\\]/g, '');
			parts.push(`background-image:url("${url}")`);
			parts.push(`background-size:${style.backgroundSize ?? 'cover'}`);
			parts.push(`background-position:${style.backgroundPosition ?? 'center'}`);
			parts.push(`background-repeat:${style.backgroundRepeat ?? 'no-repeat'}`);
		}
		if (style.minHeight != null) parts.push(`min-height:${style.minHeight}px`);
		if (style.borderColor) parts.push(`border:1px solid ${style.borderColor}`);
		if (style.borderRadius != null) parts.push(`border-radius:${style.borderRadius}px`);
		const p = style.padding;
		if (p) {
			parts.push(
				`padding:${p.top ?? 0}px ${p.right ?? 0}px ${p.bottom ?? 0}px ${p.left ?? 0}px`
			);
		}
		return parts.join(';');
	}

	const style = $derived((block?.data.style as BlockStyle | undefined) ?? {});
	const columnsProps = $derived(
		(block?.data.props as {
			columns?: Array<{ childrenIds: string[] }>;
			columnsCount?: number;
			columnsGap?: number;
			contentAlignment?: string;
		}) ?? {}
	);
	const cols = $derived(columnsProps.columns ?? []);
	const colCount = $derived(Math.max(cols.length, 1));
	const colGap = $derived(columnsProps.columnsGap ?? 16);
	const alignItems = $derived(
		columnsProps.contentAlignment === 'middle'
			? 'center'
			: columnsProps.contentAlignment === 'bottom'
				? 'end'
				: 'start'
	);
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
		<div style={containerCss(style)}>
			{#if style.overlayColor}
				<div style="background-color:{style.overlayColor};height:100%;width:100%">
					<BlockChildren
						parentId={blockId}
						childrenIds={getBlockChildrenIds(block)}
					/>
				</div>
			{:else}
				<BlockChildren
					parentId={blockId}
					childrenIds={getBlockChildrenIds(block)}
				/>
			{/if}
		</div>
	</BlockWrapper>
{:else if block.type === 'ColumnsContainer'}
	<BlockWrapper {blockId}>
		<div
			class="grid"
			style="{containerCss(style)};grid-template-columns:repeat({colCount},1fr);gap:{colGap}px;align-items:{alignItems}"
		>
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
		{@html leafHtml}
	</BlockWrapper>
{/if}

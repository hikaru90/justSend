<script module lang="ts">
	import type { Node } from '@xyflow/svelte';

	export type TriggerNode = Node<{
		label: string;
		contactBookId?: string;
	}>;
</script>

<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data }: NodeProps<TriggerNode> = $props();
</script>

<div class="min-w-44 rounded-lg border-2 border-emerald-600 bg-white px-3 py-2 shadow-sm">
	<p class="text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">Trigger</p>
	<p class="text-sm font-medium">{data.label}</p>
	{#if data.contactBookId}
		<p class="mt-1 truncate font-mono text-[10px] text-zinc-500">{data.contactBookId}</p>
	{/if}
	<Handle type="source" position={Position.Bottom} class="!bg-emerald-600" />
</div>

<script module lang="ts">
	import type { Node } from '@xyflow/svelte';

	export type EndNode = Node<{
		label: string;
	}>;
</script>

<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data }: NodeProps<EndNode> = $props();
</script>

<div class="min-w-32 rounded-lg border-2 border-zinc-700 bg-white px-3 py-2 shadow-sm">
	<Handle type="target" position={Position.Top} class="!bg-zinc-700" />
	<p class="text-[10px] font-semibold tracking-wide text-zinc-600 uppercase">End</p>
	<p class="text-sm font-medium">{data.label || 'End'}</p>
</div>

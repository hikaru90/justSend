<script module lang="ts">
	import type { Node } from '@xyflow/svelte';

	export type WaitNode = Node<{
		label: string;
		amount?: number;
		unit?: string;
	}>;
</script>

<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data }: NodeProps<WaitNode> = $props();
</script>

<div class="min-w-40 rounded-lg border-2 border-amber-500 bg-white px-3 py-2 shadow-sm">
	<Handle type="target" position={Position.Top} class="!bg-amber-500" />
	<p class="text-[10px] font-semibold tracking-wide text-amber-700 uppercase">Wait</p>
	<p class="text-sm font-medium">
		{data.amount ?? 1}
		{data.unit ?? 'hours'}
	</p>
	<Handle type="source" position={Position.Bottom} class="!bg-amber-500" />
</div>

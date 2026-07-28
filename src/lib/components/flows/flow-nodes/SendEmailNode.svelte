<script module lang="ts">
	import type { Node } from '@xyflow/svelte';

	export type SendEmailNode = Node<{
		label: string;
		templateId?: string;
		from?: string;
		subject?: string;
	}>;
</script>

<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data }: NodeProps<SendEmailNode> = $props();
</script>

<div class="min-w-44 rounded-lg border-2 border-blue-600 bg-white px-3 py-2 shadow-sm">
	<Handle type="target" position={Position.Top} class="!bg-blue-600" />
	<p class="text-[10px] font-semibold tracking-wide text-blue-700 uppercase">Send email</p>
	<p class="text-sm font-medium">{data.label || data.subject || 'Send email'}</p>
	{#if data.subject}
		<p class="mt-1 truncate text-xs text-zinc-600">{data.subject}</p>
	{/if}
	<Handle type="source" position={Position.Bottom} class="!bg-blue-600" />
</div>

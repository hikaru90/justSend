<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		class: className = '',
		value = $bindable(''),
		...rest
	}: HTMLInputAttributes & { class?: string; value?: string } = $props();
</script>

<input
	bind:value
	class={cn(
		'flex h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	{...rest}
/>

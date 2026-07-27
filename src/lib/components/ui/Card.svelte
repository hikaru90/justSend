<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		class: className = '',
		title,
		description,
		children,
		...rest
	}: HTMLAttributes<HTMLDivElement> & {
		class?: string;
		title?: string;
		description?: string;
		children?: Snippet;
	} = $props();
</script>

<div
	class={cn(
		'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-sm',
		className
	)}
	{...rest}
>
	{#if title || description}
		<div class="flex flex-col gap-1.5 border-b border-[hsl(var(--border))] p-6">
			{#if title}
				<h3 class="text-lg font-semibold leading-none tracking-tight">{title}</h3>
			{/if}
			{#if description}
				<p class="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
			{/if}
		</div>
	{/if}
	<div class="p-6">
		{@render children?.()}
	</div>
</div>

<script lang="ts">
	import { cn } from '$lib/utils';
	import { ChevronDown } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		class: className = '',
		title,
		description,
		collapsible = false,
		children,
		...rest
	}: HTMLAttributes<HTMLDivElement> & {
		class?: string;
		title?: string;
		description?: string;
		collapsible?: boolean;
		children?: Snippet;
	} = $props();

	let open = $state(true);

	const hasHeader = $derived(Boolean(title || description));
</script>

<div
	class={cn(
		'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-sm',
		className
	)}
	{...rest}
>
	{#if hasHeader}
		{#if collapsible}
			<button
				type="button"
				class={cn(
					'flex w-full items-start gap-3 p-6 text-left transition-colors hover:bg-[hsl(var(--muted))]/40',
					open && 'border-b border-[hsl(var(--border))]'
				)}
				aria-expanded={open}
				onclick={() => (open = !open)}
			>
				<div class="flex min-w-0 flex-1 flex-col gap-1.5">
					{#if title}
						<h3 class="text-lg font-semibold leading-none tracking-tight">{title}</h3>
					{/if}
					{#if description}
						<p class="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
					{/if}
				</div>
				<ChevronDown
					class={cn(
						'mt-0.5 h-4 w-4 shrink-0 opacity-60 transition-transform duration-200',
						open && 'rotate-180'
					)}
					aria-hidden="true"
				/>
			</button>
		{:else}
			<div class="flex flex-col gap-1.5 border-b border-[hsl(var(--border))] p-6">
				{#if title}
					<h3 class="text-lg font-semibold leading-none tracking-tight">{title}</h3>
				{/if}
				{#if description}
					<p class="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
				{/if}
			</div>
		{/if}
	{/if}
	{#if !collapsible || open}
		<div class="p-6">
			{@render children?.()}
		</div>
	{/if}
</div>

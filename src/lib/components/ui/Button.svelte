<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Variant = 'default' | 'outline' | 'destructive' | 'ghost' | 'secondary';
	type Size = 'default' | 'sm' | 'lg';

	let {
		class: className = '',
		variant = 'default',
		size = 'default',
		type = 'button',
		disabled = false,
		href,
		children,
		...rest
	}: HTMLButtonAttributes & {
		class?: string;
		variant?: Variant;
		size?: Size;
		href?: string;
		children?: Snippet;
	} = $props();

	const variants: Record<Variant, string> = {
		default: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90',
		outline:
			'border border-[hsl(var(--border))] bg-transparent hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]',
		destructive:
			'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:opacity-90',
		ghost: 'hover:bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]',
		secondary:
			'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:opacity-90',
	};

	const sizes: Record<Size, string> = {
		default: 'h-9 px-4 py-2 text-sm',
		sm: 'h-8 px-3 text-xs',
		lg: 'h-10 px-6 text-sm',
	};

	const classes = $derived(
		cn(
			'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-opacity disabled:pointer-events-none disabled:opacity-50',
			variants[variant],
			sizes[size],
			className,
		),
	);
</script>

{#if href}
	<a {href} class={classes} {...rest as Record<string, unknown>}>
		{@render children?.()}
	</a>
{:else}
	<button {type} {disabled} class={classes} {...rest}>
		{@render children?.()}
	</button>
{/if}

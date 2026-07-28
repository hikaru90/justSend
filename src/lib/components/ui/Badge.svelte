<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Variant = 'default' | 'secondary' | 'outline' | 'destructive' | 'success';

	let {
		class: className = '',
		variant = 'default',
		children,
		...rest
	}: HTMLAttributes<HTMLSpanElement> & {
		class?: string;
		variant?: Variant;
		children?: Snippet;
	} = $props();

	const variants: Record<Variant, string> = {
		default: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
		secondary: 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]',
		outline: 'border border-[hsl(var(--border))] text-[hsl(var(--foreground))]',
		destructive: 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]',
		success: 'bg-black text-emerald-400'
	};
</script>

<span
	class={cn(
		'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
		variants[variant],
		className
	)}
	{...rest}
>
	{@render children?.()}
</span>

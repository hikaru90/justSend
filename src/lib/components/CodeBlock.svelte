<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	let { code, class: className = '' }: { code: string; class?: string } = $props();

	let copied = $state(false);
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	async function copyCode() {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => {
				copied = false;
				timeoutId = undefined;
			}, 2000);
		} catch {
			// clipboard unavailable or denied
		}
	}

	$effect(() => {
		return () => {
			clearTimeout(timeoutId);
		};
	});
</script>

<div class={cn('relative', className)}>
	<pre class="overflow-x-auto rounded bg-[hsl(var(--muted))] p-3 pr-10 text-xs">{code}</pre>
	<button
		type="button"
		class="absolute top-1.5 right-1.5 z-10 rounded p-1 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
		aria-label={copied ? 'Copied' : 'Copy code'}
		onclick={copyCode}
	>
		{#if copied}
			<Check size={14} aria-hidden="true" />
		{:else}
			<Copy size={14} aria-hidden="true" />
		{/if}
	</button>
</div>

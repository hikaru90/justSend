<script lang="ts">
	import type { AiFeedLine } from '$lib/ai/stream-feed';

	let {
		lines = [],
		busy = false,
		status = '',
		error = null,
		emptyLabel = 'No messages yet.',
		/** When false, feed grows with content (parent scrolls) — avoids nested scroll regions. */
		scrollBody = true,
		class: className = '',
	}: {
		lines?: AiFeedLine[];
		busy?: boolean;
		status?: string;
		error?: string | null;
		emptyLabel?: string;
		scrollBody?: boolean;
		class?: string;
	} = $props();
</script>

<div
	class="flex min-h-0 flex-col rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)] {scrollBody
		? 'overflow-hidden'
		: ''} {className}"
>
	<div
		{@attach (node) => {
			void lines;
			if (!scrollBody) return;
			requestAnimationFrame(() => {
				node.scrollTop = node.scrollHeight;
			});
		}}
		class="space-y-1.5 px-3 py-2 font-mono text-xs {scrollBody
			? 'max-h-80 min-h-48 flex-1 overflow-y-auto'
			: ''}"
		aria-live="polite"
	>
		{#if lines.length === 0 && !busy}
			<p class="text-[hsl(var(--muted-foreground))]">{emptyLabel}</p>
		{/if}
		{#if lines.length === 0 && busy}
			<p class="text-[hsl(var(--muted-foreground))]">{status || 'Starting…'}</p>
		{/if}
		{#each lines as line (line.id)}
			{#if line.kind === 'user'}
				<p class="font-sans whitespace-pre-wrap text-[hsl(var(--foreground))]">
					<span class="opacity-70">you </span>{line.label}
				</p>
			{:else if line.kind === 'step'}
				<p class="text-[hsl(var(--muted-foreground))]">{line.label}</p>
			{:else if line.kind === 'system'}
				<details class="rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1">
					<summary class="cursor-pointer font-sans text-[hsl(var(--foreground))]"
						>System prompt</summary
					>
					<pre
						class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[hsl(var(--muted-foreground))]">{line.label}</pre>
				</details>
			{:else if line.kind === 'context'}
				<details class="rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1">
					<summary class="cursor-pointer font-sans text-[hsl(var(--foreground))]">Context</summary>
					<pre
						class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[hsl(var(--muted-foreground))]">{line.label}</pre>
				</details>
			{:else if line.kind === 'thinking'}
				<p class="whitespace-pre-wrap text-[hsl(var(--muted-foreground))] italic">
					<span class="not-italic opacity-70">thinking </span>{line.label}
				</p>
			{:else if line.kind === 'text'}
				<p class="whitespace-pre-wrap text-[hsl(var(--foreground))]">{line.label}</p>
			{:else if line.kind === 'error'}
				<p class="text-[hsl(var(--destructive))]">{line.label}</p>
			{:else}
				<p class={line.error ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--foreground))]'}>
					<span class="opacity-70">{line.pending ? 'tool…' : 'tool'}</span>
					<span> {line.label}</span>
					{#if line.detail}
						<span class="text-[hsl(var(--muted-foreground))]"> — {line.detail}</span>
					{/if}
				</p>
			{/if}
		{/each}
	</div>
	{#if busy || status || error}
		<div class="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))] px-3 py-2">
			{#if error}
				<p class="text-xs text-[hsl(var(--destructive))]">{error}</p>
			{:else if status}
				<p class="text-xs text-[hsl(var(--muted-foreground))]">{status}</p>
			{/if}
		</div>
	{/if}
</div>

<script lang="ts">
	import { ChevronDown, Globe } from '@lucide/svelte';

	let {
		domains,
		domainId,
	}: {
		domains: Array<{ id: number; name: string }>;
		domainId: number | null;
	} = $props();

	let open = $state(false);
	const current = $derived(domains.find((d) => d.id === domainId) ?? domains[0]);

	async function switchDomain(id: number) {
		open = false;
		if (id === domainId) return;
		await fetch('/api/domain/switch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ domainId: id }),
		});
		window.location.reload();
	}
</script>

{#if domains.length === 0}
	<a
		href="/domains"
		class="flex items-center gap-2 rounded-md border border-dashed border-[hsl(var(--border))] px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]"
	>
		<Globe class="h-4 w-4 shrink-0" />
		<span class="truncate">No domain — add one</span>
	</a>
{:else if domains.length === 1}
	<div
		class="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--accent))] px-3 py-2 text-sm font-medium"
	>
		<Globe class="h-4 w-4 shrink-0 opacity-70" />
		<span class="truncate">{current?.name}</span>
	</div>
{:else}
	<div class="relative">
		<button
			type="button"
			class="flex w-full items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--accent))] px-3 py-2 text-sm font-medium"
			onclick={() => (open = !open)}
		>
			<Globe class="h-4 w-4 shrink-0 opacity-70" />
			<span class="min-w-0 flex-1 truncate text-left">{current?.name ?? 'Select domain'}</span>
			<ChevronDown class="h-4 w-4 shrink-0 opacity-60" />
		</button>
		{#if open}
			<div
				class="absolute top-full right-0 left-0 z-10 mt-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] py-1 shadow-md"
			>
				{#each domains as domain (domain.id)}
					<button
						type="button"
						class="block w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--accent))] {domain.id ===
						domainId
							? 'font-medium'
							: ''}"
						onclick={() => switchDomain(domain.id)}
					>
						{domain.name}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

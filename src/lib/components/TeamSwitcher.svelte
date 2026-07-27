<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';

	let {
		teams,
		teamId
	}: {
		teams: Array<{ id: number; name: string }>;
		teamId: number | null;
	} = $props();

	let open = $state(false);
	const current = $derived(teams.find((t) => t.id === teamId) ?? teams[0]);

	async function switchTeam(id: number) {
		await fetch('/api/team/switch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ teamId: id })
		});
		window.location.reload();
	}
</script>

{#if teams.length <= 1}
	<p class="truncate text-sm font-medium">{current?.name ?? 'No team'}</p>
{:else}
	<div class="relative">
		<button
			type="button"
			class="flex w-full items-center justify-between rounded-md border border-[hsl(var(--border))] px-3 py-2 text-sm"
			onclick={() => (open = !open)}
		>
			<span class="truncate">{current?.name ?? 'Select team'}</span>
			<ChevronDown class="h-4 w-4 shrink-0 opacity-60" />
		</button>
		{#if open}
			<div
				class="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] py-1 shadow-md"
			>
				{#each teams as team}
					<button
						type="button"
						class="block w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--accent))]"
						onclick={() => switchTeam(team.id)}
					>
						{team.name}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

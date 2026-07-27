<script lang="ts">
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	let { data, children } = $props();
</script>

{#if !data.team}
	<main class="flex min-h-screen items-center justify-center p-6">
		<Card title="Create your team" description="Set up the first team for this useSend instance." class="w-full max-w-md">
			<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
				No team yet. Create one to continue, or check pending invites.
			</p>
			<a href="/create-team">
				<Button type="button" class="w-full">Create team</Button>
			</a>
			<p class="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
				Have an invite? <a href="/join-team" class="underline">View pending invites</a>
			</p>
		</Card>
	</main>
{:else}
	<div class="flex min-h-screen">
		<Sidebar user={data.user} teams={data.teams} teamId={data.teamId} />
		<main class="flex-1 overflow-y-auto p-6 lg:p-8">
			{@render children()}
		</main>
	</div>
{/if}

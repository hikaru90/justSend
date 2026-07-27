<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';

	let { data } = $props();
</script>

<main class="mx-auto max-w-lg p-8">
	<Card title="Join a team">
		{#if !data.email}
			<p class="text-sm text-[hsl(var(--muted-foreground))]">Your account has no email address.</p>
		{:else if data.invites.length === 0}
			<p class="text-sm text-[hsl(var(--muted-foreground))]">
				No pending invites for <strong>{data.email}</strong>. Ask a team admin to invite you, then sign
				in again to accept.
			</p>
		{:else}
			<ul class="space-y-3">
				{#each data.invites as invite}
					<li class="rounded-md border border-[hsl(var(--border))] p-4">
						<p class="font-medium">{invite.teamName}</p>
						<p class="text-sm text-[hsl(var(--muted-foreground))]">
							Role: {invite.role} · Sign in again to accept this invite automatically.
						</p>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</main>

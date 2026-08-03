<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	let { data } = $props();
	const { email } = data;
</script>

<h1 class="mb-6 text-2xl font-semibold">{email.subject}</h1>

<div class="grid gap-4 lg:grid-cols-2">
	<Card title="Details">
		<dl class="space-y-2 text-sm">
			<div>
				<dt class="text-[hsl(var(--muted-foreground))]">From</dt>
				<dd>{email.from}</dd>
			</div>
			<div>
				<dt class="text-[hsl(var(--muted-foreground))]">To</dt>
				<dd>{email.to.join(', ')}</dd>
			</div>
			<div>
				<dt class="text-[hsl(var(--muted-foreground))]">Status</dt>
				<dd><Badge>{email.latestStatus}</Badge></dd>
			</div>
		</dl>
	</Card>
	<Card title="Events">
		<ul class="max-h-64 space-y-2 overflow-y-auto text-sm">
			{#each email.emailEvents as event}
				<li class="flex justify-between gap-2 border-b pb-2">
					<Badge variant="outline">{event.status}</Badge>
					<span class="text-[hsl(var(--muted-foreground))]"
						>{new Date(event.createdAt).toLocaleString()}</span
					>
				</li>
			{:else}
				<li class="text-[hsl(var(--muted-foreground))]">No events</li>
			{/each}
		</ul>
	</Card>
</div>

{#if email.html}
	<Card title="HTML preview" class="mt-4">
		<div class="prose max-w-none overflow-auto rounded border bg-white p-4 text-black">
			{@html email.html}
		</div>
	</Card>
{/if}

<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';

	let { data } = $props();
	const { totalCounts } = data.timeSeries;
</script>

<h1 class="mb-6 text-2xl font-semibold">Dashboard</h1>

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
	<Card title="Sent (30d)"><p class="text-3xl font-bold">{totalCounts.sent}</p></Card>
	<Card title="Delivered"><p class="text-3xl font-bold">{totalCounts.delivered}</p></Card>
	<Card title="Opened"><p class="text-3xl font-bold">{totalCounts.opened}</p></Card>
	<Card title="Clicked"><p class="text-3xl font-bold">{totalCounts.clicked}</p></Card>
	<Card title="Bounced"><p class="text-3xl font-bold">{totalCounts.bounced}</p></Card>
	<Card title="Complained"><p class="text-3xl font-bold">{totalCounts.complained}</p></Card>
</div>

<Card title="Reputation" class="mt-6">
	<dl class="grid gap-4 sm:grid-cols-2">
		<div>
			<dt class="text-sm text-[hsl(var(--muted-foreground))]">Bounce rate</dt>
			<dd class="text-2xl font-semibold">{data.reputation.bounceRate.toFixed(2)}%</dd>
		</div>
		<div>
			<dt class="text-sm text-[hsl(var(--muted-foreground))]">Complaint rate</dt>
			<dd class="text-2xl font-semibold">{data.reputation.complaintRate.toFixed(2)}%</dd>
		</div>
	</dl>
</Card>

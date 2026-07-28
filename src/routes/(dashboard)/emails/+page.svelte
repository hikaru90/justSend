<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { parseJsonArray } from '$lib/utils';

	let { data } = $props();

	const worker = $derived(data.worker);
	const lastBeatLabel = $derived(
		worker.heartbeat
			? new Date(worker.heartbeat.lastBeatAt).toLocaleString()
			: 'Never'
	);
</script>

<div class="mb-6 flex items-center justify-between">
	<h1 class="text-2xl font-semibold">Queue</h1>
</div>

<Card title="Worker status" class="mb-6" description="Background process that drains queued emails and jobs.">
	<div class="flex flex-wrap items-center gap-3 text-sm">
		{#if worker.alive}
			<Badge variant="success">Running</Badge>
		{:else}
			<Badge variant="destructive">Not running</Badge>
		{/if}
		<span class="text-[hsl(var(--muted-foreground))]">
			Last heartbeat: {lastBeatLabel}
			{#if worker.heartbeat}
				· pid {worker.heartbeat.pid}
			{/if}
		</span>
	</div>

	{#if !worker.alive}
		<p class="mt-3 text-sm text-[hsl(var(--destructive))]">
			Emails stay QUEUED until the worker is up. Start it with
			<code class="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-xs">pnpm worker</code>
			(or
			<code class="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-xs">pnpm dev:worker</code>
			locally).
		</p>
	{/if}

	<dl class="mt-4 grid gap-3 sm:grid-cols-3">
		<div>
			<dt class="text-sm text-[hsl(var(--muted-foreground))]">Pending jobs</dt>
			<dd class="text-2xl font-semibold">{worker.totals.pending}</dd>
		</div>
		<div>
			<dt class="text-sm text-[hsl(var(--muted-foreground))]">Processing</dt>
			<dd class="text-2xl font-semibold">{worker.totals.processing}</dd>
		</div>
		<div>
			<dt class="text-sm text-[hsl(var(--muted-foreground))]">Failed</dt>
			<dd class="text-2xl font-semibold">{worker.totals.failed}</dd>
		</div>
	</dl>

	{#if worker.queues.length > 0}
		<div class="mt-4 overflow-x-auto rounded-md border border-[hsl(var(--border))]">
			<table class="w-full text-sm">
				<thead class="border-b bg-[hsl(var(--muted))] text-left">
					<tr>
						<th class="p-2">Queue</th>
						<th class="p-2">Pending</th>
						<th class="p-2">Processing</th>
						<th class="p-2">Failed</th>
					</tr>
				</thead>
				<tbody>
					{#each worker.queues as q (q.queue)}
						<tr class="border-b">
							<td class="p-2 font-mono text-xs">{q.queue}</td>
							<td class="p-2">{q.pending}</td>
							<td class="p-2">{q.processing}</td>
							<td class="p-2">{q.failed}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Card>

<div class="overflow-x-auto rounded-lg border border-[hsl(var(--border))]">
	<table class="w-full text-sm">
		<thead class="border-b bg-[hsl(var(--muted))] text-left">
			<tr>
				<th class="p-3">Subject</th>
				<th class="p-3">To</th>
				<th class="p-3">Status</th>
				<th class="p-3">Created</th>
			</tr>
		</thead>
		<tbody>
			{#each data.items as email (email.id)}
				<tr class="border-b hover:bg-[hsl(var(--accent))]/50">
					<td class="p-3">
						<a href="/emails/{email.id}" class="font-medium hover:underline">{email.subject}</a>
					</td>
					<td class="p-3 text-[hsl(var(--muted-foreground))]">
						{parseJsonArray(email.to).join(', ')}
					</td>
					<td class="p-3"><Badge variant="secondary">{email.latestStatus}</Badge></td>
					<td class="p-3">{new Date(email.createdAt).toLocaleString()}</td>
				</tr>
			{:else}
				<tr><td colspan="4" class="p-6 text-center text-[hsl(var(--muted-foreground))]">No emails yet</td></tr>
			{/each}
		</tbody>
	</table>
</div>

{#if data.nextCursor}
	<div class="mt-4">
		<Button variant="outline" href="/emails?cursor={data.nextCursor}">Load more</Button>
	</div>
{/if}

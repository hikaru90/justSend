<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { enhance } from '$app/forms';

	let { data } = $props();
</script>

<h1 class="mb-2 truncate text-2xl font-semibold">{data.webhook.url}</h1>
<p class="mb-6 text-sm text-[hsl(var(--muted-foreground))]">{data.webhook.description ?? 'No description'}</p>

<div class="mb-6 flex flex-wrap gap-2">
	<form method="POST" action="?/toggle" use:enhance><Button type="submit" variant="outline">Toggle status</Button></form>
	<form method="POST" action="?/test" use:enhance><Button type="submit" variant="outline">Send test</Button></form>
	<form method="POST" action="?/delete" use:enhance onsubmit={(e) => !confirm('Delete webhook?') && e.preventDefault()}>
		<Button type="submit" variant="destructive">Delete</Button>
	</form>
</div>

<Card title="Recent calls">
	<table class="w-full text-sm">
		<thead class="border-b text-left">
			<tr><th class="p-2">Type</th><th class="p-2">Status</th><th class="p-2">Attempt</th><th class="p-2"></th></tr>
		</thead>
		<tbody>
			{#each data.calls.items as call}
				<tr class="border-b">
					<td class="p-2">{call.type}</td>
					<td class="p-2"><Badge variant="outline">{call.status}</Badge></td>
					<td class="p-2">{call.attempt}</td>
					<td class="p-2">
						{#if call.status === 'FAILED'}
							<form method="POST" action="?/retry" use:enhance>
								<input type="hidden" name="callId" value={call.id} />
								<Button type="submit" size="sm" variant="ghost">Retry</Button>
							</form>
						{/if}
					</td>
				</tr>
			{:else}
				<tr><td colspan="4" class="p-4 text-[hsl(var(--muted-foreground))]">No calls yet</td></tr>
			{/each}
		</tbody>
	</table>
</Card>

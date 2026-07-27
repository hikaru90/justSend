<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { parseJsonArray } from '$lib/utils';

	let { data } = $props();
</script>

<div class="mb-6 flex items-center justify-between">
	<h1 class="text-2xl font-semibold">Emails</h1>
</div>

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
			{#each data.items as email}
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

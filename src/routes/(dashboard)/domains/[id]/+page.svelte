<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<h1 class="mb-2 text-2xl font-semibold">{data.domain.name}</h1>
<p class="mb-6 text-sm text-[hsl(var(--muted-foreground))]">{data.domain.region}</p>

<div class="mb-4 flex gap-2">
	<form method="POST" action="?/verify" use:enhance>
		<Button type="submit" variant="outline">Verify DNS</Button>
	</form>
	<form method="POST" action="?/delete" use:enhance onsubmit={(e) => !confirm('Delete domain?') && e.preventDefault()}>
		<Button type="submit" variant="destructive">Delete</Button>
	</form>
</div>
{#if form?.error}<p class="mb-4 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}

<Card title="DNS records">
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b text-left">
					<th class="p-2">Type</th><th class="p-2">Name</th><th class="p-2">Value</th><th class="p-2">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each data.domain.dnsRecords as record}
					<tr class="border-b">
						<td class="p-2">{record.type}</td>
						<td class="p-2 font-mono text-xs">{record.name}</td>
						<td class="max-w-xs truncate p-2 font-mono text-xs">{record.value}</td>
						<td class="p-2"><Badge variant="outline">{record.status}</Badge></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Card>

<Card title="Tracking" class="mt-4">
	<form method="POST" action="?/updateTracking" use:enhance class="space-y-2">
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" name="openTracking" checked={data.domain.openTracking} />
			Open tracking
		</label>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" name="clickTracking" checked={data.domain.clickTracking} />
			Click tracking
		</label>
		<Button type="submit" size="sm">Save</Button>
	</form>
</Card>

<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<h1 class="mb-6 text-2xl font-semibold">Suppressions</h1>

<Card title="Add suppression" class="mb-6">
	<form method="POST" action="?/add" use:enhance class="flex gap-2">
		<Input name="email" type="email" placeholder="blocked@example.com" required class="flex-1" />
		<Button type="submit">Add</Button>
	</form>
	{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
</Card>

<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">{data.total} total</p>

<table class="w-full text-sm">
	<thead class="border-b text-left"><tr><th class="p-2">Email</th><th class="p-2">Reason</th><th class="p-2"></th></tr></thead>
	<tbody>
		{#each data.suppressions as row}
			<tr class="border-b">
				<td class="p-2">{row.email}</td>
				<td class="p-2"><Badge variant="outline">{row.reason}</Badge></td>
				<td class="p-2">
					<form method="POST" action="?/remove" use:enhance>
						<input type="hidden" name="email" value={row.email} />
						<Button type="submit" size="sm" variant="ghost">Remove</Button>
					</form>
				</td>
			</tr>
		{/each}
	</tbody>
</table>

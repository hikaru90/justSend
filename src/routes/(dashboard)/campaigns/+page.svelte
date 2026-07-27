<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<h1 class="mb-6 text-2xl font-semibold">Campaigns</h1>

<Card title="New campaign" class="mb-6">
	<form method="POST" action="?/create" use:enhance class="grid gap-3 sm:grid-cols-2">
		<Input name="name" placeholder="Campaign name" required />
		<Input name="from" placeholder="hello@example.com" required />
		<Input name="subject" placeholder="Subject" required class="sm:col-span-2" />
		<select name="contactBookId" class="h-9 rounded-md border px-3 text-sm sm:col-span-2">
			<option value="">No contact book</option>
			{#each data.books as book}
				<option value={book.id}>{book.name}</option>
			{/each}
		</select>
		<Button type="submit" class="sm:col-span-2">Create draft</Button>
	</form>
	{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
</Card>

<div class="space-y-2">
	{#each data.items as campaign}
		<a href="/campaigns/{campaign.id}" class="block rounded-lg border p-4 hover:bg-[hsl(var(--accent))]/50">
			<div class="flex justify-between">
				<span class="font-medium">{campaign.name}</span>
				<Badge>{campaign.status}</Badge>
			</div>
			<p class="text-sm text-[hsl(var(--muted-foreground))]">{campaign.subject}</p>
		</a>
	{/each}
</div>

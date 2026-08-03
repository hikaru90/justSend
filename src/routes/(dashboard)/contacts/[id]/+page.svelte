<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<div class="mb-6 flex items-center justify-between">
	<h1 class="text-2xl font-semibold">{data.book.name}</h1>
	<Button variant="outline" href="/contacts/{data.book.id}/double-opt-in">Double opt-in</Button>
</div>

<Card title="Add contact" class="mb-6">
	<form method="POST" action="?/add" use:enhance class="flex gap-2">
		<Input name="email" type="email" placeholder="contact@example.com" required class="flex-1" />
		<Button type="submit">Add</Button>
	</form>
	{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
</Card>

<table class="w-full text-sm">
	<thead class="border-b text-left">
		<tr><th class="p-2">Email</th><th class="p-2">Subscribed</th></tr>
	</thead>
	<tbody>
		{#each data.contacts.items as contact}
			<tr class="border-b">
				<td class="p-2">{contact.email}</td>
				<td class="p-2">
					<Badge variant={contact.subscribed ? 'success' : 'secondary'}>
						{contact.subscribed ? 'Yes' : 'No'}
					</Badge>
				</td>
			</tr>
		{/each}
	</tbody>
</table>

{#if data.contacts.nextCursor}
	<Button
		variant="outline"
		class="mt-4"
		href="/contacts/{data.book.id}?cursor={data.contacts.nextCursor}">More</Button
	>
{/if}

<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<h1 class="mb-6 text-2xl font-semibold">Contact books</h1>

<Card title="New contact book" class="mb-6">
	<form method="POST" action="?/create" use:enhance class="flex gap-2">
		<Input name="name" placeholder="Newsletter" required class="flex-1" />
		<Button type="submit">Create</Button>
	</form>
	{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
</Card>

<div class="space-y-2">
	{#each data.books as book}
		<a
			href="/contacts/{book.id}"
			class="block rounded-lg border p-4 hover:bg-[hsl(var(--accent))]/50"
		>
			<div class="flex justify-between">
				<span class="font-medium">{book.name}</span>
				<span class="text-sm text-[hsl(var(--muted-foreground))]">{book.contactCount} contacts</span
				>
			</div>
		</a>
	{:else}
		<p class="text-[hsl(var(--muted-foreground))]">No contact books.</p>
	{/each}
</div>

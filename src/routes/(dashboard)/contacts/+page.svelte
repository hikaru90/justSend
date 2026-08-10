<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let renamingId = $state<string | null>(null);
	let renameValue = $state('');

	function startRename(id: string, name: string) {
		renamingId = id;
		renameValue = name;
	}

	function cancelRename() {
		renamingId = null;
		renameValue = '';
	}
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
	{#each data.books as book (book.id)}
		<div class="rounded-lg border p-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="min-w-0 flex-1">
					{#if renamingId === book.id}
						<form
							method="POST"
							action="?/rename"
							use:enhance={() => {
								return async ({ update }) => {
									await update({ reset: false });
									cancelRename();
								};
							}}
							class="flex flex-wrap items-center gap-2"
						>
							<input type="hidden" name="id" value={book.id} />
							<Input name="name" bind:value={renameValue} required class="max-w-xs flex-1" />
							<Button type="submit" size="sm">Save</Button>
							<Button type="button" size="sm" variant="outline" onclick={cancelRename}
								>Cancel</Button
							>
						</form>
					{:else}
						<a href="/contacts/{book.id}" class="font-medium hover:underline">{book.name}</a>
						<p class="text-sm text-[hsl(var(--muted-foreground))]">
							{book.contactCount} contacts
						</p>
					{/if}
				</div>
				{#if renamingId !== book.id}
					<div class="flex flex-wrap gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							onclick={() => startRename(book.id, book.name)}
						>
							Rename
						</Button>
						<form method="POST" action="?/duplicate" use:enhance>
							<input type="hidden" name="id" value={book.id} />
							<Button type="submit" size="sm" variant="outline">Duplicate</Button>
						</form>
						<form
							method="POST"
							action="?/delete"
							use:enhance
							onsubmit={(e) =>
								!confirm(`Delete “${book.name}” and all its contacts?`) && e.preventDefault()}
						>
							<input type="hidden" name="id" value={book.id} />
							<Button type="submit" size="sm" variant="destructive">Delete</Button>
						</form>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<p class="text-[hsl(var(--muted-foreground))]">No contact books.</p>
	{/each}
</div>

<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let email = $state('');
	let search = $state('');
	let statusFilter = $state<'all' | 'subscribed' | 'pending'>('all');

	const filtered = $derived(
		data.contacts.items.filter((contact) => {
			const q = search.trim().toLowerCase();
			if (q && !contact.email.toLowerCase().includes(q)) return false;
			if (statusFilter === 'subscribed' && !contact.subscribed) return false;
			if (statusFilter === 'pending' && contact.subscribed) return false;
			return true;
		}),
	);

	function formatDate(iso: string | null | undefined) {
		if (!iso) return '—';
		try {
			return new Date(iso).toLocaleString();
		} catch {
			return iso;
		}
	}
</script>

<div class="mb-6 flex items-center justify-between">
	<h1 class="text-2xl font-semibold">{data.book.name}</h1>
	<Button variant="outline" href="/contacts/{data.book.id}/double-opt-in">Double opt-in</Button>
</div>

<Card title="Add contact" class="mb-6">
	<form
		id="add-contact-form"
		method="POST"
		action="?/add"
		use:enhance={() => {
			return async ({ update }) => {
				await update();
				email = '';
			};
		}}
		class="flex gap-2"
	>
		<Input
			name="email"
			type="email"
			placeholder="contact@example.com"
			required
			class="flex-1"
			bind:value={email}
		/>
		<Button type="submit">Add</Button>
	</form>
	{#if form?.added}
		{#if form.doiError}
			<p class="mt-2 text-sm text-[hsl(var(--destructive))]">
				Contact added, but confirmation email failed: {form.doiError}
			</p>
		{:else if data.book.doubleOptInEnabled}
			<p class="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
				Contact added. Confirmation email sent.
			</p>
		{/if}
	{/if}
</Card>

{#if form?.error && !form?.added && !form?.resent && !form?.deleted}
	<p class="mb-6 text-sm text-[hsl(var(--destructive))]">{form.error}</p>
{/if}
{#if form?.resent}
	<p class="mb-6 text-sm text-emerald-700">Confirmation email resent.</p>
{/if}
{#if form?.deleted}
	<p class="mb-6 text-sm text-[hsl(var(--muted-foreground))]">Contact deleted.</p>
{/if}

<Card title="Contacts" class="mb-6">
	<div class="mb-4 flex flex-wrap gap-3">
		<Input
			bind:value={search}
			placeholder="Filter by email…"
			class="max-w-xs"
			aria-label="Filter by email"
		/>
		<select
			class="flex h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
			bind:value={statusFilter}
			aria-label="Filter by status"
		>
			<option value="all">All statuses</option>
			<option value="subscribed">Subscribed</option>
			<option value="pending">Pending / unsubscribed</option>
		</select>
		<p class="self-center text-xs text-[hsl(var(--muted-foreground))]">
			{filtered.length} of {data.contacts.items.length} shown
			{#if data.contacts.nextCursor}
				(more available — raise limit if needed)
			{/if}
		</p>
	</div>

	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead class="border-b text-left">
				<tr>
					<th class="p-2">Email</th>
					<th class="p-2">Status</th>
					<th class="p-2">Created</th>
					<th class="p-2">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as contact (contact.id)}
					<tr class="border-b">
						<td class="p-2">{contact.email}</td>
						<td class="p-2">
							{#if contact.subscribed}
								<Badge variant="success">Subscribed</Badge>
							{:else if data.book.doubleOptInEnabled && !contact.unsubscribeReason}
								<Badge variant="secondary">Pending confirmation</Badge>
							{:else}
								<Badge variant="secondary">Unsubscribed</Badge>
							{/if}
						</td>
						<td class="p-2 text-[hsl(var(--muted-foreground))]">
							{formatDate(contact.createdAt)}
						</td>
						<td class="p-2">
							<div class="flex flex-wrap gap-2">
								{#if data.book.doubleOptInEnabled && !contact.subscribed && !contact.unsubscribeReason}
									<form method="POST" action="?/resendConfirmation" use:enhance>
										<input type="hidden" name="contactId" value={contact.id} />
										<Button type="submit" size="sm" variant="outline">Resend confirmation</Button>
									</form>
								{/if}
								<form
									method="POST"
									action="?/delete"
									use:enhance
									onsubmit={(e) => !confirm(`Delete ${contact.email}?`) && e.preventDefault()}
								>
									<input type="hidden" name="contactId" value={contact.id} />
									<Button type="submit" size="sm" variant="destructive">Delete</Button>
								</form>
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="4" class="p-4 text-[hsl(var(--muted-foreground))]">No contacts match.</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Card>

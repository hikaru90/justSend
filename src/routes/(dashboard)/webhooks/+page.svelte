<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { parseJsonArray } from '$lib/utils';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<h1 class="mb-6 text-2xl font-semibold">Webhooks</h1>

<Card title="Create webhook" class="mb-6">
	<form method="POST" action="?/create" use:enhance class="space-y-3">
		<Input name="url" type="url" placeholder="https://example.com/webhook" required />
		<Input name="description" placeholder="Description (optional)" />
		<fieldset class="space-y-1">
			<legend class="text-sm font-medium">Events</legend>
			<div class="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto text-sm">
				{#each data.eventTypes as type}
					<label class="flex items-center gap-2">
						<input type="checkbox" name="eventTypes" value={type} />
						{type}
					</label>
				{/each}
			</div>
		</fieldset>
		<Button type="submit">Create</Button>
	</form>
	{#if form?.secret}
		<p class="mt-3 rounded border bg-[hsl(var(--muted))] p-2 font-mono text-xs">
			Secret: {form.secret}
		</p>
	{/if}
	{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
</Card>

<div class="space-y-2">
	{#each data.webhooks as webhook}
		<a
			href="/webhooks/{webhook.id}"
			class="block rounded-lg border p-4 hover:bg-[hsl(var(--accent))]/50"
		>
			<div class="flex justify-between gap-2">
				<span class="truncate font-medium">{webhook.url}</span>
				<Badge variant={webhook.status === 'ACTIVE' ? 'success' : 'secondary'}
					>{webhook.status}</Badge
				>
			</div>
			<p class="mt-1 truncate text-xs text-[hsl(var(--muted-foreground))]">
				{parseJsonArray(webhook.eventTypes).join(', ') || 'All events'}
			</p>
		</a>
	{/each}
</div>

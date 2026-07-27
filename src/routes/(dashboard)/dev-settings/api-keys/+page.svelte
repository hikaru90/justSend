<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<h1 class="mb-6 text-2xl font-semibold">API keys</h1>

<Card title="Create key" class="mb-6">
	<form method="POST" action="?/create" use:enhance class="grid gap-3 sm:grid-cols-2">
		<Input name="name" placeholder="Production" required />
		<select name="permission" class="h-9 rounded-md border px-3 text-sm">
			<option value="FULL">Full</option>
			<option value="SENDING">Sending only</option>
		</select>
		<select name="domainId" class="h-9 rounded-md border px-3 text-sm sm:col-span-2">
			<option value="">All domains</option>
			{#each data.domains as domain}
				<option value={domain.id}>{domain.name}</option>
			{/each}
		</select>
		<Button type="submit" class="sm:col-span-2">Create</Button>
	</form>
	{#if form?.newKey}
		<p class="mt-3 rounded border bg-[hsl(var(--muted))] p-2 font-mono text-xs break-all">
			Copy now — shown once: {form.newKey}
		</p>
	{/if}
</Card>

<ul class="space-y-2">
	{#each data.keys as key}
		<li class="flex items-center justify-between rounded-lg border p-4">
			<div>
				<p class="font-medium">{key.name}</p>
				<p class="font-mono text-xs text-[hsl(var(--muted-foreground))]">{key.partialToken}</p>
			</div>
			<form method="POST" action="?/delete" use:enhance>
				<input type="hidden" name="id" value={key.id} />
				<Button type="submit" size="sm" variant="destructive">Delete</Button>
			</form>
		</li>
	{/each}
</ul>

<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<h1 class="mb-6 text-2xl font-semibold">Domains</h1>

<Card title="Add domain" class="mb-6">
	<form method="POST" action="?/create" use:enhance class="flex flex-wrap items-end gap-3">
		<div class="min-w-[200px] flex-1">
			<label class="mb-1 block text-sm" for="name">Domain</label>
			<Input id="name" name="name" placeholder="mail.example.com" required />
		</div>
		<div>
			<label class="mb-1 block text-sm" for="region">Region</label>
			<select id="region" name="region" required class="h-9 rounded-md border px-3 text-sm">
				{#each data.regions as region}
					<option value={region}>{region}</option>
				{:else}
					<option value="">No SES regions configured</option>
				{/each}
			</select>
		</div>
		<Button type="submit">Add</Button>
	</form>
	{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
</Card>

<div class="space-y-3">
	{#each data.domains as domain}
		<a
			href="/domains/{domain.id}"
			class="block rounded-lg border border-[hsl(var(--border))] p-4 hover:bg-[hsl(var(--accent))]/50"
		>
			<div class="flex items-center justify-between">
				<span class="font-medium">{domain.name}</span>
				<Badge variant={domain.status === 'SUCCESS' ? 'success' : 'secondary'}
					>{domain.status}</Badge
				>
			</div>
			<p class="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{domain.region}</p>
		</a>
	{:else}
		<p class="text-[hsl(var(--muted-foreground))]">No domains yet.</p>
	{/each}
</div>

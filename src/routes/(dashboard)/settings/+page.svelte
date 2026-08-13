<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let teamName = $state('');

	$effect(() => {
		teamName = data.team?.name ?? '';
	});
</script>

<h1 class="mb-6 text-2xl font-semibold">Settings</h1>

<Card title="Team">
	<form
		method="POST"
		use:enhance={() => {
			return async ({ update }) => {
				await update({ reset: false });
			};
		}}
		class="flex gap-2"
	>
		<Input name="name" bind:value={teamName} required class="flex-1" />
		<Button type="submit">Save</Button>
	</form>
	{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
	<p class="mt-4 text-sm">
		<a href="/settings/team" class="underline">Manage team members and invites →</a>
	</p>
</Card>

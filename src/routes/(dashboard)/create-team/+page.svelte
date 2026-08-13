<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { enhance } from '$app/forms';

	let { form } = $props();
</script>

<main class="flex min-h-screen items-center justify-center p-6">
	<Card
		title="Create your team"
		description="Self-hosted Owlery uses a single team."
		class="w-full max-w-md"
	>
		<form method="POST" use:enhance>
			<label class="mb-1 block text-sm font-medium" for="name">Team name</label>
			<Input id="name" name="name" required placeholder="My Team" />
			{#if form?.teamError}
				<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.teamError}</p>
			{/if}
			<Button type="submit" class="mt-4 w-full">Create team</Button>
		</form>
	</Card>
</main>

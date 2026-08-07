<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<h1 class="mb-6 text-2xl font-semibold">Settings</h1>

{#if data.hasByokKey}
	<Card
		title="Personal OpenRouter key"
		description="This team is using a bring-your-own OpenRouter API key for AI features. Requests go through your OpenRouter account (and its rate limits), not Owlery AI credits."
		class="mb-6 border-amber-500/40"
	>
		<p class="text-sm text-[hsl(var(--muted-foreground))]">
			Saved key: <code class="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-xs">{data.byokKeyPreview}</code>
		</p>
		<p class="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
			If you are hitting OpenRouter rate limits, remove your key to switch back to Owlery-provided AI
			credits.
		</p>
		<form method="POST" action="?/removeByokKey" use:enhance class="mt-4">
			<Button type="submit" variant="destructive">Remove key and use Owlery AI credits</Button>
		</form>
		{#if form?.byokError}
			<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.byokError}</p>
		{/if}
		{#if form?.byokRemoved}
			<p class="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
				Personal key removed. AI features now use Owlery credits.
			</p>
		{/if}
	</Card>
{/if}

<Card title="Team">
	<form method="POST" use:enhance class="flex gap-2">
		<Input name="name" value={data.team?.name ?? ''} required class="flex-1" />
		<Button type="submit">Save</Button>
	</form>
	{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
	<p class="mt-4 text-sm">
		<a href="/settings/team" class="underline">Manage team members and invites →</a>
	</p>
</Card>

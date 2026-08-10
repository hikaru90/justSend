<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Editor from '$lib/email-editor/Editor.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	// Editable copies re-synced when server data changes after save.
	let enabled = $state(false);
	let from = $state('');
	let subject = $state('');
	let content = $state('');

	$effect(() => {
		const book = data.book;
		enabled = book.doubleOptInEnabled;
		from = book.doubleOptInFrom ?? '';
		subject = book.doubleOptInSubject ?? '';
		content = book.doubleOptInContent ?? '';
	});

	const defaultFromHint = $derived(
		data.defaultFrom
			? `Leave blank to use domain default (${data.defaultFrom})`
			: 'Leave blank to use the domain default sender address',
	);
</script>

<h1 class="mb-6 text-2xl font-semibold">Double opt-in — {data.book.name}</h1>

<Card>
	<form
		method="POST"
		use:enhance={() => {
			return async ({ update }) => {
				await update({ reset: false });
			};
		}}
		class="space-y-4"
	>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" name="doubleOptInEnabled" bind:checked={enabled} />
			Enabled
		</label>
		<div>
			<label class="mb-1 block text-sm" for="from">From (optional override)</label>
			<Input
				id="from"
				name="doubleOptInFrom"
				bind:value={from}
				placeholder={data.defaultFrom ?? 'newsletter@yourdomain.com'}
			/>
			<p class="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{defaultFromHint}</p>
		</div>
		<div>
			<label class="mb-1 block text-sm" for="subject">Subject</label>
			<Input id="subject" name="doubleOptInSubject" bind:value={subject} />
		</div>
		<input type="hidden" name="doubleOptInContent" value={content} />
		<Editor bind:value={content} label={'Email content (include {{doubleOptInUrl}})'} />
		{#if form?.error}<p class="text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
		{#if form?.saved}
			<p class="text-sm text-emerald-700">Saved.</p>
		{/if}
		<Button type="submit">Save</Button>
	</form>
</Card>

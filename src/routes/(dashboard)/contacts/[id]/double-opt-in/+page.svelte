<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Editor from '$lib/email-editor/Editor.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let content = $state(data.book.doubleOptInContent ?? '');
</script>

<h1 class="mb-6 text-2xl font-semibold">Double opt-in — {data.book.name}</h1>

<Card>
	<form method="POST" use:enhance class="space-y-4">
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" name="doubleOptInEnabled" checked={data.book.doubleOptInEnabled} />
			Enabled
		</label>
		<div>
			<label class="mb-1 block text-sm" for="from">From</label>
			<Input id="from" name="doubleOptInFrom" value={data.book.doubleOptInFrom ?? ''} />
		</div>
		<div>
			<label class="mb-1 block text-sm" for="subject">Subject</label>
			<Input id="subject" name="doubleOptInSubject" value={data.book.doubleOptInSubject ?? ''} />
		</div>
		<input type="hidden" name="doubleOptInContent" value={content} />
		<Editor bind:value={content} label={'Email content (include {{doubleOptInUrl}})'} />
		{#if form?.error}<p class="text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
		<Button type="submit">Save</Button>
	</form>
</Card>

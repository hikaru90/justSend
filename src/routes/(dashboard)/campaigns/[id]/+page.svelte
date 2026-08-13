<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Editor from '$lib/email-editor/Editor.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	const defaultHtml =
		'<p>Hello {{firstName}}</p><p><a href="{{owlery_unsubscribe_url}}">Unsubscribe</a></p>';
	let html = $state(defaultHtml);

	$effect.pre(() => {
		html = data.campaign.html ?? defaultHtml;
	});
</script>

<div class="mb-4 flex items-center gap-2">
	<h1 class="text-2xl font-semibold">{data.campaign.name}</h1>
	<Badge>{data.campaign.status}</Badge>
</div>

<Card>
	<form method="POST" action="?/update" use:enhance class="space-y-4">
		<Input name="name" value={data.campaign.name} />
		<Input name="from" value={data.campaign.from} />
		<Input name="subject" value={data.campaign.subject} />
		<select name="contactBookId" class="h-9 w-full rounded-md border px-3 text-sm">
			<option value="">No book</option>
			{#each data.books as book}
				<option value={book.id} selected={book.id === data.campaign.contactBookId}
					>{book.name}</option
				>
			{/each}
		</select>
		<input type="hidden" name="html" value={html} />
		<Editor bind:value={html} />
		{#if form?.error}<p class="text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
		<Button type="submit">Save</Button>
	</form>
</Card>

<div class="mt-4 flex flex-wrap gap-2">
	<form method="POST" action="?/schedule" use:enhance class="flex items-end gap-2">
		<div>
			<label class="text-xs" for="scheduledAt">Schedule at</label>
			<Input id="scheduledAt" name="scheduledAt" type="datetime-local" />
		</div>
		<Button type="submit" variant="outline">Schedule</Button>
	</form>
	<form method="POST" action="?/pause" use:enhance>
		<Button type="submit" variant="outline">Pause</Button>
	</form>
	<form method="POST" action="?/resume" use:enhance>
		<Button type="submit" variant="outline">Resume</Button>
	</form>
	<form
		method="POST"
		action="?/delete"
		use:enhance
		onsubmit={(e) => !confirm('Delete?') && e.preventDefault()}
	>
		<Button type="submit" variant="destructive">Delete</Button>
	</form>
</div>

<p class="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
	Sent: {data.campaign.sent} · Delivered: {data.campaign.delivered} · Opened: {data.campaign.opened}
</p>

<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Editor from '$lib/email-editor/Editor.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let newHtml = $state('<p>Hello {{name}}</p>');
	let editId = $state<string | null>(null);
	let editHtml = $state('');
</script>

<h1 class="mb-6 text-2xl font-semibold">Templates</h1>

<Card title="Create template" class="mb-6">
	<form method="POST" action="?/create" use:enhance class="space-y-3">
		<Input name="name" placeholder="Name" required />
		<Input name="subject" placeholder="Subject" required />
		<input type="hidden" name="html" value={newHtml} />
		<Editor bind:value={newHtml} />
		<Button type="submit">Create</Button>
	</form>
	{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
</Card>

<div class="space-y-4">
	{#each data.templates as template}
		<Card title={template.name}>
			<p class="mb-2 text-sm text-[hsl(var(--muted-foreground))]">{template.subject}</p>
			{#if editId === template.id}
				<form method="POST" action="?/update" use:enhance class="space-y-2">
					<input type="hidden" name="id" value={template.id} />
					<Input name="name" value={template.name} />
					<Input name="subject" value={template.subject} />
					<input type="hidden" name="html" value={editHtml} />
					<Editor bind:value={editHtml} />
					<div class="flex gap-2">
						<Button type="submit" size="sm">Save</Button>
						<Button type="button" variant="ghost" size="sm" onclick={() => (editId = null)}>Cancel</Button>
					</div>
				</form>
			{:else}
				<div class="flex gap-2">
					<Button
						size="sm"
						variant="outline"
						onclick={() => {
							editId = template.id;
							editHtml = template.html ?? '';
						}}>Edit</Button
					>
					<form method="POST" action="?/delete" use:enhance>
						<input type="hidden" name="id" value={template.id} />
						<Button type="submit" size="sm" variant="destructive">Delete</Button>
					</form>
				</div>
			{/if}
		</Card>
	{/each}
</div>

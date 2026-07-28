<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<h1 class="mb-2 text-2xl font-semibold">Flows</h1>
<p class="mb-6 text-sm text-[hsl(var(--muted-foreground))]">
	Trigger-based automation: contact created → send → wait → send.
</p>

<Card title="New flow" class="mb-6">
	<form method="POST" action="?/create" use:enhance class="flex flex-wrap items-end gap-3">
		<Input name="name" placeholder="Flow name" class="max-w-xs" />
		<Button type="submit">Create draft</Button>
	</form>
	{#if form?.error}
		<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>
	{/if}
</Card>

{#if data.flows.length === 0}
	<p class="text-sm text-[hsl(var(--muted-foreground))]">No flows yet.</p>
{:else}
	<div class="space-y-2">
		{#each data.flows as flow (flow.id)}
			<div class="flex items-center gap-3 rounded-lg border p-4 hover:bg-[hsl(var(--accent))]/50">
				<a href="/flows/{flow.id}" class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-2">
						<span class="font-medium">{flow.name}</span>
						<Badge
							variant={flow.status === 'active'
								? 'success'
								: flow.status === 'paused'
									? 'secondary'
									: 'outline'}
						>
							{flow.status}
						</Badge>
					</div>
					<p class="text-sm text-[hsl(var(--muted-foreground))]">
						{flow.graph.nodes.length} nodes · {flow.triggerType}
					</p>
				</a>
				<form method="POST" action="?/delete" use:enhance>
					<input type="hidden" name="id" value={flow.id} />
					<Button type="submit" variant="outline" size="sm">Delete</Button>
				</form>
			</div>
		{/each}
	</div>
{/if}

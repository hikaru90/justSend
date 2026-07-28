<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		SvelteFlow,
		Background,
		Controls,
		MiniMap,
		type Node,
		type Edge,
		type Connection
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { flowNodeTypes } from '$lib/components/flows/flow-nodes';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';

	let { data, form } = $props();

	let name = $state(data.flow.name);
	let status = $state(data.flow.status);
	let contactBookId = $state(data.flow.triggerConfig.contactBookId ?? '');
	let saving = $state(false);
	let selectedNodeId = $state<string | null>(null);

	let nodes = $state.raw<Node[]>(
		structuredClone(data.flow.graph.nodes).map((n) => ({
			...n,
			type: n.type ?? 'default',
			data: { ...n.data }
		})) as Node[]
	);
	let edges = $state.raw<Edge[]>(
		structuredClone(data.flow.graph.edges).map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle ?? undefined,
			targetHandle: e.targetHandle ?? undefined
		}))
	);

	const selectedNode = $derived(nodes.find((n) => n.id === selectedNodeId) ?? null);

	function addNode(type: 'sendEmail' | 'wait' | 'end') {
		const id = `${type}-${crypto.randomUUID().slice(0, 8)}`;
		const y = 80 + nodes.length * 100;
		const dataForType =
			type === 'sendEmail'
				? { label: 'Send email', subject: 'Welcome', from: '', templateId: '' }
				: type === 'wait'
					? { label: 'Wait', amount: 1, unit: 'days' }
					: { label: 'End' };

		nodes = [
			...nodes,
			{
				id,
				type,
				position: { x: 80, y },
				data: dataForType
			}
		];
		selectedNodeId = id;
	}

	function onconnect(connection: Connection) {
		if (!connection.source || !connection.target) return;
		const id = `e-${connection.source}-${connection.target}-${crypto.randomUUID().slice(0, 4)}`;
		edges = [
			...edges,
			{
				id,
				source: connection.source,
				target: connection.target,
				sourceHandle: connection.sourceHandle ?? undefined,
				targetHandle: connection.targetHandle ?? undefined
			}
		];
	}

	function updateSelectedData(key: string, value: string | number) {
		if (!selectedNodeId) return;
		nodes = nodes.map((n) =>
			n.id === selectedNodeId ? { ...n, data: { ...n.data, [key]: value } } : n
		);
	}

	function deleteSelected() {
		if (!selectedNodeId) return;
		const node = nodes.find((n) => n.id === selectedNodeId);
		if (node?.type === 'trigger') return;
		nodes = nodes.filter((n) => n.id !== selectedNodeId);
		edges = edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId);
		selectedNodeId = null;
	}

	const graphPayload = $derived(
		JSON.stringify({
			nodes: nodes.map((n) => ({
				id: n.id,
				type: n.type,
				position: n.position,
				data: n.data as Record<string, unknown>
			})),
			edges: edges.map((e) => ({
				id: e.id,
				source: e.source,
				target: e.target,
				sourceHandle: e.sourceHandle ?? null,
				targetHandle: e.targetHandle ?? null
			}))
		})
	);

	const selectClass =
		'flex h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm';
</script>

<div class="flex h-[calc(100dvh-4rem)] flex-col gap-3">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<a href="/flows" class="text-xs text-[hsl(var(--muted-foreground))] hover:underline"
				>← Flows</a
			>
			<div class="flex items-center gap-2">
				<h1 class="text-xl font-semibold tracking-tight">Edit flow</h1>
				<Badge
					variant={status === 'active' ? 'success' : status === 'paused' ? 'secondary' : 'outline'}
				>
					{status}
				</Badge>
			</div>
		</div>
		<form
			method="POST"
			action="?/save"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update();
					saving = false;
				};
			}}
			class="flex flex-wrap items-end gap-2"
		>
			<div>
				<label for="flow-name" class="mb-1 block text-xs font-medium">Name</label>
				<Input id="flow-name" bind:value={name} class="w-40" />
				<input type="hidden" name="name" value={name} />
			</div>
			<div>
				<label for="flow-status" class="mb-1 block text-xs font-medium">Status</label>
				<select id="flow-status" bind:value={status} class="{selectClass} w-32">
					<option value="draft">draft</option>
					<option value="active">active</option>
					<option value="paused">paused</option>
				</select>
				<input type="hidden" name="status" value={status} />
			</div>
			<div>
				<label for="book" class="mb-1 block text-xs font-medium">Contact book (trigger)</label>
				<select id="book" bind:value={contactBookId} class="{selectClass} w-48">
					<option value="">Select…</option>
					{#each data.books as book (book.id)}
						<option value={book.id}>{book.name}</option>
					{/each}
				</select>
				<input type="hidden" name="contactBookId" value={contactBookId} />
			</div>
			<input type="hidden" name="graph" value={graphPayload} />
			<Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
		</form>
	</div>

	{#if form?.error}
		<p class="text-sm text-[hsl(var(--destructive))]">{form.error}</p>
	{/if}
	{#if form?.saved}
		<p class="text-sm text-emerald-700">Saved.</p>
	{/if}

	<div class="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_260px]">
		<div
			class="relative min-h-[480px] overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-white"
		>
			<div class="absolute top-2 left-2 z-10 flex gap-1">
				<Button type="button" size="sm" variant="outline" onclick={() => addNode('sendEmail')}
					>+ Email</Button
				>
				<Button type="button" size="sm" variant="outline" onclick={() => addNode('wait')}
					>+ Wait</Button
				>
				<Button type="button" size="sm" variant="outline" onclick={() => addNode('end')}
					>+ End</Button
				>
			</div>
			<SvelteFlow
				bind:nodes
				bind:edges
				nodeTypes={flowNodeTypes}
				fitView
				onconnect={onconnect}
				onnodeclick={({ node }) => {
					selectedNodeId = node.id;
				}}
				onpaneclick={() => {
					selectedNodeId = null;
				}}
				class="h-full w-full"
			>
				<Background />
				<Controls />
				<MiniMap />
			</SvelteFlow>
		</div>

		<aside
			class="overflow-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3"
		>
			<p class="mb-3 text-xs font-medium tracking-wide text-[hsl(var(--muted-foreground))] uppercase">
				Node
			</p>
			{#if selectedNode}
				<p class="mb-2 text-sm font-medium capitalize">{selectedNode.type}</p>
				{#if selectedNode.type === 'sendEmail'}
					<div class="flex flex-col gap-3">
						<div>
							<label for="subj" class="mb-1 block text-xs font-medium">Subject</label>
							<Input
								id="subj"
								value={String(selectedNode.data.subject ?? '')}
								oninput={(e) => updateSelectedData('subject', e.currentTarget.value)}
							/>
						</div>
						<div>
							<label for="from" class="mb-1 block text-xs font-medium">From</label>
							<Input
								id="from"
								value={String(selectedNode.data.from ?? '')}
								oninput={(e) => updateSelectedData('from', e.currentTarget.value)}
								placeholder="hello@yourdomain.com"
							/>
						</div>
						<div>
							<label for="tpl" class="mb-1 block text-xs font-medium">Template</label>
							<select
								id="tpl"
								class={selectClass}
								value={String(selectedNode.data.templateId ?? '')}
								onchange={(e) => updateSelectedData('templateId', e.currentTarget.value)}
							>
								<option value="">None</option>
								{#each data.templates as tpl (tpl.id)}
									<option value={tpl.id}>{tpl.name}</option>
								{/each}
							</select>
						</div>
					</div>
				{:else if selectedNode.type === 'wait'}
					<div class="flex flex-col gap-3">
						<div>
							<label for="amt" class="mb-1 block text-xs font-medium">Amount</label>
							<Input
								id="amt"
								type="number"
								min="1"
								value={String(selectedNode.data.amount ?? 1)}
								oninput={(e) => updateSelectedData('amount', Number(e.currentTarget.value) || 1)}
							/>
						</div>
						<div>
							<label for="unit" class="mb-1 block text-xs font-medium">Unit</label>
							<select
								id="unit"
								class={selectClass}
								value={String(selectedNode.data.unit ?? 'hours')}
								onchange={(e) => updateSelectedData('unit', e.currentTarget.value)}
							>
								<option value="minutes">minutes</option>
								<option value="hours">hours</option>
								<option value="days">days</option>
							</select>
						</div>
					</div>
				{:else if selectedNode.type === 'trigger'}
					<p class="text-sm text-[hsl(var(--muted-foreground))]">
						Fires when a contact is created in the selected contact book. Configure the book above.
					</p>
				{:else}
					<p class="text-sm text-[hsl(var(--muted-foreground))]">End of flow.</p>
				{/if}

				{#if selectedNode.type !== 'trigger'}
					<Button type="button" variant="outline" size="sm" class="mt-4" onclick={deleteSelected}>
						Delete node
					</Button>
				{/if}
			{:else}
				<p class="text-sm text-[hsl(var(--muted-foreground))]">Select a node on the canvas.</p>
			{/if}
		</aside>
	</div>
</div>

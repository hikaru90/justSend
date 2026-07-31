<script lang="ts">
	import { cn } from '$lib/utils';
	import { X } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	let {
		open = false,
		title,
		description,
		class: className = '',
		children,
		onClose
	}: {
		open?: boolean;
		title?: string;
		description?: string;
		class?: string;
		children?: Snippet;
		onClose?: () => void;
	} = $props();

	function requestClose() {
		onClose?.();
	}

	function onDialogClick(e: MouseEvent & { currentTarget: HTMLDialogElement }) {
		if (e.target === e.currentTarget) requestClose();
	}
</script>

{#if open}
	<dialog
		{@attach (node) => {
			node.showModal();
			return () => {
				if (node.open) node.close();
			};
		}}
		class={cn(
			'fixed inset-0 m-auto max-h-[min(90vh,900px)] w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-0 text-[hsl(var(--card-foreground))] shadow-lg open:flex open:flex-col',
			className
		)}
		onclose={requestClose}
		onclick={onDialogClick}
		aria-labelledby={title ? 'modal-title' : undefined}
		aria-describedby={description ? 'modal-description' : undefined}
	>
		{#if title || description}
			<div
				class="flex shrink-0 items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-5 py-4"
			>
				<div class="min-w-0 space-y-1">
					{#if title}
						<h2 id="modal-title" class="text-lg font-semibold leading-none tracking-tight">
							{title}
						</h2>
					{/if}
					{#if description}
						<p id="modal-description" class="text-sm text-[hsl(var(--muted-foreground))]">
							{description}
						</p>
					{/if}
				</div>
				<button
					type="button"
					class="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
					aria-label="Close"
					onclick={requestClose}
				>
					<X size={16} aria-hidden="true" />
				</button>
			</div>
		{/if}
		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
			{@render children?.()}
		</div>
	</dialog>
{/if}

<style>
	dialog::backdrop {
		background: hsl(0 0% 0% / 0.45);
	}
</style>

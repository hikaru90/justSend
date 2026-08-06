<script lang="ts">
	import { cn } from '$lib/utils';
	import { Check, ChevronsUpDown } from '@lucide/svelte';

	export type ComboboxOption = {
		value: string;
		label: string;
		/** Extra text included when filtering (e.g. hex for a named token). */
		keywords?: string;
		swatch?: string;
	};

	let {
		value = $bindable(''),
		options = [],
		placeholder = 'Select…',
		class: className = '',
		inputClass = '',
		mono = false,
		onselect,
	}: {
		value?: string;
		options?: ComboboxOption[];
		placeholder?: string;
		class?: string;
		inputClass?: string;
		mono?: boolean;
		onselect?: (value: string) => void;
	} = $props();

	let open = $state(false);
	let query = $state('');
	let highlight = $state(0);
	let root = $state<HTMLDivElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	const listId = `cb-list-${Math.random().toString(36).slice(2, 9)}`;

	const selected = $derived(options.find((o) => o.value === value));

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return options;
		return options.filter((o) => {
			const hay = `${o.label} ${o.value} ${o.keywords ?? ''}`.toLowerCase();
			return hay.includes(q);
		});
	});

	$effect(() => {
		if (!open) query = value;
	});

	function openPanel() {
		open = true;
		query = value;
		highlight = Math.max(
			0,
			filtered.findIndex((o) => o.value === value),
		);
	}

	function closePanel() {
		open = false;
		query = value;
	}

	function commit(next: string) {
		value = next;
		query = next;
		closePanel();
		onselect?.(next);
		inputEl?.blur();
	}

	function onInputFocus() {
		openPanel();
	}

	function onInputInput() {
		open = true;
		highlight = 0;
	}

	function onInputKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (!open) openPanel();
			else highlight = Math.min(highlight + 1, filtered.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (!open) openPanel();
			else highlight = Math.max(highlight - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (open && filtered[highlight]) commit(filtered[highlight].value);
			else if (query.trim()) commit(query.trim());
		} else if (e.key === 'Escape') {
			e.preventDefault();
			closePanel();
			inputEl?.blur();
		}
	}

	function onDocumentPointerDown(e: PointerEvent) {
		if (!open || !root) return;
		if (!root.contains(e.target as Node)) closePanel();
	}

	$effect(() => {
		if (!open) return;
		document.addEventListener('pointerdown', onDocumentPointerDown);
		return () => document.removeEventListener('pointerdown', onDocumentPointerDown);
	});
</script>

<div bind:this={root} class={cn('relative min-w-0', className)}>
	<div class="relative flex min-w-0 items-center">
		<input
			bind:this={inputEl}
			type="text"
			role="combobox"
			aria-expanded={open}
			aria-controls={listId}
			autocomplete="off"
			bind:value={query}
			onfocus={onInputFocus}
			oninput={onInputInput}
			onkeydown={onInputKeydown}
			onblur={() => {
				queueMicrotask(() => {
					if (open) return;
					const next = query.trim();
					if (next && next !== value) {
						value = next;
						onselect?.(next);
					}
				});
			}}
			{placeholder}
			class={cn(
				'w-full rounded border border-[hsl(var(--input))] bg-transparent py-1 pe-7 ps-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
				mono && 'font-mono',
				inputClass,
			)}
		/>
		<button
			type="button"
			tabindex="-1"
			aria-label="Toggle options"
			class="absolute inset-y-0 end-0 flex items-center px-1.5 text-[hsl(var(--muted-foreground))]"
			onmousedown={(e) => e.preventDefault()}
			onclick={() => (open ? closePanel() : (inputEl?.focus(), openPanel()))}
		>
			<ChevronsUpDown class="size-3.5 opacity-60" />
		</button>
	</div>

	{#if open}
		<ul
			id={listId}
			role="listbox"
			class="absolute z-50 mt-1 max-h-48 w-full min-w-[10rem] overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] py-1 text-[hsl(var(--popover-foreground))] shadow-md"
		>
			{#if filtered.length === 0}
				<li class="px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">No matches</li>
			{:else}
				{#each filtered as opt, i (opt.value + opt.label)}
					<li role="presentation">
						<button
							type="button"
							role="option"
							aria-selected={opt.value === value}
							class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[hsl(var(--accent))] {i ===
							highlight
								? 'bg-[hsl(var(--accent))]'
								: ''}"
							onmousedown={(e) => e.preventDefault()}
							onclick={() => commit(opt.value)}
						>
							<Check
								class="size-3.5 shrink-0 {opt.value === value
									? 'opacity-100'
									: 'opacity-0'}"
							/>
							{#if opt.swatch}
								<span
									class="size-4 shrink-0 rounded border border-[hsl(var(--border))]"
									style="background-color: {opt.swatch}"
								></span>
							{/if}
							<span class="min-w-0 truncate">
								<span class={mono ? 'font-mono' : ''}>{opt.label}</span>
								{#if opt.label.toLowerCase() !== opt.value.toLowerCase()}
									<span class="ms-1 text-[hsl(var(--muted-foreground))]">{opt.value}</span>
								{/if}
							</span>
						</button>
					</li>
				{/each}
			{/if}
		</ul>
	{/if}

	{#if !open && selected && selected.label !== value}
		<span class="sr-only">{selected.label}</span>
	{/if}
</div>

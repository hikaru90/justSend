<script lang="ts">
	import { hexForColorInput } from '$lib/design/extractTokens';
	import type { DesignColorOption } from '$lib/design/extractTokens';
	import SearchCombobox, { type ComboboxOption } from './SearchCombobox.svelte';

	let {
		value = $bindable(''),
		options = [],
		fallback = '#000000',
		onchange,
	}: {
		value?: string;
		options?: DesignColorOption[];
		fallback?: string;
		onchange?: () => void;
	} = $props();

	const pickerValue = $derived(hexForColorInput(value || fallback));

	const comboboxOptions = $derived(
		options.map((opt): ComboboxOption => ({
			value: opt.value,
			label: opt.label,
			keywords: opt.value,
			swatch: opt.value,
		})),
	);

	function pick(next: string) {
		value = next;
		onchange?.();
	}
</script>

<div class="flex min-w-0 flex-1 flex-col gap-1">
	<div class="flex min-w-0 flex-1 gap-1">
		<input
			type="color"
			value={pickerValue}
			oninput={(e) => pick(e.currentTarget.value)}
			class="h-8 w-10 shrink-0 rounded border border-[hsl(var(--input))]"
			aria-label="Pick color"
		/>
		<SearchCombobox
			bind:value
			options={comboboxOptions}
			placeholder={fallback}
			class="min-w-0 flex-1"
			mono
			onselect={() => onchange?.()}
		/>
	</div>
	{#if options.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each options as opt (opt.value + opt.label)}
				<button
					type="button"
					title="{opt.label} ({opt.value})"
					aria-label="{opt.label} ({opt.value})"
					class="size-5 rounded border {value.toLowerCase() === opt.value.toLowerCase()
						? 'border-[hsl(var(--ring))] ring-2 ring-[hsl(var(--ring))]'
						: 'border-[hsl(var(--border))]'}"
					style="background-color: {opt.value}"
					onclick={() => pick(opt.value)}
				></button>
			{/each}
		</div>
	{/if}
</div>

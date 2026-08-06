<script lang="ts">
	import SearchCombobox, { type ComboboxOption } from './SearchCombobox.svelte';

	let {
		value = $bindable(''),
		options = [],
		onchange,
	}: {
		value?: string;
		options?: readonly string[];
		onchange?: () => void;
	} = $props();

	const comboboxOptions = $derived(
		options.map(
			(opt): ComboboxOption => ({
				value: opt,
				label: opt,
			}),
		),
	);
</script>

<SearchCombobox
	bind:value
	options={comboboxOptions}
	placeholder="property"
	class="w-32 shrink-0"
	mono
	onselect={() => onchange?.()}
/>

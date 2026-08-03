<script lang="ts">
	import { renderEmailHtml } from '$lib/email-editor/renderer';

	let {
		value = $bindable(''),
		label = 'HTML content',
	}: {
		value?: string;
		label?: string;
	} = $props();

	const preview = $derived(renderEmailHtml(null, value));
</script>

<div class="grid gap-4 lg:grid-cols-2">
	<div>
		<label class="mb-2 block text-sm font-medium" for="email-editor">{label}</label>
		<textarea
			id="email-editor"
			bind:value
			rows="16"
			class="min-h-[320px] w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 font-mono text-sm focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:outline-none"
			placeholder={'<p>Hello {{firstName}}</p>'}></textarea>
	</div>
	<div>
		<p class="mb-2 text-sm font-medium">Preview</p>
		<div
			class="min-h-[320px] overflow-auto rounded-md border border-[hsl(var(--border))] bg-white p-4 text-sm text-black"
		>
			{@html preview || '<p class="text-gray-400">Preview will appear here</p>'}
		</div>
	</div>
</div>

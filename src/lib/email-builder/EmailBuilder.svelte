<script lang="ts">
	import { setContext } from 'svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { EmailEditorState as Editor } from './editor-state.svelte';
	import { EDITOR_KEY } from './context';
	import { EmailBuilderLibrary, LIBRARY_KEY } from './library-context.svelte';
	import type { DesignLibraryComponent } from './library';
	import type { TEditorConfiguration } from './types';
	import { renderEmailHtml } from './render';
	import BuilderCanvas from './BuilderCanvas.svelte';
	import InspectorPanel from './InspectorPanel.svelte';

	let {
		document: initialDocument = null,
		designComponents = [],
		designColors = [],
		previewOverrides = {},
		onSave,
		saving = false
	}: {
		document?: TEditorConfiguration | null;
		designComponents?: DesignLibraryComponent[];
		designColors?: string[];
		previewOverrides?: Record<string, string>;
		onSave?: (payload: { document: TEditorConfiguration; html: string }) => void | Promise<void>;
		saving?: boolean;
	} = $props();

	const editor = new Editor();
	setContext(EDITOR_KEY, editor);

	const library = new EmailBuilderLibrary();
	setContext(LIBRARY_KEY, library);
	$effect(() => {
		library.components = designComponents;
		library.previewOverrides = previewOverrides;
		library.colors = designColors;
	});

	let lastLoaded = $state<string | null>(null);
	$effect(() => {
		const key = initialDocument ? JSON.stringify(initialDocument) : '';
		if (key !== lastLoaded) {
			lastLoaded = key;
			editor.load(initialDocument);
		}
	});

	async function save() {
		const html = renderEmailHtml(editor.document);
		await onSave?.({ document: editor.document, html });
	}
</script>

<div class="email-builder overflow-hidden rounded-md border border-[hsl(var(--border))] bg-white text-[#111]">
	<div
		class="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2"
	>
		<div class="flex flex-wrap gap-1">
			<button
				type="button"
				class="rounded px-2 py-1 text-xs {editor.tab === 'editor'
					? 'bg-[hsl(var(--secondary))] font-medium'
					: 'hover:bg-[hsl(var(--muted))]'}"
				onclick={() => (editor.tab = 'editor')}
			>
				Editor
			</button>
			<button
				type="button"
				class="rounded px-2 py-1 text-xs {editor.tab === 'preview'
					? 'bg-[hsl(var(--secondary))] font-medium'
					: 'hover:bg-[hsl(var(--muted))]'}"
				onclick={() => (editor.tab = 'preview')}
			>
				Preview
			</button>
			<button
				type="button"
				class="rounded px-2 py-1 text-xs {editor.tab === 'html'
					? 'bg-[hsl(var(--secondary))] font-medium'
					: 'hover:bg-[hsl(var(--muted))]'}"
				onclick={() => (editor.tab = 'html')}
			>
				HTML
			</button>
			<button
				type="button"
				class="rounded px-2 py-1 text-xs {editor.tab === 'json'
					? 'bg-[hsl(var(--secondary))] font-medium'
					: 'hover:bg-[hsl(var(--muted))]'}"
				onclick={() => (editor.tab = 'json')}
			>
				JSON
			</button>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<div class="flex rounded border border-[hsl(var(--border))] text-xs">
				<button
					type="button"
					class="px-2 py-1 {editor.screen === 'desktop' ? 'bg-[hsl(var(--secondary))]' : ''}"
					onclick={() => (editor.screen = 'desktop')}
				>
					Desktop
				</button>
				<button
					type="button"
					class="px-2 py-1 {editor.screen === 'mobile' ? 'bg-[hsl(var(--secondary))]' : ''}"
					onclick={() => (editor.screen = 'mobile')}
				>
					Mobile
				</button>
			</div>
			<Button
				type="button"
				size="sm"
				variant="outline"
				onclick={() => (editor.inspectorOpen = !editor.inspectorOpen)}
			>
				{editor.inspectorOpen ? 'Hide inspector' : 'Show inspector'}
			</Button>
			{#if onSave}
				<Button type="button" size="sm" disabled={saving} onclick={() => void save()}>
					{saving ? 'Saving…' : 'Save email'}
				</Button>
			{/if}
		</div>
	</div>

	<div class="flex min-h-[640px]">
		<div class="min-w-0 flex-1 overflow-auto bg-[#f5f5f5]">
			{#if editor.tab === 'editor'}
				<div class="p-4 {editor.screen === 'mobile' ? 'mx-auto max-w-[370px]' : ''}">
					<BuilderCanvas />
				</div>
			{:else if editor.tab === 'preview'}
				<div class="p-4 {editor.screen === 'mobile' ? 'mx-auto max-w-[370px]' : ''}">
					<iframe
						title="Email preview"
						class="min-h-[600px] w-full rounded border border-[hsl(var(--border))] bg-white"
						srcdoc={renderEmailHtml(editor.document)}
					></iframe>
				</div>
			{:else if editor.tab === 'html'}
				<pre
					class="m-0 max-h-[70vh] overflow-auto p-4 font-mono text-xs whitespace-pre-wrap text-[#111]">{renderEmailHtml(editor.document)}</pre>
			{:else}
				<pre
					class="m-0 max-h-[70vh] overflow-auto p-4 font-mono text-xs whitespace-pre-wrap text-[#111]">{JSON.stringify(editor.document, null, 2)}</pre>
			{/if}
		</div>

		{#if editor.inspectorOpen && editor.tab === 'editor'}
			<aside
				class="w-80 shrink-0 overflow-auto border-l border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-[hsl(var(--foreground))]"
			>
				<InspectorPanel />
			</aside>
		{/if}
	</div>
</div>

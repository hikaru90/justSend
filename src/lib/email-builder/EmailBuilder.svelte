<script lang="ts">
	import { setContext } from 'svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { EmailEditorState as Editor } from './editor-state.svelte';
	import { EDITOR_KEY } from './context';
	import { EmailBuilderLibrary, LIBRARY_KEY } from './library-context.svelte';
	import type { DesignLibraryAsset, DesignLibraryComponent } from './library';
	import type { ComponentSlot, TEditorConfiguration } from './types';
	import { renderEmailHtml } from './render';
	import { inferEditApproach, type EditApproach } from './edit-approach';
	import { resolveBlockTheme, themeEmptyDocument } from './block-theme';
	import {
		applyPreviewColorScheme,
		substitutePreviewPlaceholders,
	} from '$lib/design/extractTokens';
	import BuilderCanvas from './BuilderCanvas.svelte';
	import InspectorPanel from './InspectorPanel.svelte';

	type AiFeedLine = {
		id: number;
		kind: 'user' | 'step' | 'thinking' | 'text' | 'tool' | 'error';
		label: string;
		detail?: string;
		pending?: boolean;
		error?: boolean;
	};

	type AiEditEvent = {
		type: string;
		message?: string;
		delta?: string;
		tool?: string;
		toolCallId?: string;
		isError?: boolean;
		document?: TEditorConfiguration;
		slots?: ComponentSlot[];
		html?: string;
		approach?: EditApproach;
	};

	let {
		document: initialDocument = null,
		designComponents = [],
		designColors = [],
		designAssets = [],
		previewOverrides = {},
		onUploadAsset = null,
		onSave,
		saving = false,
		saveLabel = 'Save',
		aiEnabled = false,
		aiName,
		aiDescription,
		aiSlots,
		aiHtml = '',
		onAiEdit,
		onAiResult,
	}: {
		document?: TEditorConfiguration | null;
		designComponents?: DesignLibraryComponent[];
		designColors?: string[];
		designAssets?: DesignLibraryAsset[];
		previewOverrides?: Record<string, string>;
		onUploadAsset?:
			((file: File) => Promise<{ id: string; name: string; kind: string } | null>) | null;
		onSave?: (payload: { document: TEditorConfiguration; html: string }) => void | Promise<void>;
		saving?: boolean;
		saveLabel?: string;
		aiEnabled?: boolean;
		aiName?: string;
		aiDescription?: string | null;
		aiSlots?: ComponentSlot[];
		/** Stored component html (legacy / last render) for approach inference + HTML edits. */
		aiHtml?: string;
		onAiEdit?: (args: {
			instruction: string;
			document: TEditorConfiguration;
			slots: ComponentSlot[];
			mode: 'create' | 'edit' | 'validate';
			approach: EditApproach;
			html?: string;
			signal: AbortSignal;
			onEvent: (event: AiEditEvent) => void;
		}) => Promise<{
			document: TEditorConfiguration;
			slots: ComponentSlot[];
			html?: string;
			approach?: EditApproach;
		} | null>;
		onAiResult?: (result: {
			document: TEditorConfiguration;
			slots: ComponentSlot[];
			html?: string;
			approach?: EditApproach;
		}) => void;
	} = $props();

	const editor = new Editor();
	setContext(EDITOR_KEY, editor);

	const library = new EmailBuilderLibrary();
	setContext(LIBRARY_KEY, library);
	$effect(() => {
		library.components = designComponents;
		library.previewOverrides = previewOverrides;
		library.colors = designColors;
		library.assets = designAssets;
		library.onUploadAsset = onUploadAsset;
		const theme = resolveBlockTheme(designColors);
		editor.theme = theme;
		editor.document = themeEmptyDocument(editor.document, theme);
	});

	let aiInstruction = $state('');
	let aiMode = $state<'create' | 'edit' | 'validate'>('create');
	let aiApproachOverride = $state<EditApproach | null>(null);
	let aiEditing = $state(false);
	let aiStatus = $state('');
	let aiError = $state<string | null>(null);
	let aiAbort = $state<AbortController | null>(null);
	let aiFeed = $state<AiFeedLine[]>([]);
	let aiFeedId = 0;

	let lastLoaded = $state<string | null>(null);
	$effect(() => {
		const key = initialDocument ? JSON.stringify(initialDocument) : '';
		if (key !== lastLoaded) {
			lastLoaded = key;
			editor.load(initialDocument);
			const empty = (editor.document.root?.data?.childrenIds?.length ?? 0) === 0;
			aiMode = empty ? 'create' : 'edit';
			aiApproachOverride = null;
		}
	});

	const inferredApproach = $derived(
		inferEditApproach({
			instruction: aiInstruction,
			document: editor.document,
			html: aiHtml,
		}),
	);
	const aiApproach = $derived(aiApproachOverride ?? inferredApproach);

	function appendAiFeed(line: Omit<AiFeedLine, 'id'>): number {
		const id = ++aiFeedId;
		aiFeed = [...aiFeed, { ...line, id }];
		return id;
	}

	function patchAiFeed(id: number, patch: Partial<AiFeedLine>) {
		aiFeed = aiFeed.map((line) => (line.id === id ? { ...line, ...patch } : line));
	}

	function appendAiDelta(kind: 'thinking' | 'text', delta: string) {
		const last = aiFeed[aiFeed.length - 1];
		if (last && last.kind === kind) {
			patchAiFeed(last.id, { label: last.label + delta });
			return;
		}
		appendAiFeed({ kind, label: delta });
	}

	function handleAiEvent(event: AiEditEvent, openTools: Record<string, number>) {
		switch (event.type) {
			case 'step':
			case 'status':
				if (event.message) {
					aiStatus = event.message;
					appendAiFeed({ kind: 'step', label: event.message });
				}
				break;
			case 'thinking':
				if (event.delta) {
					aiStatus = 'Thinking…';
					appendAiDelta('thinking', event.delta);
				}
				break;
			case 'text':
				if (event.delta) {
					aiStatus = 'Responding…';
					appendAiDelta('text', event.delta);
				}
				break;
			case 'tool_start': {
				const name = event.tool ?? 'tool';
				aiStatus = `Using ${name}…`;
				const id = appendAiFeed({
					kind: 'tool',
					label: name,
					detail: event.message,
					pending: true,
				});
				const key = event.toolCallId ?? name;
				openTools[key] = id;
				break;
			}
			case 'tool_end': {
				const name = event.tool ?? 'tool';
				const key = event.toolCallId ?? name;
				const id = openTools[key];
				if (id != null) {
					patchAiFeed(id, {
						pending: false,
						error: event.isError,
						detail: event.isError ? 'error' : 'done',
					});
					delete openTools[key];
				}
				break;
			}
			case 'error':
				aiError = event.message ?? 'Generation failed';
				aiStatus = '';
				if (event.message) {
					appendAiFeed({ kind: 'error', label: event.message });
				}
				break;
			case 'cancelled':
				aiStatus = event.message ?? 'Cancelled.';
				break;
		}
	}

	function stopAiEdit() {
		aiAbort?.abort();
		aiStatus = 'Stopping…';
	}

	async function generate() {
		if (aiEditing || !onAiEdit) return;
		const instruction = aiInstruction.trim();
		if (!instruction) return;

		aiError = null;
		aiEditing = true;
		aiStatus = 'Starting…';
		appendAiFeed({ kind: 'user', label: instruction });

		const controller = new AbortController();
		aiAbort = controller;
		const openTools: Record<string, number> = {};

		try {
			const result = await onAiEdit({
				instruction,
				document: editor.document,
				slots: aiSlots ?? [],
				mode: aiMode,
				approach: aiApproach,
				html: aiHtml,
				signal: controller.signal,
				onEvent: (event) => handleAiEvent(event, openTools),
			});

			if (result) {
				editor.load(result.document);
				onAiResult?.(result);
				aiInstruction = '';
				aiApproachOverride = null;
				aiStatus = 'Done.';
				editor.tab = 'editor';
			}
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') {
				aiStatus = 'Cancelled.';
			} else {
				aiError = e instanceof Error ? e.message : 'Generation failed';
				aiStatus = '';
			}
		} finally {
			aiEditing = false;
			aiAbort = null;
		}
	}

	async function save() {
		const html = renderEmailHtml(editor.document);
		await onSave?.({ document: editor.document, html });
	}

	const previewHtml = $derived(
		applyPreviewColorScheme(
			substitutePreviewPlaceholders(renderEmailHtml(editor.document), previewOverrides),
			editor.colorScheme,
		),
	);
</script>

<div
	class="email-builder w-full max-w-full overflow-hidden rounded-md border border-[hsl(var(--border))] bg-white text-[#111]"
>
	<div
		class="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-2 sm:px-3"
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
			{#if aiEnabled}
				<button
					type="button"
					class="rounded px-2 py-1 text-xs {editor.tab === 'ai'
						? 'bg-[hsl(var(--secondary))] font-medium'
						: 'hover:bg-[hsl(var(--muted))]'}"
					onclick={() => (editor.tab = 'ai')}
				>
					AI assistant
				</button>
			{/if}
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if editor.tab !== 'ai'}
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
				{#if editor.tab === 'preview' || editor.tab === 'editor'}
					<div
						class="flex rounded border border-[hsl(var(--border))] text-xs"
						role="group"
						aria-label="Color scheme"
					>
						<button
							type="button"
							class="px-2 py-1 {editor.colorScheme === 'light' ? 'bg-[hsl(var(--secondary))]' : ''}"
							onclick={() => (editor.colorScheme = 'light')}
						>
							Light
						</button>
						<button
							type="button"
							class="px-2 py-1 {editor.colorScheme === 'dark' ? 'bg-[hsl(var(--secondary))]' : ''}"
							onclick={() => (editor.colorScheme = 'dark')}
						>
							Dark
						</button>
					</div>
				{/if}
				<Button
					type="button"
					size="sm"
					variant="outline"
					onclick={() => (editor.inspectorOpen = !editor.inspectorOpen)}
				>
					{editor.inspectorOpen ? 'Hide inspector' : 'Show inspector'}
				</Button>
			{/if}
			{#if onSave}
				<Button type="button" size="sm" disabled={saving} onclick={() => void save()}>
					{saving ? 'Saving…' : saveLabel}
				</Button>
			{/if}
		</div>
	</div>

	<div class="flex min-h-[420px] flex-col sm:min-h-[640px] lg:flex-row">
		<div
			class="min-w-0 flex-1 overflow-x-hidden overflow-y-auto {(editor.tab === 'preview' ||
				editor.tab === 'editor') &&
			editor.colorScheme === 'dark'
				? 'bg-[#0a0a0a]'
				: 'bg-[#f5f5f5]'}"
		>
			{#if editor.tab === 'editor'}
				<div
					class="box-border p-2 sm:p-4 {editor.screen === 'mobile'
						? 'mx-auto w-full max-w-[min(100%,370px)]'
						: 'w-full'}"
				>
					<BuilderCanvas />
				</div>
			{:else if editor.tab === 'preview'}
				<div
					class="box-border p-2 sm:p-4 {editor.screen === 'mobile'
						? 'mx-auto w-full max-w-[min(100%,370px)]'
						: 'w-full'}"
				>
					<iframe
						title="Email preview"
						class="block min-h-[480px] w-full max-w-full rounded border border-[hsl(var(--border))] sm:min-h-[600px] {editor.colorScheme ===
						'dark'
							? 'bg-[#111]'
							: 'bg-white'}"
						sandbox="allow-same-origin"
						srcdoc={previewHtml}
					></iframe>
				</div>
			{:else if editor.tab === 'html'}
				<pre
					class="m-0 max-h-[70vh] overflow-auto p-3 font-mono text-xs break-all whitespace-pre-wrap text-[#111] sm:p-4 sm:break-normal">{renderEmailHtml(
						editor.document,
					)}</pre>
			{:else if editor.tab === 'json'}
				<pre
					class="m-0 max-h-[70vh] overflow-auto p-3 font-mono text-xs break-all whitespace-pre-wrap text-[#111] sm:p-4 sm:break-normal">{JSON.stringify(
						editor.document,
						null,
						2,
					)}</pre>
			{:else if editor.tab === 'ai'}
				<div
					class="flex h-full min-h-[420px] flex-col bg-[hsl(var(--card))] p-3 sm:min-h-[640px] sm:p-4"
				>
					<p class="mb-3 text-sm text-[hsl(var(--muted-foreground))]">
						Create, edit, or validate using the full design system (brand tokens, assets, and peer
						components). Basic blocks pick up brand colors automatically; AI can restyle or rebuild
						them.
						{#if aiName}
							<span class="mt-1 block text-xs opacity-80">{aiName}</span>
						{/if}
						{#if aiDescription}
							<span class="mt-0.5 block text-xs opacity-80">{aiDescription}</span>
						{/if}
					</p>

					<div class="mb-2 flex flex-wrap gap-1" role="group" aria-label="AI mode">
						{#each ['create', 'edit', 'validate'] as modeOption (modeOption)}
							<button
								type="button"
								disabled={aiEditing}
								class="rounded px-2 py-1 text-xs capitalize {aiMode === modeOption
									? 'bg-[hsl(var(--secondary))] font-medium'
									: 'hover:bg-[hsl(var(--muted))]'} disabled:opacity-50"
								onclick={() => {
									aiMode = modeOption as 'create' | 'edit' | 'validate';
								}}
							>
								{modeOption}
							</button>
						{/each}
					</div>

					<div class="mb-3 flex flex-wrap items-center gap-2">
						<div class="flex flex-wrap gap-1" role="group" aria-label="AI approach">
							{#each [{ id: 'blocks', label: 'Blocks' }, { id: 'html', label: 'HTML' }] as option (option.id)}
								<button
									type="button"
									disabled={aiEditing}
									class="rounded px-2 py-1 text-xs {aiApproach === option.id
										? 'bg-[hsl(var(--secondary))] font-medium'
										: 'hover:bg-[hsl(var(--muted))]'} disabled:opacity-50"
									onclick={() => {
										aiApproachOverride = option.id as EditApproach;
									}}
								>
									{option.label}
								</button>
							{/each}
						</div>
						<p class="text-xs text-[hsl(var(--muted-foreground))]">
							{#if aiApproach === 'html'}
								Raw HTML — custom markup, dark/light CTAs, media queries.
							{:else}
								Blocks — Heading, Text, Button, Image, slots.
							{/if}
							{#if aiApproachOverride == null}
								<span class="opacity-70"> (auto)</span>
							{/if}
						</p>
					</div>

					<div
						class="mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)]"
					>
						<div
							{@attach (node) => {
								void aiFeed;
								requestAnimationFrame(() => {
									node.scrollTop = node.scrollHeight;
								});
							}}
							class="min-h-48 flex-1 space-y-1.5 overflow-y-auto px-3 py-2 font-mono text-xs"
							aria-live="polite"
						>
							{#if aiFeed.length === 0 && !aiEditing}
								<p class="text-[hsl(var(--muted-foreground))]">No messages yet.</p>
							{/if}
							{#if aiFeed.length === 0 && aiEditing}
								<p class="text-[hsl(var(--muted-foreground))]">
									{aiStatus || 'Starting…'}
								</p>
							{/if}
							{#each aiFeed as line (line.id)}
								{#if line.kind === 'user'}
									<p class="font-sans whitespace-pre-wrap text-[hsl(var(--foreground))]">
										<span class="opacity-70">you </span>{line.label}
									</p>
								{:else if line.kind === 'step'}
									<p class="text-[hsl(var(--muted-foreground))]">{line.label}</p>
								{:else if line.kind === 'thinking'}
									<p class="whitespace-pre-wrap text-[hsl(var(--muted-foreground))] italic">
										<span class="not-italic opacity-70">thinking </span>{line.label}
									</p>
								{:else if line.kind === 'text'}
									<p class="whitespace-pre-wrap text-[hsl(var(--foreground))]">
										{line.label}
									</p>
								{:else if line.kind === 'error'}
									<p class="text-[hsl(var(--destructive))]">{line.label}</p>
								{:else}
									<p
										class={line.error
											? 'text-[hsl(var(--destructive))]'
											: 'text-[hsl(var(--foreground))]'}
									>
										<span class="opacity-70">{line.pending ? 'tool…' : 'tool'}</span>
										<span> {line.label}</span>
										{#if line.detail}
											<span class="text-[hsl(var(--muted-foreground))]"> — {line.detail}</span>
										{/if}
									</p>
								{/if}
							{/each}
						</div>
						{#if aiEditing || aiStatus || aiError}
							<div
								class="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))] px-3 py-2"
							>
								{#if aiError}
									<p class="text-xs text-[hsl(var(--destructive))]">{aiError}</p>
								{:else if aiStatus}
									<p class="text-xs text-[hsl(var(--muted-foreground))]">{aiStatus}</p>
								{/if}
							</div>
						{/if}
					</div>

					<form
						class="space-y-2"
						onsubmit={(e) => {
							e.preventDefault();
							void generate();
						}}
					>
						<textarea
							bind:value={aiInstruction}
							disabled={aiEditing}
							placeholder={aiApproach === 'html'
								? aiMode === 'validate'
									? 'e.g. Check dark/light markup and asset URLs'
									: 'e.g. Dark/light CTA button with prefers-color-scheme'
								: aiMode === 'validate'
									? 'e.g. Check logos, spacing, and slots against the design system'
									: aiMode === 'edit'
										? 'e.g. Use the dark logo variant in the header'
										: 'e.g. Hero with logo, headline, and primary CTA'}
							rows="3"
							class="w-full resize-y rounded-md border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:ring-1 focus:ring-[hsl(var(--ring))] focus:outline-none disabled:opacity-50"
						></textarea>
						<div class="flex flex-wrap items-center gap-2">
							{#if aiEditing}
								<Button type="button" size="sm" variant="outline" onclick={stopAiEdit}>Stop</Button>
							{:else}
								<Button type="submit" size="sm" disabled={!aiInstruction.trim() || !onAiEdit}>
									{aiMode === 'validate' ? 'Validate' : aiMode === 'edit' ? 'Apply edit' : 'Generate'}
								</Button>
							{/if}
						</div>
					</form>
				</div>
			{/if}
		</div>

		{#if editor.inspectorOpen && editor.tab === 'editor'}
			<aside
				class="flex w-full shrink-0 flex-col overflow-hidden border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-[hsl(var(--foreground))] lg:w-80 lg:border-t-0 lg:border-l"
			>
				<div class="flex max-h-[50vh] min-h-0 flex-1 flex-col overflow-auto lg:max-h-none">
					<InspectorPanel />
				</div>
			</aside>
		{/if}
	</div>
</div>

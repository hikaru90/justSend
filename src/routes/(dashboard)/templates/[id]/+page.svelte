<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import PiEditField from '$lib/components/PiEditField.svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import DOMPurify from 'isomorphic-dompurify';
	import {
		applyPreviewColorScheme,
		pickEmailLogos,
		substitutePreviewPlaceholders
	} from '$lib/design/extractTokens';
	import {
		elementValueVariables,
		type TemplateElementType
	} from '$lib/template-element-config';

	type VisualAsset = {
		id: string;
		name: string;
		filename: string;
		kind: 'logo' | 'image';
	};

	type ElementRow = {
		id: string;
		type: TemplateElementType;
		label: string;
		required: boolean;
		parsedConfig: { text?: string; url?: string; assetId?: string };
	};

	let { data, form } = $props();
	let generating = $state(false);
	let generateStatus = $state('');
	let generateElapsedSec = $state(0);
	let generateError = $state<string | null>(null);
	let generateDone = $state(false);
	let generateAbort = $state<AbortController | null>(null);
	let generateStartedAt = $state<number | null>(null);
	let sending = $state(false);
	let piEditing = $state(false);
	let piInstruction = $state('');
	let piStatus = $state('');
	let piError = $state<string | null>(null);
	let piDone = $state(false);
	let piAbort = $state<AbortController | null>(null);
	type PiFeedLine = {
		id: number;
		kind: 'step' | 'thinking' | 'text' | 'tool';
		label: string;
		detail?: string;
		pending?: boolean;
		error?: boolean;
	};
	let piFeed = $state<PiFeedLine[]>([]);
	let piFeedId = 0;
	let previewScheme = $state<'light' | 'dark'>('light');
	let previewViewport = $state<'mobile' | 'tablet' | 'desktop'>('desktop');
	let prompt = $derived(data.template.prompt ?? '');
	let previewTo = $derived(data.userEmail ?? '');

	type ComponentRow = {
		id: string;
		name: string;
		kind: 'root' | 'component';
		source: string;
		order: number;
	};

	let addType = $state<TemplateElementType>('cta');
	let addAssetId = $state('');
	let editingId = $state<string | null>(null);
	let editAssetIds = $state<Record<string, string>>({});
	let selectedComponentId = $state<string | null>(null);
	/** Local edits keyed by component id; fall back to server source when unset. */
	let sourceOverrides = $state<Record<string, string>>({});
	let showComponentCode = $state(false);

	const components = $derived((data.components ?? []) as ComponentRow[]);
	const activeComponentId = $derived(
		selectedComponentId ??
			components.find((c) => c.kind === 'root')?.id ??
			components[0]?.id ??
			null
	);
	const activeComponent = $derived(
		components.find((c) => c.id === activeComponentId) ?? null
	);
	const activeSource = $derived(
		activeComponent
			? (sourceOverrides[activeComponent.id] ?? activeComponent.source)
			: ''
	);

	const generateElapsedLabel = $derived.by(() => {
		const m = Math.floor(generateElapsedSec / 60);
		const s = generateElapsedSec % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	});

	$effect(() => {
		if (!generating || generateStartedAt == null) return;
		const tick = () => {
			generateElapsedSec = Math.floor((Date.now() - (generateStartedAt ?? Date.now())) / 1000);
		};
		tick();
		const id = setInterval(tick, 250);
		return () => clearInterval(id);
	});

	function stopGeneration() {
		generateAbort?.abort();
		generateStatus = 'Stopping…';
	}

	function stopPiEdit() {
		piAbort?.abort();
		piStatus = 'Stopping…';
	}

	function appendPiFeed(line: Omit<PiFeedLine, 'id'>): number {
		const id = ++piFeedId;
		piFeed = [...piFeed, { ...line, id }];
		return id;
	}

	function patchPiFeed(id: number, patch: Partial<PiFeedLine>) {
		piFeed = piFeed.map((line) => (line.id === id ? { ...line, ...patch } : line));
	}

	function appendPiDelta(kind: 'thinking' | 'text', delta: string) {
		const last = piFeed[piFeed.length - 1];
		if (last && last.kind === kind) {
			patchPiFeed(last.id, { label: last.label + delta });
			return;
		}
		appendPiFeed({ kind, label: delta });
	}

	async function startPiEdit() {
		if (piEditing) return;
		const instruction = piInstruction.trim();
		if (!instruction) return;

		piError = null;
		piDone = false;
		piEditing = true;
		piStatus = 'Starting Pi…';
		piFeed = [];
		piFeedId = 0;

		const controller = new AbortController();
		piAbort = controller;

		/** Tracks open tool_start lines by tool name (last open wins). */
		const openTools: Record<string, number> = {};

		try {
			const res = await fetch(resolve(`/templates/${data.template.id}/pi-edit`), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({
					componentId: activeComponentId,
					source: activeSource,
					instruction
				}),
				signal: controller.signal
			});

			if (!res.ok || !res.body) {
				const text = await res.text().catch(() => '');
				throw new Error(text || `Pi edit request failed (${res.status})`);
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const chunks = buffer.split('\n\n');
				buffer = chunks.pop() ?? '';

				for (const chunk of chunks) {
					const line = chunk
						.split('\n')
						.map((l) => l.trim())
						.find((l) => l.startsWith('data:'));
					if (!line) continue;
					let event: {
						type?: string;
						message?: string;
						delta?: string;
						toolName?: string;
						detail?: string;
						isError?: boolean;
						html?: string;
					};
					try {
						event = JSON.parse(line.slice(5).trim()) as typeof event;
					} catch {
						continue;
					}

					switch (event.type) {
						case 'step':
							if (event.message) {
								piStatus = event.message;
								appendPiFeed({ kind: 'step', label: event.message });
							}
							break;
						case 'thinking':
							if (event.delta) {
								piStatus = 'Thinking…';
								appendPiDelta('thinking', event.delta);
							}
							break;
						case 'text':
							if (event.delta) {
								piStatus = 'Responding…';
								appendPiDelta('text', event.delta);
							}
							break;
						case 'tool_start': {
							const name = event.toolName ?? 'tool';
							piStatus = `Running ${name}…`;
							const id = appendPiFeed({
								kind: 'tool',
								label: name,
								detail: event.detail,
								pending: true
							});
							openTools[name] = id;
							break;
						}
						case 'tool_end': {
							const name = event.toolName ?? 'tool';
							const id = openTools[name];
							delete openTools[name];
							if (id != null) {
								patchPiFeed(id, {
									pending: false,
									error: Boolean(event.isError),
									detail: event.detail ?? piFeed.find((l) => l.id === id)?.detail
								});
							} else {
								appendPiFeed({
									kind: 'tool',
									label: name,
									detail: event.detail,
									pending: false,
									error: Boolean(event.isError)
								});
							}
							piStatus = event.isError ? `${name} failed` : `${name} done`;
							break;
						}
						case 'error':
							piError = event.message ?? 'Pi edit failed';
							piStatus = '';
							break;
						case 'cancelled':
							piStatus = event.message ?? 'Edit cancelled.';
							break;
						case 'done':
							piDone = true;
							piStatus = event.message ?? 'Edit complete.';
							piInstruction = '';
							break;
					}
				}
			}

			if (piDone) {
				sourceOverrides = {};
				await invalidateAll();
			}
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') {
				piStatus = 'Edit cancelled.';
			} else {
				piError = e instanceof Error ? e.message : 'Pi edit failed';
				piStatus = '';
			}
		} finally {
			piEditing = false;
			piAbort = null;
		}
	}

	async function startGeneration() {
		if (generating) return;
		generateError = null;
		generateDone = false;
		generating = true;
		generateStatus = 'Starting generation…';
		generateElapsedSec = 0;
		generateStartedAt = Date.now();

		const controller = new AbortController();
		generateAbort = controller;

		try {
			const res = await fetch(resolve(`/templates/${data.template.id}/generate`), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({ prompt }),
				signal: controller.signal
			});

			if (!res.ok || !res.body) {
				const text = await res.text().catch(() => '');
				throw new Error(text || `Generation request failed (${res.status})`);
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const chunks = buffer.split('\n\n');
				buffer = chunks.pop() ?? '';

				for (const chunk of chunks) {
					const line = chunk
						.split('\n')
						.map((l) => l.trim())
						.find((l) => l.startsWith('data:'));
					if (!line) continue;
					let event: {
						stage?: string;
						message?: string;
						chars?: number;
					};
					try {
						event = JSON.parse(line.slice(5).trim()) as typeof event;
					} catch {
						continue;
					}

					if (event.message) generateStatus = event.message;
					if (event.stage === 'error') {
						generateError = event.message ?? 'Generation failed';
					}
					if (event.stage === 'cancelled') {
						generateStatus = event.message ?? 'Generation stopped.';
					}
					if (event.stage === 'done') {
						generateDone = true;
						generateStatus = event.message ?? 'Generation complete.';
					}
				}
			}

			if (generateDone) {
				sourceOverrides = {};
				await invalidateAll();
			}
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') {
				generateStatus = 'Generation stopped.';
			} else {
				generateError = e instanceof Error ? e.message : 'Generation failed';
				generateStatus = '';
			}
		} finally {
			if (generateStartedAt != null) {
				generateElapsedSec = Math.floor((Date.now() - generateStartedAt) / 1000);
			}
			generating = false;
			generateAbort = null;
			generateStartedAt = null;
		}
	}

	const previewMaxWidth = $derived(
		previewViewport === 'mobile' ? '375px' : previewViewport === 'tablet' ? '768px' : '100%'
	);

	const libraryAssets = $derived.by((): VisualAsset[] => {
		if (addType === 'logo') return data.logoAssets;
		if (addType === 'image') return [...data.imageAssets, ...data.logoAssets];
		return [];
	});

	const elementOverrides = $derived.by(() => {
		const overrides: Record<string, string> = {};
		for (const el of data.elements as ElementRow[]) {
			Object.assign(
				overrides,
				elementValueVariables(
					{ type: el.type, label: el.label, config: JSON.stringify(el.parsedConfig) },
					{
						assetUrlById: Object.fromEntries(
							(data.visualAssets as VisualAsset[]).map((a) => [
								a.id,
								resolve(`/api/design-asset/${a.id}`)
							])
						)
					}
				)
			);
		}
		return overrides;
	});

	const sanitizeOpts = {
		ADD_TAGS: ['style'],
		ADD_ATTR: [
			'target',
			'style',
			'class',
			'id',
			'bgcolor',
			'align',
			'valign',
			'width',
			'height',
			'cellpadding',
			'cellspacing',
			'border'
		]
	};

	const previewHtml = $derived.by(() => {
		// Component-backed templates: SSR HTML from the server (props already applied).
		if (data.componentBacked && data.renderedPreviewHtml) {
			return DOMPurify.sanitize(
				applyPreviewColorScheme(data.renderedPreviewHtml, previewScheme),
				sanitizeOpts
			);
		}

		// Legacy HTML-string templates: substitute {{placeholders}}.
		if (!data.template.html) return '';
		const pair = pickEmailLogos(data.logoAssets);
		const lightUrl = pair ? resolve(`/api/design-asset/${pair.light.id}`) : undefined;
		const darkUrl = pair ? resolve(`/api/design-asset/${pair.dark.id}`) : undefined;
		const overrides: Record<string, string> = { ...elementOverrides };
		if (lightUrl && darkUrl) {
			if (!overrides.logo) {
				overrides.logo = lightUrl;
				overrides.logo_url = lightUrl;
			}
			overrides.logo_light = lightUrl;
			overrides.logo_dark = darkUrl;
			overrides.logo_dark_url = darkUrl;
		}
		const substituted = substitutePreviewPlaceholders(data.template.html, overrides);
		return DOMPurify.sanitize(applyPreviewColorScheme(substituted, previewScheme), sanitizeOpts);
	});

	const hasPreview = $derived(
		Boolean(data.componentBacked ? data.renderedPreviewHtml : data.template.html)
	);

	function assetsForType(type: TemplateElementType): VisualAsset[] {
		if (type === 'logo') return data.logoAssets;
		if (type === 'image') return [...data.imageAssets, ...data.logoAssets];
		return [];
	}

	function valueSummary(el: ElementRow): string {
		const cfg = el.parsedConfig;
		if (el.type === 'logo' || el.type === 'image') {
			if (!cfg.assetId) return 'no image';
			const asset = data.visualAssets.find((a: VisualAsset) => a.id === cfg.assetId);
			return asset ? asset.name : 'image selected';
		}
		if (el.type === 'text') return cfg.text ? `"${cfg.text}"` : 'no text';
		const parts: string[] = [];
		if (cfg.text) parts.push(`"${cfg.text}"`);
		if (cfg.url) parts.push(cfg.url);
		return parts.length ? parts.join(' → ') : 'no text/url';
	}
</script>

<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
	<div>
		<a
			href={resolve('/templates')}
			class="text-sm text-[hsl(var(--muted-foreground))] hover:underline">← Templates</a
		>
		<h1 class="mt-1 text-2xl font-semibold">{data.template.name}</h1>
		<p class="text-sm text-[hsl(var(--muted-foreground))]">
			Generate from your
			<a href={resolve('/design-system')} class="underline">design system</a>
			+ required elements
		</p>
	</div>
	<form method="POST" action="?/delete" use:enhance>
		<Button type="submit" variant="destructive" size="sm">Delete template</Button>
	</form>
</div>

{#if form?.error}
	<p class="mb-4 text-sm text-[hsl(var(--destructive))]">{form.error}</p>
{/if}
{#if form?.success && form.saved === 'generate'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Template generated with AI.</p>
{/if}
{#if form?.success && form.saved === 'component'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Component source saved.</p>
{/if}
{#if form?.success && form.saved === 'preview'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Preview queued (email id: {form.emailId}).
	</p>
{/if}
{#if form?.success && form.saved === 'element'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Element saved — preview updated.</p>
{/if}
{#if form?.success && form.saved === 'library'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Saved “{form.libraryName}” to your
		<a href={resolve('/design-system')} class="underline">design library</a>
		— future generations can reuse it.
	</p>
{/if}

{#if !data.designReady}
	<Card title="Design system missing" class="mb-6">
		<p class="mb-3 text-sm text-[hsl(var(--muted-foreground))]">
			AI generation works best with a team design system (design.md, components, assets).
		</p>
		<Button href={resolve('/design-system')} size="sm">Open design system</Button>
	</Card>
{:else}
	<p class="mb-6 text-xs text-[hsl(var(--muted-foreground))]">
		Using design system
		{#if data.designSummary.hasMd}· design.md{/if}
		{#if data.designSummary.componentCount > 0}
			· {data.designSummary.componentCount} component{data.designSummary.componentCount === 1
				? ''
				: 's'}
		{/if}
		{#if data.designSummary.assetCount > 0}
			· {data.designSummary.assetCount} asset{data.designSummary.assetCount === 1 ? '' : 's'}
		{/if}
	</p>
{/if}

<div class="grid gap-6 xl:grid-cols-2">
	<div class="space-y-6">
		<Card title="1. Template details">
			<form method="POST" action="?/updateMeta" use:enhance class="space-y-3">
				<Input name="name" value={data.template.name} required />
				<Input name="subject" value={data.template.subject} required />
				<Button type="submit" size="sm">Save details</Button>
			</form>
		</Card>

		<Card
			title="2. Required elements"
			description="Fixed pieces the AI must include — each type can carry a concrete value (image, copy, or link)."
		>
			<form
				method="POST"
				action="?/addElement"
				enctype="multipart/form-data"
				use:enhance={() => {
					return async ({ update, result }) => {
						await update();
						if (result.type === 'success') {
							addAssetId = '';
						}
					};
				}}
				class="mb-4 space-y-3 rounded-md border border-[hsl(var(--border))] p-3"
			>
				<div class="flex flex-wrap items-end gap-3">
					<div class="min-w-35 flex-1 space-y-1">
						<label class="text-xs text-[hsl(var(--muted-foreground))]" for="el-label">Label</label>
						<Input id="el-label" name="label" placeholder="Primary CTA" required />
					</div>
					<div class="space-y-1">
						<label class="text-xs text-[hsl(var(--muted-foreground))]" for="el-type">Type</label>
						<select
							id="el-type"
							name="type"
							bind:value={addType}
							onchange={() => {
								addAssetId = '';
							}}
							class="flex h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
						>
							<option value="logo">Logo</option>
							<option value="text">Text</option>
							<option value="button">Button</option>
							<option value="cta">CTA</option>
							<option value="link">Link</option>
							<option value="image">Image</option>
						</select>
					</div>
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" name="required" checked class="rounded border" />
						Required
					</label>
				</div>

				{#if addType === 'text'}
					<div class="space-y-1">
						<label class="text-xs text-[hsl(var(--muted-foreground))]" for="el-text">Text</label>
						<Input id="el-text" name="text" placeholder="Welcome to Acme" />
					</div>
				{:else if addType === 'button' || addType === 'cta' || addType === 'link'}
					<div class="grid gap-3 sm:grid-cols-2">
						<div class="space-y-1">
							<label class="text-xs text-[hsl(var(--muted-foreground))]" for="el-btn-text"
								>Button / link text</label
							>
							<Input id="el-btn-text" name="text" placeholder="Shop now" />
						</div>
						<div class="space-y-1">
							<label class="text-xs text-[hsl(var(--muted-foreground))]" for="el-btn-url"
								>URL</label
							>
							<Input
								id="el-btn-url"
								name="url"
								type="url"
								placeholder="https://example.com"
							/>
						</div>
					</div>
				{:else if addType === 'logo' || addType === 'image'}
					<input type="hidden" name="assetId" value={addAssetId} />
					<div class="space-y-2">
						<p class="text-xs text-[hsl(var(--muted-foreground))]">
							Select from the design library or upload a new {addType}.
						</p>
						{#if libraryAssets.length > 0}
							<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
								{#each libraryAssets as asset (asset.id)}
									<button
										type="button"
										class="rounded-md border p-2 text-left transition-colors {addAssetId ===
										asset.id
											? 'border-[hsl(var(--ring))] bg-[hsl(var(--muted))]/50'
											: 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30'}"
										onclick={() => (addAssetId = asset.id)}
									>
										<img
											src={resolve(`/api/design-asset/${asset.id}`)}
											alt=""
											class="mb-1 h-12 w-full object-contain"
										/>
										<p class="truncate text-xs font-medium">{asset.name}</p>
									</button>
								{/each}
							</div>
						{:else}
							<p class="text-xs text-[hsl(var(--muted-foreground))]">
								No {addType} assets in the library yet.
							</p>
						{/if}
						<div class="grid gap-3 sm:grid-cols-2">
							<div class="space-y-1">
								<label class="text-xs text-[hsl(var(--muted-foreground))]" for="el-asset-name"
									>Upload name</label
								>
								<Input
									id="el-asset-name"
									name="assetName"
									placeholder={addType === 'logo' ? 'Primary logo' : 'Hero image'}
								/>
							</div>
							<div class="space-y-1">
								<label class="text-xs text-[hsl(var(--muted-foreground))]" for="el-file"
									>Or upload file</label
								>
								<input
									id="el-file"
									name="file"
									type="file"
									accept="image/*"
									class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[hsl(var(--secondary))] file:px-3 file:py-1.5 file:text-sm"
								/>
							</div>
						</div>
					</div>
				{/if}

				<Button type="submit">Add</Button>
			</form>

			{#if data.elements.length === 0}
				<p class="text-sm text-[hsl(var(--muted-foreground))]">
					Add at least a logo and CTA so the AI knows what must appear.
				</p>
			{:else}
				<ul class="divide-y divide-[hsl(var(--border))]">
					{#each data.elements as element (element.id)}
						{@const el = element as ElementRow}
						<li class="space-y-3 py-3">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="text-sm font-medium">{el.label}</p>
									<p class="text-xs text-[hsl(var(--muted-foreground))]">
										{el.type}{el.required ? ' · required' : ' · optional'} · {valueSummary(el)}
									</p>
									{#if (el.type === 'logo' || el.type === 'image') && el.parsedConfig.assetId}
										<img
											src={resolve(`/api/design-asset/${el.parsedConfig.assetId}`)}
											alt=""
											class="mt-2 h-10 w-auto max-w-32 object-contain"
										/>
									{/if}
								</div>
								<div class="flex shrink-0 gap-2">
									<Button
										type="button"
										size="sm"
										variant="outline"
										onclick={() => {
											if (editingId === el.id) {
												editingId = null;
												return;
											}
											editingId = el.id;
											if (el.parsedConfig.assetId) {
												editAssetIds[el.id] = el.parsedConfig.assetId;
											}
										}}
									>
										{editingId === el.id ? 'Close' : 'Edit'}
									</Button>
									<form method="POST" action="?/deleteElement" use:enhance>
										<input type="hidden" name="id" value={el.id} />
										<Button type="submit" size="sm" variant="destructive">Remove</Button>
									</form>
								</div>
							</div>

							{#if editingId === el.id}
								<form
									method="POST"
									action="?/updateElement"
									enctype="multipart/form-data"
									use:enhance={() => {
										return async ({ update, result }) => {
											await update();
											if (result.type === 'success') editingId = null;
										};
									}}
									class="space-y-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-3"
								>
									<input type="hidden" name="id" value={el.id} />
									<div class="flex flex-wrap items-end gap-3">
										<div class="min-w-35 flex-1 space-y-1">
											<label
												class="text-xs text-[hsl(var(--muted-foreground))]"
												for="edit-label-{el.id}">Label</label
											>
											<Input
												id="edit-label-{el.id}"
												name="label"
												value={el.label}
												required
											/>
										</div>
										<label class="flex items-center gap-2 text-sm">
											<input
												type="checkbox"
												name="required"
												checked={el.required}
												class="rounded border"
											/>
											Required
										</label>
									</div>

									{#if el.type === 'text'}
										<div class="space-y-1">
											<label
												class="text-xs text-[hsl(var(--muted-foreground))]"
												for="edit-text-{el.id}">Text</label
											>
											<Input
												id="edit-text-{el.id}"
												name="text"
												value={el.parsedConfig.text ?? ''}
											/>
										</div>
									{:else if el.type === 'button' || el.type === 'cta' || el.type === 'link'}
										<div class="grid gap-3 sm:grid-cols-2">
											<div class="space-y-1">
												<label
													class="text-xs text-[hsl(var(--muted-foreground))]"
													for="edit-btn-text-{el.id}">Button / link text</label
												>
												<Input
													id="edit-btn-text-{el.id}"
													name="text"
													value={el.parsedConfig.text ?? ''}
												/>
											</div>
											<div class="space-y-1">
												<label
													class="text-xs text-[hsl(var(--muted-foreground))]"
													for="edit-btn-url-{el.id}">URL</label
												>
												<Input
													id="edit-btn-url-{el.id}"
													name="url"
													type="url"
													value={el.parsedConfig.url ?? ''}
												/>
											</div>
										</div>
									{:else if el.type === 'logo' || el.type === 'image'}
										{@const editAssets = assetsForType(el.type)}
										{@const selectedAssetId =
											editAssetIds[el.id] ?? el.parsedConfig.assetId ?? ''}
										<input type="hidden" name="assetId" value={selectedAssetId} />
										{#if editAssets.length > 0}
											<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
												{#each editAssets as asset (asset.id)}
													<button
														type="button"
														class="rounded-md border p-2 text-left transition-colors {selectedAssetId ===
														asset.id
															? 'border-[hsl(var(--ring))] bg-[hsl(var(--muted))]/50'
															: 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30'}"
														onclick={() => {
															editAssetIds[el.id] = asset.id;
														}}
													>
														<img
															src={resolve(`/api/design-asset/${asset.id}`)}
															alt=""
															class="mb-1 h-12 w-full object-contain"
														/>
														<p class="truncate text-xs font-medium">{asset.name}</p>
													</button>
												{/each}
											</div>
										{/if}
										<div class="grid gap-3 sm:grid-cols-2">
											<div class="space-y-1">
												<label
													class="text-xs text-[hsl(var(--muted-foreground))]"
													for="edit-asset-name-{el.id}">Upload name</label
												>
												<Input
													id="edit-asset-name-{el.id}"
													name="assetName"
													placeholder={el.type === 'logo' ? 'Primary logo' : 'Hero image'}
												/>
											</div>
											<div class="space-y-1">
												<label
													class="text-xs text-[hsl(var(--muted-foreground))]"
													for="edit-file-{el.id}">Or upload file</label
												>
												<input
													id="edit-file-{el.id}"
													name="file"
													type="file"
													accept="image/*"
													class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[hsl(var(--secondary))] file:px-3 file:py-1.5 file:text-sm"
												/>
											</div>
										</div>
									{/if}

									<Button type="submit" size="sm">Save values</Button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<Card
			title="3. Generate with AI"
			description="OpenRouter uses your design system + elements to produce the email HTML"
		>
			<div class="space-y-3">
				<textarea
					name="prompt"
					rows="6"
					bind:value={prompt}
					disabled={generating}
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-50"
					placeholder="Describe the email: tone, sections, offer, audience…"
				></textarea>
				<div class="flex flex-wrap items-center gap-2">
					<Button type="button" disabled={generating} onclick={startGeneration}>
						{data.template.html ? 'Regenerate HTML' : 'Generate HTML'}
					</Button>
					{#if generating}
						<Button type="button" variant="outline" onclick={stopGeneration}>Stop</Button>
					{/if}
				</div>
				{#if generating || generateStatus || generateError || generateDone}
					<div
						class="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 text-sm"
						aria-live="polite"
					>
						{#if generating}
							<p class="font-medium">Generating… {generateElapsedLabel}</p>
						{:else if generateDone && !generateError}
							<p class="font-medium">Done · took {generateElapsedLabel}</p>
						{:else if generateError}
							<p class="font-medium text-[hsl(var(--destructive))]">Failed</p>
						{/if}
						{#if generateStatus}
							<p class="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{generateStatus}</p>
						{/if}
						{#if generateError}
							<p class="mt-1 text-xs text-[hsl(var(--destructive))]">{generateError}</p>
						{/if}
					</div>
				{/if}
				<p class="text-xs text-[hsl(var(--muted-foreground))]">
					Requires OPENROUTER_API_KEY. Generates a Svelte component tree bound to your required
					elements. You can stop mid-run.
				</p>
			</div>
		</Card>

		<Card
			title="4. Edit with AI"
			description="Describe changes — Pi updates the selected Svelte component"
		>
			<div class="space-y-4">
				<form
					class="space-y-3"
					onsubmit={(e) => {
						e.preventDefault();
						void startPiEdit();
					}}
				>
					{#if components.length > 0}
						<div class="flex flex-wrap gap-1">
							{#each components as c (c.id)}
								<Button
									type="button"
									size="sm"
									variant={activeComponentId === c.id ? 'default' : 'outline'}
									onclick={() => (selectedComponentId = c.id)}
								>
									{c.name}{c.kind === 'root' ? ' (root)' : ''}
								</Button>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-[hsl(var(--muted-foreground))]">
							Generate the template first to create components you can edit.
						</p>
					{/if}
					<PiEditField
						bind:value={piInstruction}
						busy={piEditing}
						disabled={!data.piConfigured || piEditing || !activeComponentId}
						placeholder="e.g. Make the CTA green and add more padding in the header"
						hint={data.piConfigured
							? activeComponent
								? `Pi edits ${activeComponent.name}.svelte. Thinking and tool calls stream below.`
								: 'Generate components first, then edit with Pi.'
							: 'Set OPENROUTER_API_KEY to enable AI edits.'}
					/>
					{#if piEditing}
						<div class="flex items-center gap-2">
							<Button type="button" size="sm" variant="outline" onclick={stopPiEdit}>
								Stop
							</Button>
							{#if piStatus}
								<p class="text-xs text-[hsl(var(--muted-foreground))]">{piStatus}</p>
							{/if}
						</div>
					{:else if piStatus}
						<p class="text-xs text-[hsl(var(--muted-foreground))]">{piStatus}</p>
					{/if}
					{#if piFeed.length > 0}
						<div
							class="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)] px-3 py-2 font-mono text-xs"
							aria-live="polite"
						>
							{#each piFeed as line (line.id)}
								{#if line.kind === 'step'}
									<p class="text-[hsl(var(--muted-foreground))]">{line.label}</p>
								{:else if line.kind === 'thinking'}
									<p class="whitespace-pre-wrap text-[hsl(var(--muted-foreground))] italic">
										<span class="not-italic opacity-70">thinking </span>{line.label}
									</p>
								{:else if line.kind === 'text'}
									<p class="whitespace-pre-wrap text-[hsl(var(--foreground))]">{line.label}</p>
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
					{/if}
					{#if piError}
						<p class="text-xs text-[hsl(var(--destructive))]">{piError}</p>
					{/if}
				</form>

				{#if activeComponent}
					<div class="space-y-3 border-t border-[hsl(var(--border))] pt-4">
						<Button
							type="button"
							size="sm"
							variant="outline"
							onclick={() => (showComponentCode = !showComponentCode)}
						>
							{showComponentCode ? 'Hide code' : 'Show code'}
						</Button>
						{#if showComponentCode}
							<form
								method="POST"
								action="?/updateComponent"
								use:enhance={() => {
									return async ({ result, update }) => {
										await update();
										if (result.type === 'success' && activeComponent) {
											const { [activeComponent.id]: _, ...rest } = sourceOverrides;
											sourceOverrides = rest;
										}
									};
								}}
								class="space-y-3"
							>
								<input type="hidden" name="componentId" value={activeComponent.id} />
								<textarea
									name="source"
									rows="14"
									value={activeSource}
									oninput={(e) => {
										sourceOverrides = {
											...sourceOverrides,
											[activeComponent.id]: (e.currentTarget as HTMLTextAreaElement).value
										};
									}}
									class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
									placeholder="Svelte component source…"
								></textarea>
								<div class="flex flex-wrap items-center gap-2">
									<Button type="submit" size="sm"
										>Save {activeComponent.name}.svelte</Button
									>
									<Button
										type="submit"
										size="sm"
										variant="outline"
										formaction="?/saveToLibrary"
									>
										Save to library
									</Button>
									<a
										href={resolve(`/templates/${data.template.id}/export?download=1`)}
										class="text-xs underline text-[hsl(var(--muted-foreground))]"
									>
										Export rendered HTML
									</a>
								</div>
								<p class="text-xs text-[hsl(var(--muted-foreground))]">
									Library saves add this component to your team
									<a href={resolve('/design-system')} class="underline">design system</a>
									so the next email generation can reuse it.
								</p>
							</form>
						{/if}
					</div>
				{/if}
			</div>
		</Card>
	</div>

	<div class="space-y-6">
		{#if data.legacyHtmlOnly}
			<div
				class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100"
			>
				This template still uses legacy HTML. Regenerate to switch to Svelte components so editing
				required elements updates the preview automatically.
			</div>
		{/if}

		<Card
			title="Preview"
			description={data.componentBacked
				? 'SSR-rendered from Svelte components + element props'
				: 'Generated HTML from the design system'}
		>
			{#if data.renderError}
				<p class="mb-2 text-sm text-[hsl(var(--destructive))]">{data.renderError}</p>
			{/if}
			{#if hasPreview}
				<div class="mb-3 flex flex-wrap items-center gap-2">
					<div class="flex gap-1">
						<Button
							type="button"
							size="sm"
							variant={previewScheme === 'light' ? 'default' : 'outline'}
							onclick={() => (previewScheme = 'light')}
						>
							Light
						</Button>
						<Button
							type="button"
							size="sm"
							variant={previewScheme === 'dark' ? 'default' : 'outline'}
							onclick={() => (previewScheme = 'dark')}
						>
							Dark
						</Button>
					</div>
					<div class="flex gap-1">
						<Button
							type="button"
							size="sm"
							variant={previewViewport === 'mobile' ? 'default' : 'outline'}
							onclick={() => (previewViewport = 'mobile')}
						>
							Mobile
						</Button>
						<Button
							type="button"
							size="sm"
							variant={previewViewport === 'tablet' ? 'default' : 'outline'}
							onclick={() => (previewViewport = 'tablet')}
						>
							Tablet
						</Button>
						<Button
							type="button"
							size="sm"
							variant={previewViewport === 'desktop' ? 'default' : 'outline'}
							onclick={() => (previewViewport = 'desktop')}
						>
							Desktop
						</Button>
					</div>
					{#if data.componentBacked}
						<a
							href={resolve(`/templates/${data.template.id}/export?download=1`)}
							class="ml-auto text-xs underline text-[hsl(var(--muted-foreground))]"
						>
							Download HTML
						</a>
					{/if}
				</div>
				<div class="overflow-x-auto">
					<div
						class="mx-auto min-h-[420px] overflow-auto rounded-md border border-[hsl(var(--border))] p-4 transition-[width] {previewScheme ===
						'dark'
							? 'bg-neutral-950 text-white'
							: 'bg-white text-black'}"
						style="width: 100%; max-width: {previewMaxWidth};"
					>
						{@html previewHtml}
					</div>
				</div>
			{:else}
				<p class="text-sm text-[hsl(var(--muted-foreground))]">
					No preview yet. Add required elements, write a prompt, and generate.
				</p>
			{/if}
		</Card>

		<Card title="Send preview" description="Deliver the current template to an inbox">
			<form
				method="POST"
				action="?/sendPreview"
				use:enhance={() => {
					sending = true;
					return async ({ update }) => {
						await update();
						sending = false;
					};
				}}
				class="space-y-3"
			>
				{#if data.previewFrom}
					<p class="text-xs text-[hsl(var(--muted-foreground))]">
						From <span class="font-mono">{data.previewFrom}</span>
						{#if !data.domainVerified}· <span class="text-[hsl(var(--destructive))]">domain not verified</span>{/if}
					</p>
				{:else}
					<p class="text-xs text-[hsl(var(--muted-foreground))]">
						Select a verified domain in the sidebar to enable preview sending.
					</p>
				{/if}
				<Input
					name="to"
					type="email"
					bind:value={previewTo}
					placeholder="you@example.com"
					required
				/>
				<Button type="submit" size="sm" disabled={sending || !data.previewFrom}>
					{sending ? 'Sending…' : 'Send preview'}
				</Button>
			</form>
		</Card>
	</div>
</div>

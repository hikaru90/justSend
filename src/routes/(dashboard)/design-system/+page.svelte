<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import CodeBlock from '$lib/components/CodeBlock.svelte';
	import EmailBuilder from '$lib/email-builder/EmailBuilder.svelte';
	import { cloneDocument, renderEmailHtml } from '$lib/email-builder/render';
	import {
		EMPTY_DOCUMENT,
		type ComponentSlot,
		type TEditorConfiguration,
	} from '$lib/email-builder/types';
	import { copyablePre } from '$lib/actions/copyablePre';
	import { Check, Copy } from '@lucide/svelte';
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import {
		addHexColor,
		extractDesignTokens,
		hexForColorInput,
		pickEmailLogos,
		removeHexColor,
		replaceHexColor,
		renderSvelteComponentPreview,
		substitutePreviewPlaceholders,
	} from '$lib/design/extractTokens';

	let { data, form } = $props();

	let newName = $state('');
	let newDescription = $state('');
	let newSlots = $state<ComponentSlot[]>([]);
	let newBuilderKey = $state(0);
	let savingNewComponent = $state(false);
	let newSaveError = $state<string | null>(null);

	let editComponentId = $state<string | null>(null);
	let editName = $state('');
	let editDescription = $state('');
	let editDocument = $state<TEditorConfiguration>(cloneDocument(EMPTY_DOCUMENT));
	let editSlots = $state<ComponentSlot[]>([]);
	let editBuilderKey = $state(0);
	let savingEditComponent = $state(false);
	let editSaveError = $state<string | null>(null);
	let editAssetId = $state<string | null>(null);
	let editAssetName = $state('');
	let inferring = $state(false);
	let inferUrl = $state('');
	let inferStatus = $state('');
	let inferStream = $state('');
	let inferError = $state<string | null>(null);
	let inferAbort = $state<AbortController | null>(null);
	let reapplyingId = $state<string | null>(null);
	let reapplyStatus = $state('');
	let reapplyStream = $state('');
	let reapplyError = $state<string | null>(null);
	let reapplyAbort = $state<AbortController | null>(null);
	let componentView = $state<Record<string, 'preview' | 'code'>>({});
	let mdCopied = $state(false);
	let mdCopyTimeout: ReturnType<typeof setTimeout> | undefined;
	let newColorHex = $state('#3366ff');

	let designMdDraft = $derived(data.designMd);

	const tokens = $derived(extractDesignTokens(designMdDraft));
	const designColors = $derived(tokens.colors.map(hexForColorInput));
	const designComponents = $derived(
		data.components.map((c) => ({
			id: c.id,
			name: c.name,
			kind: c.kind,
			role: c.role,
			description: c.description,
			starterKey: c.starterKey,
			html: c.html,
			document: c.document ?? '',
			props: (c.parsedSlots ?? []).map((s) => s.name),
			parsedSlots: c.parsedSlots ?? [],
		})),
	);
	const renderedMd = $derived(
		DOMPurify.sanitize(
			marked.parse(designMdDraft || '_No design.md yet._', { async: false }) as string,
		),
	);

	const fontAssets = $derived(data.assets.filter((a) => a.kind === 'font'));
	const logoAssets = $derived(data.assets.filter((a) => a.kind === 'logo'));
	const imageAssets = $derived(data.assets.filter((a) => a.kind === 'image'));

	function assetUrl(assetId: string): string {
		return resolve(`/api/design-asset/${assetId}`);
	}

	const previewPropOverrides = $derived.by((): Record<string, string> => {
		const overrides: Record<string, string> = {};
		const pair = pickEmailLogos(logoAssets);
		if (pair) {
			const light = assetUrl(pair.light.id);
			const dark = assetUrl(pair.dark.id);
			overrides.logo = light;
			overrides.logo_url = light;
			overrides.logo_light = light;
			overrides.logo_dark = dark;
			overrides.logo_dark_url = dark;
		}
		const heroImage = imageAssets[0] ?? logoAssets[0];
		if (heroImage) {
			const url = assetUrl(heroImage.id);
			overrides.image = url;
			overrides.image_url = url;
		}
		return overrides;
	});

	const fontFaceCss = $derived.by(() => {
		return fontAssets
			.map((asset) => {
				const url = assetUrl(asset.id);
				const format = asset.mime.includes('woff2')
					? 'woff2'
					: asset.mime.includes('woff')
						? 'woff'
						: asset.mime.includes('ttf')
							? 'truetype'
							: asset.mime.includes('otf')
								? 'opentype'
								: 'woff2';
				const family = asset.name.replace(/['"]/g, '');
				return `@font-face{font-family:'${family}';src:url('${url}') format('${format}');font-display:swap;}`;
			})
			.join('\n');
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
			'border',
		],
	};

	const primaryColor = $derived(tokens.colors[0] ?? 'hsl(var(--primary))');
	const primaryFont = $derived(tokens.fontFamilies[0] ?? 'system-ui, sans-serif');

	async function copyDesignMd() {
		try {
			await navigator.clipboard.writeText(designMdDraft);
			mdCopied = true;
			clearTimeout(mdCopyTimeout);
			mdCopyTimeout = setTimeout(() => {
				mdCopied = false;
				mdCopyTimeout = undefined;
			}, 2000);
		} catch {
			// clipboard unavailable or denied
		}
	}

	function updateColor(from: string, to: string) {
		const next = to.trim();
		if (!/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(next)) return;
		if (hexForColorInput(from) === hexForColorInput(next)) return;
		designMdDraft = replaceHexColor(designMdDraft, from, next);
	}

	function addColor() {
		const hex = newColorHex.trim().startsWith('#') ? newColorHex.trim() : `#${newColorHex.trim()}`;
		if (!/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(hex)) return;
		designMdDraft = addHexColor(designMdDraft, hexForColorInput(hex));
	}

	function removeColor(hex: string) {
		designMdDraft = removeHexColor(designMdDraft, hex);
	}

	function parseComponentDocumentField(component: {
		document?: string | null;
	}): TEditorConfiguration {
		const raw = component.document?.trim();
		if (!raw) return cloneDocument(EMPTY_DOCUMENT);
		try {
			const parsed = JSON.parse(raw) as TEditorConfiguration;
			if (parsed?.root?.type === 'EmailLayout') return parsed;
		} catch {
			/* fall through */
		}
		return cloneDocument(EMPTY_DOCUMENT);
	}

	function hasComponentDocument(component: { document?: string | null }): boolean {
		const raw = component.document?.trim();
		if (!raw) return false;
		try {
			const parsed = JSON.parse(raw) as TEditorConfiguration;
			return parsed?.root?.type === 'EmailLayout';
		} catch {
			return false;
		}
	}

	function componentCode(component: { document?: string | null; html: string }): string {
		if (hasComponentDocument(component)) {
			return renderEmailHtml(parseComponentDocumentField(component));
		}
		return component.html;
	}

	function addSlot(target: 'new' | 'edit') {
		const slot: ComponentSlot = { name: '', blockId: '', prop: 'props.text', type: 'text' };
		if (target === 'new') newSlots = [...newSlots, slot];
		else editSlots = [...editSlots, slot];
	}

	function removeSlot(target: 'new' | 'edit', index: number) {
		if (target === 'new') newSlots = newSlots.filter((_, i) => i !== index);
		else editSlots = editSlots.filter((_, i) => i !== index);
	}

	async function saveComponentFetch(input: {
		id?: string;
		name: string;
		description: string;
		document: TEditorConfiguration;
		slots: ComponentSlot[];
	}): Promise<void> {
		const body = new FormData();
		if (input.id) body.append('id', input.id);
		body.append('name', input.name.trim());
		body.append('description', input.description.trim());
		body.append('document', JSON.stringify(input.document));
		body.append('slots', JSON.stringify(input.slots.filter((s) => s.name.trim())));
		const res = await fetch('?/saveComponent', {
			method: 'POST',
			body,
			headers: {
				accept: 'application/json',
				'x-sveltekit-action': 'true',
			},
		});
		if (!res.ok) {
			const err = await res.json().catch(() => null);
			const message =
				err && typeof err === 'object' && 'error' in err && typeof err.error === 'string'
					? err.error
					: 'Save failed';
			throw new Error(message);
		}
		await invalidateAll();
	}

	async function uploadBuilderAsset(
		file: File,
	): Promise<{ id: string; name: string; kind: string } | null> {
		const body = new FormData();
		body.append('file', file);
		body.append('name', file.name || 'image');
		body.append('kind', 'image');
		const res = await fetch('?/uploadAsset', {
			method: 'POST',
			body,
			headers: {
				accept: 'application/json',
				'x-sveltekit-action': 'true',
			},
		});
		if (!res.ok) return null;
		const result = deserialize(await res.text());
		if (result.type !== 'success' || !result.data || typeof result.data !== 'object') return null;
		const asset = (result.data as { asset?: { id: string; name: string; kind: string } }).asset;
		if (asset?.id) await invalidateAll();
		return asset ?? null;
	}

	const builderDesignAssets = $derived(
		[...logoAssets, ...imageAssets].map((a) => ({
			id: a.id,
			name: a.name,
			kind: a.kind,
		})),
	);

	async function saveNewComponent(payload: { document: TEditorConfiguration; html: string }) {
		if (!newName.trim()) {
			newSaveError = 'Component name is required';
			return;
		}
		newSaveError = null;
		savingNewComponent = true;
		try {
			await saveComponentFetch({
				name: newName,
				description: newDescription,
				document: payload.document,
				slots: newSlots,
			});
			newName = '';
			newDescription = '';
			newSlots = [];
			newBuilderKey += 1;
		} catch (e) {
			newSaveError = e instanceof Error ? e.message : 'Save failed';
		} finally {
			savingNewComponent = false;
		}
	}

	async function saveEditComponent(payload: { document: TEditorConfiguration; html: string }) {
		if (!editComponentId || !editName.trim()) {
			editSaveError = 'Component name is required';
			return;
		}
		editSaveError = null;
		savingEditComponent = true;
		try {
			await saveComponentFetch({
				id: editComponentId,
				name: editName,
				description: editDescription,
				document: payload.document,
				slots: editSlots,
			});
			cancelEdit();
		} catch (e) {
			editSaveError = e instanceof Error ? e.message : 'Save failed';
		} finally {
			savingEditComponent = false;
		}
	}

	function startEdit(component: {
		id: string;
		name: string;
		description: string | null;
		document?: string | null;
		parsedSlots?: ComponentSlot[];
	}) {
		editSaveError = null;
		editComponentId = component.id;
		editName = component.name;
		editDescription = component.description ?? '';
		editDocument = parseComponentDocumentField(component);
		editSlots = [...(component.parsedSlots ?? [])];
		editBuilderKey += 1;
	}

	function cancelEdit() {
		editComponentId = null;
		editName = '';
		editDescription = '';
		editDocument = cloneDocument(EMPTY_DOCUMENT);
		editSlots = [];
		editSaveError = null;
	}

	function startEditAsset(asset: { id: string; name: string }) {
		editAssetId = asset.id;
		editAssetName = asset.name;
	}

	function cancelEditAsset() {
		editAssetId = null;
		editAssetName = '';
	}

	type StreamEvent = {
		stage?: string;
		message?: string;
		delta?: string;
		chars?: number;
		model?: string;
	};

	async function readOpenRouterSse(
		res: Response,
		onEvent: (event: StreamEvent) => void,
	): Promise<void> {
		if (!res.ok || !res.body) {
			const text = await res.text().catch(() => '');
			throw new Error(text || `Request failed (${res.status})`);
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
				try {
					onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
				} catch {
					// ignore malformed SSE
				}
			}
		}
	}

	async function startInfer() {
		if (inferring) return;
		const url = inferUrl.trim();
		if (!url) return;

		inferError = null;
		inferStream = '';
		inferStatus = 'Starting…';
		inferring = true;
		const controller = new AbortController();
		inferAbort = controller;

		try {
			const res = await fetch(resolve('/design-system/infer'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({ url }),
				signal: controller.signal,
			});
			await readOpenRouterSse(res, (event) => {
				if (event.stage === 'delta' && event.delta) {
					inferStream += event.delta;
					inferStatus = `Receiving… (${(event.chars ?? inferStream.length).toLocaleString()} chars)`;
				} else if (event.stage === 'error') {
					inferError = event.message ?? 'Inference failed';
					inferStatus = inferError;
				} else if (event.stage === 'cancelled') {
					inferStatus = event.message ?? 'Stopped';
				} else if (event.message) {
					inferStatus = event.message;
				}
			});
			if (!inferError) await invalidateAll();
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') {
				inferStatus = 'Stopped';
			} else {
				inferError = e instanceof Error ? e.message : 'Inference failed';
				inferStatus = inferError;
			}
		} finally {
			inferring = false;
			inferAbort = null;
		}
	}

	function stopInfer() {
		inferAbort?.abort();
		inferStatus = 'Stopping…';
	}

	async function startReapply(componentId: string) {
		if (reapplyingId) return;
		reapplyError = null;
		reapplyStream = '';
		reapplyStatus = 'Starting…';
		reapplyingId = componentId;
		const controller = new AbortController();
		reapplyAbort = controller;

		try {
			const res = await fetch(resolve('/design-system/reapply'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({ id: componentId }),
				signal: controller.signal,
			});
			await readOpenRouterSse(res, (event) => {
				if (event.stage === 'delta' && event.delta) {
					reapplyStream += event.delta;
					reapplyStatus = `Receiving… (${(event.chars ?? reapplyStream.length).toLocaleString()} chars)`;
				} else if (event.stage === 'error') {
					reapplyError = event.message ?? 'Reapply failed';
					reapplyStatus = reapplyError;
				} else if (event.stage === 'cancelled') {
					reapplyStatus = event.message ?? 'Stopped';
				} else if (event.message) {
					reapplyStatus = event.message;
				}
			});
			if (!reapplyError) await invalidateAll();
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') {
				reapplyStatus = 'Stopped';
			} else {
				reapplyError = e instanceof Error ? e.message : 'Reapply failed';
				reapplyStatus = reapplyError;
			}
		} finally {
			reapplyingId = null;
			reapplyAbort = null;
		}
	}

	function stopReapply() {
		reapplyAbort?.abort();
		reapplyStatus = 'Stopping…';
	}

	async function runComponentAiEdit(args: {
		instruction: string;
		document: TEditorConfiguration;
		slots: ComponentSlot[];
		mode: 'create' | 'edit' | 'validate';
		name?: string;
		description?: string | null;
		signal: AbortSignal;
		onEvent: (event: {
			type: string;
			message?: string;
			delta?: string;
			tool?: string;
			toolCallId?: string;
			isError?: boolean;
			document?: TEditorConfiguration;
			slots?: ComponentSlot[];
		}) => void;
	}): Promise<{ document: TEditorConfiguration; slots: ComponentSlot[] } | null> {
		const res = await fetch(resolve('/design-system/pi-edit'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
			body: JSON.stringify({
				instruction: args.instruction,
				document: args.document,
				slots: args.slots,
				mode: args.mode,
				name: args.name,
				description: args.description,
			}),
			signal: args.signal,
		});

		if (!res.ok || !res.body) {
			const text = await res.text().catch(() => '');
			throw new Error(text || `Pi edit request failed (${res.status})`);
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let result: { document: TEditorConfiguration; slots: ComponentSlot[] } | null = null;

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
					tool?: string;
					toolCallId?: string;
					detail?: string;
					isError?: boolean;
					document?: TEditorConfiguration;
					slots?: ComponentSlot[];
				};
				try {
					event = JSON.parse(line.slice(5).trim()) as typeof event;
				} catch {
					continue;
				}

				const type = event.type ?? '';
				if (type === 'done') {
					if (event.document?.root?.type === 'EmailLayout') {
						result = {
							document: cloneDocument(event.document),
							slots: Array.isArray(event.slots) ? event.slots : args.slots,
						};
					}
					args.onEvent({
						type: 'done',
						message: event.message,
						document: result?.document,
						slots: result?.slots,
					});
					continue;
				}

				args.onEvent({
					type,
					message: event.message ?? event.detail,
					delta: event.delta,
					tool: event.tool ?? event.toolName,
					toolCallId: event.toolCallId,
					isError: event.isError,
					document: event.document,
					slots: event.slots,
				});
			}
		}

		return result;
	}

	function looksLikeSvelte(code: string): boolean {
		return /\$props\s*\(/.test(code) || /<\/?script\b/i.test(code);
	}

	function getView(id: string): 'preview' | 'code' {
		return componentView[id] ?? 'preview';
	}

	function setView(id: string, view: 'preview' | 'code') {
		componentView = { ...componentView, [id]: view };
	}

	function previewHtml(html: string): string {
		const body = looksLikeSvelte(html)
			? renderSvelteComponentPreview(html, previewPropOverrides)
			: substitutePreviewPlaceholders(html, previewPropOverrides);
		return DOMPurify.sanitize(body, sanitizeOpts);
	}

	function contrastText(hex: string): string {
		const h = hex.replace('#', '');
		const full =
			h.length === 3
				? h
						.split('')
						.map((c) => c + c)
						.join('')
				: h;
		if (full.length !== 6) return '#fff';
		const r = parseInt(full.slice(0, 2), 16);
		const g = parseInt(full.slice(2, 4), 16);
		const b = parseInt(full.slice(4, 6), 16);
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return luminance > 0.55 ? '#111' : '#fff';
	}

	function formatComponentProps(props: unknown): string | null {
		if (!props) return null;
		if (typeof props === 'string') return props;
		try {
			return JSON.stringify(props, null, 2);
		} catch {
			return null;
		}
	}

	$effect(() => {
		if (!browser) return;
		const el = document.createElement('style');
		el.setAttribute('data-owlery-design-fonts', '');
		el.textContent = fontFaceCss;
		document.head.appendChild(el);
		return () => el.remove();
	});
</script>

<h1 class="mb-2 text-2xl font-semibold">Design System</h1>
<p class="mb-6 text-sm text-[hsl(var(--muted-foreground))]">
	Team-wide baseline for AI-generated email templates: design.md, fonts, assets, and reusable
	components you add yourself.
</p>

{#if form?.error}
	<p class="mb-4 text-sm text-[hsl(var(--destructive))]">{form.error}</p>
{/if}
{#if form?.success && form.saved === 'infer'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Inferred design.md from URL
		{#if form.assetsDownloaded}
			· downloaded {form.assetsDownloaded} asset{form.assetsDownloaded === 1 ? '' : 's'}
		{/if}
		. Components were not changed.
	</p>
{:else if form?.success && form.saved === 'reapply'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Reapplied design system to component.
	</p>
{:else if form?.success && form.saved === 'component'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Component saved.</p>
{:else if form?.success}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Saved.</p>
{/if}

<Card
	title="Infer from URL"
	description="Fetch a public site and ask AI to draft design.md (and download logo/fonts). Does not touch components."
	class="mb-6"
>
	<div class="flex flex-wrap items-end gap-3">
		<div class="min-w-50 flex-1 space-y-1">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="infer-url">Website URL</label>
			<Input
				id="infer-url"
				name="url"
				type="url"
				placeholder="https://example.com"
				bind:value={inferUrl}
				disabled={inferring}
				required
			/>
		</div>
		{#if inferring}
			<Button type="button" variant="outline" onclick={stopInfer}>Stop</Button>
		{:else}
			<Button type="button" disabled={!inferUrl.trim()} onclick={() => void startInfer()}>
				Infer design system
			</Button>
		{/if}
	</div>

	{#if inferring || inferStatus}
		<p class="mt-3 text-xs text-[hsl(var(--muted-foreground))]" aria-live="polite">{inferStatus}</p>
	{/if}
	{#if inferError}
		<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{inferError}</p>
	{/if}
	{#if inferStream || inferring}
		<pre
			class="mt-3 max-h-64 overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 font-mono text-xs whitespace-pre-wrap text-[hsl(var(--foreground))]"
			aria-live="polite">{inferStream || 'Waiting for model…'}</pre>
	{/if}

	<p class="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
		Requires OPENROUTER_API_KEY. Streams the model response live. Overwrites design.md only — never
		creates or changes components. Attempts to download the logo and web fonts from the site.
	</p>
</Card>

{#if logoAssets.length > 0 || fontAssets.length > 0}
	<div
		class="design-preview mb-6 flex flex-wrap items-center gap-4 rounded-md border border-[hsl(var(--border))] p-4"
	>
		{#each logoAssets as logo (logo.id)}
			<img
				src={resolve(`/api/design-asset/${logo.id}`)}
				alt={logo.name}
				class="h-12 max-w-40 object-contain"
			/>
		{/each}
		{#if fontAssets.length > 0}
			<p class="text-sm text-[hsl(var(--muted-foreground))]">
				Fonts: {fontAssets.map((f) => f.name).join(', ')}
			</p>
		{/if}
	</div>
{/if}

<Card
	title="design.md"
	description="Edit colors below or the markdown directly — brand tokens, typography, spacing, and guidelines"
	class="mb-6"
>
	<div class="design-preview grid gap-4 lg:grid-cols-2">
		<form method="POST" action="?/saveMd" use:enhance class="space-y-3">
			<div class="relative">
				<textarea
					name="designMd"
					rows="16"
					bind:value={designMdDraft}
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 pr-10 font-mono text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:outline-none"
					placeholder="# Brand — colors, typography, spacing, tone"></textarea>
				<button
					type="button"
					class="absolute top-1.5 right-1.5 z-10 rounded p-1 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
					aria-label={mdCopied ? 'Copied' : 'Copy design.md'}
					onclick={copyDesignMd}
				>
					{#if mdCopied}
						<Check size={14} aria-hidden="true" />
					{:else}
						<Copy size={14} aria-hidden="true" />
					{/if}
				</button>
			</div>
			<Button type="submit">Save design.md</Button>
		</form>

		<div class="space-y-4">
			<div>
				<p
					class="mb-2 text-xs font-medium tracking-wide text-[hsl(var(--muted-foreground))] uppercase"
				>
					Colors
				</p>
				<p class="mb-2 text-xs text-[hsl(var(--muted-foreground))]">
					Edit swatches to update hex values in design.md. Save design.md to persist.
				</p>
				<div class="flex flex-wrap gap-2">
					{#each tokens.colors as color (color)}
						<div
							class="group relative flex w-28 flex-col overflow-hidden rounded-md border border-[hsl(var(--border))]"
						>
							<label
								class="relative flex h-12 cursor-pointer items-center justify-center"
								style:background={color}
								style:color={contrastText(color)}
							>
								<span class="pointer-events-none font-mono text-[10px] opacity-90">{color}</span>
								<input
									type="color"
									class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
									value={hexForColorInput(color)}
									aria-label={`Edit color ${color}`}
									onchange={(e) => updateColor(color, e.currentTarget.value)}
								/>
							</label>
							<div
								class="flex items-center gap-1 border-t border-[hsl(var(--border))] bg-[hsl(var(--background))] p-1"
							>
								<input
									type="text"
									value={color}
									spellcheck="false"
									aria-label={`Hex for ${color}`}
									class="min-w-0 flex-1 rounded border-0 bg-transparent px-1 py-0.5 font-mono text-[11px] focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:outline-none"
									onchange={(e) => updateColor(color, e.currentTarget.value)}
									onblur={(e) => updateColor(color, e.currentTarget.value)}
								/>
								<button
									type="button"
									class="rounded px-1 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--destructive))]"
									aria-label={`Remove ${color}`}
									onclick={() => removeColor(color)}
								>
									×
								</button>
							</div>
						</div>
					{/each}
				</div>
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<input
						type="color"
						bind:value={newColorHex}
						aria-label="New color"
						class="h-9 w-10 cursor-pointer rounded border border-[hsl(var(--border))] bg-transparent p-0.5"
					/>
					<input
						type="text"
						bind:value={newColorHex}
						spellcheck="false"
						aria-label="New color hex"
						class="h-9 w-28 rounded-md border border-[hsl(var(--input))] bg-transparent px-2 font-mono text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:outline-none"
					/>
					<Button type="button" size="sm" variant="outline" onclick={addColor}>Add color</Button>
				</div>
			</div>

			{#if tokens.fontFamilies.length > 0}
				<div>
					<p
						class="mb-2 text-xs font-medium tracking-wide text-[hsl(var(--muted-foreground))] uppercase"
					>
						Typography
					</p>
					<div class="space-y-2">
						{#each tokens.fontFamilies as family (family)}
							<p class="text-lg" style:font-family="'{family}', system-ui, sans-serif">
								{family} — The quick brown fox jumps over the lazy dog
							</p>
						{/each}
					</div>
				</div>
			{/if}

			<div>
				<p
					class="mb-2 text-xs font-medium tracking-wide text-[hsl(var(--muted-foreground))] uppercase"
				>
					Samples
				</p>
				<div
					class="flex flex-wrap items-center gap-4"
					style:font-family="'{primaryFont}', system-ui, sans-serif"
				>
					<button
						type="button"
						class="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
						style:background={primaryColor}
						style:color={typeof primaryColor === 'string' && primaryColor.startsWith('#')
							? contrastText(primaryColor)
							: '#fff'}
					>
						Primary button
					</button>
					<a
						href="https://example.com"
						class="text-sm underline underline-offset-2"
						style:color={primaryColor}
						target="_blank"
						rel="noreferrer"
					>
						Sample link
					</a>
				</div>
			</div>

			<div
				class="prose-design max-h-80 overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-4 text-sm"
				use:copyablePre
			>
				<!-- `renderedMd` is sanitized with DOMPurify in the script block above. -->
				{@html renderedMd}
			</div>
		</div>
	</div>
</Card>

<Card
	title="Fonts & assets"
	description="Upload logos, images, and font files — edit name or replace the file anytime"
	class="mb-6"
>
	<form
		method="POST"
		action="?/uploadAsset"
		enctype="multipart/form-data"
		use:enhance
		class="mb-4 flex flex-wrap items-end gap-3"
	>
		<div class="min-w-35 flex-1 space-y-1">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="asset-name">Name</label>
			<Input id="asset-name" name="name" placeholder="Primary logo" required />
		</div>
		<div class="space-y-1">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="asset-kind">Kind</label>
			<select
				id="asset-kind"
				name="kind"
				class="flex h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
			>
				<option value="logo">Logo</option>
				<option value="image">Image</option>
				<option value="font">Font</option>
			</select>
		</div>
		<div class="space-y-1">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="asset-file">File</label>
			<input
				id="asset-file"
				name="file"
				type="file"
				required
				class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[hsl(var(--secondary))] file:px-3 file:py-1.5 file:text-sm"
			/>
		</div>
		<Button type="submit">Upload</Button>
	</form>

	{#if data.assets.length === 0}
		<p class="text-sm text-[hsl(var(--muted-foreground))]">No assets uploaded yet.</p>
	{:else}
		<ul class="divide-y divide-[hsl(var(--border))]">
			{#each data.assets as asset (asset.id)}
				<li class="py-3">
					{#if editAssetId === asset.id}
						<form
							method="POST"
							action="?/updateAsset"
							enctype="multipart/form-data"
							use:enhance={() =>
								async ({ result, update }) => {
									await update();
									if (result.type === 'success') cancelEditAsset();
								}}
							class="space-y-3"
						>
							<input type="hidden" name="id" value={asset.id} />
							<div class="flex flex-wrap items-start gap-3">
								{#if asset.kind === 'logo' || asset.kind === 'image'}
									<img
										src={resolve(`/api/design-asset/${asset.id}`)}
										alt=""
										class="h-10 w-10 rounded object-contain"
									/>
								{:else if asset.kind === 'font'}
									<span
										class="flex h-10 w-10 items-center justify-center rounded bg-[hsl(var(--muted))] text-lg"
										style:font-family="'{editAssetName || asset.name}', system-ui, sans-serif"
										aria-hidden="true"
									>
										Aa
									</span>
								{/if}
								<div class="min-w-0 flex-1 space-y-3">
									<div class="space-y-1">
										<label
											class="text-xs text-[hsl(var(--muted-foreground))]"
											for="edit-asset-name-{asset.id}">Name</label
										>
										<Input
											id="edit-asset-name-{asset.id}"
											name="name"
											bind:value={editAssetName}
											required
										/>
									</div>
									<div class="space-y-1">
										<label
											class="text-xs text-[hsl(var(--muted-foreground))]"
											for="edit-asset-file-{asset.id}">Replace file</label
										>
										<input
											id="edit-asset-file-{asset.id}"
											name="file"
											type="file"
											class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[hsl(var(--secondary))] file:px-3 file:py-1.5 file:text-sm"
										/>
										<p class="text-xs text-[hsl(var(--muted-foreground))]">
											Current: {asset.filename} · {(asset.size / 1024).toFixed(1)} KB. Leave empty to
											keep the existing file.
										</p>
									</div>
									<div class="flex flex-wrap gap-2">
										<Button type="submit" size="sm">Save asset</Button>
										<Button type="button" size="sm" variant="ghost" onclick={cancelEditAsset}
											>Cancel</Button
										>
									</div>
								</div>
							</div>
						</form>
					{:else}
						<div class="flex items-center justify-between gap-3">
							<div class="flex min-w-0 items-center gap-3">
								{#if asset.kind === 'logo' || asset.kind === 'image'}
									<img
										src={resolve(`/api/design-asset/${asset.id}`)}
										alt=""
										class="h-10 w-10 rounded object-contain"
									/>
								{:else if asset.kind === 'font'}
									<span
										class="flex h-10 w-10 items-center justify-center rounded bg-[hsl(var(--muted))] text-lg"
										style:font-family="'{asset.name}', system-ui, sans-serif"
										aria-hidden="true"
									>
										Aa
									</span>
								{/if}
								<div class="min-w-0">
									<p class="truncate text-sm font-medium">{asset.name}</p>
									<p class="truncate text-xs text-[hsl(var(--muted-foreground))]">
										{asset.kind} · {asset.filename} · {(asset.size / 1024).toFixed(1)} KB
									</p>
									<a
										href={resolve(`/api/design-asset/${asset.id}`)}
										class="text-xs text-[hsl(var(--muted-foreground))] hover:underline"
										target="_blank"
										rel="noreferrer">Open</a
									>
								</div>
							</div>
							<div class="flex shrink-0 gap-2">
								<Button size="sm" variant="outline" onclick={() => startEditAsset(asset)}
									>Edit</Button
								>
								<form method="POST" action="?/deleteAsset" use:enhance>
									<input type="hidden" name="id" value={asset.id} />
									<Button type="submit" size="sm" variant="destructive">Delete</Button>
								</form>
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Card>

<Card
	title="Components"
	description="Reusable email sections for templates. All components are equal — add, edit, or delete freely."
>
	<div class="mb-6 space-y-3">
		<p class="text-xs text-[hsl(var(--muted-foreground))]">
			Add a component. Always creates a new row — never overwrites existing ones.
		</p>
		<Input bind:value={newName} placeholder="Component name (e.g. Promo Footer)" required />
		<Input bind:value={newDescription} placeholder="Optional description" />
		<div class="space-y-2 rounded-md border border-[hsl(var(--border))] p-3">
			<p class="text-xs font-medium tracking-wide text-[hsl(var(--muted-foreground))] uppercase">
				Slots
			</p>
			<p class="text-xs text-[hsl(var(--muted-foreground))]">
				Map template variables to block properties.
			</p>
			{#each newSlots as slot, i (i)}
				<div class="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto] sm:items-center">
					<Input bind:value={slot.name} placeholder="Slot name" aria-label="Slot name" />
					<Input bind:value={slot.blockId} placeholder="Block ID" aria-label="Block ID" />
					<Input
						bind:value={slot.prop}
						placeholder="Prop (e.g. props.text)"
						aria-label="Prop path"
					/>
					<select
						bind:value={slot.type}
						class="h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-2 text-sm"
						aria-label="Slot type"
					>
						<option value="text">text</option>
						<option value="url">url</option>
						<option value="asset">asset</option>
						<option value="color">color</option>
					</select>
					<Button type="button" size="sm" variant="ghost" onclick={() => removeSlot('new', i)}>
						Remove
					</Button>
				</div>
			{/each}
			<Button type="button" size="sm" variant="outline" onclick={() => addSlot('new')}>
				Add slot
			</Button>
		</div>
		{#if newSaveError}
			<p class="text-sm text-[hsl(var(--destructive))]">{newSaveError}</p>
		{/if}
		{#if data.piConfigured}
			<p class="mb-2 text-xs text-[hsl(var(--muted-foreground))]">
				Open the <span class="font-medium text-[hsl(var(--foreground))]">AI assistant</span> tab in the
				builder to generate a component from a prompt, then save.
			</p>
		{/if}
		{#key newBuilderKey}
			<EmailBuilder
				document={cloneDocument(EMPTY_DOCUMENT)}
				{designComponents}
				{designColors}
				designAssets={builderDesignAssets}
				previewOverrides={previewPropOverrides}
				onUploadAsset={uploadBuilderAsset}
				saving={savingNewComponent}
				onSave={saveNewComponent}
				aiEnabled={data.piConfigured}
				aiName={newName}
				aiDescription={newDescription}
				aiSlots={newSlots}
				onAiEdit={(args) =>
					runComponentAiEdit({
						...args,
						name: newName,
						description: newDescription,
					})}
				onAiResult={(result) => {
					newSlots = result.slots;
				}}
			/>
		{/key}
	</div>

	{#if data.components.length === 0}
		<p class="text-sm text-[hsl(var(--muted-foreground))]">No components yet.</p>
	{:else}
		<ul class="grid gap-3 sm:grid-cols-2">
			{#each data.components as component (component.id)}
				<li class="rounded-md border border-[hsl(var(--border))] p-4">
					<div class="mb-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div class="min-w-0">
							<p class="font-medium">{component.name}</p>
							{#if component.description}
								<p class="text-xs text-[hsl(var(--muted-foreground))]">{component.description}</p>
							{/if}
							{#if component.parsedSlots?.length}
								<p class="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
									Slots: {component.parsedSlots.map((s) => s.name).join(', ')}
								</p>
							{:else if formatComponentProps(component.props)}
								<div class="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
									<p>props</p>
									<pre
										class="mt-1 overflow-x-auto rounded bg-[hsl(var(--muted))] px-2 py-1 font-mono text-[11px] text-[hsl(var(--foreground))]">{formatComponentProps(
											component.props,
										)}</pre>
								</div>
							{/if}
						</div>
						<div class="flex flex-wrap gap-2">
							<div class="flex rounded-md border border-[hsl(var(--border))] text-xs">
								<button
									type="button"
									class="px-2 py-1 {getView(component.id) === 'preview'
										? 'bg-[hsl(var(--secondary))] font-medium'
										: ''}"
									onclick={() => setView(component.id, 'preview')}
								>
									Preview
								</button>
								<button
									type="button"
									class="px-2 py-1 {getView(component.id) === 'code'
										? 'bg-[hsl(var(--secondary))] font-medium'
										: ''}"
									onclick={() => setView(component.id, 'code')}
								>
									Code
								</button>
							</div>
							<Button size="sm" variant="outline" onclick={() => startEdit(component)}>Edit</Button>
							{#if reapplyingId === component.id}
								<Button type="button" size="sm" variant="outline" onclick={stopReapply}>Stop</Button
								>
								<span class="text-xs text-[hsl(var(--muted-foreground))]">{reapplyStatus}</span>
							{:else}
								<Button
									type="button"
									size="sm"
									variant="secondary"
									disabled={reapplyingId !== null || !designMdDraft.trim()}
									title={!designMdDraft.trim()
										? 'Save design.md first'
										: 'Restyle this component from design.md'}
									onclick={() => void startReapply(component.id)}
								>
									Reapply
								</Button>
							{/if}
							<form method="POST" action="?/deleteComponent" use:enhance>
								<input type="hidden" name="id" value={component.id} />
								<Button type="submit" size="sm" variant="destructive">Delete</Button>
							</form>
						</div>
					</div>
					{#if reapplyingId === component.id && (reapplyStream || reapplyError)}
						{#if reapplyError}
							<p class="mb-2 text-sm text-[hsl(var(--destructive))]">{reapplyError}</p>
						{/if}
						<pre
							class="mb-3 max-h-48 overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 font-mono text-xs whitespace-pre-wrap text-[hsl(var(--foreground))]"
							aria-live="polite">{reapplyStream || 'Waiting for model…'}</pre>
					{/if}
					{#if getView(component.id) === 'preview'}
						{#if hasComponentDocument(component)}
							<iframe
								title="{component.name} preview"
								class="component-preview min-h-48 w-full rounded border border-[hsl(var(--border))] bg-white"
								srcdoc={renderEmailHtml(parseComponentDocumentField(component))}
							></iframe>
						{:else if component.html.trim()}
							<div
								class="component-preview overflow-visible rounded border border-[hsl(var(--border))] bg-white p-3 text-[#111]"
							>
								{@html previewHtml(component.html)}
							</div>
						{:else}
							<p class="text-xs text-[hsl(var(--muted-foreground))]">No preview available.</p>
						{/if}
					{:else}
						<CodeBlock code={componentCode(component)} />
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Card>

<Modal
	open={editComponentId !== null}
	title={editName ? `Edit ${editName}` : 'Edit component'}
	description="Use the AI assistant tab to generate blocks, edit in the canvas, then save."
	onClose={cancelEdit}
>
	{#if editComponentId}
		<div class="space-y-3">
			<Input placeholder="Component name" bind:value={editName} required />
			<Input placeholder="Optional description" bind:value={editDescription} />
			<div class="space-y-2 rounded-md border border-[hsl(var(--border))] p-3">
				<p class="text-xs font-medium tracking-wide text-[hsl(var(--muted-foreground))] uppercase">
					Slots
				</p>
				{#each editSlots as slot, i (i)}
					<div class="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto] sm:items-center">
						<Input bind:value={slot.name} placeholder="Slot name" aria-label="Slot name" />
						<Input bind:value={slot.blockId} placeholder="Block ID" aria-label="Block ID" />
						<Input
							bind:value={slot.prop}
							placeholder="Prop (e.g. props.text)"
							aria-label="Prop path"
						/>
						<select
							bind:value={slot.type}
							class="h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-2 text-sm"
							aria-label="Slot type"
						>
							<option value="text">text</option>
							<option value="url">url</option>
							<option value="asset">asset</option>
							<option value="color">color</option>
						</select>
						<Button type="button" size="sm" variant="ghost" onclick={() => removeSlot('edit', i)}>
							Remove
						</Button>
					</div>
				{/each}
				<Button type="button" size="sm" variant="outline" onclick={() => addSlot('edit')}>
					Add slot
				</Button>
			</div>
			{#if editSaveError}
				<p class="text-sm text-[hsl(var(--destructive))]">{editSaveError}</p>
			{/if}
			{#key editBuilderKey}
				<EmailBuilder
					document={editDocument}
					{designComponents}
					{designColors}
					designAssets={builderDesignAssets}
					previewOverrides={previewPropOverrides}
					onUploadAsset={uploadBuilderAsset}
					saving={savingEditComponent}
					onSave={saveEditComponent}
					aiEnabled={data.piConfigured}
					aiName={editName}
					aiDescription={editDescription}
					aiSlots={editSlots}
					onAiEdit={(args) =>
						runComponentAiEdit({
							...args,
							name: editName,
							description: editDescription,
						})}
					onAiResult={(result) => {
						editDocument = cloneDocument(result.document);
						editSlots = result.slots;
					}}
				/>
			{/key}
			{#if !data.piConfigured}
				<p class="text-xs text-[hsl(var(--muted-foreground))]">
					Set OPENROUTER_API_KEY to generate components from the AI assistant tab in the builder.
				</p>
			{/if}
			<div class="flex gap-2 pt-2">
				<Button type="button" variant="ghost" onclick={cancelEdit}>Close</Button>
			</div>
		</div>
	{/if}
</Modal>

<style>
	@keyframes infer-progress {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(400%);
		}
	}
	.infer-progress-bar {
		animation: infer-progress 1.1s ease-in-out infinite;
	}

	.component-preview :global(img) {
		max-width: 100%;
		height: auto;
	}

	.prose-design :global(h1) {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0.75rem 0 0.35rem;
	}
	.prose-design :global(h2) {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0.65rem 0 0.3rem;
	}
	.prose-design :global(h3) {
		font-size: 1rem;
		font-weight: 600;
		margin: 0.5rem 0 0.25rem;
	}
	.prose-design :global(p),
	.prose-design :global(ul),
	.prose-design :global(ol) {
		margin: 0.35rem 0;
	}
	.prose-design :global(ul) {
		list-style: disc;
		padding-left: 1.25rem;
	}
	.prose-design :global(ol) {
		list-style: decimal;
		padding-left: 1.25rem;
	}
	.prose-design :global(code) {
		font-family: ui-monospace, monospace;
		font-size: 0.85em;
		background: hsl(var(--muted));
		padding: 0.1em 0.3em;
		border-radius: 0.2rem;
	}
	.prose-design :global(pre) {
		overflow-x: auto;
		background: hsl(var(--muted));
		padding: 0.75rem 2.5rem 0.75rem 0.75rem;
		border-radius: 0.35rem;
		font-size: 0.75rem;
	}
	.prose-design :global([data-copyable-wrap]) {
		margin: 0.35rem 0;
	}
</style>

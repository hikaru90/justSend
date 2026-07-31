<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import CodeBlock from '$lib/components/CodeBlock.svelte';
	import PiEditField from '$lib/components/PiEditField.svelte';
	import { copyablePre } from '$lib/actions/copyablePre';
	import { Check, Copy } from '@lucide/svelte';
	import { enhance } from '$app/forms';
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
		substitutePreviewPlaceholders
	} from '$lib/design/extractTokens';

	let { data, form } = $props();

	let editComponentId = $state<string | null>(null);
	let editName = $state('');
	let editDescription = $state('');
	let editHtml = $state('');
	let editAssetId = $state<string | null>(null);
	let editAssetName = $state('');
	let piInstruction = $state('');
	let piEditing = $state(false);
	let piStatus = $state('');
	let piError = $state<string | null>(null);
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
	const renderedMd = $derived(
		DOMPurify.sanitize(marked.parse(designMdDraft || '_No design.md yet._', { async: false }) as string)
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
			'border'
		]
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

	function startEdit(component: {
		id: string;
		name: string;
		description: string | null;
		html: string;
	}) {
		editComponentId = component.id;
		editName = component.name;
		editDescription = component.description ?? '';
		editHtml = component.html;
	}

	function cancelEdit() {
		piAbort?.abort();
		editComponentId = null;
		editName = '';
		editDescription = '';
		editHtml = '';
		piInstruction = '';
		piEditing = false;
		piStatus = '';
		piError = null;
		piAbort = null;
		piFeed = [];
		piFeedId = 0;
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
		onEvent: (event: StreamEvent) => void
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
				signal: controller.signal
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
				signal: controller.signal
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
		piEditing = true;
		piStatus = 'Starting Pi…';
		piFeed = [];
		piFeedId = 0;

		const controller = new AbortController();
		piAbort = controller;

		/** Tracks open tool_start lines by tool name (last open wins). */
		const openTools: Record<string, number> = {};

		try {
			const res = await fetch(resolve('/design-system/pi-edit'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({
					instruction,
					html: editHtml,
					name: editName,
					description: editDescription
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
							piStatus = event.message ?? 'Edit complete.';
							piInstruction = '';
							if (typeof event.html === 'string') {
								editHtml = event.html;
							}
							break;
					}
				}
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
			h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
		if (full.length !== 6) return '#fff';
		const r = parseInt(full.slice(0, 2), 16);
		const g = parseInt(full.slice(2, 4), 16);
		const b = parseInt(full.slice(4, 6), 16);
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return luminance > 0.55 ? '#111' : '#fff';
	}

	function isStarterComponent(component: { starterKey?: string | null }): boolean {
		return Boolean(component.starterKey);
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
	Team-wide baseline for AI-generated email templates: design.md, fonts, assets, starter-kit
	sections that are always present, and any extra custom components layered on top.
</p>

{#if form?.error}
	<p class="mb-4 text-sm text-[hsl(var(--destructive))]">{form.error}</p>
{/if}
{#if form?.success && form.saved === 'infer'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Inferred design system from URL
		{#if form.componentsCreated}
			· updated/branded {form.componentsCreated} starter section{form.componentsCreated === 1
				? ''
				: 's'}
		{/if}
		{#if form.assetsDownloaded}
			· downloaded {form.assetsDownloaded} asset{form.assetsDownloaded === 1 ? '' : 's'}
		{/if}
		. Review and edit below.
	</p>
{:else if form?.success && form.saved === 'reapply'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Reapplied design system to component.
	</p>
{:else if form?.success}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Saved.</p>
{/if}

<Card
	title="Infer from URL"
	description="Fetch a public site and ask AI to brand the reusable starter sections, refine design.md, and suggest extra custom components"
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
		Requires OPENROUTER_API_KEY. Streams the model response live. Overwrites design.md, keeps the
		reusable starter sections in place while branding/refining them from the URL, may append extra
		custom components, and attempts to download the logo and web fonts from the site.
	</p>
</Card>

{#if logoAssets.length > 0 || fontAssets.length > 0}
	<div class="design-preview mb-6 flex flex-wrap items-center gap-4 rounded-md border border-[hsl(var(--border))] p-4">
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

<Card title="design.md" description="Edit colors below or the markdown directly — brand tokens, typography, spacing, and guidelines" class="mb-6">
	<div class="design-preview grid gap-4 lg:grid-cols-2">
		<form method="POST" action="?/saveMd" use:enhance class="space-y-3">
			<div class="relative">
				<textarea
					name="designMd"
					rows="16"
					bind:value={designMdDraft}
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 pr-10 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
					placeholder="# Brand — colors, typography, spacing, tone"
				></textarea>
				<button
					type="button"
					class="absolute right-1.5 top-1.5 z-10 rounded p-1 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
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
				<p class="mb-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
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
								<span class="pointer-events-none text-[10px] font-mono opacity-90">{color}</span>
								<input
									type="color"
									class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
									value={hexForColorInput(color)}
									aria-label={`Edit color ${color}`}
									onchange={(e) => updateColor(color, e.currentTarget.value)}
								/>
							</label>
							<div class="flex items-center gap-1 border-t border-[hsl(var(--border))] bg-[hsl(var(--background))] p-1">
								<input
									type="text"
									value={color}
									spellcheck="false"
									aria-label={`Hex for ${color}`}
									class="min-w-0 flex-1 rounded border-0 bg-transparent px-1 py-0.5 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
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
						class="h-9 w-28 rounded-md border border-[hsl(var(--input))] bg-transparent px-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
					/>
					<Button type="button" size="sm" variant="outline" onclick={addColor}>Add color</Button>
				</div>
			</div>

			{#if tokens.fontFamilies.length > 0}
				<div>
					<p class="mb-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
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
				<p class="mb-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
					Samples
				</p>
				<div class="flex flex-wrap items-center gap-4" style:font-family="'{primaryFont}', system-ui, sans-serif">
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

<Card title="Fonts & assets" description="Upload logos, images, and font files — edit name or replace the file anytime" class="mb-6">
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
											for="edit-asset-file-{asset.id}"
											>Replace file</label
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
								<Button size="sm" variant="outline" onclick={() => startEditAsset(asset)}>Edit</Button>
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
	description="Starter-kit sections stay available as the reusable baseline; add custom snippets only when you need something extra"
>
	<form method="POST" action="?/saveComponent" use:enhance class="mb-6 space-y-3">
		<p class="text-xs text-[hsl(var(--muted-foreground))]">
			Add extra custom components here. The starter kit remains the primary framework and starter
			sections reset to their defaults instead of being deleted.
		</p>
		<Input
			name="name"
			placeholder="Custom component name (e.g. Promo Footer)"
			required
		/>
		<Input name="description" placeholder="Optional description for this extra component" />
		<textarea
			name="html"
			rows="6"
			class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
			placeholder={'<a href="{{cta_url}}" style="...">{{cta_label}}</a>'}
		></textarea>
		<Button type="submit">Add custom component</Button>
	</form>

	{#if data.components.length === 0}
		<p class="text-sm text-[hsl(var(--muted-foreground))]">No components yet.</p>
	{:else}
		<ul class="grid gap-3 sm:grid-cols-2">
			{#each data.components as component (component.id)}
				<li class="rounded-md border border-[hsl(var(--border))] p-4">
					<div class="mb-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<p class="font-medium">{component.name}</p>
								<span
									class={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
										isStarterComponent(component)
											? 'bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))]'
											: 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
									}`}
								>
									{isStarterComponent(component) ? 'Starter' : 'Custom'}
								</span>
							</div>
							{#if component.description}
								<p class="text-xs text-[hsl(var(--muted-foreground))]">{component.description}</p>
							{/if}
							<p class="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
								{#if isStarterComponent(component)}
									Starter sections are always present and reset instead of being deleted.
								{:else}
									Custom components extend the starter kit when you need something brand-specific.
								{/if}
							</p>
							{#if component.starterKey}
								<p class="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
									starterKey: <span class="font-mono">{component.starterKey}</span>
								</p>
							{/if}
							{#if formatComponentProps(component.props)}
								<div class="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
									<p>props</p>
									<pre class="mt-1 overflow-x-auto rounded bg-[hsl(var(--muted))] px-2 py-1 font-mono text-[11px] text-[hsl(var(--foreground))]">{formatComponentProps(component.props)}</pre>
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
								<Button type="button" size="sm" variant="outline" onclick={stopReapply}>Stop</Button>
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
						<div
							class="component-preview overflow-visible rounded border border-[hsl(var(--border))] bg-white p-3 text-[#111]"
						>
							{@html previewHtml(component.html)}
						</div>
					{:else}
						<CodeBlock code={component.html} />
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Card>

<Modal
	open={editComponentId !== null}
	title={editName ? `Edit ${editName}` : 'Edit component'}
	description="Preview changes, optionally edit with Pi, then save."
	onClose={cancelEdit}
>
	{#if editComponentId}
		<div
			class="component-preview mb-4 overflow-visible rounded border border-[hsl(var(--border))] bg-white p-3 text-[#111]"
		>
			{@html previewHtml(editHtml)}
		</div>
		<div class="space-y-3">
			{#if data.piConfigured}
				<form
					class="space-y-3"
					onsubmit={(e) => {
						e.preventDefault();
						void startPiEdit();
					}}
				>
					{#if piFeed.length > 0 || piEditing || piStatus || piError}
						<div
							class="flex min-h-0 flex-col overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)]"
						>
							<div
								{@attach (node) => {
									void piFeed;
									requestAnimationFrame(() => {
										node.scrollTop = node.scrollHeight;
									});
								}}
								class="max-h-64 min-h-32 space-y-1.5 overflow-y-auto px-3 py-2 font-mono text-xs"
								aria-live="polite"
							>
								{#if piFeed.length === 0 && piEditing}
									<p class="text-[hsl(var(--muted-foreground))]">
										{piStatus || 'Starting…'}
									</p>
								{/if}
								{#each piFeed as line (line.id)}
									{#if line.kind === 'step'}
										<p class="text-[hsl(var(--muted-foreground))]">{line.label}</p>
									{:else if line.kind === 'thinking'}
										<p class="whitespace-pre-wrap text-[hsl(var(--muted-foreground))] italic">
											<span class="not-italic opacity-70">thinking </span>{line.label}
										</p>
									{:else if line.kind === 'text'}
										<p class="whitespace-pre-wrap text-[hsl(var(--foreground))]">
											{line.label}
										</p>
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
							{#if piEditing || piStatus || piError}
								<div
									class="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))] px-3 py-2"
								>
									{#if piEditing}
										<Button type="button" size="sm" variant="outline" onclick={stopPiEdit}>
											Stop
										</Button>
									{/if}
									{#if piError}
										<p class="text-xs text-[hsl(var(--destructive))]">{piError}</p>
									{:else if piStatus}
										<p class="text-xs text-[hsl(var(--muted-foreground))]">{piStatus}</p>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
					<PiEditField
						bind:value={piInstruction}
						busy={piEditing}
						disabled={piEditing}
						placeholder="e.g. Make the button larger and use brand primary color"
						hint="Pi updates the HTML draft below — click Update component to save. Thinking and tool calls stream above."
					/>
				</form>
			{:else}
				<p class="text-xs text-[hsl(var(--muted-foreground))]">
					Set OPENROUTER_API_KEY to edit components with Pi (speak or type).
				</p>
			{/if}
			<form
				method="POST"
				action="?/saveComponent"
				use:enhance={() =>
					async ({ result, update }) => {
						await update();
						if (result.type === 'success') cancelEdit();
					}}
				class="space-y-3"
			>
				<input type="hidden" name="id" value={editComponentId} />
				<Input name="name" placeholder="Component name" bind:value={editName} required />
				<Input name="description" placeholder="Optional description" bind:value={editDescription} />
				<textarea
					name="html"
					rows="6"
					bind:value={editHtml}
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
				></textarea>
				<div class="flex gap-2">
					<Button type="submit">Update component</Button>
					<Button type="button" variant="ghost" onclick={cancelEdit}>Cancel</Button>
				</div>
			</form>
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

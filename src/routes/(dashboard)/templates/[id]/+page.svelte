<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import EmailBuilder from '$lib/email-builder/EmailBuilder.svelte';
	import { cloneDocument } from '$lib/email-builder/render';
	import type { ComponentSlot, TEditorConfiguration } from '$lib/email-builder/types';
	import type { EditApproach } from '$lib/email-builder/edit-approach';
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { GripVertical } from '@lucide/svelte';
	import DOMPurify from 'isomorphic-dompurify';
	import { pickEmailLogos, substitutePreviewPlaceholders } from '$lib/design/extractTokens';
	import type { TemplateElementType } from '$lib/template-element-config';

	type VisualAsset = {
		id: string;
		name: string;
		filename: string;
		kind: 'logo' | 'image';
	};

	type DesignComponentOption = {
		id: string;
		name: string;
		kind: 'starter' | 'custom';
		role: string;
		description: string | null;
		starterKey: string | null;
		html: string;
		document?: string;
		props: string[];
		parsedSlots?: import('$lib/email-builder/types').ComponentSlot[];
	};

	type ElementRow = {
		id: string;
		type: TemplateElementType;
		label: string;
		required: boolean;
		parsedConfig: { text?: string; url?: string; assetId?: string; designComponentId?: string };
	};

	let { data, form } = $props();

	let prompt = $state(data.template.prompt ?? '');
	let previewTo = $derived(data.userEmail ?? '');
	let scaffolding = $state(false);
	let scaffoldStatus = $state('');
	let scaffoldStream = $state('');
	let scaffoldError = $state<string | null>(null);
	let scaffoldAbort = $state<AbortController | null>(null);
	let composing = $state(false);
	let savingHtml = $state(false);
	let sending = $state(false);
	let editorHtml = $state('');
	let assistOpen = $state(false);

	let testEmail = $state('alex@example.com');
	let testFirstName = $state('Alex');
	let testLastName = $state('River');

	const testVariables = $derived({
		email: testEmail,
		firstName: testFirstName,
		lastName: testLastName,
	});

	$effect(() => {
		prompt = data.template.prompt ?? '';
	});

	let addType = $state<TemplateElementType>('cta');
	let addLabel = $state('');
	let addAssetId = $state('');
	let customFormOpen = $state(false);
	let editingId = $state<string | null>(null);
	let editAssetIds = $state<Record<string, string>>({});
	let elementOrderOverride = $state<string[] | null>(null);
	let draggingElementId = $state<string | null>(null);
	let dragOverElementId = $state<string | null>(null);
	let pickerMode = $state<'multi-add' | 'single-edit' | null>(null);
	let pickerSelectedIds = $state<string[]>([]);
	let pickerSingleId = $state('');
	let pickerEditElementId = $state<string | null>(null);

	const designComponents = $derived((data.designComponents ?? []) as DesignComponentOption[]);
	const emailDocument = $derived((data.emailDocument ?? null) as TEditorConfiguration | null);
	const builderPreviewOverrides = $derived.by((): Record<string, string> => {
		const overrides: Record<string, string> = { ...testVariables };
		const pair = pickEmailLogos(data.logoAssets ?? []);
		if (pair) {
			const light = resolve(`/api/design-asset/${pair.light.id}`);
			const dark = resolve(`/api/design-asset/${pair.dark.id}`);
			overrides.logo = light;
			overrides.logo_url = light;
			overrides.logo_light = light;
			overrides.logo_dark = dark;
			overrides.logo_dark_url = dark;
		}
		return overrides;
	});

	const subjectPreview = $derived(
		substitutePreviewPlaceholders(data.template.subject ?? '', testVariables),
	);

	$effect(() => {
		editorHtml = data.previewHtml ?? '';
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
			'data-owl-section',
			'data-owl-id',
			'data-owl-column',
			'data-owl-sections',
		],
	};

	function componentPreviewHtml(html: string): string {
		return DOMPurify.sanitize(substitutePreviewPlaceholders(html), sanitizeOpts);
	}

	async function startScaffold() {
		if (scaffolding) return;
		scaffoldError = null;
		scaffoldStream = '';
		scaffoldStatus = 'Starting…';
		scaffolding = true;

		const controller = new AbortController();
		scaffoldAbort = controller;

		try {
			const res = await fetch(resolve(`/templates/${data.template.id}/scaffold`), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({ prompt }),
				signal: controller.signal,
			});

			if (!res.ok || !res.body) {
				const text = await res.text().catch(() => '');
				throw new Error(text || `Scaffold request failed (${res.status})`);
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
						delta?: string;
						chars?: number;
						model?: string;
					};
					try {
						event = JSON.parse(line.slice(5).trim()) as typeof event;
					} catch {
						continue;
					}

					if (event.stage === 'delta' && event.delta) {
						scaffoldStream += event.delta;
						scaffoldStatus = `Receiving… (${(event.chars ?? scaffoldStream.length).toLocaleString()} chars)`;
					} else if (event.stage === 'error') {
						scaffoldError = event.message ?? 'Scaffold failed';
						scaffoldStatus = scaffoldError;
					} else if (event.stage === 'cancelled') {
						scaffoldStatus = event.message ?? 'Stopped';
					} else if (event.message) {
						scaffoldStatus = event.message;
					}
				}
			}

			if (!scaffoldError) {
				await invalidateAll();
			}
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') {
				scaffoldStatus = 'Stopped';
			} else {
				scaffoldError = e instanceof Error ? e.message : 'Scaffold failed';
				scaffoldStatus = scaffoldError;
			}
		} finally {
			scaffolding = false;
			scaffoldAbort = null;
		}
	}

	function stopScaffold() {
		scaffoldAbort?.abort();
		scaffoldStatus = 'Stopping…';
	}

	function assetsForType(type: TemplateElementType): VisualAsset[] {
		if (type === 'logo') return data.logoAssets;
		if (type === 'image') return [...data.imageAssets, ...data.logoAssets];
		return [];
	}

	const libraryAssets = $derived.by((): VisualAsset[] => assetsForType(addType));

	function designComponentName(id: string | undefined): string | null {
		if (!id) return null;
		return designComponents.find((c) => c.id === id)?.name ?? null;
	}

	function valueSummary(el: ElementRow): string {
		const cfg = el.parsedConfig;
		if (el.type === 'component') {
			return designComponentName(cfg.designComponentId) ?? 'no component selected';
		}
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

	const localElements = $derived.by((): ElementRow[] => {
		const server = data.elements as ElementRow[];
		const byId = new Map(server.map((el) => [el.id, el]));
		const override = elementOrderOverride;
		const order =
			override && override.length === server.length && override.every((id) => byId.has(id))
				? override
				: server.map((el) => el.id);
		return order.map((id) => byId.get(id)!);
	});

	function reorderLocalElements(fromId: string, toId: string): string[] | null {
		if (fromId === toId) return null;
		const ids = localElements.map((el) => el.id);
		const from = ids.indexOf(fromId);
		const to = ids.indexOf(toId);
		if (from < 0 || to < 0) return null;
		const next = [...ids];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		elementOrderOverride = next;
		return next;
	}

	function onElementDragStart(event: DragEvent, id: string) {
		draggingElementId = id;
		dragOverElementId = null;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', id);
		}
	}

	function onElementDragOver(event: DragEvent, id: string) {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		if (dragOverElementId !== id) dragOverElementId = id;
	}

	function onElementDrop(event: DragEvent, targetId: string) {
		event.preventDefault();
		const fromId = draggingElementId ?? event.dataTransfer?.getData('text/plain') ?? null;
		if (!fromId) return;
		reorderLocalElements(fromId, targetId);
		dragOverElementId = null;
	}

	function onElementDragEnd() {
		const orderedIds = localElements.map((el) => el.id);
		const serverIds = (data.elements as ElementRow[]).map((el) => el.id);
		const changed =
			orderedIds.length !== serverIds.length ||
			orderedIds.some((id, index) => id !== serverIds[index]);

		draggingElementId = null;
		dragOverElementId = null;
		if (!changed) {
			elementOrderOverride = null;
			return;
		}
		void persistElementOrder(orderedIds);
	}

	async function persistElementOrder(orderedIds: string[]) {
		elementOrderOverride = orderedIds;
		try {
			const body = new FormData();
			for (const id of orderedIds) body.append('orderedId', id);
			const res = await fetch('?/reorderElements', {
				method: 'POST',
				body,
				headers: {
					accept: 'application/json',
					'x-sveltekit-action': 'true',
				},
			});
			if (!res.ok) {
				elementOrderOverride = null;
				return;
			}
			await invalidateAll();
			elementOrderOverride = null;
		} catch {
			elementOrderOverride = null;
		}
	}

	const pickerOpen = $derived(pickerMode !== null);
	const pickerSelectedCount = $derived(pickerSelectedIds.length);
	const pickerEditElement = $derived(
		pickerEditElementId
			? ((data.elements as ElementRow[]).find((e) => e.id === pickerEditElementId) ?? null)
			: null,
	);

	function openMultiAddPicker() {
		customFormOpen = false;
		editingId = null;
		pickerMode = 'multi-add';
		pickerSelectedIds = [];
		pickerSingleId = '';
		pickerEditElementId = null;
	}

	function openSingleEditPicker(elementId: string) {
		const el = (data.elements as ElementRow[]).find((e) => e.id === elementId);
		if (!el || el.type !== 'component') return;
		customFormOpen = false;
		editingId = null;
		pickerMode = 'single-edit';
		pickerEditElementId = elementId;
		pickerSingleId = el.parsedConfig.designComponentId ?? '';
		pickerSelectedIds = [];
	}

	function closePicker() {
		pickerMode = null;
		pickerSelectedIds = [];
		pickerSingleId = '';
		pickerEditElementId = null;
	}

	function togglePickerId(id: string) {
		if (pickerMode === 'single-edit') {
			pickerSingleId = id;
			return;
		}
		if (pickerSelectedIds.includes(id)) {
			pickerSelectedIds = pickerSelectedIds.filter((x) => x !== id);
		} else {
			pickerSelectedIds = [...pickerSelectedIds, id];
		}
	}

	function isPickerCardSelected(id: string): boolean {
		if (pickerMode === 'single-edit') return pickerSingleId === id;
		return pickerSelectedIds.includes(id);
	}

	function toggleCustomForm() {
		customFormOpen = !customFormOpen;
		if (customFormOpen) {
			pickerMode = null;
			addType = 'cta';
			addLabel = '';
			addAssetId = '';
		}
	}

	async function saveEmailBuilder(payload: { document: TEditorConfiguration; html: string }) {
		savingHtml = true;
		try {
			const body = new FormData();
			body.append('html', payload.html);
			body.append('document', JSON.stringify(payload.document));
			const res = await fetch('?/saveHtml', {
				method: 'POST',
				body,
				headers: {
					accept: 'application/json',
					'x-sveltekit-action': 'true',
				},
			});
			if (!res.ok) throw new Error('Save failed');
			editorHtml = payload.html;
			await invalidateAll();
		} finally {
			savingHtml = false;
		}
	}

	async function uploadBuilderAsset(
		file: File,
	): Promise<{ id: string; name: string; kind: string } | null> {
		const body = new FormData();
		body.append('file', file);
		body.append('name', file.name || 'image');
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
		(data.visualAssets ?? []).map((a: VisualAsset) => ({
			id: a.id,
			name: a.name,
			kind: a.kind,
		})),
	);

	async function runEmailAiEdit(args: {
		instruction: string;
		document: TEditorConfiguration;
		slots: ComponentSlot[];
		mode: 'create' | 'edit' | 'validate';
		approach: EditApproach;
		html?: string;
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
			html?: string;
			approach?: EditApproach;
		}) => void;
	}): Promise<{
		document: TEditorConfiguration;
		slots: ComponentSlot[];
		html?: string;
		approach?: EditApproach;
	} | null> {
		const res = await fetch(resolve('/design-system/pi-edit'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
			body: JSON.stringify({
				instruction: args.instruction,
				document: args.document,
				slots: args.slots,
				mode: args.mode,
				approach: args.approach,
				html: args.html,
				name: data.template.name,
				description: 'Template email document',
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
		let result: {
			document: TEditorConfiguration;
			slots: ComponentSlot[];
			html?: string;
			approach?: EditApproach;
		} | null = null;

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
					html?: string;
					approach?: EditApproach;
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
							html: typeof event.html === 'string' ? event.html : undefined,
							approach:
								event.approach === 'html' || event.approach === 'blocks'
									? event.approach
									: args.approach,
						};
					}
					args.onEvent({
						type: 'done',
						message: event.message,
						document: result?.document,
						slots: result?.slots,
						html: result?.html,
						approach: result?.approach,
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
					html: event.html,
					approach: event.approach,
				});
			}
		}

		return result;
	}
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
	<div>
		<a
			href={resolve('/templates')}
			class="text-sm text-[hsl(var(--muted-foreground))] hover:underline">← Templates</a
		>
		<h1 class="mt-1 text-2xl font-semibold">{data.template.name}</h1>
		<p class="text-sm text-[hsl(var(--muted-foreground))]">
			Build the email here. Use the AI assistant tab in the builder, or the helpers below.
		</p>
	</div>
	<form method="POST" action="?/delete" use:enhance>
		<Button type="submit" variant="destructive" size="sm">Delete template</Button>
	</form>
</div>

{#if form?.error}
	<p
		class="mb-4 rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-3 py-2 text-sm text-[hsl(var(--destructive))]"
	>
		{form.error}
	</p>
{/if}
{#if form?.success && form.saved === 'scaffold'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		AI content ready — use Compose into builder if you want it applied.
	</p>
{/if}
{#if form?.success && form.saved === 'compose'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Sections composed into the builder.
	</p>
{/if}
{#if form?.success && form.saved === 'html'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Email saved.</p>
{/if}
{#if form?.success && form.saved === 'preview'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Preview queued (email id: {form.emailId}).
	</p>
{/if}
{#if form?.success && form.saved === 'element'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Sections updated.</p>
{/if}

{#if !data.designReady}
	<Card title="Design system missing" class="mb-4">
		<p class="mb-3 text-sm text-[hsl(var(--muted-foreground))]">
			Optional: add a design system for AI-assisted sections. You can still build emails by hand.
		</p>
		<Button href={resolve('/design-system')} size="sm">Open design system</Button>
	</Card>
{/if}

<div class="mb-4 grid gap-4 lg:grid-cols-[1fr_auto]">
	<form method="POST" action="?/updateMeta" use:enhance class="flex flex-wrap items-end gap-3">
		<div class="min-w-40 flex-1 space-y-1">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="tpl-name">Name</label>
			<Input id="tpl-name" name="name" value={data.template.name} required />
		</div>
		<div class="min-w-48 flex-[1.5] space-y-1">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="tpl-subject">Subject</label>
			<Input id="tpl-subject" name="subject" value={data.template.subject} required />
		</div>
		<Button type="submit" size="sm" variant="outline">Save</Button>
	</form>
	<form
		method="POST"
		action="?/sendPreview"
		use:enhance={({ formData }) => {
			sending = true;
			formData.set('email', testEmail);
			formData.set('firstName', testFirstName);
			formData.set('lastName', testLastName);
			return async ({ update }) => {
				await update();
				sending = false;
			};
		}}
		class="flex flex-wrap items-end gap-2"
	>
		<div class="min-w-48 flex-1 space-y-1">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="preview-to"
				>Send preview</label
			>
			<Input id="preview-to" name="to" type="email" bind:value={previewTo} required />
		</div>
		<Button type="submit" size="sm" disabled={sending || !data.previewFrom || !data.hasHtml}>
			{sending ? 'Sending…' : 'Send'}
		</Button>
		<a
			href={resolve(`/templates/${data.template.id}/export?download=1`)}
			class="inline-flex h-8 items-center text-xs text-[hsl(var(--muted-foreground))] underline"
		>
			Download
		</a>
	</form>
</div>

<div class="mb-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
	<div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
		<div>
			<p class="text-sm font-medium">Test variables</p>
			<p class="text-xs text-[hsl(var(--muted-foreground))]">
				Standard contact fields used as <code class="text-[0.7rem]">{'{{…}}'}</code> in the email. Values
				apply to Preview and Send preview.
			</p>
		</div>
		{#if subjectPreview !== (data.template.subject ?? '')}
			<p class="text-xs text-[hsl(var(--muted-foreground))]">
				Subject preview: <span class="text-[hsl(var(--foreground))]">{subjectPreview}</span>
			</p>
		{/if}
	</div>
	<div class="grid gap-3 sm:grid-cols-3">
		<div class="space-y-1">
			<label class="font-mono text-xs text-[hsl(var(--muted-foreground))]" for="test-var-email">
				{'{{email}}'}
			</label>
			<Input
				id="test-var-email"
				type="email"
				bind:value={testEmail}
				placeholder="alex@example.com"
			/>
		</div>
		<div class="space-y-1">
			<label class="font-mono text-xs text-[hsl(var(--muted-foreground))]" for="test-var-firstName">
				{'{{firstName}}'}
			</label>
			<Input id="test-var-firstName" bind:value={testFirstName} placeholder="Alex" />
		</div>
		<div class="space-y-1">
			<label class="font-mono text-xs text-[hsl(var(--muted-foreground))]" for="test-var-lastName">
				{'{{lastName}}'}
			</label>
			<Input id="test-var-lastName" bind:value={testLastName} placeholder="River" />
		</div>
	</div>
</div>

<div class="mb-6">
	<EmailBuilder
		document={emailDocument}
		{designComponents}
		designColors={data.designColors}
		designAssets={builderDesignAssets}
		previewOverrides={builderPreviewOverrides}
		onUploadAsset={uploadBuilderAsset}
		saving={savingHtml}
		onSave={saveEmailBuilder}
		aiEnabled={data.piConfigured}
		aiName={data.template.name}
		aiDescription="Template email — edits use your design system (blocks or HTML)."
		aiHtml={data.template.html ?? ''}
		onAiEdit={runEmailAiEdit}
	/>
</div>

<div class="mb-2">
	<button
		type="button"
		class="text-sm font-medium text-[hsl(var(--foreground))] underline-offset-4 hover:underline"
		onclick={() => (assistOpen = !assistOpen)}
	>
		{assistOpen ? 'Hide assistants' : 'Show assistants'}
		<span class="font-normal text-[hsl(var(--muted-foreground))]">
			— sections, AI generate, compose into builder
		</span>
	</button>
</div>

{#if assistOpen}
	<div class="space-y-6">
		<Card
			title="Sections"
			description="Optional: pick design-system sections, then compose them into the builder."
		>
			<div class="mb-4 flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={designComponents.length === 0}
					onclick={openMultiAddPicker}
				>
					Add from design system
				</Button>
				<Button
					type="button"
					variant={customFormOpen ? 'secondary' : 'outline'}
					onclick={toggleCustomForm}
				>
					{customFormOpen ? 'Hide custom form' : 'Add custom element'}
				</Button>
			</div>

			{#if customFormOpen}
				<form
					method="POST"
					action="?/addElement"
					enctype="multipart/form-data"
					use:enhance={() => {
						return async ({ update, result }) => {
							await update();
							if (result.type === 'success') {
								addAssetId = '';
								addLabel = '';
								customFormOpen = false;
							}
						};
					}}
					class="mb-4 space-y-3 rounded-md border border-[hsl(var(--border))] p-3"
				>
					<div class="flex flex-wrap items-end gap-3">
						<div class="min-w-35 flex-1 space-y-1">
							<label class="text-xs text-[hsl(var(--muted-foreground))]" for="el-label">Label</label
							>
							<Input
								id="el-label"
								name="label"
								bind:value={addLabel}
								placeholder="Primary CTA"
								required
							/>
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
						<Input name="text" placeholder="Welcome to Acme" />
					{:else if addType === 'button' || addType === 'cta' || addType === 'link'}
						<div class="grid gap-3 sm:grid-cols-2">
							<Input name="text" placeholder="Shop now" />
							<Input name="url" type="url" placeholder="https://example.com" />
						</div>
					{:else if addType === 'logo' || addType === 'image'}
						<input type="hidden" name="assetId" value={addAssetId} />
						{#if libraryAssets.length > 0}
							<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
								{#each libraryAssets as asset (asset.id)}
									<button
										type="button"
										class="rounded-md border p-2 text-left {addAssetId === asset.id
											? 'border-[hsl(var(--ring))] bg-[hsl(var(--muted))]/50'
											: 'border-[hsl(var(--border))]'}"
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
						{/if}
						<input
							name="file"
							type="file"
							accept="image/*"
							class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[hsl(var(--secondary))] file:px-3 file:py-1.5"
						/>
					{/if}

					<div class="flex gap-2">
						<Button type="submit">Add</Button>
						<Button type="button" variant="ghost" onclick={() => (customFormOpen = false)}
							>Cancel</Button
						>
					</div>
				</form>
			{/if}

			{#if localElements.length === 0}
				<p class="text-sm text-[hsl(var(--muted-foreground))]">
					No sections yet. Skip this and build in the email builder, or add design-system sections
					here.
				</p>
			{:else}
				<ul class="divide-y divide-[hsl(var(--border))]">
					{#each localElements as element (element.id)}
						{@const el = element as ElementRow}
						{@const libComponent =
							el.type === 'component' && el.parsedConfig.designComponentId
								? designComponents.find((c) => c.id === el.parsedConfig.designComponentId)
								: null}
						<li
							class="space-y-3 py-3 {draggingElementId === el.id
								? 'opacity-60'
								: ''} {dragOverElementId === el.id && draggingElementId !== el.id
								? 'bg-[hsl(var(--muted))]/30'
								: ''}"
							ondragover={(e) => onElementDragOver(e, el.id)}
							ondrop={(e) => onElementDrop(e, el.id)}
						>
							<div class="flex items-start justify-between gap-3">
								<span
									role="button"
									tabindex="0"
									class="mt-0.5 shrink-0 cursor-grab touch-none rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/50"
									draggable="true"
									aria-label="Drag to reorder {el.label}"
									ondragstart={(e) => onElementDragStart(e, el.id)}
									ondragend={onElementDragEnd}
								>
									<GripVertical class="size-4" />
								</span>
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium">{el.label}</p>
									<p class="text-xs text-[hsl(var(--muted-foreground))]">
										{el.type === 'component' ? 'design system' : el.type}
										{el.required ? ' · required' : ' · optional'} · {valueSummary(el)}
									</p>
									{#if libComponent}
										<div
											class="mt-2 h-24 overflow-hidden rounded-md border border-[hsl(var(--border))] bg-white p-2 text-[#111]"
										>
											{@html componentPreviewHtml(libComponent.html)}
										</div>
									{/if}
								</div>
								<div class="flex shrink-0 gap-2">
									<Button
										type="button"
										size="sm"
										variant="outline"
										onclick={() => {
											if (el.type === 'component') {
												openSingleEditPicker(el.id);
												return;
											}
											editingId = editingId === el.id ? null : el.id;
											if (el.parsedConfig.assetId) editAssetIds[el.id] = el.parsedConfig.assetId;
										}}
									>
										Edit
									</Button>
									<form method="POST" action="?/deleteElement" use:enhance>
										<input type="hidden" name="id" value={el.id} />
										<Button type="submit" size="sm" variant="destructive">Remove</Button>
									</form>
								</div>
							</div>

							{#if editingId === el.id && el.type !== 'component'}
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
									<Input name="label" value={el.label} required />
									<label class="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											name="required"
											checked={el.required}
											class="rounded border"
										/>
										Required
									</label>
									{#if el.type === 'text'}
										<Input name="text" value={el.parsedConfig.text ?? ''} />
									{:else if el.type === 'button' || el.type === 'cta' || el.type === 'link'}
										<div class="grid gap-3 sm:grid-cols-2">
											<Input name="text" value={el.parsedConfig.text ?? ''} />
											<Input name="url" type="url" value={el.parsedConfig.url ?? ''} />
										</div>
									{:else if el.type === 'logo' || el.type === 'image'}
										{@const selectedAssetId = editAssetIds[el.id] ?? el.parsedConfig.assetId ?? ''}
										<input type="hidden" name="assetId" value={selectedAssetId} />
										<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
											{#each assetsForType(el.type) as asset (asset.id)}
												<button
													type="button"
													class="rounded-md border p-2 {selectedAssetId === asset.id
														? 'border-[hsl(var(--ring))]'
														: 'border-[hsl(var(--border))]'}"
													onclick={() => {
														editAssetIds[el.id] = asset.id;
													}}
												>
													<img
														src={resolve(`/api/design-asset/${asset.id}`)}
														alt=""
														class="h-12 w-full object-contain"
													/>
												</button>
											{/each}
										</div>
									{/if}
									<Button type="submit" size="sm">Save</Button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<Card
			title="Generate content"
			description="Optional: AI fills slot values for your sections, then compose into the builder."
		>
			<div class="space-y-3">
				<textarea
					name="prompt"
					rows="4"
					bind:value={prompt}
					disabled={scaffolding}
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm disabled:opacity-50"
					placeholder="Tone, offer, audience… e.g. Warm welcome email for new signups, mention free trial"
				></textarea>
				<div class="flex flex-wrap items-center gap-2">
					{#if scaffolding}
						<Button type="button" variant="outline" onclick={stopScaffold}>Stop</Button>
						<span class="text-sm text-[hsl(var(--muted-foreground))]">{scaffoldStatus}</span>
					{:else}
						<Button
							type="button"
							disabled={localElements.length === 0}
							onclick={() => void startScaffold()}
						>
							Generate content
						</Button>
					{/if}
				</div>
				{#if scaffoldError}
					<p class="text-sm text-[hsl(var(--destructive))]">{scaffoldError}</p>
				{/if}
				{#if scaffoldStream || scaffolding}
					<pre
						class="max-h-64 overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 font-mono text-xs whitespace-pre-wrap text-[hsl(var(--foreground))]"
						aria-live="polite">{scaffoldStream || 'Waiting for model…'}</pre>
				{/if}
			</div>
		</Card>

		<Card
			title="Compose into builder"
			description="Optional: merge sections + generated copy into the email builder (overwrites current document)."
		>
			<form
				method="POST"
				action="?/compose"
				use:enhance={() => {
					if (
						data.hasHtml &&
						!confirm('This overwrites the current email builder document. Continue?')
					) {
						return async () => {};
					}
					composing = true;
					return async ({ update }) => {
						await update();
						composing = false;
						assistOpen = false;
					};
				}}
				class="space-y-3"
			>
				<Button type="submit" disabled={composing || localElements.length === 0}>
					{composing ? 'Composing…' : 'Compose into builder'}
				</Button>
			</form>
		</Card>
	</div>
{/if}

<Modal
	open={pickerOpen}
	title={pickerMode === 'single-edit' ? 'Change section' : 'Add design-system sections'}
	description={pickerMode === 'single-edit'
		? 'Pick one library section to replace this element.'
		: 'Select one or more sections to include.'}
	onClose={closePicker}
>
	{#if designComponents.length === 0}
		<p class="text-sm text-[hsl(var(--muted-foreground))]">
			No components yet. Add some on
			<a href={resolve('/design-system')} class="underline">Design system</a>.
		</p>
	{:else}
		<div class="flex flex-wrap gap-3">
			{#each designComponents as component (component.id)}
				{@const selected = isPickerCardSelected(component.id)}
				<button
					type="button"
					class="flex min-w-0 flex-1 basis-[calc(50%-0.375rem)] flex-col overflow-hidden rounded-md border text-left {selected
						? 'border-[hsl(var(--ring))] bg-[hsl(var(--muted))]/40 ring-1 ring-[hsl(var(--ring))]'
						: 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/20'}"
					onclick={() => togglePickerId(component.id)}
				>
					<div class="h-44 overflow-hidden bg-white p-2 text-[#111]">
						{@html componentPreviewHtml(component.html)}
					</div>
					<div class="border-t border-[hsl(var(--border))] px-3 py-2">
						<p class="truncate text-sm font-medium">{component.name}</p>
						{#if component.description}
							<p class="truncate text-xs text-[hsl(var(--muted-foreground))]">
								{component.description}
							</p>
						{/if}
					</div>
				</button>
			{/each}
		</div>

		{#if pickerMode === 'multi-add'}
			<form
				method="POST"
				action="?/addElements"
				use:enhance={() => {
					return async ({ update, result }) => {
						await update();
						if (result.type === 'success') closePicker();
					};
				}}
				class="mt-4 flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))] pt-4"
			>
				{#each pickerSelectedIds as id (id)}
					<input type="hidden" name="designComponentId" value={id} />
				{/each}
				<input type="hidden" name="required" value="on" />
				<Button type="submit" disabled={pickerSelectedCount === 0}>
					{pickerSelectedCount === 0 ? 'Add selected' : `Add ${pickerSelectedCount} selected`}
				</Button>
				<Button type="button" variant="ghost" onclick={closePicker}>Cancel</Button>
			</form>
		{:else if pickerEditElement}
			{@const selectedLib = designComponents.find((c) => c.id === pickerSingleId)}
			<form
				method="POST"
				action="?/updateElement"
				use:enhance={() => {
					return async ({ update, result }) => {
						await update();
						if (result.type === 'success') closePicker();
					};
				}}
				class="mt-4 flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))] pt-4"
			>
				<input type="hidden" name="id" value={pickerEditElement.id} />
				<input type="hidden" name="label" value={selectedLib?.name ?? pickerEditElement.label} />
				<input type="hidden" name="designComponentId" value={pickerSingleId} />
				{#if pickerEditElement.required}
					<input type="hidden" name="required" value="on" />
				{/if}
				<Button
					type="submit"
					disabled={!pickerSingleId ||
						pickerSingleId === pickerEditElement.parsedConfig.designComponentId}
				>
					Use this section
				</Button>
				<Button type="button" variant="ghost" onclick={closePicker}>Cancel</Button>
			</form>
		{/if}
	{/if}
</Modal>

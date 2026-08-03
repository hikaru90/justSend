<script lang="ts">
	import { getContext } from 'svelte';
	import { resolve } from '$app/paths';
	import { EDITOR_KEY } from './context';
	import { LIBRARY_KEY, EmailBuilderLibrary } from './library-context.svelte';
	import type { EmailEditorState } from './editor-state.svelte';

	const editor = getContext<EmailEditorState>(EDITOR_KEY);
	const library = getContext<EmailBuilderLibrary>(LIBRARY_KEY);
	const designColors = $derived(library?.colors ?? []);
	const libraryAssets = $derived(library?.assets ?? []);
	const selectedId = $derived(editor.selectedBlockId);
	const block = $derived(selectedId ? editor.document[selectedId] : null);
	let uploadingAsset = $state(false);
	let uploadError = $state<string | null>(null);

	function setProps(patch: Record<string, unknown>) {
		if (!selectedId || !block) return;
		editor.updateBlock(selectedId, {
			...block,
			data: {
				...block.data,
				props: { ...(block.data.props ?? {}), ...patch },
			},
		});
	}

	function setLayoutField(key: string, value: string) {
		if (!selectedId || !block || block.type !== 'EmailLayout') return;
		editor.updateBlock(selectedId, {
			...block,
			data: { ...block.data, [key]: value },
		});
	}

	type BlockStyle = {
		backgroundColor?: string | null;
		borderColor?: string | null;
		borderRadius?: number | null;
		color?: string | null;
		padding?: { top: number; bottom: number; left: number; right: number } | null;
		backgroundImage?: string | null;
		backgroundSize?: 'cover' | 'contain' | null;
		backgroundPosition?: string | null;
		backgroundRepeat?: 'no-repeat' | 'repeat' | null;
		minHeight?: number | null;
		overlayColor?: string | null;
		textAlign?: 'left' | 'center' | 'right' | null;
		contentAlignment?: 'top' | 'middle' | 'bottom' | null;
	};

	function setStyle(patch: BlockStyle) {
		if (!selectedId || !block) return;
		const prev = (block.data.style as BlockStyle | undefined) ?? {};
		editor.updateBlock(selectedId, {
			...block,
			data: {
				...block.data,
				style: { ...prev, ...patch },
			},
		});
	}

	function setPaddingSide(side: 'top' | 'right' | 'bottom' | 'left', value: number) {
		if (!selectedId || !block) return;
		const prev = (block.data.style as BlockStyle | undefined)?.padding ?? {
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
		};
		setStyle({
			padding: {
				top: prev.top ?? 0,
				right: prev.right ?? 0,
				bottom: prev.bottom ?? 0,
				left: prev.left ?? 0,
				[side]: value,
			},
		});
	}

	function hexColor(value: string | null | undefined, fallback: string): string {
		if (value && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
		return fallback;
	}

	const textValue = $derived(String((block?.data.props as { text?: string })?.text ?? ''));
	const urlValue = $derived(String((block?.data.props as { url?: string })?.url ?? ''));
	const htmlValue = $derived(String((block?.data.props as { contents?: string })?.contents ?? ''));
	const imageUrl = $derived(String((block?.data.props as { url?: string })?.url ?? ''));
	const imageAlt = $derived(String((block?.data.props as { alt?: string })?.alt ?? ''));
	const imageWidth = $derived((block?.data.props as { width?: number | null })?.width ?? null);
	const imageContentAlignment = $derived(
		String((block?.data.props as { contentAlignment?: string })?.contentAlignment ?? 'middle'),
	);
	const imageTextAlign = $derived(
		String((block?.data.style as BlockStyle | undefined)?.textAlign ?? 'left'),
	);
	const blockStyle = $derived((block?.data.style as BlockStyle | undefined) ?? {});
	const padding = $derived(blockStyle.padding ?? { top: 0, right: 0, bottom: 0, left: 0 });
	const bgImageUrl = $derived(String(blockStyle.backgroundImage ?? ''));
	const bgSize = $derived(blockStyle.backgroundSize ?? 'cover');
	const bgPosition = $derived(blockStyle.backgroundPosition ?? 'center');
	const bgMinHeight = $derived(blockStyle.minHeight ?? 200);
	const overlayColor = $derived(blockStyle.overlayColor ?? null);
	const containerTextAlign = $derived(blockStyle.textAlign ?? 'left');
	const containerContentAlignment = $derived(
		blockStyle.contentAlignment ?? (bgImageUrl ? 'middle' : 'top'),
	);
	const columnsProps = $derived(
		(block?.data.props as {
			columns?: Array<{ childrenIds: string[] }>;
			columnsCount?: number;
			columnsGap?: number;
			contentAlignment?: string;
		}) ?? {},
	);

	function setColumnsCount(count: 2 | 3) {
		if (!selectedId || !block || block.type !== 'ColumnsContainer') return;
		const existing =
			(block.data.props as { columns?: Array<{ childrenIds: string[] }> })?.columns ?? [];
		const columns = Array.from({ length: count }, (_, i) => existing[i] ?? { childrenIds: [] });
		setProps({ columnsCount: count, columns });
	}

	function designAssetUrl(assetId: string): string {
		// Root-relative so saved documents work across localhost and production.
		return resolve(`/api/design-asset/${assetId}`);
	}

	function isSelectedAssetUrl(current: string, assetId: string): boolean {
		if (!current) return false;
		const relative = designAssetUrl(assetId);
		return current === relative || current.endsWith(`/api/design-asset/${assetId}`);
	}

	function pickLibraryAsset(assetId: string) {
		setProps({ url: designAssetUrl(assetId) });
	}

	function pickBackgroundAsset(assetId: string) {
		setStyle({ backgroundImage: designAssetUrl(assetId) });
	}

	async function uploadImageAsset(file: File, target: 'props' | 'background' = 'props') {
		uploadError = null;
		if (!library?.onUploadAsset) {
			uploadError = 'Image upload is not available here.';
			return;
		}
		uploadingAsset = true;
		try {
			const asset = await library.onUploadAsset(file);
			if (asset?.id) {
				library.assets = [
					{ id: asset.id, name: asset.name, kind: asset.kind },
					...library.assets.filter((a) => a.id !== asset.id),
				];
				if (target === 'background') pickBackgroundAsset(asset.id);
				else pickLibraryAsset(asset.id);
			} else {
				uploadError = 'Upload failed.';
			}
		} catch (e) {
			uploadError = e instanceof Error ? e.message : 'Upload failed.';
		} finally {
			uploadingAsset = false;
		}
	}
</script>

{#snippet colorSwatches(value: string | null, onSelect: (color: string | null) => void)}
	{#if designColors.length}
		<div class="mt-1 flex flex-wrap gap-1">
			<button
				type="button"
				title="Remove color"
				aria-label="Remove color"
				class="size-5 rounded border {value === null
					? 'border-[hsl(var(--ring))] ring-2 ring-[hsl(var(--ring))]'
					: 'border-[hsl(var(--border))]'} flex items-center justify-center bg-white text-[hsl(var(--muted-foreground))]"
				onclick={() => onSelect(null)}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
				>
			</button>
			{#each designColors as color (color)}
				<button
					type="button"
					title={color}
					aria-label={color}
					class="size-5 rounded border {value?.toLowerCase() === color.toLowerCase()
						? 'border-[hsl(var(--ring))] ring-2 ring-[hsl(var(--ring))]'
						: 'border-[hsl(var(--border))]'}"
					style="background: {color}"
					onclick={() => onSelect(color)}
				></button>
			{/each}
		</div>
	{/if}
{/snippet}

{#if !block || !selectedId}
	<div class="space-y-2">
		<p class="text-sm font-medium">Styles</p>
		<p class="text-xs text-[hsl(var(--muted-foreground))]">
			Click a block in the email to edit its copy and styles here. Use the + buttons between blocks
			to add Heading, Text, Button, Image, and more.
		</p>
		{#if editor.document.root?.type === 'EmailLayout'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Canvas background</span>
				<input
					type="color"
					class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
					value={String(editor.document.root.data.canvasColor ?? '#FFFFFF')}
					oninput={(e) => {
						const root = editor.document.root;
						if (!root) return;
						editor.updateBlock('root', {
							...root,
							data: { ...root.data, canvasColor: e.currentTarget.value },
						});
					}}
				/>
				{@render colorSwatches(
					String(editor.document.root.data.canvasColor ?? '#FFFFFF'),
					(color) => {
						const root = editor.document.root;
						if (!root) return;
						editor.updateBlock('root', {
							...root,
							data: { ...root.data, canvasColor: color ?? '' },
						});
					},
				)}
			</label>
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Backdrop</span>
				<input
					type="color"
					class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
					value={String(editor.document.root.data.backdropColor ?? '#F5F5F5')}
					oninput={(e) => {
						const root = editor.document.root;
						if (!root) return;
						editor.updateBlock('root', {
							...root,
							data: { ...root.data, backdropColor: e.currentTarget.value },
						});
					}}
				/>
				{@render colorSwatches(
					String(editor.document.root.data.backdropColor ?? '#F5F5F5'),
					(color) => {
						const root = editor.document.root;
						if (!root) return;
						editor.updateBlock('root', {
							...root,
							data: { ...root.data, backdropColor: color ?? '' },
						});
					},
				)}
			</label>
		{/if}
	</div>
{:else}
	<div class={block.type === 'Text' ? 'flex min-h-0 flex-1 flex-col gap-3' : 'space-y-3'}>
		<p class="shrink-0 text-sm font-medium">{block.type} block</p>

		{#if block.type === 'Heading' || block.type === 'Text' || block.type === 'Button'}
			<label
				class={block.type === 'Text'
					? 'flex min-h-0 flex-1 flex-col gap-1 text-xs'
					: 'block space-y-1 text-xs'}
			>
				<span class="shrink-0 text-[hsl(var(--muted-foreground))]">
					{block.type === 'Button' ? 'Label' : 'Content'}
				</span>
				<textarea
					rows={block.type === 'Text' ? undefined : 2}
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm {block.type ===
					'Text'
						? 'min-h-0 flex-1 resize-none'
						: ''}"
					value={textValue}
					oninput={(e) =>
						setProps(
							block.type === 'Text'
								? { text: e.currentTarget.value, markdown: true }
								: { text: e.currentTarget.value },
						)}></textarea>
				{#if block.type === 'Text'}
					<span class="shrink-0 text-[hsl(var(--muted-foreground))]">
						Supports Markdown (e.g. **bold**, *italic*, [links](https://…), lists).
					</span>
				{/if}
			</label>
		{/if}

		{#if block.type === 'Button'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">URL</span>
				<input
					type="url"
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={urlValue}
					oninput={(e) => setProps({ url: e.currentTarget.value })}
				/>
			</label>
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Button background</span>
				<input
					type="color"
					class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
					value={hexColor(
						String(
							(block.data.props as { buttonBackgroundColor?: string })?.buttonBackgroundColor ?? '',
						) || null,
						'#000000',
					)}
					oninput={(e) => setProps({ buttonBackgroundColor: e.currentTarget.value })}
				/>
				{@render colorSwatches(
					(block.data.props as { buttonBackgroundColor?: string })?.buttonBackgroundColor ?? null,
					(color) => setProps({ buttonBackgroundColor: color ?? '#000000' }),
				)}
			</label>
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Button text</span>
				<input
					type="color"
					class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
					value={hexColor(
						String(
							(block.data.props as { buttonTextColor?: string })?.buttonTextColor ?? '',
						) || null,
						'#FFFFFF',
					)}
					oninput={(e) => setProps({ buttonTextColor: e.currentTarget.value })}
				/>
				{@render colorSwatches(
					(block.data.props as { buttonTextColor?: string })?.buttonTextColor ?? null,
					(color) => setProps({ buttonTextColor: color ?? '#FFFFFF' }),
				)}
			</label>
		{/if}

		{#if block.type === 'Heading' || block.type === 'Text'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Text color</span>
				<input
					type="color"
					class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
					value={hexColor(blockStyle.color ?? null, '#262626')}
					oninput={(e) => setStyle({ color: e.currentTarget.value })}
				/>
				{@render colorSwatches(blockStyle.color ?? null, (color) => setStyle({ color }))}
			</label>
		{/if}

		{#if block.type === 'Image'}
			<div class="space-y-2">
				<p class="text-xs font-medium text-[hsl(var(--muted-foreground))]">Image</p>
				{#if libraryAssets.length > 0}
					<div class="grid grid-cols-3 gap-2">
						{#each libraryAssets as asset (asset.id)}
							{@const assetUrl = designAssetUrl(asset.id)}
							<button
								type="button"
								class="rounded-md border p-1.5 text-left {isSelectedAssetUrl(imageUrl, asset.id)
									? 'border-[hsl(var(--ring))] bg-[hsl(var(--muted))]/50'
									: 'border-[hsl(var(--border))]'}"
								onclick={() => pickLibraryAsset(asset.id)}
							>
								<img src={assetUrl} alt="" class="mb-1 h-10 w-full object-contain" />
								<p class="truncate text-[10px] font-medium">{asset.name}</p>
							</button>
						{/each}
					</div>
				{/if}
				{#if library?.onUploadAsset}
					<label class="block space-y-1 text-xs">
						<span class="text-[hsl(var(--muted-foreground))]">Upload</span>
						<input
							type="file"
							accept="image/*"
							disabled={uploadingAsset}
							class="block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-[hsl(var(--secondary))] file:px-2 file:py-1"
							onchange={(e) => {
								const file = e.currentTarget.files?.[0];
								if (file) void uploadImageAsset(file);
								e.currentTarget.value = '';
							}}
						/>
					</label>
					{#if uploadingAsset}
						<p class="text-[10px] text-[hsl(var(--muted-foreground))]">Uploading…</p>
					{/if}
					{#if uploadError}
						<p class="text-[10px] text-[hsl(var(--destructive))]">{uploadError}</p>
					{/if}
				{/if}
				<label class="block space-y-1 text-xs">
					<span class="text-[hsl(var(--muted-foreground))]">Image URL</span>
					<input
						type="url"
						class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
						value={imageUrl}
						oninput={(e) => setProps({ url: e.currentTarget.value })}
					/>
				</label>
			</div>
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Alt text</span>
				<input
					type="text"
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={imageAlt}
					oninput={(e) => setProps({ alt: e.currentTarget.value })}
				/>
			</label>
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Width (px)</span>
				<input
					type="number"
					min="1"
					placeholder="auto"
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={imageWidth ?? ''}
					oninput={(e) => {
						const raw = e.currentTarget.value.trim();
						if (!raw) {
							setProps({ width: null });
							return;
						}
						const n = Number(raw);
						setProps({ width: Number.isFinite(n) && n > 0 ? n : null });
					}}
				/>
			</label>
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Horizontal alignment</span>
				<select
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={imageTextAlign}
					onchange={(e) => {
						const v = e.currentTarget.value;
						setStyle({
							textAlign: v === 'center' || v === 'right' ? v : 'left',
						});
					}}
				>
					<option value="left">Left</option>
					<option value="center">Center</option>
					<option value="right">Right</option>
				</select>
			</label>
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Vertical alignment</span>
				<select
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={imageContentAlignment}
					onchange={(e) => {
						const v = e.currentTarget.value;
						setProps({
							contentAlignment: v === 'top' || v === 'bottom' ? v : 'middle',
						});
					}}
				>
					<option value="top">Top</option>
					<option value="middle">Middle</option>
					<option value="bottom">Bottom</option>
				</select>
			</label>
		{/if}

		{#if block.type === 'Html'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">HTML</span>
				<textarea
					rows={12}
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 font-mono text-xs"
					value={htmlValue}
					oninput={(e) => setProps({ contents: e.currentTarget.value })}></textarea>
			</label>
			<p class="text-xs text-[hsl(var(--muted-foreground))]">
				Tip: replace this with Heading / Text / Button blocks (+ between sections) for easier copy
				editing.
			</p>
		{/if}

		{#if block.type === 'Heading'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Level</span>
				<select
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={String((block.data.props as { level?: string })?.level ?? 'h2')}
					onchange={(e) => setProps({ level: e.currentTarget.value })}
				>
					<option value="h1">H1</option>
					<option value="h2">H2</option>
					<option value="h3">H3</option>
				</select>
			</label>
		{/if}

		{#if block.type === 'EmailLayout'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Canvas color</span>
				<input
					type="color"
					class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
					value={String(block.data.canvasColor ?? '#FFFFFF')}
					oninput={(e) => setLayoutField('canvasColor', e.currentTarget.value)}
				/>
				{@render colorSwatches(String(block.data.canvasColor ?? '#FFFFFF'), (color) =>
					setLayoutField('canvasColor', color ?? ''),
				)}
			</label>
		{/if}

		{#if block.type === 'Container' || block.type === 'ColumnsContainer'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Background</span>
				<input
					type="color"
					class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
					value={hexColor(blockStyle.backgroundColor, '#FFFFFF')}
					oninput={(e) => setStyle({ backgroundColor: e.currentTarget.value })}
				/>
				{@render colorSwatches(blockStyle.backgroundColor ?? null, (color) =>
					setStyle({ backgroundColor: color }),
				)}
			</label>

			{#if block.type === 'Container'}
				<div class="space-y-2">
					<p class="text-xs font-medium text-[hsl(var(--muted-foreground))]">Background image</p>
					{#if libraryAssets.length > 0}
						<div class="grid grid-cols-3 gap-2">
							{#each libraryAssets as asset (asset.id)}
								{@const assetUrl = designAssetUrl(asset.id)}
								<button
									type="button"
									class="rounded-md border p-1.5 text-left {isSelectedAssetUrl(bgImageUrl, asset.id)
										? 'border-[hsl(var(--ring))] bg-[hsl(var(--muted))]/50'
										: 'border-[hsl(var(--border))]'}"
									onclick={() => pickBackgroundAsset(asset.id)}
								>
									<img src={assetUrl} alt="" class="mb-1 h-10 w-full object-contain" />
									<p class="truncate text-[10px] font-medium">{asset.name}</p>
								</button>
							{/each}
						</div>
					{/if}
					{#if library?.onUploadAsset}
						<label class="block space-y-1 text-xs">
							<span class="text-[hsl(var(--muted-foreground))]">Upload</span>
							<input
								type="file"
								accept="image/*"
								disabled={uploadingAsset}
								class="block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-[hsl(var(--secondary))] file:px-2 file:py-1"
								onchange={(e) => {
									const file = e.currentTarget.files?.[0];
									if (file) void uploadImageAsset(file, 'background');
									e.currentTarget.value = '';
								}}
							/>
						</label>
						{#if uploadingAsset}
							<p class="text-[10px] text-[hsl(var(--muted-foreground))]">Uploading…</p>
						{/if}
						{#if uploadError}
							<p class="text-[10px] text-[hsl(var(--destructive))]">{uploadError}</p>
						{/if}
					{/if}
					<label class="block space-y-1 text-xs">
						<span class="text-[hsl(var(--muted-foreground))]">Image URL</span>
						<input
							type="url"
							class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
							value={bgImageUrl}
							oninput={(e) => setStyle({ backgroundImage: e.currentTarget.value || null })}
						/>
					</label>
					{#if bgImageUrl}
						<button
							type="button"
							class="text-xs text-[hsl(var(--muted-foreground))] underline"
							onclick={() => setStyle({ backgroundImage: null })}
						>
							Clear background image
						</button>
					{/if}
				</div>
				<label class="block space-y-1 text-xs">
					<span class="text-[hsl(var(--muted-foreground))]">Background size</span>
					<select
						class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
						value={bgSize}
						onchange={(e) =>
							setStyle({
								backgroundSize: e.currentTarget.value === 'contain' ? 'contain' : 'cover',
							})}
					>
						<option value="cover">Cover</option>
						<option value="contain">Contain</option>
					</select>
				</label>
				<label class="block space-y-1 text-xs">
					<span class="text-[hsl(var(--muted-foreground))]">Background position</span>
					<select
						class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
						value={bgPosition}
						onchange={(e) => setStyle({ backgroundPosition: e.currentTarget.value })}
					>
						<option value="center">Center</option>
						<option value="top">Top</option>
						<option value="bottom">Bottom</option>
						<option value="left">Left</option>
						<option value="right">Right</option>
					</select>
				</label>
				<label class="block space-y-1 text-xs">
					<span class="text-[hsl(var(--muted-foreground))]">Min height (px)</span>
					<input
						type="number"
						min="0"
						class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
						value={bgMinHeight}
						oninput={(e) => setStyle({ minHeight: Number(e.currentTarget.value) || 0 })}
					/>
				</label>
				<label class="block space-y-1 text-xs">
					<span class="text-[hsl(var(--muted-foreground))]">Overlay color</span>
					<input
						type="color"
						class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
						value={hexColor(overlayColor, '#000000')}
						oninput={(e) => setStyle({ overlayColor: e.currentTarget.value })}
					/>
					{@render colorSwatches(overlayColor, (color) => setStyle({ overlayColor: color }))}
				</label>
				<label class="block space-y-1 text-xs">
					<span class="text-[hsl(var(--muted-foreground))]">Border color</span>
					<input
						type="color"
						class="h-8 w-full cursor-pointer rounded border border-[hsl(var(--input))]"
						value={hexColor(blockStyle.borderColor, '#CCCCCC')}
						oninput={(e) => setStyle({ borderColor: e.currentTarget.value })}
					/>
					{@render colorSwatches(blockStyle.borderColor ?? null, (color) =>
						setStyle({ borderColor: color }),
					)}
				</label>
				<label class="block space-y-1 text-xs">
					<span class="text-[hsl(var(--muted-foreground))]">Border radius (px)</span>
					<input
						type="number"
						min="0"
						class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
						value={blockStyle.borderRadius ?? 0}
						oninput={(e) => setStyle({ borderRadius: Number(e.currentTarget.value) || 0 })}
					/>
				</label>
				<label class="block space-y-1 text-xs">
					<span class="text-[hsl(var(--muted-foreground))]">Horizontal alignment</span>
					<select
						class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
						value={containerTextAlign}
						onchange={(e) => {
							const v = e.currentTarget.value;
							setStyle({
								textAlign: v === 'center' || v === 'right' ? v : 'left',
							});
						}}
					>
						<option value="left">Left</option>
						<option value="center">Center</option>
						<option value="right">Right</option>
					</select>
				</label>
				<label class="block space-y-1 text-xs">
					<span class="text-[hsl(var(--muted-foreground))]">Vertical alignment</span>
					<select
						class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
						value={containerContentAlignment}
						onchange={(e) => {
							const v = e.currentTarget.value;
							setStyle({
								contentAlignment: v === 'middle' || v === 'bottom' ? v : 'top',
							});
						}}
					>
						<option value="top">Top</option>
						<option value="middle">Middle</option>
						<option value="bottom">Bottom</option>
					</select>
				</label>
			{/if}

			<div class="space-y-1">
				<p class="text-xs text-[hsl(var(--muted-foreground))]">Padding (px)</p>
				<div class="grid grid-cols-2 gap-2">
					<label class="block space-y-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
						Top
						<input
							type="number"
							min="0"
							class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1 text-sm"
							value={padding.top ?? 0}
							oninput={(e) => setPaddingSide('top', Number(e.currentTarget.value) || 0)}
						/>
					</label>
					<label class="block space-y-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
						Right
						<input
							type="number"
							min="0"
							class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1 text-sm"
							value={padding.right ?? 0}
							oninput={(e) => setPaddingSide('right', Number(e.currentTarget.value) || 0)}
						/>
					</label>
					<label class="block space-y-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
						Bottom
						<input
							type="number"
							min="0"
							class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1 text-sm"
							value={padding.bottom ?? 0}
							oninput={(e) => setPaddingSide('bottom', Number(e.currentTarget.value) || 0)}
						/>
					</label>
					<label class="block space-y-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
						Left
						<input
							type="number"
							min="0"
							class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1 text-sm"
							value={padding.left ?? 0}
							oninput={(e) => setPaddingSide('left', Number(e.currentTarget.value) || 0)}
						/>
					</label>
				</div>
			</div>
		{/if}

		{#if block.type === 'ColumnsContainer'}
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Columns</span>
				<select
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={String(columnsProps.columnsCount ?? 2)}
					onchange={(e) => setColumnsCount(Number(e.currentTarget.value) === 3 ? 3 : 2)}
				>
					<option value="2">2</option>
					<option value="3">3</option>
				</select>
			</label>
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Column gap (px)</span>
				<input
					type="number"
					min="0"
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={columnsProps.columnsGap ?? 16}
					oninput={(e) => setProps({ columnsGap: Number(e.currentTarget.value) || 0 })}
				/>
			</label>
			<label class="block space-y-1 text-xs">
				<span class="text-[hsl(var(--muted-foreground))]">Content alignment</span>
				<select
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					value={columnsProps.contentAlignment ?? 'top'}
					onchange={(e) => setProps({ contentAlignment: e.currentTarget.value })}
				>
					<option value="top">Top</option>
					<option value="middle">Middle</option>
					<option value="bottom">Bottom</option>
				</select>
			</label>
		{/if}
	</div>
{/if}

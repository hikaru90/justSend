<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import { ArrowDown, ArrowUp, Copy, Trash2 } from '@lucide/svelte';

	let {
		html = $bindable(''),
		onSave,
		saving = false,
	}: {
		html?: string;
		onSave?: (html: string) => void | Promise<void>;
		saving?: boolean;
	} = $props();

	type SelectedInfo = {
		id: string;
		tag: string;
		styleText: string;
		text: string;
		isSection: boolean;
	};

	type StyleRow = { prop: string; value: string };

	let selected = $state<SelectedInfo | null>(null);
	let styleRows = $state<StyleRow[]>([]);
	let textDraft = $state('');
	let iframeEl = $state<HTMLIFrameElement | null>(null);
	let dirty = $state(false);

	const COMMON_PROPS = [
		'color',
		'background-color',
		'font-size',
		'font-weight',
		'line-height',
		'padding',
		'margin',
		'text-align',
		'border-radius',
		'width',
		'max-width',
	];

	function parseStyle(styleText: string): StyleRow[] {
		return styleText
			.split(';')
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => {
				const idx = part.indexOf(':');
				if (idx < 0) return { prop: part.trim(), value: '' };
				return {
					prop: part.slice(0, idx).trim(),
					value: part.slice(idx + 1).trim(),
				};
			})
			.filter((r) => r.prop);
	}

	function serializeStyle(rows: StyleRow[]): string {
		return rows
			.filter((r) => r.prop.trim())
			.map((r) => `${r.prop.trim()}: ${r.value.trim()}`)
			.join('; ');
	}

	function assignOwlIds(docHtml: string): { html: string; sections: string[] } {
		if (typeof DOMParser === 'undefined') {
			return { html: docHtml, sections: [] };
		}
		const parser = new DOMParser();
		const doc = parser.parseFromString(docHtml, 'text/html');
		let counter = 0;
		const sections: string[] = [];
		const walk = (node: Element) => {
			if (!node.getAttribute('data-owl-id')) {
				node.setAttribute('data-owl-id', `owl-${++counter}`);
			}
			if (
				node.hasAttribute('data-owl-section') ||
				(node.parentElement?.hasAttribute('data-owl-sections') &&
					(node.tagName === 'TABLE' || node.tagName === 'DIV'))
			) {
				sections.push(node.getAttribute('data-owl-id')!);
			}
			for (const child of Array.from(node.children)) {
				walk(child);
			}
		};
		if (doc.body) walk(doc.body);
		// Prefer explicit data-owl-section markers
		const marked = Array.from(doc.querySelectorAll('[data-owl-section]')).map((el) =>
			el.getAttribute('data-owl-id')!,
		);
		return {
			html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`,
			sections: marked.length ? marked : sections,
		};
	}

	const prepared = $derived.by(() => assignOwlIds(html || '<p></p>'));
	const sectionIds = $derived(prepared.sections);

	const editorScript = `
<script>
(function () {
  var selectedId = null;
  function post(type, payload) {
    parent.postMessage(Object.assign({ source: 'owlery-editor', type: type }, payload || {}), '*');
  }
  function clearOutline() {
    document.querySelectorAll('[data-owl-hover]').forEach(function (el) {
      el.removeAttribute('data-owl-hover');
      el.style.outline = el.getAttribute('data-owl-prev-outline') || '';
      el.removeAttribute('data-owl-prev-outline');
    });
  }
  document.addEventListener('mouseover', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || !t.getAttribute('data-owl-id')) return;
    clearOutline();
    t.setAttribute('data-owl-hover', '1');
    t.setAttribute('data-owl-prev-outline', t.style.outline || '');
    t.style.outline = '2px solid #6366f1';
  }, true);
  document.addEventListener('mouseout', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.getAttribute('data-owl-id') === selectedId) return;
    clearOutline();
  }, true);
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var id = t.getAttribute('data-owl-id');
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    selectedId = id;
    clearOutline();
    t.style.outline = '2px solid #4f46e5';
    var isSection = t.hasAttribute('data-owl-section');
    var text = '';
    if (t.childElementCount === 0) text = t.textContent || '';
    else if (t.children.length === 1 && t.children[0].tagName === 'A') {
      text = t.children[0].textContent || '';
    }
    post('select', {
      id: id,
      tag: t.tagName.toLowerCase(),
      styleText: t.getAttribute('style') || '',
      text: text,
      isSection: isSection
    });
  }, true);
  post('ready', {});
})();
<\/script>`;

	const srcdoc = $derived(prepared.html.replace(/<\/body>/i, `${editorScript}</body>`));

	$effect(() => {
		function onMessage(event: MessageEvent) {
			const data = event.data;
			if (!data || data.source !== 'owlery-editor') return;
			if (data.type === 'select') {
				selected = {
					id: data.id,
					tag: data.tag,
					styleText: data.styleText || '',
					text: data.text || '',
					isSection: Boolean(data.isSection),
				};
				styleRows = parseStyle(data.styleText || '');
				textDraft = data.text || '';
			}
		}
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	});

	function mutateDoc(mutator: (doc: Document) => void) {
		const parser = new DOMParser();
		const doc = parser.parseFromString(prepared.html, 'text/html');
		mutator(doc);
		const next = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
		html = next;
		dirty = true;
	}

	function applyStyles() {
		if (!selected) return;
		const style = serializeStyle(styleRows);
		mutateDoc((doc) => {
			const el = doc.querySelector(`[data-owl-id="${selected!.id}"]`);
			if (!el) return;
			if (style) el.setAttribute('style', style);
			else el.removeAttribute('style');
		});
		selected = { ...selected, styleText: style };
	}

	function applyText() {
		if (!selected) return;
		mutateDoc((doc) => {
			const el = doc.querySelector(`[data-owl-id="${selected!.id}"]`);
			if (!el) return;
			if (el.childElementCount === 0) {
				el.textContent = textDraft;
			} else if (el.children.length === 1 && el.children[0].tagName === 'A') {
				el.children[0].textContent = textDraft;
			} else {
				el.textContent = textDraft;
			}
		});
		selected = { ...selected, text: textDraft };
	}

	function addStyleRow() {
		styleRows = [...styleRows, { prop: 'color', value: '#000000' }];
	}

	function removeStyleRow(index: number) {
		styleRows = styleRows.filter((_, i) => i !== index);
		applyStyles();
	}

	function moveSection(id: string, direction: -1 | 1) {
		mutateDoc((doc) => {
			const el = doc.querySelector(`[data-owl-id="${id}"]`);
			if (!el || !el.parentElement) return;
			const parent = el.parentElement;
			const siblings = Array.from(parent.children).filter((c) =>
				c.hasAttribute('data-owl-section'),
			);
			const idx = siblings.indexOf(el);
			const swap = siblings[idx + direction];
			if (!swap) return;
			if (direction === -1) parent.insertBefore(el, swap);
			else parent.insertBefore(swap, el);
		});
	}

	function deleteSection(id: string) {
		mutateDoc((doc) => {
			const el = doc.querySelector(`[data-owl-id="${id}"]`);
			el?.remove();
		});
		if (selected?.id === id) selected = null;
	}

	function duplicateSection(id: string) {
		mutateDoc((doc) => {
			const el = doc.querySelector(`[data-owl-id="${id}"]`);
			if (!el || !el.parentElement) return;
			const clone = el.cloneNode(true) as Element;
			clone.querySelectorAll('[data-owl-id]').forEach((node) => {
				node.removeAttribute('data-owl-id');
			});
			clone.removeAttribute('data-owl-id');
			el.parentElement.insertBefore(clone, el.nextSibling);
		});
	}

	async function save() {
		if (!onSave) return;
		await onSave(html);
		dirty = false;
	}

	function sectionLabel(id: string): string {
		if (typeof DOMParser === 'undefined') return id;
		const parser = new DOMParser();
		const doc = parser.parseFromString(prepared.html, 'text/html');
		const el = doc.querySelector(`[data-owl-id="${id}"]`);
		const name = el?.getAttribute('data-owl-section') || el?.tagName.toLowerCase() || id;
		return name;
	}
</script>

<div class="grid gap-4 xl:grid-cols-[1fr_280px]">
	<div class="min-w-0 space-y-2">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<p class="text-sm text-[hsl(var(--muted-foreground))]">
				Click any element in the preview to edit its text and CSS.
				{#if dirty}
					<span class="font-medium text-[hsl(var(--foreground))]"> · Unsaved changes</span>
				{/if}
			</p>
			<Button type="button" size="sm" disabled={saving || !dirty} onclick={() => void save()}>
				{saving ? 'Saving…' : 'Save HTML'}
			</Button>
		</div>
		<iframe
			bind:this={iframeEl}
			title="Email visual editor"
			sandbox="allow-scripts"
			{srcdoc}
			class="min-h-[520px] w-full rounded-md border border-[hsl(var(--border))] bg-white"
		></iframe>
	</div>

	<div class="space-y-4">
		<div class="rounded-md border border-[hsl(var(--border))] p-3">
			<p
				class="mb-2 text-xs font-semibold tracking-wide text-[hsl(var(--muted-foreground))] uppercase"
			>
				Layers
			</p>
			{#if sectionIds.length === 0}
				<p class="text-xs text-[hsl(var(--muted-foreground))]">No sections detected.</p>
			{:else}
				<ul class="space-y-1">
					{#each sectionIds as id (id)}
						<li
							class="flex items-center gap-1 rounded px-1 py-1 text-sm {selected?.id === id
								? 'bg-[hsl(var(--muted))]'
								: 'hover:bg-[hsl(var(--muted))]/50'}"
						>
							<button
								type="button"
								class="min-w-0 flex-1 truncate text-left capitalize"
								onclick={() => {
									selected = {
										id,
										tag: 'section',
										styleText: '',
										text: '',
										isSection: true,
									};
								}}
							>
								{sectionLabel(id)}
							</button>
							<button
								type="button"
								class="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]"
								aria-label="Move up"
								onclick={() => moveSection(id, -1)}
							>
								<ArrowUp class="size-3.5" />
							</button>
							<button
								type="button"
								class="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]"
								aria-label="Move down"
								onclick={() => moveSection(id, 1)}
							>
								<ArrowDown class="size-3.5" />
							</button>
							<button
								type="button"
								class="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]"
								aria-label="Duplicate"
								onclick={() => duplicateSection(id)}
							>
								<Copy class="size-3.5" />
							</button>
							<button
								type="button"
								class="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--destructive))]/10 hover:text-[hsl(var(--destructive))]"
								aria-label="Delete"
								onclick={() => deleteSection(id)}
							>
								<Trash2 class="size-3.5" />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="rounded-md border border-[hsl(var(--border))] p-3">
			<p
				class="mb-2 text-xs font-semibold tracking-wide text-[hsl(var(--muted-foreground))] uppercase"
			>
				Inspector
			</p>
			{#if !selected}
				<p class="text-xs text-[hsl(var(--muted-foreground))]">Select an element to edit.</p>
			{:else}
				<p class="mb-2 font-mono text-xs text-[hsl(var(--muted-foreground))]">
					&lt;{selected.tag}&gt; · {selected.id}
				</p>

				{#if selected.text !== undefined}
					<label class="mb-1 block text-xs text-[hsl(var(--muted-foreground))]" for="owl-text"
						>Text</label
					>
					<textarea
						id="owl-text"
						rows="3"
						bind:value={textDraft}
						onblur={applyText}
						class="mb-3 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					></textarea>
				{/if}

				<p class="mb-1 text-xs text-[hsl(var(--muted-foreground))]">Inline CSS</p>
				<div class="space-y-2">
					{#each styleRows as row, index (index)}
						<div class="flex gap-1">
							<input
								list="owl-css-props"
								bind:value={row.prop}
								onchange={applyStyles}
								class="w-28 shrink-0 rounded-md border border-[hsl(var(--input))] bg-transparent px-1.5 py-1 font-mono text-xs"
								placeholder="property"
							/>
							<input
								bind:value={row.value}
								onchange={applyStyles}
								class="min-w-0 flex-1 rounded-md border border-[hsl(var(--input))] bg-transparent px-1.5 py-1 font-mono text-xs"
								placeholder="value"
							/>
							<button
								type="button"
								class="rounded px-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
								onclick={() => removeStyleRow(index)}
							>
								×
							</button>
						</div>
					{/each}
				</div>
				<datalist id="owl-css-props">
					{#each COMMON_PROPS as prop (prop)}
						<option value={prop}></option>
					{/each}
				</datalist>
				<div class="mt-2 flex gap-2">
					<Button type="button" size="sm" variant="outline" onclick={addStyleRow}
						>Add property</Button
					>
					<Button type="button" size="sm" onclick={applyStyles}>Apply</Button>
				</div>
			{/if}
		</div>
	</div>
</div>

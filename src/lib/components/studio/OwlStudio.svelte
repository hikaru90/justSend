<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { browser } from '$app/environment';
	import { tick, onMount } from 'svelte';
	import { parseActionResult } from '$lib/sveltekit-action';
	import {
		AlertTriangle,
		ChevronDown,
		ChevronUp,
		Copy,
		Hammer,
		Layers,
		LoaderCircle,
		Monitor,
		Pencil,
		Plus,
		Smartphone,
		Trash2,
		Bookmark,
		XCircle,
	} from '@lucide/svelte';
	import { designAssetPath } from '$lib/design-asset-urls';
	import {
		buildDesignColorOptions,
		orderDesignColorOptions,
		substitutePreviewPlaceholders,
	} from '$lib/design/extractTokens';
	import type { DesignColorOption } from '$lib/design/extractTokens';
	import { resolveBlockTheme, type BlockTheme } from '$lib/email-builder/block-theme';
	import StyleColorCombobox from '$lib/components/studio/StyleColorCombobox.svelte';
	import StylePropertyCombobox from '$lib/components/studio/StylePropertyCombobox.svelte';
	import { OWL } from '$lib/email/owl/format';
	import {
		applyInspectorPatch,
		applyShellInspectorPatch,
		enumOptions,
		extractInspector,
		extractShellInspector,
		findSectionIdForOwlId,
		isOwlIdInShell,
		isColorStyleProp,
		mintOwlDoc,
		mintOwlIdsInFragment,
		nextStylePropertyToAdd,
		shellBackdropBackgroundColor,
		shellBackdropCrumb,
		shellCanvasBackgroundColor,
		shellCanvasColorSet,
		shellCanvasCrumb,
		stripSectionBackgroundColors,
		stylePropertyOptions,
		styleRowKind,
		suggestedAttributes,
		updateSectionHtml,
		updateShellHtml,
		type AttrRow,
		type InspectorPatch,
		type InspectorSnapshot,
		type StyleRow,
	} from '$lib/email/owl/studio-client';
	import {
		newSectionId,
		serializeOwlDoc,
		type OwlDoc,
		type OwlSection,
	} from '$lib/email/owl/studio';
	import type { OwlIssue, OwlSlot } from '$lib/email/owl/format';
	import AiStreamFeed from '$lib/components/ai/AiStreamFeed.svelte';
	import {
		applyAiStreamEvent,
		createAiFeedReducer,
		owlProgressToStreamEvent,
		type AiFeedLine,
	} from '$lib/ai/stream-feed';
	import { findPreviewElByOwlId, syncInlinePreviewOutlines } from '$lib/email/owl/preview-outline';

	type StarterOption = {
		key: string;
		name: string;
		role: 'shell' | 'section';
		description: string;
		html: string;
	};

	type DesignSection = {
		id: string;
		name: string;
		description: string | null;
		starterKey: string | null;
		html: string;
	};

	type VisualAsset = {
		id: string;
		name: string;
		kind: 'logo' | 'image';
	};

	type OwlCompilePreview = {
		html: string;
		issues: OwlIssue[];
		sectionSlots: Record<string, OwlSlot[]>;
		sectionHtml: Record<string, string>;
	};

	type OwlComposeResult = {
		doc: OwlDoc;
		subject?: string;
		preheader?: string;
		model: string;
	};

	let {
		doc,
		templateId,
		templateName = 'Email',
		templateSubject = '',
		templateDescription = '',
		preheader = $bindable(''),
		starters,
		designSections,
		designColors = [],
		designTokens = {},
		logoAssets = [],
		imageAssets = [],
		testVariables = {},
		piConfigured = false,
		onSubjectSuggest,
	}: {
		doc: OwlDoc;
		templateId: string;
		templateName?: string;
		templateSubject?: string;
		templateDescription?: string;
		preheader?: string;
		starters: StarterOption[];
		designSections: DesignSection[];
		designColors?: string[];
		designTokens?: Record<string, string>;
		logoAssets?: VisualAsset[];
		imageAssets?: VisualAsset[];
		testVariables?: Record<string, string>;
		piConfigured?: boolean;
		onSubjectSuggest?: (subject: string) => void;
	} = $props();

	const sectionStarters = $derived(starters.filter((s) => s.role === 'section'));
	const owlAiComposeUrl = $derived(resolve(`/templates/${templateId}/owl-ai-compose`));
	const owlPiEditUrl = $derived(resolve(`/templates/${templateId}/owl-pi-edit`));

	function cloneDoc(value: OwlDoc): OwlDoc {
		const copy = JSON.parse(JSON.stringify(value)) as OwlDoc;
		return browser ? mintOwlDoc(copy) : copy;
	}

	let currentDoc = $state<OwlDoc>(cloneDoc(doc));
	let selectedId = $state<string | null>(null);
	let renamingSectionId = $state<string | null>(null);
	let renameDraft = $state('');
	let renameInputEl = $state<HTMLInputElement | null>(null);
	let selectedOwlId = $state<string | null>(null);
	let device = $state<'desktop' | 'mobile'>('desktop');
	let preview = $state<OwlCompilePreview | null>(null);
	let compileError = $state<string | null>(null);
	let addOpen = $state(false);
	let composeBusy = $state(false);
	let composeStatus = $state<string | null>(null);
	let composeError = $state<string | null>(null);
	let composeFeed = $state<AiFeedLine[]>([]);
	let hammerOpen = $state(false);
	let hammerTab = $state<'build' | 'pi'>('build');
	let piEditDraft = $state('');
	let piEditBusy = $state(false);
	let piEditStatus = $state<string | null>(null);
	let piEditError = $state<string | null>(null);
	let piEditFeed = $state<AiFeedLine[]>([]);
	let piEditSessionId = $state<string | null>(null);
	let piEditAbort: AbortController | null = null;
	let componentPiOpen = $state(false);
	let componentPiDraft = $state('');
	let componentPiBusy = $state(false);
	let componentPiStatus = $state<string | null>(null);
	let componentPiError = $state<string | null>(null);
	let componentPiFeed = $state<AiFeedLine[]>([]);
	let componentPiSessionId = $state<string | null>(null);
	let componentPiAbort: AbortController | null = null;
	let componentPiSectionId = $state<string | null>(null);
	let componentPiSectionLabel = $state('');
	let issuesOpen = $state(false);
	let inspector = $state<InspectorSnapshot | null>(null);
	let styleRows = $state<StyleRow[]>([]);
	let attrRows = $state<AttrRow[]>([]);
	let textDraft = $state('');
	let rawHtmlDraft = $state('');
	let lightEditOwlId = $state<string | null>(null);
	let styleEditOwlId = $state<string | null>(null);
	let contentTextFocused = $state(false);
	let previewRoot = $state<HTMLElement | null>(null);
	let previewIframe = $state<HTMLIFrameElement | null>(null);
	let previewScrollEl = $state<HTMLDivElement | null>(null);
	let hoverMarkedEl: HTMLElement | null = null;
	/** Live DOM node from the last preview click — preferred over id re-lookup for outlines. */
	let selectedMarkedEl: HTMLElement | null = null;
	let breadcrumbHoverOwlId = $state<string | null>(null);

	onMount(() => {
		currentDoc = mintOwlDoc(currentDoc);
	});
	let composeDraft = $state('');
	let composeAbort: AbortController | null = null;
	let saveOpen = $state(false);
	let saveSection = $state<OwlSection | null>(null);
	let saveName = $state('');
	let saveDescription = $state('');
	let saveBusy = $state(false);
	let saveError = $state<string | null>(null);
	let saveStatus = $state<string | null>(null);
	let localDesignSections = $state<DesignSection[]>([...designSections]);

	const blockTheme = $derived(resolveBlockTheme(designColors));
	const emailContainer = $derived(shellCanvasCrumb(currentDoc.shell));
	const emailContainerColor = $derived(shellCanvasBackgroundColor(currentDoc.shell) ?? '#FFFFFF');
	const emailBackdrop = $derived(shellBackdropCrumb(currentDoc.shell));
	const emailBackdropColor = $derived(shellBackdropBackgroundColor(currentDoc.shell) ?? '#F5F5F5');
	const selectedIsEmailContainer = $derived(
		emailContainer !== null && selectedOwlId === emailContainer.owlId,
	);
	const selectedIsEmailBackdrop = $derived(
		emailBackdrop !== null && selectedOwlId === emailBackdrop.owlId,
	);
	const selectedIsShell = $derived(
		selectedOwlId !== null && isOwlIdInShell(currentDoc, selectedOwlId),
	);
	const colorComboboxOptions = $derived(buildDesignColorOptions(designColors, designTokens));
	const cssPropertyOptions = stylePropertyOptions();

	$effect(() => {
		localDesignSections = [...designSections];
	});

	// Sync from server when the saved envelope changes (save / navigation) — not on selectedId.
	$effect(() => {
		const serverDoc = doc;
		currentDoc = cloneDoc(serverDoc);
		preheader = serverDoc.preheader ?? '';
	});

	$effect(() => {
		const value = preheader;
		if ((currentDoc.preheader ?? '') !== value) {
			currentDoc = { ...currentDoc, preheader: value || undefined };
		}
	});

	$effect(() => {
		const sections = currentDoc.sections;
		if (sections.length === 0) {
			if (selectedId !== null) selectedId = null;
			return;
		}
		if (selectedId === null || !sections.some((s) => s.id === selectedId)) {
			selectedId = sections[0].id;
		}
	});

	const errorCount = $derived(preview?.issues.filter((i) => i.severity === 'error').length ?? 0);
	const warningCount = $derived(
		preview?.issues.filter((i) => i.severity === 'warning').length ?? 0,
	);

	let compileTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleRecompile() {
		if (compileTimer) clearTimeout(compileTimer);
		compileTimer = setTimeout(() => {
			void recompile();
		}, 250);
	}

	$effect(() => {
		void currentDoc;
		scheduleRecompile();
	});

	async function recompile() {
		try {
			const docToCompile = mintOwlDoc(currentDoc);
			const serialized = serializeOwlDoc(docToCompile);
			if (browser && serializeOwlDoc(currentDoc) !== serialized) {
				currentDoc = docToCompile;
			}
			const body = new FormData();
			body.append('doc', serialized);
			const res = await fetch(`?/owlCompile`, {
				method: 'POST',
				body,
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
			});
			if (!res.ok) {
				compileError = `Compile failed (${res.status})`;
				return;
			}
			const result = parseActionResult(await res.text());
			if (result.type !== 'success') {
				compileError =
					result.type === 'failure' && typeof result.data?.error === 'string'
						? result.data.error
						: `Compile failed (${result.type})`;
				return;
			}
			const data = result.data as OwlCompilePreview;
			if (typeof data.html !== 'string') {
				compileError = 'Compile returned no html';
				return;
			}
			compileError = null;
			preview = data;
		} catch (e) {
			compileError = e instanceof Error ? e.message : 'Compile failed';
		}
	}

	const displayHtml = $derived(
		preview ? substitutePreviewPlaceholders(preview.html, testVariables) : '',
	);

	const previewBodyHtml = $derived(displayHtml);

	const selectedSection = $derived(currentDoc.sections.find((s) => s.id === selectedId) ?? null);

	const selectedSlots = $derived(selectedId ? (preview?.sectionSlots[selectedId] ?? []) : []);

	function sectionRootInPreview(sectionId: string): Element | null {
		if (!previewRoot) return null;
		const idx = currentDoc.sections.findIndex((s) => s.id === sectionId);
		if (idx < 0) return null;
		const roots = previewRoot.querySelectorAll(`[${OWL.role}="section"]`);
		return roots[idx] ?? null;
	}

	/** Prefer the UI-selected section when an owl id appears in more than one fragment. */
	function sectionIdForOwlId(owlId: string): string | null {
		if (
			selectedId &&
			currentDoc.sections.some(
				(s) => s.id === selectedId && s.html.includes(`${OWL.id}="${owlId}"`),
			)
		) {
			return selectedId;
		}
		return findSectionIdForOwlId(currentDoc, owlId);
	}

	function editHtmlForOwlId(owlId: string): string | null {
		if (isOwlIdInShell(currentDoc, owlId)) return currentDoc.shell;
		const sectionId = sectionIdForOwlId(owlId);
		if (!sectionId) return null;
		return currentDoc.sections.find((s) => s.id === sectionId)?.html ?? null;
	}

	function extractForOwlId(owlId: string): InspectorSnapshot | null {
		if (isOwlIdInShell(currentDoc, owlId)) {
			return extractShellInspector(currentDoc.shell, owlId);
		}
		const sectionId = sectionIdForOwlId(owlId);
		if (!sectionId) return null;
		const section = currentDoc.sections.find((s) => s.id === sectionId);
		if (!section) return null;
		return extractInspector(section.html, owlId);
	}

	function textFromPreviewEl(el: HTMLElement): string {
		if (el.childElementCount === 0) return el.textContent ?? '';
		const only = el.children[0];
		if (el.children.length === 1 && only instanceof HTMLElement && only.tagName === 'A') {
			return only.textContent ?? '';
		}
		return el.textContent ?? '';
	}

	/**
	 * Content as shown in preview: slot override when set, else source HTML,
	 * with test-variable placeholders substituted. Prefer live preview DOM when
	 * it already reflects that element (post-compile).
	 */
	function effectiveContentText(
		owlId: string,
		htmlFallback: string,
		slotName?: string,
		slotType?: string,
	): string {
		if (slotName && (!slotType || slotType === 'text')) {
			// Per-instance key (owlId) wins; slot name is the legacy fallback.
			const value = currentDoc.slotValues[owlId] ?? currentDoc.slotValues[slotName];
			if (typeof value === 'string') {
				return substitutePreviewPlaceholders(value, testVariables);
			}
		}
		const previewEl = previewElForOwlId(owlId);
		if (previewEl) {
			const live = textFromPreviewEl(previewEl).trim();
			// Prefer live preview when it has visible text; otherwise fall back to source.
			if (live) return live;
		}
		return substitutePreviewPlaceholders(htmlFallback, testVariables);
	}

	function isTextSlot(snap: InspectorSnapshot | null): boolean {
		if (!snap?.slotName) return false;
		return !snap.slotType || snap.slotType === 'text';
	}

	function refreshInspector() {
		// Selection changed — never leave Content stuck behind a stale focus flag.
		contentTextFocused = false;

		if (!selectedOwlId) {
			inspector = null;
			lightEditOwlId = null;
			styleEditOwlId = null;
			textDraft = '';
			return;
		}

		const snap = extractForOwlId(selectedOwlId);
		inspector = snap;
		if (!snap) {
			lightEditOwlId = null;
			styleEditOwlId = null;
			textDraft = '';
			return;
		}

		const editHtml = editHtmlForOwlId(selectedOwlId);
		if (!editHtml) {
			lightEditOwlId = null;
			styleEditOwlId = null;
			textDraft = '';
			return;
		}

		lightEditOwlId = selectedOwlId;
		styleEditOwlId = selectedOwlId;

		styleRows = snap.styleRows.map((r) => ({ ...r }));
		attrRows = snap.attrRows.map((r) => ({ ...r }));
		textDraft = effectiveContentText(selectedOwlId, snap.textContent, snap.slotName, snap.slotType);
		rawHtmlDraft = snap.rawHtml;
	}

	$effect(() => {
		selectedOwlId;
		selectedIsShell;
		selectedSection;
		refreshInspector();
	});

	/** After compile / slot edits, refresh Content to match preview (skip if typing). */
	$effect(() => {
		previewBodyHtml;
		void currentDoc.slotValues;
		void testVariables;
		selectedOwlId;
		lightEditOwlId;
		if (!selectedOwlId || !inspector) return;
		void tick().then(() => {
			if (!inspector || !lightEditOwlId) return;
			if (!contentTextFocused) {
				const lightSnap =
					lightEditOwlId === inspector.owlId ? inspector : extractForOwlId(lightEditOwlId);
				if (lightSnap) {
					textDraft = effectiveContentText(
						lightEditOwlId,
						lightSnap.textContent,
						lightSnap.slotName ?? inspector.slotName,
						lightSnap.slotType ?? inspector.slotType,
					);
				}
			}
		});
	});

	$effect(() => {
		previewBodyHtml;
		hoverMarkedEl = null;
		selectedMarkedEl = null;
	});

	$effect(() => {
		previewBodyHtml;
		selectedOwlId;
		selectedId;
		breadcrumbHoverOwlId;
		void tick().then(() => syncPreviewOutlines());
	});

	$effect(() => {
		if (!browser) return;
		const scrollEl = previewScrollEl;
		if (!scrollEl) return;
		const scroll = scrollEl;

		function pointerInsidePreview(clientX: number, clientY: number): boolean {
			return markedElementAtPoint(clientX, clientY) !== null;
		}

		function clearHover() {
			hoverMarkedEl = null;
			syncPreviewOutlines();
		}

		function onPointerLeave(e: PointerEvent) {
			if (e.relatedTarget instanceof Node && scroll.contains(e.relatedTarget)) return;
			clearHover();
		}

		function onDocumentPointerMove(e: PointerEvent) {
			if (scroll.contains(e.target as Node)) return;
			if (pointerInsidePreview(e.clientX, e.clientY)) return;
			clearHover();
		}

		function onDocumentPointerDown(e: PointerEvent) {
			if (scroll.contains(e.target as Node)) return;
			clearHover();
		}

		function onWindowBlur() {
			clearHover();
		}

		scroll.addEventListener('pointerleave', onPointerLeave);
		document.addEventListener('pointermove', onDocumentPointerMove, { passive: true });
		document.addEventListener('pointerdown', onDocumentPointerDown, { passive: true });
		window.addEventListener('blur', onWindowBlur);
		return () => {
			scroll.removeEventListener('pointerleave', onPointerLeave);
			document.removeEventListener('pointermove', onDocumentPointerMove);
			document.removeEventListener('pointerdown', onDocumentPointerDown);
			window.removeEventListener('blur', onWindowBlur);
		};
	});

	function markedElementAtPoint(x: number, y: number): HTMLElement | null {
		const iframe = previewIframe;
		const root = previewRoot;
		if (!iframe || !root) return null;
		const doc = root.ownerDocument;
		const rect = iframe.getBoundingClientRect();
		if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
		const hit = doc.elementFromPoint(x - rect.left, y - rect.top);
		if (!hit) return null;
		const marked = hit.closest(`[${OWL.id}]`) as HTMLElement | null;
		return marked && root.contains(marked) ? marked : null;
	}

	function handlePreviewLoad() {
		const iframe = previewIframe;
		const doc = iframe?.contentDocument;
		if (!iframe || !doc?.body) return;
		previewRoot = doc.body;
		doc.addEventListener('mouseover', handleFrameMouseOver, { passive: true });
		doc.addEventListener('click', handlePreviewClick);
		void tick().then(() => syncPreviewOutlines());
	}

	function handleFrameMouseOver(e: MouseEvent) {
		const root = previewRoot;
		const target = e.target as Element | null;
		if (!root || !target || typeof target.closest !== 'function' || !root.contains(target)) return;
		const marked = target.closest(`[${OWL.id}]`) as HTMLElement | null;
		if (!marked || !root.contains(marked)) return;
		if (hoverMarkedEl === marked) return;
		hoverMarkedEl = marked;
		syncPreviewOutlines();
	}

	function previewElForOwlId(owlId: string): HTMLElement | null {
		if (!previewRoot) return null;
		if (isOwlIdInShell(currentDoc, owlId)) {
			return findPreviewElByOwlId(previewRoot, null, owlId);
		}
		const sectionId = sectionIdForOwlId(owlId);
		const scope = sectionId ? sectionRootInPreview(sectionId) : null;
		return findPreviewElByOwlId(previewRoot, scope, owlId);
	}

	function applyShellPatch(owlId: string, patch: InspectorPatch): string | null {
		return applyShellInspectorPatch(currentDoc.shell, owlId, patch);
	}

	function syncPreviewOutlines() {
		if (!previewRoot) return;
		if (hoverMarkedEl && !previewRoot.contains(hoverMarkedEl)) {
			hoverMarkedEl = null;
		}
		if (selectedMarkedEl && !previewRoot.contains(selectedMarkedEl)) {
			selectedMarkedEl = null;
		}
		let hoverEl = hoverMarkedEl;
		if (breadcrumbHoverOwlId) {
			const crumbEl = previewElForOwlId(breadcrumbHoverOwlId);
			if (crumbEl) hoverEl = crumbEl;
		}
		const selectedEl =
			selectedMarkedEl ?? (selectedOwlId ? previewElForOwlId(selectedOwlId) : null);
		syncInlinePreviewOutlines(previewRoot, { hoverEl, selectedEl });
	}

	function setBreadcrumbHover(owlId: string | null) {
		breadcrumbHoverOwlId = owlId;
		void tick().then(() => syncPreviewOutlines());
	}

	function scrollSelectedIntoPreview() {
		if (!selectedOwlId) return;
		previewElForOwlId(selectedOwlId)?.scrollIntoView({
			block: 'nearest',
			inline: 'nearest',
			behavior: 'smooth',
		});
	}

	function selectOwlId(owlId: string, sectionId?: string | null, el?: HTMLElement | null) {
		selectedOwlId = owlId;
		selectedMarkedEl = el ?? null;
		if (isOwlIdInShell(currentDoc, owlId)) {
			selectedId = null;
		} else if (sectionId) {
			selectedId = sectionId;
		} else {
			const found = findSectionIdForOwlId(currentDoc, owlId);
			if (found) selectedId = found;
		}
		void tick().then(() => {
			hoverMarkedEl = null;
			breadcrumbHoverOwlId = null;
			syncPreviewOutlines();
			scrollSelectedIntoPreview();
		});
	}

	function selectEmailContainer() {
		if (!emailContainer) return;
		selectedOwlId = emailContainer.owlId;
		selectedMarkedEl = null;
		selectedId = null;
		void tick().then(() => {
			hoverMarkedEl = null;
			breadcrumbHoverOwlId = null;
			syncPreviewOutlines();
			scrollSelectedIntoPreview();
		});
	}

	function selectEmailBackdrop() {
		if (!emailBackdrop) return;
		selectedOwlId = emailBackdrop.owlId;
		selectedMarkedEl = null;
		selectedId = null;
		void tick().then(() => {
			hoverMarkedEl = null;
			breadcrumbHoverOwlId = null;
			syncPreviewOutlines();
			scrollSelectedIntoPreview();
		});
	}

	/**
	 * Remove baked-in section backgrounds (white fills, the container color, or
	 * the container's gradient pin color) so sections inherit the container
	 * background again. Authored variant surfaces (data-owl-dark-style) keep
	 * their colors.
	 */
	function clearSectionBackgrounds() {
		if (!emailContainer) return;
		const colors = shellCanvasColorSet(currentDoc.shell, emailContainer.owlId);
		currentDoc = {
			...currentDoc,
			sections: currentDoc.sections.map((s) => ({
				...s,
				html: stripSectionBackgroundColors(s.html, colors),
			})),
		};
		refreshInspector();
	}

	function applyToOwlId(owlId: string, patch: InspectorPatch) {
		if (isOwlIdInShell(currentDoc, owlId)) {
			// A container background edit cascades to sections: remove fills that
			// match the OLD container surface so nothing stays pinned to the
			// previous color and the new color shows through everywhere.
			const wasContainer = emailContainer !== null && emailContainer.owlId === owlId;
			const oldColors =
				wasContainer && patch.styleRows?.some((r) => r.prop.trim().toLowerCase() === 'background-color')
					? shellCanvasColorSet(currentDoc.shell, owlId)
					: null;
			const nextShell = applyShellPatch(owlId, patch);
			if (nextShell === null) return;
			currentDoc = updateShellHtml(currentDoc, nextShell);
			if (oldColors) {
				currentDoc = {
					...currentDoc,
					sections: currentDoc.sections.map((s) => ({
						...s,
						html: stripSectionBackgroundColors(s.html, oldColors),
					})),
				};
			}
			refreshInspector();
			return;
		}
		const sectionId = sectionIdForOwlId(owlId);
		if (!sectionId) return;
		const section = currentDoc.sections.find((s) => s.id === sectionId);
		if (!section) return;
		const nextHtml = applyInspectorPatch(section.html, owlId, patch);
		if (nextHtml === null) return;
		currentDoc = updateSectionHtml(currentDoc, section.id, nextHtml);
		refreshInspector();
	}

	function handlePreviewClick(e: MouseEvent) {
		if (!previewRoot) return;
		const target = e.target as Element | null;
		if (!target || typeof target.closest !== 'function' || !previewRoot.contains(target)) return;
		const marked = target.closest(`[${OWL.id}]`) as HTMLElement | null;
		if (!marked || !previewRoot.contains(marked)) return;

		e.preventDefault();
		e.stopPropagation();
		const owlId = marked.getAttribute(OWL.id)!;
		let sectionId: string | null = null;
		if (!isOwlIdInShell(currentDoc, owlId)) {
			const sectionRoot = marked.closest(`[${OWL.role}="section"]`) as HTMLElement | null;
			if (sectionRoot && previewRoot.contains(sectionRoot)) {
				const idx = [...previewRoot.querySelectorAll(`[${OWL.role}="section"]`)].indexOf(
					sectionRoot,
				);
				if (idx >= 0) sectionId = currentDoc.sections[idx]?.id ?? null;
			}
		}
		selectOwlId(owlId, sectionId, marked);
		return;
	}

	function handleIssueClick(issue: OwlIssue) {
		if (!issue.owlId) return;
		selectOwlId(issue.owlId);
		issuesOpen = true;
	}

	function applyInspector(patch: InspectorPatch) {
		if (!selectedOwlId) return;
		applyToOwlId(selectedOwlId, patch);
	}

	function applyStyleRows() {
		if (!lightEditOwlId) return;
		applyToOwlId(lightEditOwlId, { styleRows });
	}

	function applyAttrRows() {
		if (!lightEditOwlId) return;
		applyToOwlId(lightEditOwlId, { attrRows });
	}

	function applyTextDraft() {
		if (!lightEditOwlId) return;
		if (isTextSlot(inspector) && inspector?.slotName) {
			setSlot(inspector.owlId, textDraft);
			return;
		}
		applyToOwlId(lightEditOwlId, { textContent: textDraft });
	}

	function applyRawHtml() {
		applyInspector({ rawHtml: rawHtmlDraft });
	}

	function handleRawHtmlKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			applyRawHtml();
		}
	}

	function prefillStyleValue(prop: string, theme: BlockTheme, forEmailContainer = false): string {
		const p = prop.trim().toLowerCase();
		if (p === 'color') return theme.text;
		if (p === 'background-color') {
			return theme.canvas;
		}
		if (p === 'border-color' || p === 'outline-color') return theme.muted;
		return '';
	}

	function colorOptionsForProp(prop: string): DesignColorOption[] {
		const recommended = prefillStyleValue(prop, blockTheme, selectedIsEmailContainer);
		return orderDesignColorOptions(colorComboboxOptions, recommended);
	}

	function handleStylePropChange(row: StyleRow) {
		if (isColorStyleProp(row.prop)) {
			row.value = prefillStyleValue(row.prop, blockTheme, selectedIsEmailContainer);
		}
		applyStyleRows();
	}

	function addStyleRow() {
		const prop = nextStylePropertyToAdd(styleRows);
		styleRows = [
			...styleRows,
			{ prop, value: prefillStyleValue(prop, blockTheme, selectedIsEmailContainer) },
		];
	}

	function addAttrRow() {
		const tag = inspector?.tag ?? 'td';
		const suggested = suggestedAttributes(tag).find((a) => !attrRows.some((r) => r.name === a));
		attrRows = [...attrRows, { name: suggested ?? '', value: '' }];
	}

	function slotValue(slot: OwlSlot): string | boolean | undefined {
		return currentDoc.slotValues[slot.owlId] ?? currentDoc.slotValues[slot.name];
	}

	function setSlot(key: string, value: string | boolean | null) {
		const next = { ...currentDoc };
		if (value === null) {
			const values = { ...currentDoc.slotValues };
			delete values[key];
			next.slotValues = values;
		} else {
			next.slotValues = { ...currentDoc.slotValues, [key]: value };
		}
		currentDoc = next;
	}

	function reservedOwlIds(doc: OwlDoc = currentDoc): Set<string> {
		const reserved = new Set<string>();
		for (const m of doc.shell.matchAll(new RegExp(`${OWL.id}="(w\\d+)"`, 'g'))) {
			reserved.add(m[1]!);
		}
		for (const s of doc.sections) {
			for (const m of s.html.matchAll(new RegExp(`${OWL.id}="(w\\d+)"`, 'g'))) {
				reserved.add(m[1]!);
			}
		}
		return reserved;
	}

	function addSection(section: { html: string; key: string; label: string }) {
		const next = { ...currentDoc };
		const reserved = reservedOwlIds(next);
		let maxId = 0;
		for (const id of reserved) maxId = Math.max(maxId, Number(id.slice(1)) || 0);
		const html = mintOwlIdsInFragment(section.html, maxId, reserved);
		const id = newSectionId();
		next.sections = [...currentDoc.sections, { id, key: section.key, label: section.label, html }];
		currentDoc = next;
		selectedId = id;
		addOpen = false;
	}

	function duplicateSection(section: OwlSection) {
		const idx = currentDoc.sections.findIndex((s) => s.id === section.id);
		const reserved = reservedOwlIds();
		let maxId = 0;
		for (const id of reserved) maxId = Math.max(maxId, Number(id.slice(1)) || 0);
		const copy = {
			...section,
			id: newSectionId(),
			label: `${section.label} copy`,
			html: mintOwlIdsInFragment(section.html, maxId, reserved),
		};
		const next = { ...currentDoc };
		next.sections = [...currentDoc.sections];
		next.sections.splice(idx + 1, 0, copy);
		currentDoc = next;
		selectedId = copy.id;
	}

	function removeSection(id: string) {
		const idx = currentDoc.sections.findIndex((s) => s.id === id);
		const next = { ...currentDoc };
		next.sections = currentDoc.sections.filter((s) => s.id !== id);
		currentDoc = next;
		if (renamingSectionId === id) {
			renamingSectionId = null;
			renameDraft = '';
		}
		if (selectedId === id) {
			const remaining = next.sections;
			selectedId = remaining.length > 0 ? remaining[Math.max(0, idx - 1)].id : null;
			selectedOwlId = null;
		}
	}

	function moveSection(id: string, dir: -1 | 1) {
		const idx = currentDoc.sections.findIndex((s) => s.id === id);
		const to = idx + dir;
		if (idx < 0 || to < 0 || to >= currentDoc.sections.length) return;
		const next = { ...currentDoc };
		const sections = [...currentDoc.sections];
		const [moved] = sections.splice(idx, 1);
		sections.splice(to, 0, moved);
		next.sections = sections;
		currentDoc = next;
	}

	function startRenameSection(section: OwlSection) {
		renamingSectionId = section.id;
		renameDraft = section.label;
		selectedId = section.id;
		selectedOwlId = null;
		selectedMarkedEl = null;
		void tick().then(() => {
			renameInputEl?.focus();
			renameInputEl?.select();
		});
	}

	function cancelRenameSection() {
		renamingSectionId = null;
		renameDraft = '';
	}

	function commitRenameSection() {
		const id = renamingSectionId;
		if (!id) return;
		const label = renameDraft.trim() || 'Section';
		const next = { ...currentDoc };
		next.sections = currentDoc.sections.map((s) => (s.id === id ? { ...s, label } : s));
		currentDoc = next;
		renamingSectionId = null;
		renameDraft = '';
	}

	function handleRenameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRenameSection();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelRenameSection();
		}
	}

	function sectionThumbnail(sectionId: string): string {
		const html = preview?.sectionHtml[sectionId];
		if (!html) return '';
		return substitutePreviewPlaceholders(html, testVariables);
	}

	async function uploadAsset(file: File): Promise<VisualAsset | null> {
		const body = new FormData();
		body.append('file', file);
		body.append('name', file.name || 'image');
		const res = await fetch('?/uploadAsset', {
			method: 'POST',
			body,
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
		});
		if (!res.ok) return null;
		const result = parseActionResult(await res.text());
		if (result.type !== 'success' || !result.data || typeof result.data !== 'object') return null;
		const asset = (result.data as { asset?: { id: string; name: string; kind: 'logo' | 'image' } })
			.asset;
		if (!asset?.id) return null;
		await invalidateAll();
		return { id: asset.id, name: asset.name, kind: asset.kind };
	}

	function openHammerModal(tab: 'build' | 'pi' = 'build') {
		if (!piConfigured) {
			composeError = 'AI is not configured on this server.';
			return;
		}
		hammerTab = tab;
		composeDraft = templateDescription.trim();
		composeError = null;
		composeStatus = null;
		composeFeed = [];
		piEditError = null;
		piEditStatus = null;
		if (!piEditSessionId) piEditFeed = [];
		hammerOpen = true;
	}

	async function closeHammerModal() {
		if (composeBusy) composeAbort?.abort();
		if (piEditBusy) piEditAbort?.abort();
		if (piEditSessionId) {
			try {
				await fetch(owlPiEditUrl, {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sessionId: piEditSessionId }),
				});
			} catch {
				// best-effort cleanup
			}
			piEditSessionId = null;
		}
		hammerOpen = false;
	}

	async function runCompose() {
		const description = composeDraft.trim();
		if (!description) {
			composeError = 'Describe what this email is for.';
			return;
		}
		composeBusy = true;
		composeStatus = 'Starting…';
		composeError = null;
		const reducer = createAiFeedReducer();
		composeFeed = [];
		applyAiStreamEvent(reducer, { type: 'user', message: description });
		composeFeed = [...reducer.feed];
		composeAbort = new AbortController();
		try {
			const res = await fetch(owlAiComposeUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({
					name: templateName,
					subject: templateSubject || templateName,
					description,
				}),
				signal: composeAbort.signal,
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text.trim() || `Compose failed (${res.status})`);
			}
			if (!res.body) throw new Error('Compose stream unavailable');
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let built = false;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n\n');
				buffer = parts.pop() ?? '';
				for (const part of parts) {
					const line = part.trim();
					if (!line.startsWith('data: ')) continue;
					let event: {
						stage: string;
						message?: string;
						chars?: number;
						delta?: string;
						system?: string;
						context?: string;
						content?: OwlComposeResult;
					};
					try {
						event = JSON.parse(line.slice(6));
					} catch {
						continue;
					}
					const mapped = owlProgressToStreamEvent(event);
					if (mapped) {
						const status = applyAiStreamEvent(reducer, mapped);
						composeFeed = [...reducer.feed];
						if (status) composeStatus = status;
					}
					if (event.stage === 'done') {
						if (!event.content?.doc?.sections?.length) {
							throw new Error('Compose returned an empty template');
						}
						currentDoc = cloneDoc(event.content.doc);
						if (event.content.subject) onSubjectSuggest?.(event.content.subject);
						if (event.content.preheader) preheader = event.content.preheader;
						selectedId = currentDoc.sections[0]?.id ?? null;
						selectedOwlId = null;
						composeStatus = event.message ?? 'Template built.';
						built = true;
						hammerOpen = false;
					} else if (event.stage === 'error') {
						throw new Error(event.message ?? 'Compose failed');
					} else if (event.stage === 'cancelled') {
						composeStatus = 'Cancelled.';
					} else if (event.message && !mapped) {
						applyAiStreamEvent(reducer, { type: event.stage, message: event.message });
						composeFeed = [...reducer.feed];
						composeStatus = event.message;
					}
				}
			}
			if (!built && !composeError) {
				throw new Error('Compose finished without a template — check server logs');
			}
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') {
				composeStatus = 'Cancelled.';
			} else {
				composeError = e instanceof Error ? e.message : 'Compose failed';
				composeStatus = null;
			}
		} finally {
			composeBusy = false;
			composeAbort = null;
		}
	}

	async function runPiEdit() {
		const instruction = piEditDraft.trim();
		if (!instruction) {
			piEditError = 'Describe what to change.';
			return;
		}
		piEditBusy = true;
		piEditStatus = 'Starting…';
		piEditError = null;
		const reducer = createAiFeedReducer();
		if (!piEditSessionId) {
			piEditFeed = [];
		}
		applyAiStreamEvent(reducer, { type: 'user', message: instruction });
		piEditFeed = [...reducer.feed];
		piEditDraft = '';
		piEditAbort = new AbortController();
		try {
			const res = await fetch(owlPiEditUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({
					doc: serializeOwlDoc(currentDoc),
					instruction,
					sessionId: piEditSessionId ?? undefined,
					keepSession: true,
					name: templateName,
					subject: templateSubject || templateName,
					description: templateDescription,
				}),
				signal: piEditAbort.signal,
			});
			if (!res.ok || !res.body) {
				throw new Error((await res.text().catch(() => '')) || `Pi edit failed (${res.status})`);
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n\n');
				buffer = parts.pop() ?? '';
				for (const part of parts) {
					const line = part
						.split('\n')
						.map((l) => l.trim())
						.find((l) => l.startsWith('data:'));
					if (!line) continue;
					let event: {
						type?: string;
						message?: string;
						content?: string;
						delta?: string;
						toolName?: string;
						tool?: string;
						toolCallId?: string;
						isError?: boolean;
						doc?: OwlDoc;
						sessionId?: string;
					};
					try {
						event = JSON.parse(line.slice(5).trim());
					} catch {
						continue;
					}
					const type = event.type ?? '';
					if (type === 'done') {
						if (event.doc) {
							currentDoc = cloneDoc(event.doc);
							selectedId = currentDoc.sections[0]?.id ?? null;
							selectedOwlId = null;
						}
						if (event.sessionId) piEditSessionId = event.sessionId;
						piEditStatus = event.message ?? 'Edit applied.';
						applyAiStreamEvent(reducer, { type: 'step', message: piEditStatus });
						piEditFeed = [...reducer.feed];
						continue;
					}
					if (type === 'error') {
						throw new Error(event.message ?? 'Pi edit failed');
					}
					if (type === 'cancelled') {
						piEditStatus = event.message ?? 'Cancelled.';
						continue;
					}
					const mapped = applyAiStreamEvent(reducer, {
						type,
						message: event.message,
						content: event.content,
						delta: event.delta,
						tool: event.tool ?? event.toolName,
						toolCallId: event.toolCallId,
						isError: event.isError,
					});
					piEditFeed = [...reducer.feed];
					if (mapped) piEditStatus = mapped;
				}
			}
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') {
				piEditStatus = 'Cancelled.';
			} else {
				piEditError = e instanceof Error ? e.message : 'Pi edit failed';
				piEditStatus = null;
			}
		} finally {
			piEditBusy = false;
			piEditAbort = null;
		}
	}

	function stopPiEdit() {
		piEditAbort?.abort();
		piEditStatus = 'Stopping…';
	}

	async function disposeComponentPiSession() {
		if (!componentPiSessionId) return;
		const sessionId = componentPiSessionId;
		componentPiSessionId = null;
		try {
			await fetch(owlPiEditUrl, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId }),
			});
		} catch {
			// best-effort cleanup
		}
	}

	async function closeComponentPiModal() {
		if (componentPiBusy) componentPiAbort?.abort();
		await disposeComponentPiSession();
		componentPiOpen = false;
		componentPiSectionId = null;
		componentPiSectionLabel = '';
		componentPiError = null;
		componentPiStatus = null;
		componentPiFeed = [];
		componentPiDraft = '';
	}

	async function openComponentPiModal(section: OwlSection) {
		if (!piConfigured) {
			componentPiError = 'Pi is not configured (OPENROUTER_API_KEY).';
			componentPiSectionId = section.id;
			componentPiSectionLabel = section.label;
			componentPiOpen = true;
			return;
		}
		if (componentPiSectionId && componentPiSectionId !== section.id) {
			await disposeComponentPiSession();
			componentPiFeed = [];
			componentPiDraft = '';
		}
		selectSection(section);
		componentPiSectionId = section.id;
		componentPiSectionLabel = section.label;
		componentPiError = null;
		componentPiStatus = null;
		if (!componentPiSessionId) componentPiFeed = [];
		componentPiOpen = true;
	}

	function stopComponentPiEdit() {
		componentPiAbort?.abort();
		componentPiStatus = 'Stopping…';
	}

	async function runComponentPiEdit() {
		const instruction = componentPiDraft.trim();
		if (!instruction) {
			componentPiError = 'Describe what to change.';
			return;
		}
		if (!componentPiSectionId) {
			componentPiError = 'No component selected.';
			return;
		}
		componentPiBusy = true;
		componentPiStatus = 'Starting…';
		componentPiError = null;
		const reducer = createAiFeedReducer();
		if (!componentPiSessionId) {
			componentPiFeed = [];
		}
		applyAiStreamEvent(reducer, { type: 'user', message: instruction });
		componentPiFeed = [...reducer.feed];
		componentPiDraft = '';
		componentPiAbort = new AbortController();
		try {
			const res = await fetch(owlPiEditUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({
					doc: serializeOwlDoc(currentDoc),
					instruction,
					sectionId: componentPiSectionId,
					sessionId: componentPiSessionId ?? undefined,
					keepSession: true,
					name: templateName,
					subject: templateSubject || templateName,
					description: templateDescription,
				}),
				signal: componentPiAbort.signal,
			});
			if (!res.ok || !res.body) {
				throw new Error((await res.text().catch(() => '')) || `Pi edit failed (${res.status})`);
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n\n');
				buffer = parts.pop() ?? '';
				for (const part of parts) {
					const line = part
						.split('\n')
						.map((l) => l.trim())
						.find((l) => l.startsWith('data:'));
					if (!line) continue;
					let event: {
						type?: string;
						message?: string;
						content?: string;
						delta?: string;
						toolName?: string;
						tool?: string;
						toolCallId?: string;
						isError?: boolean;
						doc?: OwlDoc;
						sessionId?: string;
					};
					try {
						event = JSON.parse(line.slice(5).trim());
					} catch {
						continue;
					}
					const type = event.type ?? '';
					if (type === 'done') {
						if (event.doc) {
							currentDoc = cloneDoc(event.doc);
							if (componentPiSectionId) {
								selectedId = componentPiSectionId;
								selectedOwlId = null;
								selectedMarkedEl = null;
							}
							refreshInspector();
						}
						if (event.sessionId) componentPiSessionId = event.sessionId;
						componentPiStatus = event.message ?? 'Component edit applied.';
						applyAiStreamEvent(reducer, { type: 'step', message: componentPiStatus });
						componentPiFeed = [...reducer.feed];
						continue;
					}
					if (type === 'error') {
						throw new Error(event.message ?? 'Pi edit failed');
					}
					if (type === 'cancelled') {
						componentPiStatus = event.message ?? 'Cancelled.';
						continue;
					}
					const mapped = applyAiStreamEvent(reducer, {
						type,
						message: event.message,
						content: event.content,
						delta: event.delta,
						tool: event.tool ?? event.toolName,
						toolCallId: event.toolCallId,
						isError: event.isError,
					});
					componentPiFeed = [...reducer.feed];
					if (mapped) componentPiStatus = mapped;
				}
			}
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') {
				componentPiStatus = 'Cancelled.';
			} else {
				componentPiError = e instanceof Error ? e.message : 'Pi edit failed';
				componentPiStatus = null;
			}
		} finally {
			componentPiBusy = false;
			componentPiAbort = null;
		}
	}

	function assetKindFor(slot: OwlSlot): VisualAsset[] {
		return slot.name.startsWith('logo') ? logoAssets : imageAssets;
	}

	function colorFor(slot: OwlSlot): string | undefined {
		const value = slotValue(slot);
		return typeof value === 'string' ? value : undefined;
	}

	function selectSection(section: OwlSection) {
		selectedId = section.id;
		selectedOwlId = null;
		selectedMarkedEl = null;
	}

	function linkedLibrarySection(section: OwlSection): DesignSection | null {
		return localDesignSections.find((s) => s.id === section.key) ?? null;
	}

	function openSaveComponent(section: OwlSection) {
		saveSection = section;
		const linked = linkedLibrarySection(section);
		saveName = linked?.name ?? section.label;
		saveDescription = linked?.description ?? '';
		saveError = null;
		saveStatus = linked ? 'Updates the saved library component.' : null;
		saveOpen = true;
	}

	function closeSaveModal() {
		if (saveBusy) return;
		saveOpen = false;
		saveSection = null;
		saveError = null;
		saveStatus = null;
	}

	async function runSaveComponent() {
		if (!saveSection) return;
		const name = saveName.trim();
		if (!name) {
			saveError = 'Name is required.';
			return;
		}
		saveBusy = true;
		saveError = null;
		saveStatus = 'Saving…';
		try {
			const linked = linkedLibrarySection(saveSection);
			const body = new FormData();
			if (linked) body.append('id', linked.id);
			body.append('name', name);
			body.append('description', saveDescription.trim());
			body.append('html', saveSection.html);
			const res = await fetch('?/saveOwlComponent', {
				method: 'POST',
				body,
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
			});
			const result = parseActionResult(await res.text());
			if (result.type !== 'success') {
				throw new Error(
					result.type === 'failure' && typeof result.data?.error === 'string'
						? result.data.error
						: 'Save failed',
				);
			}
			const data = result.data as {
				component?: { id: string; name: string; description: string | null; html: string };
			};
			if (data.component) {
				const entry: DesignSection = {
					id: data.component.id,
					name: data.component.name,
					description: data.component.description,
					starterKey: null,
					html: data.component.html,
				};
				const idx = localDesignSections.findIndex((s) => s.id === entry.id);
				if (idx >= 0) {
					localDesignSections = localDesignSections.map((s, i) => (i === idx ? entry : s));
				} else {
					localDesignSections = [entry, ...localDesignSections];
				}
				const next = { ...currentDoc };
				next.sections = currentDoc.sections.map((s) =>
					s.id === saveSection!.id ? { ...s, key: entry.id, label: entry.name } : s,
				);
				currentDoc = next;
			}
			saveStatus = linked ? 'Library component updated.' : 'Saved to library.';
			saveOpen = false;
			saveSection = null;
			void invalidateAll();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Save failed';
			saveStatus = null;
		} finally {
			saveBusy = false;
		}
	}

	export function getCurrentDoc(): OwlDoc {
		return currentDoc;
	}
</script>

<div class="grid gap-4 lg:grid-cols-[280px_1fr_320px] lg:items-start">
	<section
		class="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto"
	>
		<div class="mb-2 flex items-center justify-between gap-2">
			<h2 class="flex items-center gap-2 text-sm font-medium">
				<Layers class="size-4" />
				Sections
			</h2>
			<div class="flex items-center gap-1">
				{#if piConfigured}
					<Button
						size="sm"
						variant="outline"
						title="Build or edit with AI"
						disabled={composeBusy || piEditBusy}
						onclick={() => openHammerModal(currentDoc.sections.length > 0 ? 'pi' : 'build')}
					>
						{#if composeBusy || piEditBusy}
							<LoaderCircle class="size-4 animate-spin" />
						{:else}
							<Hammer class="size-4" />
						{/if}
					</Button>
				{/if}
				<Button size="sm" variant="outline" onclick={() => (addOpen = !addOpen)}>
					<Plus class="size-4" />
					Add
				</Button>
			</div>
		</div>

		{#if composeError}
			<p
				class="mb-2 rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-2 py-1.5 text-xs text-[hsl(var(--destructive))]"
			>
				{composeError}
			</p>
		{:else if composeStatus}
			<p class="mb-2 text-xs text-[hsl(var(--muted-foreground))]">{composeStatus}</p>
		{/if}

		{#if addOpen}
			<div
				class="mb-3 max-h-72 space-y-1 overflow-auto rounded-md border border-[hsl(var(--border))] p-2"
			>
				<p class="px-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">Library</p>
				{#each sectionStarters as starter (starter.key)}
					<button
						type="button"
						class="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[hsl(var(--accent))]"
						onclick={() =>
							addSection({ html: starter.html, key: starter.key, label: starter.name })}
					>
						<span class="block font-medium">{starter.name}</span>
						{#if starter.description}
							<span class="block text-xs text-[hsl(var(--muted-foreground))]"
								>{starter.description}</span
							>
						{/if}
					</button>
				{/each}
				{#if localDesignSections.length > 0}
					<p class="px-1 pt-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
						Saved components
					</p>
					{#each localDesignSections as section (section.id)}
						<button
							type="button"
							class="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[hsl(var(--accent))]"
							onclick={() =>
								addSection({ html: section.html, key: section.id, label: section.name })}
						>
							<span class="block font-medium">{section.name}</span>
						</button>
					{/each}
				{/if}
			</div>
		{/if}

		{#if currentDoc.sections.length === 0 && !emailContainer}
			<p class="py-4 text-center text-sm text-[hsl(var(--muted-foreground))]">
				No sections yet. Add one or build from description.
			</p>
		{:else}
		<ul class="space-y-1">
			{#if emailBackdrop}
				<li>
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded-md border p-1.5 text-left {selectedIsEmailBackdrop
							? 'border-[hsl(var(--ring))] bg-[hsl(var(--muted))]/40'
							: 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/20'}"
						onclick={selectEmailBackdrop}
					>
						<span
							class="size-4 shrink-0 rounded border border-[hsl(var(--border))]"
							style:background-color={emailBackdropColor}
							aria-hidden="true"
						></span>
						<span class="min-w-0 flex-1 truncate text-sm font-medium">Email backdrop</span>
						<span class="font-mono text-[0.65rem] text-[hsl(var(--muted-foreground))]"
							>{emailBackdropColor}</span
						>
					</button>
				</li>
			{/if}
			{#if emailContainer}
					<li>
						<button
							type="button"
							class="flex w-full items-center gap-2 rounded-md border p-1.5 text-left {selectedIsEmailContainer
								? 'border-[hsl(var(--ring))] bg-[hsl(var(--muted))]/40'
								: 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/20'}"
							onclick={selectEmailContainer}
						>
							<span
								class="size-4 shrink-0 rounded border border-[hsl(var(--border))]"
								style:background-color={emailContainerColor}
								aria-hidden="true"
							></span>
							<span class="min-w-0 flex-1 truncate text-sm font-medium">Email container</span>
							<span class="font-mono text-[0.65rem] text-[hsl(var(--muted-foreground))]"
								>{emailContainerColor}</span
							>
						</button>
					</li>
				{/if}
				{#each currentDoc.sections as section, i (section.id)}
					{@const thumb = sectionThumbnail(section.id)}
					<li>
						<div
							class="rounded-md border p-1.5 {selectedId === section.id && !selectedIsEmailContainer
								? 'border-[hsl(var(--ring))] bg-[hsl(var(--muted))]/40'
								: 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/20'}"
						>
							<div class="flex items-start gap-2">
								{#if thumb}
									<div
										class="owl-thumb relative h-14 w-20 shrink-0 overflow-hidden rounded border border-[hsl(var(--border))] bg-white"
										aria-hidden="true"
									>
										<div class="owl-thumb-inner pointer-events-none origin-top-left scale-[0.12]">
											{@html thumb}
										</div>
									</div>
								{/if}
								<div class="min-w-0 flex-1">
									{#if renamingSectionId === section.id}
										<input
											bind:this={renameInputEl}
											bind:value={renameDraft}
											type="text"
											aria-label="Section name"
											class="w-full rounded border border-[hsl(var(--input))] bg-transparent px-1 py-0.5 text-sm"
											onkeydown={handleRenameKeydown}
											onblur={commitRenameSection}
										/>
									{:else}
										<button
											type="button"
											class="w-full truncate px-1 text-left text-sm"
											onclick={() => selectSection(section)}
											ondblclick={() => startRenameSection(section)}
											title="{section.label} — double-click to rename"
										>
											{section.label}
										</button>
									{/if}
									<div class="flex shrink-0 items-center">
										{#if piConfigured}
											<button
												type="button"
												class="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-30"
												aria-label="Edit with Pi"
												title="Edit component with Pi"
												disabled={componentPiBusy && componentPiSectionId !== section.id}
												onclick={() => void openComponentPiModal(section)}
											>
												{#if componentPiBusy && componentPiSectionId === section.id}
													<LoaderCircle class="size-3.5 animate-spin" />
												{:else}
													<Hammer class="size-3.5" />
												{/if}
											</button>
										{/if}
										<button
											type="button"
											class="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
											aria-label="Rename"
											title="Rename"
											onclick={() => startRenameSection(section)}
											><Pencil class="size-3.5" /></button
										>
										<button
											type="button"
											class="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-30"
											disabled={i === 0}
											aria-label="Move up"
											onclick={() => moveSection(section.id, -1)}
											><ChevronUp class="size-3.5" /></button
										>
										<button
											type="button"
											class="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-30"
											disabled={i === currentDoc.sections.length - 1}
											aria-label="Move down"
											onclick={() => moveSection(section.id, 1)}
											><ChevronDown class="size-3.5" /></button
										>
										<button
											type="button"
											class="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
											aria-label="Duplicate"
											onclick={() => duplicateSection(section)}><Copy class="size-3.5" /></button
										>
										<button
											type="button"
											class="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
											aria-label="Save as component"
											title="Save to library for reuse"
											onclick={() => openSaveComponent(section)}
											><Bookmark class="size-3.5" /></button
										>
										<button
											type="button"
											class="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--destructive))]/10 hover:text-[hsl(var(--destructive))]"
											aria-label="Remove"
											onclick={() => removeSection(section.id)}><Trash2 class="size-3.5" /></button
										>
									</div>
								</div>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section
		class="flex min-w-0 flex-col rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3"
	>
		<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
			<div class="flex items-center gap-1 rounded-md border border-[hsl(var(--border))] p-0.5">
				<button
					type="button"
					class="flex items-center gap-1 rounded px-2 py-1 text-xs {device === 'desktop'
						? 'bg-[hsl(var(--secondary))]'
						: ''}"
					onclick={() => (device = 'desktop')}><Monitor class="size-3.5" />Desktop</button
				>
				<button
					type="button"
					class="flex items-center gap-1 rounded px-2 py-1 text-xs {device === 'mobile'
						? 'bg-[hsl(var(--secondary))]'
						: ''}"
					onclick={() => (device = 'mobile')}><Smartphone class="size-3.5" />Mobile</button
				>
			</div>
			<div class="flex items-center gap-2">
				{#if errorCount > 0 || warningCount > 0}
					<button
						type="button"
						class="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs {errorCount > 0
							? 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]'
							: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}"
						onclick={() => (issuesOpen = !issuesOpen)}
					>
						{#if errorCount > 0}
							<XCircle class="size-3.5" />
							{errorCount} error{errorCount === 1 ? '' : 's'}
						{/if}
						{#if warningCount > 0}
							<AlertTriangle class="size-3.5" />
							{warningCount} warning{warningCount === 1 ? '' : 's'}
						{/if}
					</button>
				{/if}
			</div>
		</div>

		{#if issuesOpen && preview?.issues.length}
			<ul
				class="mb-2 max-h-40 space-y-1 overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-2 text-xs"
			>
				{#each preview.issues as issue, i (`${issue.code}-${i}`)}
					<li>
						<button
							type="button"
							class="w-full rounded px-2 py-1 text-left hover:bg-[hsl(var(--accent))] {issue.severity ===
							'error'
								? 'text-[hsl(var(--destructive))]'
								: 'text-[hsl(var(--muted-foreground))]'}"
							disabled={!issue.owlId}
							onclick={() => handleIssueClick(issue)}
						>
							<span class="font-medium">{issue.code}</span>: {issue.message}
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if compileError}
			<p
				class="mb-2 rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-3 py-2 text-sm text-[hsl(var(--destructive))]"
			>
				{compileError}
			</p>
		{/if}

		<div
			bind:this={previewScrollEl}
			class="flex min-h-0 flex-1 justify-center overflow-auto rounded-md border border-[hsl(var(--border))] p-3"
		>
			{#if previewBodyHtml}
				<div
					class="owl-preview-frame rounded-md shadow-sm {device === 'mobile'
						? 'w-[390px]'
						: 'w-full max-w-[680px]'}"
				>
					<iframe
						bind:this={previewIframe}
						title="Email preview"
						class="owl-preview-iframe"
						sandbox="allow-same-origin"
						srcdoc={previewBodyHtml}
						onload={handlePreviewLoad}
					></iframe>
				</div>
			{:else}
				<p class="py-16 text-sm text-[hsl(var(--muted-foreground))]">Preview loading…</p>
			{/if}
		</div>
	</section>

	<section
		class="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto"
	>
		<div class="mb-3 flex items-center justify-between gap-2">
			<h2 class="text-sm font-medium">
				{inspector ? 'Inspector' : selectedSection ? 'Content' : 'Sidebar'}
			</h2>
			{#if inspector && (selectedSection || selectedIsShell)}
				<button
					type="button"
					class="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:underline"
					onclick={() => {
						selectedOwlId = null;
						breadcrumbHoverOwlId = null;
						syncPreviewOutlines();
					}}
				>
					Clear selection
				</button>
			{/if}
		</div>

		{#if inspector}
			<div class="mb-4 space-y-4 border-b border-[hsl(var(--border))] pb-4">
			{#if selectedIsEmailContainer}
				<div
					class="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))]"
				>
					<p>
						<strong class="font-medium text-[hsl(var(--foreground))]">Email container</strong>
						wraps all sections — change
						<code class="text-[0.65rem]">background-color</code> here. Sections that have their
						own background keep it.
					</p>
					<button
						type="button"
						class="mt-1.5 underline hover:text-[hsl(var(--foreground))]"
						onclick={clearSectionBackgrounds}
					>
						Clear baked-in section backgrounds
					</button>
					<span class="mt-0.5 block text-[0.65rem]">
						Removes white/container-colored section backgrounds so sections inherit the container
						color. Styled elements like buttons are kept.
					</span>
				</div>
			{/if}
			{#if selectedIsEmailBackdrop}
				<p
					class="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))]"
				>
					<strong class="font-medium text-[hsl(var(--foreground))]">Email backdrop</strong> paints
					the page background behind the container — change
					<code class="text-[0.65rem]">background-color</code> here.
				</p>
			{/if}

				<p class="text-xs text-[hsl(var(--muted-foreground))]">
					Edits apply directly to this element. The preview always renders in light mode.
				</p>

				{#if inspector.breadcrumbs.length > 0 && !selectedIsEmailContainer}
					<nav class="flex flex-wrap gap-1 text-xs text-[hsl(var(--muted-foreground))]">
						<span class="mr-1 font-medium text-[hsl(var(--foreground))]">Element</span>
						{#each inspector.breadcrumbs as crumb, i (crumb.owlId)}
							{#if i > 0}<span>/</span>{/if}
							<button
								type="button"
								class="rounded px-1 hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] {crumb.owlId ===
								selectedOwlId
									? 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]'
									: ''}"
								onpointerenter={() => setBreadcrumbHover(crumb.owlId)}
								onpointerleave={() => setBreadcrumbHover(null)}
								onfocus={() => setBreadcrumbHover(crumb.owlId)}
								onblur={() => setBreadcrumbHover(null)}
								onclick={() => selectOwlId(crumb.owlId, selectedId)}
							>
								&lt;{crumb.tag}&gt;
							</button>
						{/each}
						{#if emailContainer}
							<span>/</span>
							<button
								type="button"
								class="rounded px-1 hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
								onpointerenter={() => setBreadcrumbHover(emailContainer.owlId)}
								onpointerleave={() => setBreadcrumbHover(null)}
								onfocus={() => setBreadcrumbHover(emailContainer.owlId)}
								onblur={() => setBreadcrumbHover(null)}
								onclick={selectEmailContainer}
							>
								Email container
							</button>
						{/if}
					</nav>
				{/if}

				<div>
					<div class="mb-1 flex items-center justify-between gap-2">
						<p class="text-xs font-medium text-[hsl(var(--muted-foreground))]">Content</p>
					</div>
					{#if inspector.slotName}
						<p class="mb-2 text-xs text-[hsl(var(--muted-foreground))]">
							Slot <code class="text-[0.65rem]">{inspector.slotName}</code>
							({inspector.slotType}) — use the slot editor below when available.
						</p>
					{/if}
					<textarea
						rows="2"
						bind:value={textDraft}
						placeholder="Enter text…"
						onfocus={() => (contentTextFocused = true)}
						onblur={() => (contentTextFocused = false)}
						onchange={applyTextDraft}
						class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					></textarea>
					{#if isTextSlot(inspector)}
						<p class="mt-1 text-[0.65rem] text-[hsl(var(--muted-foreground))]">
							Supports Markdown (e.g. **bold**, *italic*, [links](https://…), lists).
						</p>
					{/if}
				</div>

				<div>
					<div class="mb-1 flex items-center justify-between gap-2">
						<p class="text-xs font-medium text-[hsl(var(--muted-foreground))]">Styles</p>
					</div>
					<p class="mb-2 text-xs text-[hsl(var(--muted-foreground))]">
						Inline styles on this element.
					</p>
					<div class="space-y-1.5">
						{#each styleRows as row, index (index)}
							{@const kind = styleRowKind(row.prop)}
							<div class="flex flex-wrap gap-1">
								<StylePropertyCombobox
									bind:value={row.prop}
									options={cssPropertyOptions}
									onchange={() => handleStylePropChange(row)}
								/>
								{#if kind === 'color'}
									<StyleColorCombobox
										bind:value={row.value}
										options={colorOptionsForProp(row.prop)}
										fallback={prefillStyleValue(row.prop, blockTheme, selectedIsEmailContainer)}
										onchange={applyStyleRows}
									/>
								{:else if kind === 'enum'}
									<select
										bind:value={row.value}
										onchange={applyStyleRows}
										class="min-w-0 flex-1 rounded border border-[hsl(var(--input))] bg-transparent px-1 py-1 text-xs"
									>
										{#each enumOptions(row.prop) as opt (opt)}
											<option value={opt}>{opt}</option>
										{/each}
									</select>
								{:else}
									<input
										bind:value={row.value}
										onchange={applyStyleRows}
										class="min-w-0 flex-1 rounded border border-[hsl(var(--input))] bg-transparent px-1 py-1 font-mono text-xs"
									/>
								{/if}
								<button
									type="button"
									class="px-1 text-xs text-[hsl(var(--muted-foreground))]"
									onclick={() => {
										styleRows = styleRows.filter((_, j) => j !== index);
										applyStyleRows();
									}}>×</button
								>
							</div>
						{/each}
					</div>
					<Button size="sm" variant="outline" class="mt-2" onclick={addStyleRow}
						>Add property</Button
					>
				</div>

				<div>
					<p class="mb-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">Attributes</p>
					<div class="space-y-1.5">
						{#each attrRows as row, index (index)}
							<div class="flex gap-1">
								<input
									bind:value={row.name}
									onchange={applyAttrRows}
									class="w-20 shrink-0 rounded border border-[hsl(var(--input))] bg-transparent px-1 py-1 font-mono text-xs"
								/>
								<input
									bind:value={row.value}
									onchange={applyAttrRows}
									class="min-w-0 flex-1 rounded border border-[hsl(var(--input))] bg-transparent px-1 py-1 font-mono text-xs"
								/>
								<button
									type="button"
									class="px-1 text-xs"
									onclick={() => {
										attrRows = attrRows.filter((_, j) => j !== index);
										applyAttrRows();
									}}>×</button
								>
							</div>
						{/each}
					</div>
					<Button size="sm" variant="outline" class="mt-2" onclick={addAttrRow}
						>Add attribute</Button
					>
				</div>
				<div>
					<p class="mb-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">HTML source</p>
					<textarea
						rows="5"
						bind:value={rawHtmlDraft}
						onkeydown={handleRawHtmlKeydown}
						class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 font-mono text-xs"
					></textarea>
					<Button size="sm" class="mt-2" onclick={applyRawHtml}>Apply</Button>
					<span class="ml-2 text-xs text-[hsl(var(--muted-foreground))]">⌘/Ctrl+Enter</span>
				</div>
			</div>
		{/if}

		{#if !selectedSection && !selectedIsShell}
			<p class="text-sm text-[hsl(var(--muted-foreground))]">
				Select a section, pick <strong class="font-medium">Email container</strong> in the left list,
				or click an element in the preview.
			</p>
		{:else if selectedSlots.length === 0}
			{#if !inspector}
				<p class="text-sm text-[hsl(var(--muted-foreground))]">
					Click an element in the preview to inspect styles, or edit this section in the design
					system.
				</p>
			{/if}
		{:else}
			{#if inspector}
				<p class="mb-3 text-xs font-medium text-[hsl(var(--muted-foreground))]">Content slots</p>
			{/if}
			<div class="space-y-4">
				{#each selectedSlots as slot (slot.owlId)}
					{@const value = slotValue(slot)}
					{@const slotSelected = slot.owlId === lightEditOwlId}
					<div
						class="space-y-1.5 rounded-md {slotSelected
							? 'border border-[hsl(var(--ring))] bg-[hsl(var(--muted))]/20 p-2'
							: ''}"
					>
						<label
							class="block text-xs font-medium"
							for={`slot-${selectedSection?.id}-${slot.name}`}
						>
							{slot.label ?? slot.name}
							<span class="font-normal text-[hsl(var(--muted-foreground))]">· {slot.type}</span>
							{#if slot.owlId && inspector}
								<button
									type="button"
									class="ml-1 font-normal text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:underline"
									onclick={() => selectOwlId(slot.owlId, selectedSection?.id ?? '')}
								>
									(select element)
								</button>
							{/if}
						</label>
						{#if slot.type === 'text'}
							<textarea
								id={`slot-${selectedSection?.id}-${slot.name}`}
								rows="3"
								value={typeof value === 'string' ? value : ''}
								oninput={(e) => setSlot(slot.owlId, e.currentTarget.value)}
								class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm"
							></textarea>
							<p class="text-[0.65rem] text-[hsl(var(--muted-foreground))]">
								Supports Markdown (e.g. **bold**, *italic*, [links](https://…), lists).
							</p>
						{:else if slot.type === 'url'}
							<Input
								type="url"
								value={typeof value === 'string' ? value : ''}
								oninput={(e) => setSlot(slot.owlId, e.currentTarget.value)}
							/>
						{:else if slot.type === 'image'}
							<div class="grid grid-cols-3 gap-2">
								{#each assetKindFor(slot) as asset (asset.id)}
									<button
										type="button"
										class="rounded-md border p-1.5 {value === designAssetPath(asset.id)
											? 'border-[hsl(var(--ring))]'
											: 'border-[hsl(var(--border))]'}"
										onclick={() => setSlot(slot.owlId, designAssetPath(asset.id))}
									>
										<img
											src={designAssetPath(asset.id)}
											alt={asset.name}
											class="h-12 w-full object-contain"
										/>
									</button>
								{/each}
							</div>
						{:else if slot.type === 'color'}
							<div class="flex items-center gap-2">
								<input
									type="color"
									value={colorFor(slot) ?? '#0A2540'}
									oninput={(e) => setSlot(slot.owlId, e.currentTarget.value)}
									class="h-9 w-12 rounded border"
								/>
								<Input
									type="text"
									value={colorFor(slot) ?? ''}
									oninput={(e) => setSlot(slot.owlId, e.currentTarget.value)}
								/>
							</div>
						{:else if slot.type === 'boolean'}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={value === false ? false : true}
									onchange={(e) => setSlot(slot.owlId, e.currentTarget.checked ? null : false)}
									class="rounded border"
								/>
								Show this block
							</label>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<Modal
	open={hammerOpen}
	title="AI assistant"
	description="Build a new template from a description, or edit the current email with the Pi coding agent."
	onClose={closeHammerModal}
>
	<div class="space-y-4">
		<div class="flex flex-wrap gap-1 rounded-md border border-[hsl(var(--border))] p-0.5">
			<button
				type="button"
				class="rounded px-3 py-1.5 text-sm {hammerTab === 'build'
					? 'bg-[hsl(var(--secondary))] font-medium'
					: 'hover:bg-[hsl(var(--muted))]'}"
				disabled={composeBusy || piEditBusy}
				onclick={() => (hammerTab = 'build')}
			>
				Build from description
			</button>
			<button
				type="button"
				class="rounded px-3 py-1.5 text-sm {hammerTab === 'pi'
					? 'bg-[hsl(var(--secondary))] font-medium'
					: 'hover:bg-[hsl(var(--muted))]'}"
				disabled={composeBusy || piEditBusy}
				onclick={() => (hammerTab = 'pi')}
			>
				Edit with Pi
			</button>
		</div>

		{#if hammerTab === 'build'}
			{#if currentDoc.sections.length > 0}
				<p
					class="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 text-sm"
				>
					This replaces all {currentDoc.sections.length} current section{currentDoc.sections
						.length === 1
						? ''
						: 's'} with a fresh template. Save when you are happy with the result.
				</p>
			{/if}
			<div class="space-y-1.5">
				<label class="text-sm font-medium" for="compose-description">Description</label>
				<textarea
					id="compose-description"
					rows="4"
					bind:value={composeDraft}
					disabled={composeBusy}
					placeholder="e.g. A welcome email for new subscribers — friendly tone, logo header, short intro, one CTA to get started, legal footer."
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm"
				></textarea>
			</div>
			<AiStreamFeed
				lines={composeFeed}
				busy={composeBusy}
				status={composeStatus ?? ''}
				error={composeError}
			/>
			<div class="flex justify-end gap-2">
				<Button variant="outline" disabled={composeBusy} onclick={closeHammerModal}>Cancel</Button>
				<Button disabled={composeBusy || !composeDraft.trim()} onclick={() => void runCompose()}>
					{#if composeBusy}
						<LoaderCircle class="size-4 animate-spin" />
						Building…
					{:else}
						Build template
					{/if}
				</Button>
			</div>
		{:else}
			<p class="text-sm text-[hsl(var(--muted-foreground))]">
				Pi edits the compiled email HTML with read/write tools and your design system context.
				{#if piEditSessionId}
					Follow-up edits continue the same session.
				{/if}
			</p>
			<div class="space-y-1.5">
				<label class="text-sm font-medium" for="pi-edit-instruction">Instruction</label>
				<textarea
					id="pi-edit-instruction"
					rows="4"
					bind:value={piEditDraft}
					disabled={piEditBusy}
					placeholder="e.g. Add a second CTA below the hero, tighten footer spacing, match brand primary on buttons."
					class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm"
					onkeydown={(e) => {
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							void runPiEdit();
						}
					}}></textarea>
			</div>
			<AiStreamFeed
				lines={piEditFeed}
				busy={piEditBusy}
				status={piEditStatus ?? ''}
				error={piEditError}
			/>
			<div class="flex flex-wrap justify-end gap-2">
				<Button variant="outline" disabled={piEditBusy} onclick={closeHammerModal}>Close</Button>
				{#if piEditBusy}
					<Button variant="outline" onclick={stopPiEdit}>Stop</Button>
				{:else}
					<Button disabled={!piEditDraft.trim()} onclick={() => void runPiEdit()}>
						{piEditSessionId ? 'Send follow-up' : 'Run Pi edit'}
					</Button>
				{/if}
			</div>
		{/if}
	</div>
</Modal>

<Modal
	open={componentPiOpen}
	title={componentPiSectionLabel
		? `Edit "${componentPiSectionLabel}" with Pi`
		: 'Edit component with Pi'}
	description="Pi rewrites this whole component's HTML using your design system. The rest of the email stays unchanged."
	class="max-w-2xl"
	onClose={() => void closeComponentPiModal()}
>
	<div class="space-y-4">
		<p class="text-sm text-[hsl(var(--muted-foreground))]">
			Describe what you don't like about this component.
			{#if componentPiSessionId}
				Follow-up edits continue the same session.
			{/if}
		</p>
		<div class="space-y-1.5">
			<label class="text-sm font-medium" for="component-pi-instruction">Instruction</label>
			<textarea
				id="component-pi-instruction"
				rows="4"
				bind:value={componentPiDraft}
				disabled={componentPiBusy}
				placeholder="e.g. Make this button use the brand primary color and round the corners."
				class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm"
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						void runComponentPiEdit();
					}
				}}></textarea>
		</div>
		<AiStreamFeed
			lines={componentPiFeed}
			busy={componentPiBusy}
			status={componentPiStatus ?? ''}
			error={componentPiError}
		/>
		<div class="flex flex-wrap justify-end gap-2">
			<Button
				variant="outline"
				disabled={componentPiBusy}
				onclick={() => void closeComponentPiModal()}
			>
				Close
			</Button>
			{#if componentPiBusy}
				<Button variant="outline" onclick={stopComponentPiEdit}>Stop</Button>
			{:else}
				<Button disabled={!componentPiDraft.trim()} onclick={() => void runComponentPiEdit()}>
					{componentPiSessionId ? 'Send follow-up' : 'Run Pi edit'}
				</Button>
			{/if}
		</div>
	</div>
</Modal>

<Modal
	open={saveOpen}
	title={saveSection && linkedLibrarySection(saveSection)
		? 'Update library component'
		: 'Save as component'}
	description="Reuse this section when adding blocks, building from description, or in Pi edits."
	onClose={closeSaveModal}
>
	<div class="space-y-4">
		<div class="space-y-1.5">
			<label class="text-sm font-medium" for="save-component-name">Name</label>
			<Input id="save-component-name" bind:value={saveName} disabled={saveBusy} />
		</div>
		<div class="space-y-1.5">
			<label class="text-sm font-medium" for="save-component-description">Description</label>
			<textarea
				id="save-component-description"
				rows="2"
				bind:value={saveDescription}
				disabled={saveBusy}
				placeholder="e.g. Branded header with logo and nav link"
				class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm"
			></textarea>
		</div>
		{#if saveStatus}
			<p class="text-sm text-[hsl(var(--muted-foreground))]">{saveStatus}</p>
		{/if}
		{#if saveError}
			<p
				class="rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-3 py-2 text-sm text-[hsl(var(--destructive))]"
			>
				{saveError}
			</p>
		{/if}
		<div class="flex justify-end gap-2">
			<Button variant="outline" disabled={saveBusy} onclick={closeSaveModal}>Cancel</Button>
			<Button disabled={saveBusy || !saveName.trim()} onclick={() => void runSaveComponent()}>
				{#if saveBusy}
					<LoaderCircle class="size-4 animate-spin" />
					Saving…
				{:else}
					Save to library
				{/if}
			</Button>
		</div>
	</div>
</Modal>

<style>
	.owl-preview-frame {
		min-height: 720px;
		background: #fff;
	}

	.owl-preview-iframe {
		display: block;
		width: 100%;
		height: 75vh;
		min-height: 720px;
		border: 0;
	}

	.owl-thumb-inner {
		width: 620px;
	}
</style>

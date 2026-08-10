/**
 * Browser-only Owl Studio helpers: id minting, inspector extraction, and
 * patching section fragments. No server imports — safe for Svelte components.
 */
import { OWL } from './format';
import { gradientPinColor, normalizeHexColor, parseStyleDecls } from './style';
import type { OwlDoc, OwlSection } from './studio';

export { gradientPinColor, normalizeHexColor } from './style';

export type StyleRow = { prop: string; value: string };
export type AttrRow = { name: string; value: string };

export type InspectorSnapshot = {
	owlId: string;
	tag: string;
	breadcrumbs: Array<{ owlId: string; tag: string }>;
	styleRows: StyleRow[];
	attrRows: AttrRow[];
	textContent: string;
	slotName?: string;
	slotType?: string;
	rawHtml: string;
};

const EDITABLE_ATTRS = new Set([
	'href',
	'src',
	'alt',
	'align',
	'bgcolor',
	'width',
	'height',
	'target',
	'title',
]);

const COLOR_PROPS = new Set(['color', 'background-color', 'border-color', 'outline-color']);
const SIZE_PROPS = new Set([
	'font-size',
	'line-height',
	'width',
	'height',
	'max-width',
	'min-width',
	'padding',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'margin',
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'border-radius',
	'border-width',
]);
const ENUM_PROPS: Record<string, string[]> = {
	'text-align': ['left', 'center', 'right', 'justify'],
	'font-weight': ['normal', 'bold', '400', '500', '600', '700'],
	'vertical-align': ['top', 'middle', 'bottom'],
};

export function styleRowKind(prop: string): 'color' | 'size' | 'enum' | 'text' {
	const p = prop.toLowerCase();
	if (COLOR_PROPS.has(p)) return 'color';
	if (SIZE_PROPS.has(p)) return 'size';
	if (p in ENUM_PROPS) return 'enum';
	return 'text';
}

export function enumOptions(prop: string): string[] {
	return ENUM_PROPS[prop.toLowerCase()] ?? [];
}

/** Email-safe CSS properties for the inspector (frequent first). */
export const STYLE_PROPERTY_OPTIONS = [
	'color',
	'background-color',
	'padding',
	'font-size',
	'line-height',
	'font-weight',
	'text-align',
	'margin',
	'border-radius',
	'border-color',
	'width',
	'max-width',
	'display',
	'vertical-align',
	'text-decoration',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'border-width',
	'border',
	'font-family',
	'letter-spacing',
	'border-top',
	'border-bottom',
	'outline-color',
	'min-width',
	'max-height',
	'opacity',
] as const;

export function stylePropertyOptions(): readonly string[] {
	return STYLE_PROPERTY_OPTIONS;
}

const STYLE_PROP_SUGGESTIONS = STYLE_PROPERTY_OPTIONS;

/** Next CSS property to suggest when adding a style row (skips ones already present). */
export function nextStylePropertyToAdd(rows: StyleRow[]): string {
	const have = new Set(rows.map((r) => r.prop.trim().toLowerCase()).filter(Boolean));
	return STYLE_PROP_SUGGESTIONS.find((p) => !have.has(p)) ?? STYLE_PROPERTY_OPTIONS[0];
}

export function isColorStyleProp(prop: string): boolean {
	return COLOR_PROPS.has(prop.trim().toLowerCase());
}

function wrapFragment(html: string): { doc: Document; container: HTMLElement } | null {
	if (typeof DOMParser === 'undefined') return null;
	const doc = new DOMParser().parseFromString(`<div id="owl-frag-root">${html}</div>`, 'text/html');
	const container = doc.getElementById('owl-frag-root');
	if (!container) return null;
	return { doc, container };
}

/**
 * Mint `data-owl-id` values in a section fragment (document order).
 * Missing ids are assigned; ids already in `reserved` are reminted so sections
 * never share ids (otherwise preview/inspector `querySelector` hits the first match).
 * Returns the original string when nothing changes (stable across recompiles).
 */
export function mintOwlIdsInFragment(
	html: string,
	startCounter = 0,
	reserved: Set<string> = new Set(),
): string {
	const wrapped = wrapFragment(html);
	if (!wrapped) return html;
	const { container } = wrapped;
	let counter = startCounter;
	for (const id of reserved) counter = Math.max(counter, Number(id.slice(1)) || 0);
	let changed = false;
	const walk = (el: Element) => {
		const id = el.getAttribute(OWL.id);
		if (!id || reserved.has(id)) {
			counter += 1;
			const next = `w${counter}`;
			el.setAttribute(OWL.id, next);
			reserved.add(next);
			changed = true;
		} else {
			reserved.add(id);
			counter = Math.max(counter, Number(id.slice(1)) || 0);
		}
		for (const child of Array.from(el.children)) walk(child);
	};
	for (const child of Array.from(container.children)) walk(child);
	return changed ? container.innerHTML : html;
}

/** Count existing `wN` ids in a fragment so the next mint continues the sequence. */
export function maxOwlIdCounter(html: string): number {
	let max = 0;
	for (const m of html.matchAll(new RegExp(`${OWL.id}="w(\\d+)"`, 'g'))) {
		max = Math.max(max, Number(m[1]));
	}
	return max;
}

function walkBodyElements(root: Element): Element[] {
	const out: Element[] = [];
	const walk = (el: Element) => {
		const tag = el.tagName.toLowerCase();
		if (tag === 'head' || tag === 'html') return;
		out.push(el);
		for (const child of Array.from(el.children)) walk(child);
	};
	walk(root);
	return out;
}

function mintMissingOwlIds(root: Element, startCounter: number): number {
	let counter = startCounter;
	for (const el of walkBodyElements(root)) {
		if (el.getAttribute(OWL.id)) continue;
		counter += 1;
		el.setAttribute(OWL.id, `w${counter}`);
	}
	return counter;
}

function parseShellDocument(shellHtml: string): Document | null {
	if (typeof DOMParser === 'undefined') return null;
	return new DOMParser().parseFromString(shellHtml, 'text/html');
}

function serializeShellDocument(doc: Document, original: string): string {
	const html = doc.documentElement.outerHTML;
	return original.trim().toLowerCase().startsWith('<!doctype') ? `<!DOCTYPE html>\n${html}` : html;
}

function collectOwlIds(html: string): Set<string> {
	const ids = new Set<string>();
	for (const m of html.matchAll(new RegExp(`${OWL.id}="(w\\d+)"`, 'g'))) ids.add(m[1]!);
	return ids;
}

/** Reassign shell ids that collide with section ids — keeps section ids stable for the inspector. */
function remintConflictingShellIds(shellHtml: string, reserved: Set<string>): string {
	const doc = parseShellDocument(shellHtml);
	if (!doc?.body) return shellHtml;
	let counter = 0;
	for (const id of reserved) counter = Math.max(counter, Number(id.slice(1)) || 0);
	for (const m of shellHtml.matchAll(new RegExp(`${OWL.id}="(w\\d+)"`, 'g'))) {
		counter = Math.max(counter, Number(m[1]) || 0);
	}
	let changed = false;
	for (const el of walkBodyElements(doc.body)) {
		const id = el.getAttribute(OWL.id);
		if (!id || reserved.has(id)) {
			counter += 1;
			const next = `w${counter}`;
			el.setAttribute(OWL.id, next);
			reserved.add(next);
			changed = true;
		} else {
			reserved.add(id);
		}
	}
	return changed ? serializeShellDocument(doc, shellHtml) : shellHtml;
}

/** Mint missing `data-owl-id` values in a full shell document (body tree). */
export function mintOwlIdsInShell(shellHtml: string, startCounter = 0): string {
	const doc = parseShellDocument(shellHtml);
	if (!doc?.body) return shellHtml;
	mintMissingOwlIds(doc.body, startCounter);
	return serializeShellDocument(doc, shellHtml);
}

export function mintOwlDoc(doc: OwlDoc): OwlDoc {
	const reserved = new Set<string>();
	let counter = 0;
	const sections = doc.sections.map((s) => {
		const html = mintOwlIdsInFragment(s.html, counter, reserved);
		counter = Math.max(counter, maxOwlIdCounter(html));
		return { ...s, html };
	});
	const shell = remintConflictingShellIds(doc.shell, reserved);
	return { ...doc, shell, sections };
}

/** @deprecated Prefer {@link mintOwlDoc}. */
export function mintOwlDocSections(doc: OwlDoc): OwlDoc {
	return mintOwlDoc(doc);
}

export function findSectionIdForOwlId(doc: OwlDoc, owlId: string): string | null {
	for (const section of doc.sections) {
		if (section.html.includes(`${OWL.id}="${owlId}"`)) return section.id;
	}
	return null;
}

export function isOwlIdInShell(doc: OwlDoc, owlId: string): boolean {
	const canvas = shellCanvasCrumb(doc.shell);
	if (canvas?.owlId === owlId) return true;
	return doc.shell.includes(`${OWL.id}="${owlId}"`) && findSectionIdForOwlId(doc, owlId) === null;
}

export type ShellCanvasCrumb = {
	owlId: string;
	label: string;
	kind: 'canvas';
	tag: string;
};

function findCanvasTable(body: Element): Element | null {
	const shell = body.querySelector(`[${OWL.role}="shell"]`);
	if (!shell) return null;
	for (const table of shell.querySelectorAll('table')) {
		if (table === shell) continue;
		const style = table.getAttribute('style') ?? '';
		if (/max-width:\s*620px/i.test(style)) return table;
	}
	const nested = shell.querySelector('table');
	return nested && nested !== shell ? nested : null;
}

function readBackgroundColor(el: Element): string | null {
	const style = el.getAttribute('style');
	const decls = parseStyleDecls(style);
	const bg = decls.find(([p]) => p === 'background-color')?.[1];
	if (bg) return bg;
	return el.getAttribute('bgcolor');
}

/** The 620px content column that wraps all sections — the email container. */
export function shellCanvasCrumb(shellHtml: string): ShellCanvasCrumb | null {
	const doc = parseShellDocument(shellHtml);
	if (!doc?.body) return null;
	const canvas = findCanvasTable(doc.body);
	const id = canvas?.getAttribute(OWL.id);
	if (!canvas || !id) return null;
	return { owlId: id, label: 'Email container', kind: 'canvas', tag: 'table' };
}

/** Current canvas background-color (for the sidebar color chip). */
export function shellCanvasBackgroundColor(shellHtml: string): string | null {
	const doc = parseShellDocument(shellHtml);
	if (!doc?.body) return null;
	const canvas = findCanvasTable(doc.body);
	return canvas ? readBackgroundColor(canvas) : null;
}

export type ShellBackdropCrumb = {
	owlId: string;
	label: string;
	kind: 'backdrop';
	tag: string;
};

function findBackdropTable(body: Element): Element | null {
	return body.querySelector(`[${OWL.role}="shell"]`);
}

/** The full-width page wrapper behind the canvas — the email backdrop. */
export function shellBackdropCrumb(shellHtml: string): ShellBackdropCrumb | null {
	const doc = parseShellDocument(shellHtml);
	if (!doc?.body) return null;
	const backdrop = findBackdropTable(doc.body);
	const id = backdrop?.getAttribute(OWL.id);
	if (!backdrop || !id) return null;
	return { owlId: id, label: 'Email backdrop', kind: 'backdrop', tag: 'table' };
}

/** Current backdrop background-color (for the sidebar color chip). */
export function shellBackdropBackgroundColor(shellHtml: string): string | null {
	const doc = parseShellDocument(shellHtml);
	if (!doc?.body) return null;
	const backdrop = findBackdropTable(doc.body);
	return backdrop ? readBackgroundColor(backdrop) : null;
}

export function updateShellHtml(doc: OwlDoc, shell: string): OwlDoc {
	return { ...doc, shell };
}

function styleToRows(style: string | null): StyleRow[] {
	return parseStyleDecls(style).map(([prop, value]) => ({ prop, value }));
}

function rowsToStyle(rows: StyleRow[]): string {
	return rows
		.filter((r) => r.prop.trim())
		.map((r) => `${r.prop.trim()}: ${r.value.trim()}`)
		.join('; ');
}

function attrRowsFor(el: Element): AttrRow[] {
	const rows: AttrRow[] = [];
	for (const name of el.getAttributeNames()) {
		if (name.startsWith('data-owl-')) continue;
		if (name === 'style' || name === 'class') continue;
		rows.push({ name, value: el.getAttribute(name) ?? '' });
	}
	return rows;
}

function breadcrumbChain(el: Element, container: Element): Array<{ owlId: string; tag: string }> {
	const chain: Array<{ owlId: string; tag: string }> = [];
	let node: Element | null = el;
	while (node && node !== container) {
		const id = node.getAttribute(OWL.id);
		if (id) chain.unshift({ owlId: id, tag: node.tagName.toLowerCase() });
		node = node.parentElement;
	}
	return chain;
}

function textFromElement(el: Element): string {
	if (el.childElementCount === 0) return el.textContent ?? '';
	if (el.children.length === 1 && el.children[0].tagName === 'A') {
		return el.children[0].textContent ?? '';
	}
	return el.textContent ?? '';
}

function inspectorSnapshotFor(el: Element, container: Element): InspectorSnapshot {
	return {
		owlId: el.getAttribute(OWL.id) ?? '',
		tag: el.tagName.toLowerCase(),
		breadcrumbs: breadcrumbChain(el, container),
		styleRows: styleToRows(el.getAttribute('style')),
		attrRows: attrRowsFor(el),
		textContent: textFromElement(el),
		slotName: el.getAttribute(OWL.slot) ?? undefined,
		slotType: el.getAttribute(OWL.slotType) ?? undefined,
		rawHtml: el.outerHTML,
	};
}

export function extractInspector(sectionHtml: string, owlId: string): InspectorSnapshot | null {
	const wrapped = wrapFragment(sectionHtml);
	if (!wrapped) return null;
	const { container } = wrapped;
	const el = container.querySelector(`[${OWL.id}="${owlId}"]`);
	if (!el) return null;
	return inspectorSnapshotFor(el, container);
}

export function extractShellInspector(shellHtml: string, owlId: string): InspectorSnapshot | null {
	const doc = parseShellDocument(shellHtml);
	if (!doc?.body) return null;
	const el = doc.body.querySelector(`[${OWL.id}="${owlId}"]`);
	if (!el) return null;
	return inspectorSnapshotFor(el, doc.body);
}

export type InspectorPatch = {
	styleRows?: StyleRow[];
	attrRows?: AttrRow[];
	textContent?: string;
	rawHtml?: string;
};

function stripTokenRefs(el: Element) {
	el.removeAttribute(OWL.token);
}

function applyAttrRowsTo(el: Element, rows: AttrRow[]) {
	for (const name of el.getAttributeNames()) {
		if (name.startsWith('data-owl-') || name === 'style' || name === 'class') continue;
		el.removeAttribute(name);
	}
	for (const row of rows) {
		if (!row.name.trim()) continue;
		if (row.value === '') el.removeAttribute(row.name.trim());
		else el.setAttribute(row.name.trim(), row.value);
	}
}

function applyTextTo(el: Element, text: string) {
	if (el.childElementCount === 0) {
		el.textContent = text;
	} else if (el.children.length === 1 && el.children[0].tagName === 'A') {
		el.children[0].textContent = text;
	} else {
		el.textContent = text;
	}
}

/** Apply a patch to either a section fragment or a full shell document. */
export function applyEditableHtmlPatch(
	html: string,
	owlId: string,
	patch: InspectorPatch,
): string | null {
	return applyInspectorPatch(html, owlId, patch) ?? applyShellInspectorPatch(html, owlId, patch);
}

function extractFromEditableHtml(html: string, owlId: string): InspectorSnapshot | null {
	return extractInspector(html, owlId) ?? extractShellInspector(html, owlId);
}

function applyInspectorPatchToElement(
	el: Element,
	container: Element,
	patch: InspectorPatch,
	owlId: string,
): void {
	if (patch.rawHtml !== undefined) {
		const tmp = wrapFragment(patch.rawHtml);
		if (!tmp) return;
		const replacement = tmp.container.firstElementChild;
		if (!replacement) return;
		if (!replacement.getAttribute(OWL.id)) replacement.setAttribute(OWL.id, owlId);
		el.replaceWith(replacement);
		return;
	}

	if (patch.styleRows !== undefined) {
		const rows = syncGradientPinRows(el, patch.styleRows);
		const style = rowsToStyle(rows);
		if (style) el.setAttribute('style', style);
		else el.removeAttribute('style');
		stripTokenRefs(el);
		// Keep the legacy `bgcolor` attribute (Outlook fallback) in step.
		if (el.hasAttribute('bgcolor')) {
			const bgNext =
				rows.find((r) => r.prop.trim().toLowerCase() === 'background-color')?.value.trim() ?? '';
			if (bgNext) el.setAttribute('bgcolor', bgNext);
			else el.removeAttribute('bgcolor');
		}
	}

	if (patch.attrRows !== undefined) {
		applyAttrRowsTo(el, patch.attrRows);
	}

	if (patch.textContent !== undefined) {
		applyTextTo(el, patch.textContent);
	}
}

/**
 * The compiler pins light backgrounds with a same-color two-stop
 * `linear-gradient` (dark-mode hardening). When the user edits or deletes an
 * element's `background-color`, the pin must follow — otherwise the old
 * gradient keeps painting the previous color on top of the new one.
 */
const GRADIENT_PIN_RE = /linear-gradient\(\s*([^,)]+?)\s*,\s*([^,)]+?)\s*\)/i;

function syncGradientPinRows(el: Element, rows: StyleRow[]): StyleRow[] {
	const oldDecls = parseStyleDecls(el.getAttribute('style'));
	const oldPin = oldDecls.find(([p]) => p === 'background-image')?.[1];
	// Any same-color two-stop gradient is treated as a pin and follows
	// background-color edits — even when it no longer matches the current
	// background (stale pins must heal, otherwise they keep painting the old
	// color on top of the new one).
	if (!gradientPinColor(oldPin)) return rows;

	const bgRow = rows.find((r) => r.prop.trim().toLowerCase() === 'background-color');
	const bgNext = bgRow?.value.trim() ?? '';
	const out = [...rows];
	const pinIdx = out.findIndex(
		(r) => r.prop.trim().toLowerCase() === 'background-image' && GRADIENT_PIN_RE.test(r.value),
	);
	if (pinIdx < 0) return rows;
	if (!bgNext) {
		out.splice(pinIdx, 1);
	} else {
		out[pinIdx] = {
			...out[pinIdx],
			value: `linear-gradient(${bgNext}, ${bgNext})`,
		};
	}
	return out;
}

export function applyInspectorPatch(
	sectionHtml: string,
	owlId: string,
	patch: InspectorPatch,
): string | null {
	const wrapped = wrapFragment(sectionHtml);
	if (!wrapped) return null;
	const { container } = wrapped;
	const el = container.querySelector(`[${OWL.id}="${owlId}"]`);
	if (!el) return null;
	applyInspectorPatchToElement(el, container, patch, owlId);
	return container.innerHTML;
}

/**
 * Set (or clear) an element's background surface: `background-color`, a
 * same-color gradient pin when the element already carries one, and the
 * legacy `bgcolor` attribute — the trio that must move together or layers
 * keep painting stale colors on top of each other.
 */
function applyBackgroundTo(el: Element, color: string | null): void {
	const decls = parseStyleDecls(el.getAttribute('style'));
	const hadPin = decls.some(([p, v]) => p === 'background-image' && gradientPinColor(v));
	const kept = decls.filter(
		([p, v]) => p !== 'background-color' && !(p === 'background-image' && gradientPinColor(v)),
	);
	const next: Array<[string, string]> = [...kept];
	if (color) {
		next.push(['background-color', color]);
		if (hadPin) next.push(['background-image', `linear-gradient(${color},${color})`]);
	}
	el.setAttribute(
		'style',
		next.map(([p, v]) => `${p}:${v};`).join(''),
	);
	if (el.hasAttribute('bgcolor')) {
		if (color) el.setAttribute('bgcolor', color);
		else el.removeAttribute('bgcolor');
	}
}

export function applyShellInspectorPatch(
	shellHtml: string,
	owlId: string,
	patch: InspectorPatch,
): string | null {
	const doc = parseShellDocument(shellHtml);
	if (!doc?.body) return null;
	const el = doc.body.querySelector(`[${OWL.id}="${owlId}"]`);
	if (!el) return null;
	applyInspectorPatchToElement(el, doc.body, patch, owlId);
	// The "Email container" is a composite: the 620px canvas table AND its
	// inner cell carry explicit surfaces. Propagating the background-color to
	// the cell keeps the visible canvas (the area behind sections) in sync and
	// lets enforceExplicitColors fall back to the container color inside
	// sections whose background was removed.
	const canvas = findCanvasTable(doc.body);
	if (canvas && canvas.getAttribute(OWL.id) === owlId && patch.styleRows) {
		const bgRow = patch.styleRows.find((r) => r.prop.trim().toLowerCase() === 'background-color');
		const bgNext = bgRow?.value.trim() || null;
		const td = canvas.querySelector('td');
		if (td) applyBackgroundTo(td, bgNext);
	}
	// The "Email backdrop" is a composite too: <body>, the full-width wrapper
	// table, and its padded cell all paint the page background. One edit must
	// move all three (plus their pins and bgcolor attributes) or the old color
	// keeps showing around/behind the canvas.
	const backdrop = findBackdropTable(doc.body);
	if (backdrop && backdrop.getAttribute(OWL.id) === owlId && patch.styleRows) {
		const bgRow = patch.styleRows.find((r) => r.prop.trim().toLowerCase() === 'background-color');
		const bgNext = bgRow?.value.trim() || null;
		applyBackgroundTo(doc.body, bgNext);
		applyBackgroundTo(backdrop, bgNext);
		const td = backdrop.querySelector('td');
		if (td) applyBackgroundTo(td, bgNext);
	}
	return serializeShellDocument(doc, shellHtml);
}

/**
 * Colors that paint the email container's background surface: the canvas
 * table's `background-color`, its gradient pin, its `bgcolor` attribute, the
 * inner cell's background, plus a white sentinel. Section fills matching any
 * of these are container-surface paints (not authored accents) and get
 * stripped so the container color shows through again.
 */
export function shellCanvasColorSet(shellHtml: string, canvasOwlId: string): Set<string> {
	const colors = new Set<string>(['#ffffff']);
	const doc = parseShellDocument(shellHtml);
	if (!doc?.body) return colors;
	const canvas = findCanvasTable(doc.body);
	if (!canvas || canvas.getAttribute(OWL.id) !== canvasOwlId) return colors;
	for (const [prop, value] of parseStyleDecls(canvas.getAttribute('style'))) {
		if (prop === 'background-color') colors.add(normalizeHexColor(value));
		const pin = prop === 'background-image' ? gradientPinColor(value) : null;
		if (pin) colors.add(pin);
	}
	const bgAttr = canvas.getAttribute('bgcolor');
	if (bgAttr) colors.add(normalizeHexColor(bgAttr));
	const td = canvas.querySelector('td');
	if (td) {
		const tdBg = readBackgroundColor(td);
		if (tdBg) colors.add(normalizeHexColor(tdBg));
	}
	return colors;
}

export function updateSectionHtml(doc: OwlDoc, sectionId: string, html: string): OwlDoc {
	return {
		...doc,
		sections: doc.sections.map((s) => (s.id === sectionId ? { ...s, html } : s)),
	};
}

export function extractPreviewBodyInnerHtml(fullHtml: string): string {
	if (typeof DOMParser === 'undefined') return fullHtml;
	const doc = new DOMParser().parseFromString(fullHtml, 'text/html');
	return doc.body?.innerHTML ?? fullHtml;
}

/**
 * Remove `background-color` (and matching gradient pins) from every element
 * of a section fragment whose color is in `colors`. Elements carrying
 * `data-owl-dark-style` are authored variant surfaces (e.g. buttons) and are
 * never touched. After stripping, sections inherit the container background
 * again at compile time (`enforceExplicitColors`).
 */
export function stripSectionBackgroundColors(
	sectionHtml: string,
	colors: ReadonlySet<string>,
): string {
	const wanted = new Set([...colors].map(normalizeHexColor));
	const wrapped = wrapFragment(sectionHtml);
	if (!wrapped) return sectionHtml;
	let changed = false;
	for (const el of Array.from(wrapped.container.querySelectorAll('[style]'))) {
		if (el.hasAttribute('data-owl-dark-style')) continue;
		const decls = parseStyleDecls(el.getAttribute('style'));
		const kept = decls.filter(([p, v]) => {
			if (p === 'background-color') return !wanted.has(normalizeHexColor(v));
			const pin = p === 'background-image' ? gradientPinColor(v) : null;
			if (pin) return !wanted.has(pin);
			return true;
		});
		if (kept.length !== decls.length) {
			changed = true;
			if (kept.length) el.setAttribute('style', kept.map(([p, v]) => `${p}:${v};`).join(''));
			else el.removeAttribute('style');
		}
	}
	return changed ? wrapped.container.innerHTML : sectionHtml;
}

export function isEditableAttribute(name: string): boolean {
	return EDITABLE_ATTRS.has(name.toLowerCase());
}

export function suggestedAttributes(tag: string): string[] {
	const t = tag.toLowerCase();
	if (t === 'a') return ['href', 'target', 'title'];
	if (t === 'img') return ['src', 'alt', 'width', 'height'];
	if (t === 'td' || t === 'th') return ['align', 'bgcolor', 'width'];
	return ['align', 'bgcolor'];
}

export type SectionLookup = Pick<OwlSection, 'id' | 'html'>;

/**
 * mjml-map — bridge from compiled Owl markup (C1) to an MJML shell document.
 *
 * The Owl shell's table scaffold (backdrop table, 620px canvas table) is
 * replaced by MJML's own structural markup so delivery HTML gets MJML's
 * MSO/VML conditionals, `role="article"` scaffolding, and responsive
 * `mj-column-*` classes. Authored section markup (with every `data-owl-*`
 * annotation, owll-* classes and gmail-blend wrappers) rides inside
 * `<mj-raw>` — MJML passes it through verbatim.
 *
 * Worker-safe: linkedom only, no async, no mjml import.
 */
import { parseDocument, serialize, type Document, type Element } from './parser';
import { OWL } from './format';
import { parseStyleDecls } from './style';

export type OwlDeliveryMap = {
	/** MJML XML document ready for mjml2html. */
	xml: string;
	/** data-owl-id of the shell canvas table, re-stamped onto the MJML wrapper div in post. */
	canvasOwlId: string | null;
};

const FALLBACK_BACKDROP = '#F5F5F5';
const FALLBACK_CANVAS = '#FFFFFF';
const FALLBACK_WIDTH = '620px';

function readBackgroundColor(el: Element): string | null {
	const decls = parseStyleDecls(el.getAttribute('style'));
	const bg = decls.find(([p]) => p === 'background-color')?.[1];
	return bg ?? el.getAttribute('bgcolor');
}

/** Inheritable text styles carried from the replaced canvas table to the raw wrapper div. */
const INHERITED_TEXT_PROPS = ['color', 'font-family', 'font-size', 'line-height'] as const;

function inheritedCanvasStyle(canvasTable: Element | null): string {
	if (!canvasTable) return '';
	const decls = parseStyleDecls(canvasTable.getAttribute('style'));
	return INHERITED_TEXT_PROPS.map(
		(prop) => decls.find(([p]) => p === prop),
	)
		.filter((d): d is [string, string] => !!d)
		.map(([p, v]) => `${p}:${v};`)
		.join('');
}

/** The canvas = the inner max-width table inside the shell root (mirrors studio-client.findCanvasTable). */
function findCanvasTable(doc: Document): Element | null {
	const shell = doc.querySelector(`[${OWL.role}="shell"]`);
	if (!shell) return null;
	for (const table of shell.querySelectorAll('table')) {
		if (table === shell) continue;
		const style = table.getAttribute('style') ?? '';
		if (/max-width:\s*[\d.]+px/i.test(style)) return table as Element;
	}
	const nested = shell.querySelector('table');
	return nested && nested !== shell ? (nested as Element) : null;
}

function xmlAttr(value: string): string {
	// Colors like #RRGGBB / rgb() / linear-gradient-free literals only;
	// strip anything that could break out of the XML attribute.
	return value.replace(/["'<>&]/g, '').trim();
}

function escapeXmlText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Vertical backdrop gap rendered above/below the white card. */
function backdropSpacer(backdrop: string): string {
	return (
		`<mj-section background-color="${xmlAttr(backdrop)}" padding="0">` +
		`<mj-column><mj-spacer height="32px" /></mj-column></mj-section>`
	);
}

/**
 * Read a compiled Owl document and produce the MJML shell document for it.
 * Falls back gracefully when the shell is unusual: a missing canvas table
 * means sections ride full-bleed in mj-body; a missing preheader node is
 * simply omitted (MJML renders no preview text).
 */
export function buildOwlMjmlDocument(compiledHtml: string): OwlDeliveryMap {
	const doc = parseDocument(compiledHtml);

	const docLang = doc.documentElement?.getAttribute('lang')?.trim() || 'en';

	const body = doc.body;
	const backdrop =
		(body ? readBackgroundColor(body as unknown as Element) : null) ?? FALLBACK_BACKDROP;

	const canvasTable = findCanvasTable(doc);
	const canvas = (canvasTable ? readBackgroundColor(canvasTable) : null) ?? FALLBACK_CANVAS;
	const widthMatch = canvasTable
		? /max-width:\s*([\d.]+px)/i.exec(canvasTable.getAttribute('style') ?? '')
		: null;
	const width = widthMatch?.[1] ?? FALLBACK_WIDTH;
	const canvasOwlId = canvasTable?.getAttribute(OWL.id) ?? null;

	const preheader = doc.querySelector(`[${OWL.preheader}]`);
	const preheaderRaw = preheader ? serialize(preheader as unknown as Element) : null;

	const blendScreen = canvasTable?.querySelector('.gmail-blend-screen');
	let sectionsRaw: string;
	if (blendScreen) {
		sectionsRaw = serialize(blendScreen as unknown as Element);
	} else if (canvasTable) {
		// Shell without blend wrappers: take the canvas cell's inner content.
		const cell = canvasTable.querySelector('td');
		sectionsRaw = cell ? cell.innerHTML.trim() : serialize(canvasTable);
	} else {
		// No shell canvas at all (custom shell): everything in body except the preheader.
		sectionsRaw = [...(doc.body?.childNodes ?? [])]
			.filter((n) => n !== preheader && !(n as Element).querySelector?.(`[${OWL.preheader}]`))
			.map((n) => (typeof n.toString === 'function' ? n.toString() : ''))
			.join('\n');
	}

	// The MJML wrapper replaces the shell canvas table — carry its inheritable
	// text styles (font/color/size/leading) so raw content does not fall back
	// to the browser default font.
	const textRootStyle = inheritedCanvasStyle(canvasTable);
	if (textRootStyle) sectionsRaw = `<div style="${textRootStyle.replace(/"/g, "'")}">${sectionsRaw}</div>`;

	const baseCss = doc.head?.querySelector(`style[${OWL.baseCss}]`)?.textContent ?? '';

	const xml =
		`<mjml lang="${xmlAttr(docLang)}">` +
		`<mj-head><mj-style>${escapeXmlText(baseCss)}</mj-style></mj-head>` +
		`<mj-body background-color="${xmlAttr(backdrop)}" width="${xmlAttr(width)}">` +
		(preheaderRaw ? `<mj-raw>${preheaderRaw}</mj-raw>` : '') +
		backdropSpacer(backdrop) +
		`<mj-wrapper background-color="${xmlAttr(canvas)}">` +
		`<mj-raw>${sectionsRaw}</mj-raw>` +
		`</mj-wrapper>` +
		backdropSpacer(backdrop) +
		`</mj-body></mjml>`;

	return { xml, canvasOwlId };
}

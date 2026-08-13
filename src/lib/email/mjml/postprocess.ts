/**
 * finalizeDeliveryHtml — post-pass applied to MJML output (C2).
 *
 * MJML owns the structural scaffold (MSO/VML conditionals, responsive
 * classes, doctype, head metas). This pass re-asserts compiler-owned pieces
 * on top of it:
 *
 * - `color-scheme: light only` metas (MJML does not emit them)
 * - `class="body"` + backdrop gradient pin (Apple Mail forced-dark hardening)
 * - the canvas wrapper div gets the shell's original canvas `data-owl-id`
 *   back so the studio's "Email container" selection keeps working
 * - every remaining MJML structural element mints a stable `data-owl-id`
 *   (continuing the C1 counter) so applyLightOverride can pin its inline
 *   colors for forced-dark clients
 * - a fresh `<style data-owl-light-css>` dark-mode override + Gmail
 *   `u + .body` blend CSS via applyLightOverride
 *
 * The `data-owl-mjml` marker tells absolutizeEmailAssetUrls to skip the
 * legacy fluidify pass (MJML output already carries its own width strategy).
 */
import { parseDocument, serialize, walkElements, type Document, type Element } from '../owl/parser';
import { applyLightOverride } from '../owl/light-override';
import { OWL } from '../owl/format';
import { addClass, mergeStyleDecls } from '../owl/style';

export const MJML_MARKER = 'data-owl-mjml';

export function isMjmlDelivered(html: string): boolean {
	return html.includes(MJML_MARKER);
}

export type FinalizeDeliveryOptions = {
	/** Shell canvas table id — stamped onto the MJML wrapper (max-width) div. */
	canvasOwlId?: string | null;
};

function ensureMeta(head: Element | null, name: string, content: string): void {
	if (!head || head.querySelector(`meta[name="${name}"]`)) return;
	const meta = head.ownerDocument.createElement('meta');
	meta.setAttribute('name', name);
	meta.setAttribute('content', content);
	head.appendChild(meta);
}

/** Mint data-owl-id for MJML structural body elements, continuing past existing w-ids. */
function mintMissingIds(doc: Document): void {
	const body = (doc.body ?? doc) as unknown as Document | Element;
	let max = 0;
	for (const el of walkElements(doc)) {
		const id = el.getAttribute(OWL.id);
		const num = id ? /^w(\d+)$/.exec(id)?.[1] : null;
		if (num) max = Math.max(max, Number(num));
	}
	for (const el of walkElements(body)) {
		const tag = el.tagName.toLowerCase();
		if (tag === 'head' || tag === 'html') continue;
		if (el.getAttribute(OWL.id)) continue;
		el.setAttribute(OWL.id, `w${++max}`);
	}
}

function stampCanvasWrapper(doc: Document, canvasOwlId: string): void {
	if (doc.querySelector(`[${OWL.id}="${canvasOwlId}"]`)) return;
	// The MJML wrapper div is the first centered max-width div with a
	// background inside the article scaffold.
	for (const el of walkElements(doc)) {
		if (el.tagName.toLowerCase() !== 'div') continue;
		const style = el.getAttribute('style') ?? '';
		if (!/max-width:\s*[\d.]+px/i.test(style)) continue;
		if (!/background(?:-color)?:/i.test(style)) continue;
		el.setAttribute(OWL.id, canvasOwlId);
		return;
	}
}

export function finalizeDeliveryHtml(html: string, opts: FinalizeDeliveryOptions = {}): string {
	const doc = parseDocument(html);

	ensureMeta(doc.head as unknown as Element, 'color-scheme', 'light only');
	ensureMeta(doc.head as unknown as Element, 'supported-color-schemes', 'light only');

	const body = doc.body as unknown as Element | null;
	if (body) {
		addClass(body, 'body');
		body.setAttribute(MJML_MARKER, '1');
		const bg = (body.getAttribute('style') ?? '')
			.match(/background-color:\s*([^;]+)/i)?.[1]
			?.trim();
		if (bg) {
			body.setAttribute(
				'style',
				mergeStyleDecls(
					body.getAttribute('style'),
					[['background-image', `linear-gradient(${bg},${bg})`]],
					false,
				),
			);
		}
	}

	if (opts.canvasOwlId) stampCanvasWrapper(doc, opts.canvasOwlId);

	mintMissingIds(doc);
	applyLightOverride(doc, {});
	return serialize(doc);
}

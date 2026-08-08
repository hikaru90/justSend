/**
 * to-mjml — map a block-builder document onto the MJML shell.
 *
 * Same architecture as the Owl pipeline (owl/mjml-map.ts): the hand-rolled
 * backdrop/canvas table scaffold is replaced by MJML's structural markup
 * (MSO/VML conditionals, responsive classes, role="article"), while the
 * per-block render output — produced by the existing render-html.ts block
 * renderers — rides inside `<mj-raw>` verbatim, wrapped in the gmail-blend
 * divs. Delivery = transpileMjml + finalizeDeliveryHtml (shared post-pass).
 *
 * Pure string building: client- and worker-safe; no mjml import here.
 */
import { fluidifyEmailHtml } from '$lib/email/fluidify-email-html';
import { renderBlock } from './render-html';
import type { TEditorBlock, TEditorConfiguration } from './types';

const DEFAULT_BACKDROP = '#F5F5F5';
const DEFAULT_CANVAS = '#FFFFFF';

function xmlAttr(value: string): string {
	return value.replace(/["'<>&]/g, '').trim();
}

function layoutBlock(document: TEditorConfiguration): TEditorBlock | null {
	for (const id of Object.keys(document)) {
		const block = document[id];
		if (block?.type === 'EmailLayout') return block;
	}
	return null;
}

const BASE_CSS = `:root{color-scheme:light only;}
html,body{margin:0!important;padding:0!important;width:100%!important;}
img{max-width:100%!important;height:auto!important;}
table{border-collapse:collapse;}
@media only screen and (max-width:620px){
.owl-stack{display:block!important;width:100%!important;max-width:100%!important;}
}`;

function backdropSpacer(backdrop: string): string {
	return (
		`<mj-section background-color="${xmlAttr(backdrop)}" padding="0">` +
		`<mj-column><mj-spacer height="32px" /></mj-column></mj-section>`
	);
}

/** Build the MJML XML document for a block-builder document tree. */
export function toMjmlDocument(document: TEditorConfiguration): string {
	const root = layoutBlock(document);
	const backdrop = root?.data.backdropColor ?? DEFAULT_BACKDROP;
	const canvas = root?.data.canvasColor ?? DEFAULT_CANVAS;

	const kids = root
		? fluidifyEmailHtml(
				(root.data.childrenIds ?? []).map((id) => renderBlock(document, id)).join(''),
			)
		: '';

	return (
		`<mjml lang="en"><mj-head><mj-style>${BASE_CSS}</mj-style></mj-head>` +
		`<mj-body background-color="${xmlAttr(backdrop)}" width="600px">` +
		backdropSpacer(backdrop) +
		`<mj-wrapper background-color="${xmlAttr(canvas)}">` +
		`<mj-raw><div class="gmail-blend-screen"><div class="gmail-blend-difference">${kids}</div></div></mj-raw>` +
		`</mj-wrapper>` +
		backdropSpacer(backdrop) +
		`</mj-body></mjml>`
	);
}

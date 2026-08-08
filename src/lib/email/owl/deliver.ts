/**
 * deliver — the C2 compile stage for Owl markup:
 *
 *   buildOwlMjmlDocument  →  mjml2html  →  finalizeDeliveryHtml
 *
 * C1 (`compileOwlHtml`) stays the deterministic studio markup stage that Pi
 * edits; this stage turns it into delivery HTML with MJML's MSO/VML
 * conditionals and responsive scaffold. Server/worker only (lazy mjml import).
 */
import { transpileMjml } from '$lib/email/mjml/transpile';
import { finalizeDeliveryHtml } from '$lib/email/mjml/postprocess';
import { buildOwlMjmlDocument } from './mjml-map';

export async function deliverOwlHtml(compiledMarkupHtml: string): Promise<string> {
	const map = buildOwlMjmlDocument(compiledMarkupHtml);
	const { html } = await transpileMjml(map.xml);
	return finalizeDeliveryHtml(html, { canvasOwlId: map.canvasOwlId });
}

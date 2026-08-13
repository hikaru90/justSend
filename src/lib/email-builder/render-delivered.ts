/**
 * render-delivered — server-side delivery render for block-builder documents:
 *
 *   toMjmlDocument → mjml2html → finalizeDeliveryHtml
 *
 * The saved/previewed html for design-system components is MJML-delivered so
 * it matches the Owl template pipeline byte-for-byte in scaffold behavior
 * (MSO/VML conditionals, responsive classes, light-only shield, gmail-blend
 * rules). Server-only: the mjml import is lazy.
 */
import { transpileMjml } from '$lib/email/mjml/transpile';
import { finalizeDeliveryHtml } from '$lib/email/mjml/postprocess';
import { toMjmlDocument } from './to-mjml';
import type { TEditorConfiguration } from './types';

export async function renderDeliveredEmailHtml(document: TEditorConfiguration): Promise<string> {
	const { html } = await transpileMjml(toMjmlDocument(document));
	return finalizeDeliveryHtml(html, {});
}

import { fluidifyEmailHtml } from '$lib/email/fluidify-email-html';
import { rewriteDesignAssetUrls } from '$lib/design-asset-urls';
import { isMjmlDelivered } from '$lib/email/mjml/postprocess';

/**
 * Rewrite design-asset URLs to absolute ones so email clients
 * (which have no page origin) can fetch images, and fluidify fixed-width markup
 * so the layout can shrink on mobile (Gmail Android, etc.).
 *
 * MJML-delivered html (data-owl-mjml) skips fluidify — MJML's width strategy
 * (max-width containers, responsive classes) must not be rewritten.
 *
 * Also remaps already-absolute design-asset URLs from other hosts (e.g. localhost
 * baked in during local editing) onto the current base — so prod/dev share DB data.
 */
export function absolutizeEmailAssetUrls(html: string, baseUrl: string): string {
	if (!html) return html;
	const rewritten = rewriteDesignAssetUrls(html, baseUrl);
	return isMjmlDelivered(rewritten) ? rewritten : fluidifyEmailHtml(rewritten);
}

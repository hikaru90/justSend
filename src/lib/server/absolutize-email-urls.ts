import { fluidifyEmailHtml } from '$lib/email/fluidify-email-html';
import { rewriteDesignAssetUrls } from '$lib/design-asset-urls';

/**
 * Rewrite design-asset URLs to absolute ones so email clients
 * (which have no page origin) can fetch images, and fluidify fixed-width markup
 * so the layout can shrink on mobile (Gmail Android, etc.).
 *
 * Also remaps already-absolute design-asset URLs from other hosts (e.g. localhost
 * baked in during local editing) onto the current base — so prod/dev share DB data.
 */
export function absolutizeEmailAssetUrls(html: string, baseUrl: string): string {
	if (!html) return html;
	return fluidifyEmailHtml(rewriteDesignAssetUrls(html, baseUrl));
}

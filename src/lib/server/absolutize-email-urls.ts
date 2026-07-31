import { fluidifyEmailHtml } from '$lib/email/fluidify-email-html';

/**
 * Rewrite root-relative design-asset URLs to absolute ones so email clients
 * (which have no page origin) can fetch images, and fluidify fixed-width markup
 * so the layout can shrink on mobile (Gmail Android, etc.).
 */
export function absolutizeEmailAssetUrls(html: string, baseUrl: string): string {
	const origin = baseUrl.replace(/\/$/, '');
	if (!html) return html;

	const withAbsolute = !origin
		? html
		: html
				.replace(/(\bsrc=["'])\/(api\/design-asset\/[^"']+)/gi, `$1${origin}/$2`)
				.replace(/(\bhref=["'])\/(api\/design-asset\/[^"']+)/gi, `$1${origin}/$2`)
				.replace(
					/url\(\s*(["']?)\/(api\/design-asset\/[^"')\s]+)\1\s*\)/gi,
					`url($1${origin}/$2$1)`
				);

	return fluidifyEmailHtml(withAbsolute);
}

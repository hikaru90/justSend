/**
 * Rewrite root-relative design-asset URLs to absolute ones so email clients
 * (which have no page origin) can fetch images.
 */
export function absolutizeEmailAssetUrls(html: string, baseUrl: string): string {
	const origin = baseUrl.replace(/\/$/, '');
	if (!origin || !html) return html;

	return html
		.replace(/(\bsrc=["'])\/(api\/design-asset\/[^"']+)/gi, `$1${origin}/$2`)
		.replace(/(\bhref=["'])\/(api\/design-asset\/[^"']+)/gi, `$1${origin}/$2`)
		.replace(
			/url\(\s*(["']?)\/(api\/design-asset\/[^"')\s]+)\1\s*\)/gi,
			`url($1${origin}/$2$1)`
		);
}

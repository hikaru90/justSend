/** Root-relative path for a design asset (safe to persist across environments). */
export function designAssetPath(assetId: string): string {
	return `/api/design-asset/${assetId}`;
}

/**
 * Build a design-asset URL. Empty / omitted base → root-relative path so
 * templates survive moving between localhost and production.
 */
export function designAssetUrl(assetId: string, baseUrl = ''): string {
	const base = baseUrl.replace(/\/$/, '');
	return base ? `${base}${designAssetPath(assetId)}` : designAssetPath(assetId);
}

const ABSOLUTE_DESIGN_ASSET = /https?:\/\/[^/"'\s)]+\/(api\/design-asset\/[^"'?\s)#]+)/gi;

/**
 * Strip any host from design-asset URLs so stored HTML/documents are
 * environment-agnostic. Leaves non-design-asset absolute URLs alone.
 */
export function relativizeDesignAssetUrls(text: string): string {
	if (!text) return text;
	return text.replace(ABSOLUTE_DESIGN_ASSET, '/$1');
}

/**
 * Rewrite root-relative and any-host absolute design-asset URLs to `baseUrl`.
 * Does not fluidify HTML — use `absolutizeEmailAssetUrls` for outbound mail.
 */
export function rewriteDesignAssetUrls(html: string, baseUrl: string): string {
	const origin = baseUrl.replace(/\/$/, '');
	if (!origin || !html) return html;

	return html
		.replace(ABSOLUTE_DESIGN_ASSET, `${origin}/$1`)
		.replace(/(\bsrc=["'])\/(api\/design-asset\/[^"']+)/gi, `$1${origin}/$2`)
		.replace(/(\bhref=["'])\/(api\/design-asset\/[^"']+)/gi, `$1${origin}/$2`)
		.replace(/url\(\s*(["']?)\/(api\/design-asset\/[^"')\s]+)\1\s*\)/gi, `url($1${origin}/$2$1)`);
}

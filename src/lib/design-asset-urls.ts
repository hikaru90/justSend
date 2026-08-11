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

/**
 * Legacy cuid (24 hex) or content-addressed sha256 (64 hex) asset ids.
 * Bare ids must become `/api/design-asset/{id}` before use as img src.
 */
const BARE_ASSET_ID = /^[a-f0-9]{24}$|^[a-f0-9]{64}$/i;

/**
 * If `value` is a bare design-asset id, wrap it as `/api/design-asset/{id}`.
 * Leaves absolute URLs, root-relative paths, and other strings untouched.
 */
export function normalizeDesignAssetSrc(value: string): string {
	const v = value.trim();
	if (!v) return value;
	if (BARE_ASSET_ID.test(v)) return designAssetPath(v);
	return value;
}

/** Normalize every string value in an Owl slotValues map (image slots store asset srcs). */
export function normalizeDesignAssetSlotValues(
	values: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {};
	let changed = false;
	for (const [key, value] of Object.entries(values)) {
		if (typeof value !== 'string') {
			out[key] = value;
			continue;
		}
		const next = normalizeDesignAssetSrc(value);
		out[key] = next;
		if (next !== value) changed = true;
	}
	return changed ? out : values;
}

/**
 * Rewrite bare asset ids embedded as `src="…"` or `url(…)` in HTML/CSS text.
 * Leaves already-prefixed paths and absolute URLs alone.
 */
export function normalizeBareDesignAssetUrlsInHtml(html: string): string {
	if (!html) return html;
	return html
		.replace(
			/(\bsrc=["'])([a-fA-F0-9]{24}|[a-fA-F0-9]{64})(["'])/g,
			(_, prefix: string, id: string, suffix: string) =>
				`${prefix}/api/design-asset/${id}${suffix}`,
		)
		.replace(
			/(url\(\s*["']?)([a-fA-F0-9]{24}|[a-fA-F0-9]{64})(["']?\s*\))/g,
			(_, prefix: string, id: string, suffix: string) =>
				`${prefix}/api/design-asset/${id}${suffix}`,
		);
}

/**
 * Walk an email-builder block tree and normalize Image `props.url` /
 * Container `style.backgroundImage` when they hold bare asset ids.
 * Returns whether anything changed.
 */
export function normalizeBareDesignAssetUrlsInDocument(
	doc: Record<string, { type?: string; data?: Record<string, unknown> }>,
): boolean {
	if (!doc || typeof doc !== 'object') return false;
	let changed = false;

	const normalizeField = (obj: Record<string, unknown> | undefined, key: string) => {
		if (!obj || typeof obj[key] !== 'string') return;
		const prev = obj[key] as string;
		const next = normalizeDesignAssetSrc(prev);
		if (next !== prev) {
			obj[key] = next;
			changed = true;
		}
	};

	for (const block of Object.values(doc)) {
		if (!block || typeof block !== 'object') continue;
		const data = block.data;
		if (!data || typeof data !== 'object') continue;
		const props = data.props as Record<string, unknown> | undefined;
		const style = data.style as Record<string, unknown> | undefined;
		normalizeField(props, 'url');
		normalizeField(style, 'backgroundImage');
	}
	return changed;
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

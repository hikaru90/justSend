const FETCH_TIMEOUT_MS = 15_000;
const MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_STYLESHEETS = 8;
const MAX_FONT_FACES = 12;

/** Browser-like UA so hosts like fonts.googleapis.com serve woff2 instead of ttf. */
const BROWSER_UA =
	'Mozilla/5.0 (compatible; OwleryDesignInfer/1.0; +https://owlery.dev) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function assertSafeUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('Invalid URL');
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('URL must be http or https');
	}

	const host = url.hostname.toLowerCase();
	if (
		host === 'localhost' ||
		host === '127.0.0.1' ||
		host === '::1' ||
		host === '0.0.0.0' ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		host === 'metadata.google.internal'
	) {
		throw new Error('URL host is not allowed');
	}

	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) {
		const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
		if (
			a === 10 ||
			a === 127 ||
			a === 0 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254)
		) {
			throw new Error('URL host is not allowed');
		}
	}

	return url;
}

function resolveAgainst(href: string, base: URL): URL | null {
	try {
		return assertSafeUrl(new URL(href, base).toString());
	} catch {
		return null;
	}
}

function getAttr(tag: string, name: string): string | null {
	const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
	const m = tag.match(re);
	return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

function findLinkTags(html: string, relNeedles: string[]): string[] {
	const tags: string[] = [];
	const re = /<link\b[^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const tag = m[0];
		const rel = (getAttr(tag, 'rel') ?? '').toLowerCase();
		if (relNeedles.some((n) => rel.includes(n))) {
			tags.push(tag);
		}
	}
	return tags;
}

/**
 * Prefer apple-touch-icon, then large favicon, then any icon, then og:image, then first header img.
 */
export function extractLogoUrl(html: string, baseUrl: URL): string | null {
	const apple = findLinkTags(html, ['apple-touch-icon']);
	for (const tag of apple) {
		const href = getAttr(tag, 'href');
		if (!href) continue;
		const resolved = resolveAgainst(href, baseUrl);
		if (resolved) return resolved.toString();
	}

	const icons = findLinkTags(html, ['icon']);
	// Prefer icons that declare a larger size
	const scored = icons
		.map((tag) => {
			const href = getAttr(tag, 'href');
			const sizes = getAttr(tag, 'sizes') ?? '';
			const sizeMatch = sizes.match(/(\d+)/);
			const size = sizeMatch ? Number(sizeMatch[1]) : 0;
			return { href, size };
		})
		.filter((x): x is { href: string; size: number } => Boolean(x.href))
		.sort((a, b) => b.size - a.size);

	for (const item of scored) {
		const resolved = resolveAgainst(item.href, baseUrl);
		if (resolved) return resolved.toString();
	}

	const ogMatch = html.match(
		/<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*>|<meta\b[^>]*content\s*=\s*["'][^"']+["'][^>]*property\s*=\s*["']og:image["'][^>]*>/i
	);
	if (ogMatch) {
		const content = getAttr(ogMatch[0], 'content');
		if (content) {
			const resolved = resolveAgainst(content, baseUrl);
			if (resolved) return resolved.toString();
		}
	}

	const headerMatch = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i);
	if (headerMatch) {
		const img = headerMatch[1].match(/<img\b[^>]*>/i);
		if (img) {
			const src = getAttr(img[0], 'src');
			if (src) {
				const resolved = resolveAgainst(src, baseUrl);
				if (resolved) return resolved.toString();
			}
		}
	}

	return null;
}

/**
 * Collect stylesheet URLs from the page. Font CSS hosts are listed first.
 */
export function extractFontCssUrls(html: string, baseUrl: URL): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();

	function add(href: string) {
		const resolved = resolveAgainst(href, baseUrl);
		if (!resolved) return;
		const key = resolved.toString();
		if (seen.has(key)) return;
		seen.add(key);
		urls.push(key);
	}

	const fontHostHints = ['fonts.googleapis.com', 'fonts.gstatic.com', 'use.typekit.net', 'fonts.bunny.net'];

	const linkTags = findLinkTags(html, ['stylesheet', 'preload']);
	const prioritized: string[] = [];
	const rest: string[] = [];

	for (const tag of linkTags) {
		const rel = (getAttr(tag, 'rel') ?? '').toLowerCase();
		const as = (getAttr(tag, 'as') ?? '').toLowerCase();
		const href = getAttr(tag, 'href');
		if (!href) continue;
		if (rel.includes('preload') && as !== 'style' && as !== 'font') continue;
		if (rel.includes('preload') && as === 'font') continue; // binary font URL, not CSS

		const host = (() => {
			try {
				return new URL(href, baseUrl).hostname.toLowerCase();
			} catch {
				return '';
			}
		})();

		if (fontHostHints.some((h) => host.includes(h)) || /font/i.test(href)) {
			prioritized.push(href);
		} else if (rel.includes('stylesheet')) {
			rest.push(href);
		}
	}

	for (const href of [...prioritized, ...rest]) {
		add(href);
		if (urls.length >= MAX_STYLESHEETS) break;
	}

	return urls;
}

export type ParsedFontFace = {
	family: string;
	url: string;
	format: string;
};

function pickBestSrc(srcValue: string, cssBaseUrl: URL): { url: string; format: string } | null {
	// Split on commas that are outside url() / format()
	const candidates: Array<{ url: string; format: string; rank: number }> = [];
	const parts = srcValue.split(/,(?![^(]*\))/);

	for (const part of parts) {
		const urlMatch = part.match(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/i);
		if (!urlMatch) continue;
		const rawUrl = urlMatch[1];
		if (rawUrl.startsWith('data:')) continue;

		const formatMatch = part.match(/format\(\s*['"]?([^'")\s]+)['"]?\s*\)/i);
		const ext = rawUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
		const format = (formatMatch?.[1] ?? ext).toLowerCase();

		let rank = 0;
		if (format.includes('woff2') || ext === 'woff2') rank = 3;
		else if (format.includes('woff') || ext === 'woff') rank = 2;
		else if (format.includes('truetype') || format.includes('ttf') || ext === 'ttf') rank = 1;
		else if (format.includes('opentype') || format.includes('otf') || ext === 'otf') rank = 1;
		else continue;

		const resolved = resolveAgainst(rawUrl, cssBaseUrl);
		if (!resolved) continue;
		candidates.push({ url: resolved.toString(), format, rank });
	}

	candidates.sort((a, b) => b.rank - a.rank);
	const best = candidates[0];
	return best ? { url: best.url, format: best.format } : null;
}

export function parseFontFaces(css: string, cssBaseUrl: URL | string): ParsedFontFace[] {
	const base = typeof cssBaseUrl === 'string' ? new URL(cssBaseUrl) : cssBaseUrl;
	const faces: ParsedFontFace[] = [];
	const seen = new Set<string>();

	const faceRe = /@font-face\s*\{([^}]+)\}/gi;
	let m: RegExpExecArray | null;
	while ((m = faceRe.exec(css)) !== null) {
		const body = m[1];
		const familyMatch = body.match(/font-family\s*:\s*['"]?([^'";}]+)['"]?/i);
		const srcMatch = body.match(/src\s*:\s*([^;]+)/i);
		if (!familyMatch || !srcMatch) continue;

		const family = familyMatch[1].trim().replace(/^['"]|['"]$/g, '');
		if (!family) continue;

		const best = pickBestSrc(srcMatch[1], base);
		if (!best) continue;

		const key = `${family.toLowerCase()}|${best.url}`;
		if (seen.has(key)) continue;
		seen.add(key);

		faces.push({ family, url: best.url, format: best.format });
		if (faces.length >= MAX_FONT_FACES) break;
	}

	return faces;
}

export type DownloadedAsset = {
	bytes: Uint8Array;
	mime: string;
	filename: string;
};

function filenameFromUrl(url: URL, fallback: string): string {
	const last = url.pathname.split('/').filter(Boolean).pop() ?? fallback;
	const safe = last.replace(/[^a-zA-Z0-9._-]/g, '_');
	return safe || fallback;
}

function mimeFromFormat(format: string, contentType: string | null): string {
	if (contentType && !contentType.includes('text/') && !contentType.includes('octet-stream')) {
		return contentType.split(';')[0].trim();
	}
	const f = format.toLowerCase();
	if (f.includes('woff2')) return 'font/woff2';
	if (f.includes('woff')) return 'font/woff';
	if (f.includes('ttf') || f.includes('truetype')) return 'font/ttf';
	if (f.includes('otf') || f.includes('opentype')) return 'font/otf';
	return contentType?.split(';')[0].trim() || 'application/octet-stream';
}

export async function downloadAssetBytes(
	rawUrl: string,
	opts?: { fallbackFilename?: string; formatHint?: string }
): Promise<DownloadedAsset> {
	const url = assertSafeUrl(rawUrl);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(url.toString(), {
			signal: controller.signal,
			redirect: 'follow',
			headers: {
				'User-Agent': BROWSER_UA,
				Accept: 'image/*,font/*,*/*;q=0.8'
			}
		});
		if (!response.ok) {
			throw new Error(`Failed to download asset (${response.status})`);
		}

		const contentLength = Number(response.headers.get('content-length') ?? 0);
		if (contentLength > MAX_ASSET_BYTES) {
			throw new Error('Asset too large');
		}

		const buffer = new Uint8Array(await response.arrayBuffer());
		if (buffer.byteLength > MAX_ASSET_BYTES) {
			throw new Error('Asset too large');
		}
		if (buffer.byteLength === 0) {
			throw new Error('Asset was empty');
		}

		const contentType = response.headers.get('content-type');
		const mime = mimeFromFormat(opts?.formatHint ?? '', contentType);
		const filename = filenameFromUrl(url, opts?.fallbackFilename ?? 'asset');

		return { bytes: buffer, mime, filename };
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw new Error('Timed out downloading asset');
		}
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

export async function fetchCssText(rawUrl: string): Promise<string> {
	const url = assertSafeUrl(rawUrl);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(url.toString(), {
			signal: controller.signal,
			redirect: 'follow',
			headers: {
				'User-Agent': BROWSER_UA,
				Accept: 'text/css,*/*;q=0.1'
			}
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch CSS (${response.status})`);
		}
		const text = await response.text();
		return text.slice(0, 500_000);
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw new Error('Timed out fetching CSS');
		}
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Deduplicate font faces by family, keeping first (usually regular weight).
 */
export function uniqueFontsByFamily(faces: ParsedFontFace[]): ParsedFontFace[] {
	const seen = new Set<string>();
	const out: ParsedFontFace[] = [];
	for (const face of faces) {
		const key = face.family.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(face);
	}
	return out;
}

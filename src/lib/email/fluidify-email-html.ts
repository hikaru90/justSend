/**
 * Make email HTML safer for narrow viewports (Gmail Android, etc.).
 * Rewrites fixed-width tables and ensures images can shrink.
 */

const FIXED_EMAIL_WIDTHS = new Set(['600', '620', '640', '650', '680', '700']);

function ensureStyleDecl(style: string, property: string, value: string): string {
	const re = new RegExp(`(?:^|;)\\s*${property}\\s*:`, 'i');
	if (re.test(style)) return style;
	const trimmed = style.trim().replace(/;?\s*$/, '');
	return trimmed ? `${trimmed};${property}:${value}` : `${property}:${value}`;
}

function fluidifyTableTag(tag: string): string {
	const widthMatch = tag.match(/\bwidth\s*=\s*(["']?)(\d+)\1/i);
	if (!widthMatch) return tag;
	const px = widthMatch[2];
	if (!FIXED_EMAIL_WIDTHS.has(px)) return tag;

	let next = tag.replace(/\bwidth\s*=\s*(["']?)\d+\1/i, 'width="100%"');

	if (/\bstyle\s*=\s*"/i.test(next)) {
		next = next.replace(/\bstyle\s*=\s*"([^"]*)"/i, (_m, style: string) => {
			let s = ensureStyleDecl(style, 'max-width', `${px}px`);
			s = ensureStyleDecl(s, 'width', '100%');
			return `style="${s}"`;
		});
	} else if (/\bstyle\s*=\s*'/i.test(next)) {
		next = next.replace(/\bstyle\s*=\s*'([^']*)'/i, (_m, style: string) => {
			let s = ensureStyleDecl(style, 'max-width', `${px}px`);
			s = ensureStyleDecl(s, 'width', '100%');
			return `style='${s}'`;
		});
	} else {
		next = next.replace(
			/<table\b/i,
			`<table style="width:100%;max-width:${px}px;"`
		);
	}

	return next;
}

function fluidifyImgTag(tag: string): string {
	let next = tag.replace(/\sheight\s*=\s*(["']?)auto\1/gi, '');

	if (/\bstyle\s*=\s*"/i.test(next)) {
		next = next.replace(/\bstyle\s*=\s*"([^"]*)"/i, (_m, style: string) => {
			let s = ensureStyleDecl(style, 'max-width', '100%');
			s = ensureStyleDecl(s, 'height', 'auto');
			s = ensureStyleDecl(s, 'display', 'block');
			return `style="${s}"`;
		});
	} else if (/\bstyle\s*=\s*'/i.test(next)) {
		next = next.replace(/\bstyle\s*=\s*'([^']*)'/i, (_m, style: string) => {
			let s = ensureStyleDecl(style, 'max-width', '100%');
			s = ensureStyleDecl(s, 'height', 'auto');
			s = ensureStyleDecl(s, 'display', 'block');
			return `style='${s}'`;
		});
	} else {
		next = next.replace(
			/<img\b/i,
			'<img style="display:block;max-width:100%;height:auto;border:0;"'
		);
	}

	return next;
}

/** Rewrite fixed-width tables / rigid images so the email can shrink on mobile. */
export function fluidifyEmailHtml(html: string): string {
	if (!html) return html;

	return html
		.replace(/<table\b[^>]*>/gi, (tag) => fluidifyTableTag(tag))
		.replace(/<img\b[^>]*>/gi, (tag) => fluidifyImgTag(tag));
}

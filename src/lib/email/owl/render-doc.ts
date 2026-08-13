/**
 * renderOwlDocHtml — slim, worker-safe pipeline from an `OwlDoc` to final HTML.
 *
 * This is the single compose→slots→compile path shared by the studio compiler
 * (`compileOwlDoc`) and every outbound send/export path. It intentionally does
 * NOT import `studio-server.ts` or `starters.ts`: those pull in Vite-only
 * `import.meta.glob(?raw)` (starters.ts), which crashes the esbuild worker
 * bundle. The modules imported here (shell, slots, compile, parser, markdown,
 * design-asset-urls, format) are all worker-safe.
 */
import { parseDocument, serialize } from './parser';
import { composeEmailHtml } from './shell';
import { compileOwlHtml } from './compile';
import { deliverOwlHtml } from './deliver';
import { applySlotValues } from './slots';
import { resolveMarkdownLinkColors } from './markdown';
import { rewriteDesignAssetUrls } from '$lib/design-asset-urls';
import type { OwlDoc } from './studio';
import type { OwlIssue } from './format';

export type RenderOwlDocHtmlOptions = {
	/** Design tokens: token name -> literal value (e.g. { primary: '#0A2540' }). */
	tokens?: Record<string, string>;
	/**
	 * When set, root-relative `/api/design-asset/...` URLs are rewritten to
	 * absolute `{origin}/api/design-asset/...` URLs (preview/export). Omit it
	 * when persisting final HTML or when a later pass absolutizes.
	 */
	origin?: string;
};

export type RenderOwlDocHtmlResult = {
	html: string;
	issues: OwlIssue[];
};

/**
 * C1 — compose + compile an OwlDoc to studio markup (pre-MJML). This is the
 * deterministic fixed-point stage that AI/Pi whole-template edits operate on
 * and that feeds the MJML delivery stage. Deterministic; issues are returned
 * alongside output, never thrown.
 */
export function renderOwlMarkupHtml(
	doc: OwlDoc,
	ctx: RenderOwlDocHtmlOptions = {},
): RenderOwlDocHtmlResult {
	const composed = composeEmailHtml(
		doc.shell,
		doc.sections.map((s) => s.html),
		{ preheader: doc.preheader },
	);

	const parsed = parseDocument(composed.html);
	const mdColors = resolveMarkdownLinkColors(ctx.tokens);
	applySlotValues(parsed, doc.slotValues, mdColors);

	const result = compileOwlHtml(serialize(parsed), {
		kind: 'marketing',
		tokens: ctx.tokens,
	});

	const html = ctx.origin ? rewriteDesignAssetUrls(result.html, ctx.origin) : result.html;

	return { html, issues: [...composed.issues, ...result.issues] };
}

/**
 * C2 — the delivery render: C1 markup wrapped in MJML (MSO/VML conditionals,
 * responsive scaffold) and post-processed. This is the html that previews,
 * saves, exports and every outbound send use.
 */
export async function renderOwlDocHtml(
	doc: OwlDoc,
	ctx: RenderOwlDocHtmlOptions = {},
): Promise<RenderOwlDocHtmlResult> {
	const markup = renderOwlMarkupHtml(doc, ctx);
	const delivered = await deliverOwlHtml(markup.html);
	const html = ctx.origin ? rewriteDesignAssetUrls(delivered, ctx.origin) : delivered;
	return { html, issues: markup.issues };
}

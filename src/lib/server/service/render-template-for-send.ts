import { renderEmailHtml } from '$lib/email-editor/renderer';
import { parseDesignTokenMap } from '$lib/design/extractTokens';
import { parseOwlDoc } from '$lib/email/owl/studio';
import { renderOwlDocHtml } from '$lib/email/owl/render-doc';
import { getDesignSystemBundle } from './design-system-service';
import { replaceVariables } from './email-service';

export function designTokensForTeam(teamId: number): Record<string, string> {
	return parseDesignTokenMap(getDesignSystemBundle(teamId).system?.designMd ?? '');
}

export type RenderTemplateForSendOptions = {
	/** Design tokens used when compiling an OwlDoc (e.g. current design.md). */
	tokens?: Record<string, string>;
	/** Send / export variables substituted into leftover `{{placeholder}}` tokens. */
	variables?: Record<string, string>;
	/**
	 * When set, root-relative design-asset URLs in freshly compiled Owl HTML are
	 * rewritten to absolute `{origin}/api/design-asset/...` URLs (export/preview).
	 * Send paths omit it (they absolutize via `absolutizeEmailAssetUrls`).
	 */
	origin?: string;
};

/**
 * Render a template for an outbound send/export. When the template stores an
 * OwlDoc envelope (`content`), it is freshly compiled from that doc with the
 * current design tokens — never trusting the cached `html` snapshot, which can
 * diverge from the live preview (the snapshot is only rewritten on explicit
 * "Save template"). Legacy (non-Owl) templates keep today's behavior: the
 * stored `html` verbatim, else `renderEmailHtml`.
 */
export async function renderTemplateForSend(
	template: { content: string | null | undefined; html: string | null | undefined },
	opts: RenderTemplateForSendOptions = {},
): Promise<string> {
	const variables = opts.variables ?? {};
	const doc = parseOwlDoc(template.content);
	if (doc) {
		const { html } = await renderOwlDocHtml(doc, { tokens: opts.tokens, origin: opts.origin });
		return replaceVariables(html, variables);
	}
	if (template.html?.trim()) {
		return replaceVariables(template.html, variables);
	}
	return renderEmailHtml(template.content ?? null, template.html ?? null, variables);
}

/**
 * Design-token resolution. Tokens are authored as `data-owl-token` with the
 * syntax `css-property:token-name`. The compiler resolves them to literal
 * values (CSS custom properties do not work in email clients) and leaves the
 * attribute in place so token edits re-apply on the next compile.
 */
import { walkElements, type Document } from './parser';
import { OWL, type OwlCompileContext, type OwlIssue } from './format';
import { mergeStyleDecls } from './style';

function resolve(
	el: { getAttribute(name: string): string | null },
	raw: string | null,
	tokens: Record<string, string> | undefined,
): [prop: string, value: string] | null {
	if (!raw) return null;
	const idx = raw.indexOf(':');
	if (idx === -1) return null;
	const prop = raw.slice(0, idx).trim().toLowerCase();
	const name = raw.slice(idx + 1).trim();
	if (!prop || !name) return null;
	const value = tokens?.[name];
	if (!value) return null;
	return [prop, value];
}

export function applyTokens(doc: Document, ctx: OwlCompileContext): OwlIssue[] {
	const issues: OwlIssue[] = [];
	const tokens = ctx.tokens ?? {};

	for (const el of walkElements(doc)) {
		const id = el.getAttribute(OWL.id) ?? undefined;

		const token = resolve(el, el.getAttribute(OWL.token), tokens);
		if (token) {
			el.setAttribute('style', mergeStyleDecls(el.getAttribute('style'), [token], true));
		} else if (el.getAttribute(OWL.token)) {
			issues.push({
				code: 'token.unresolved',
				severity: 'warning',
				message: `Unresolved token "${el.getAttribute(OWL.token)}".`,
				owlId: id,
			});
		}
	}

	return issues;
}

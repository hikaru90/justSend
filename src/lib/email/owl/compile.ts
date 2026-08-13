/**
 * compileOwlHtml — the single, pure, deterministic pipeline:
 *
 *   parse → heal → strip-dark → normalize → tokens → enforce-explicit-colors → light-override → preheader → fluidify → lint
 *
 * Guarantees:
 *  - Same input bytes -> byte-identical output (enforced by tests).
 *  - Never throws: heals instead, and reports issues alongside output.
 *  - Recompiling already-compiled output is a fixed point.
 */
import {
	parseDocument,
	serialize,
	spliceRawAtComment,
	walkElements,
	type Document,
} from './parser';
import { healDocument } from './heal';
import { stripDarkVariants } from './strip-dark';
import { normalizeDocument } from './normalize';
import { applyTokens } from './tokens';
import { enforceExplicitColors } from './explicit-colors';
import { applyLightOverride } from './light-override';
import { extractSlots } from './slots';
import { lintDocument } from './lint';
import { fluidifyEmailHtml } from '$lib/email/fluidify-email-html';
import {
	OWL,
	OWL_FILLER,
	type OwlCompileContext,
	type OwlCompileResult,
	type OwlIssue,
} from './format';

function setPreheader(doc: Document, preheader: string, issues: OwlIssue[]): void {
	const el = doc.querySelector(`[${OWL.preheader}]`);
	if (el) {
		let target: Node | null = null;
		for (const child of el.childNodes ?? []) {
			if (child.nodeType === 3) {
				target = child;
				break;
			}
		}
		if (target) target.nodeValue = preheader;
		else el.textContent = preheader;
		if (!(el.textContent ?? '').includes('\u200c')) {
			el.appendChild(doc.createTextNode(OWL_FILLER));
		}
		return;
	}

	if (
		spliceRawAtComment(
			doc,
			OWL.preheaderAnchor,
			`<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}${OWL_FILLER}</div>`,
		)
	) {
		return;
	}

	issues.push({
		code: 'compile.preheader-unsupported',
		severity: 'warning',
		message: 'No preheader element or anchor found; preheader not injected.',
	});
}

export function compileOwlHtml(sourceHtml: string, ctx: OwlCompileContext = {}): OwlCompileResult {
	const doc = parseDocument(sourceHtml);
	const issues: OwlIssue[] = [...healDocument(doc)];

	issues.push(...stripDarkVariants(doc));

	normalizeDocument(doc);

	issues.push(...applyTokens(doc, ctx));

	issues.push(...enforceExplicitColors(doc));

	issues.push(...applyLightOverride(doc, ctx));

	if (ctx.preheader !== undefined) setPreheader(doc, ctx.preheader, issues);

	const serialized = serialize(doc);
	const html = fluidifyEmailHtml(serialized);

	// Lint after fluidify so placeholder/unsubscribe checks see the final shape.
	issues.push(...lintDocument(doc, html));

	const slots = extractSlots(doc);
	const ids: string[] = [];
	for (const el of walkElements(doc)) {
		const id = el.getAttribute(OWL.id);
		if (id) ids.push(id);
	}

	return { html, issues, slots, ids };
}

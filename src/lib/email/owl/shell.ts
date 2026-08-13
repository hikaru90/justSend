/**
 * Compose: splice section fragments into a shell document and fill the
 * preheader. Deterministic — identical inputs produce identical output.
 */
import { parseDocument, serialize, spliceAtComment, walkElements, type Document } from './parser';
import { healDocument } from './heal';
import { normalizeDocument } from './normalize';
import { OWL, OWL_FILLER, type OwlIssue } from './format';

export type ComposeResult = { html: string; issues: OwlIssue[] };

function setPreheader(doc: Document, preheader: string, issues: OwlIssue[]): void {
	const el = doc.querySelector(`[${OWL.preheader}]`);
	if (!el) {
		issues.push({
			code: 'compose.missing-preheader',
			severity: 'warning',
			message: 'No [data-owl-preheader] element found; preheader not injected.',
		});
		return;
	}

	// Replace only the first text node so authored filler after it survives.
	let target: Node | null = null;
	for (const child of el.childNodes ?? []) {
		if (child.nodeType === 3) {
			target = child;
			break;
		}
	}
	if (target) {
		target.nodeValue = preheader;
	} else {
		el.textContent = preheader;
	}

	// Ensure the filler run is present (guarded by its trailing ZWNJ).
	if (!(el.textContent ?? '').includes('\u200c')) {
		el.appendChild(doc.createTextNode(OWL_FILLER));
	}
}

/** Compose a full email document from a shell plus section fragments. */
export function composeEmailHtml(
	shellHtml: string,
	sectionsHtml: string[],
	opts: { preheader?: string } = {},
): ComposeResult {
	const doc = parseDocument(shellHtml);
	const issues: OwlIssue[] = [...healDocument(doc)];
	normalizeDocument(doc);

	const spliced = spliceAtComment(doc, OWL.sectionsAnchor, sectionsHtml.join('\n'));
	if (!spliced) {
		issues.push({
			code: 'compose.missing-anchor',
			severity: 'error',
			message: 'Shell is missing the <!--owl:sections--> anchor.',
		});
	}

	if (opts.preheader !== undefined) setPreheader(doc, opts.preheader, issues);

	return { html: serialize(doc), issues };
}

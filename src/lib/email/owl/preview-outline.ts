import { OWL } from './format';

/** Paint targets for row/table elements — mirrors email table structure in the studio. */
export function highlightTargetsFor(el: HTMLElement): HTMLElement[] {
	const tag = el.tagName.toLowerCase();
	if (tag === 'tr') {
		const cells = [...el.querySelectorAll(':scope > td, :scope > th')].filter(
			(n): n is HTMLElement => n instanceof HTMLElement,
		);
		return cells.length > 0 ? cells : [el];
	}
	if (tag === 'tbody' || tag === 'thead' || tag === 'table') {
		const cells = [...el.querySelectorAll('td, th')].filter(
			(n): n is HTMLElement => n instanceof HTMLElement,
		);
		return cells.length > 0 ? cells : [el];
	}
	return [el];
}

/** Find a marked preview node; `querySelector` skips the scope element itself (section root table). */
export function findPreviewElByOwlId(
	root: HTMLElement,
	scope: Element | null,
	owlId: string,
): HTMLElement | null {
	const searchRoot = scope ?? root;
	if (searchRoot instanceof HTMLElement && searchRoot.getAttribute(OWL.id) === owlId) {
		return searchRoot;
	}
	const el = searchRoot.querySelector(`[${OWL.id}="${owlId}"]`);
	return el instanceof HTMLElement ? el : null;
}

export function scrubLegacyInlineOutlines(root: Element): void {
	for (const el of root.querySelectorAll(
		'[data-owl-hover], [data-owl-selected], [data-owl-prev-outline], [data-owl-prev-shadow], [data-owl-prev-bg]',
	)) {
		if (!(el instanceof HTMLElement)) continue;
		el.style.outline = el.getAttribute('data-owl-prev-outline') ?? '';
		el.style.boxShadow = el.getAttribute('data-owl-prev-shadow') ?? '';
		el.style.backgroundColor = el.getAttribute('data-owl-prev-bg') ?? '';
		el.style.outlineOffset = '';
		el.removeAttribute('data-owl-prev-outline');
		el.removeAttribute('data-owl-prev-shadow');
		el.removeAttribute('data-owl-prev-bg');
		el.removeAttribute('data-owl-hover');
		el.removeAttribute('data-owl-selected');
	}
}

function stashInlineStyles(el: HTMLElement) {
	if (!el.hasAttribute('data-owl-prev-outline')) {
		el.setAttribute('data-owl-prev-outline', el.style.outline || '');
	}
	if (!el.hasAttribute('data-owl-prev-shadow')) {
		el.setAttribute('data-owl-prev-shadow', el.style.boxShadow || '');
	}
	if (!el.hasAttribute('data-owl-prev-bg')) {
		el.setAttribute('data-owl-prev-bg', el.style.backgroundColor || '');
	}
}

export function paintOutlineTargets(targets: HTMLElement[], kind: 'hover' | 'selected') {
	const color = kind === 'hover' ? '#6366f1' : '#4f46e5';
	const glow =
		kind === 'hover' ? 'rgb(99 102 241 / 0.18)' : 'rgb(79 70 229 / 0.22)';
	const attr = kind === 'hover' ? 'data-owl-hover' : 'data-owl-selected';
	for (const el of targets) {
		stashInlineStyles(el);
		el.setAttribute(attr, '1');
		el.style.setProperty('outline', `2px solid ${color}`, 'important');
		el.style.setProperty('outline-offset', '-2px', 'important');
		el.style.setProperty('box-shadow', `inset 0 0 0 2px ${color}`, 'important');
		el.style.setProperty('background-color', glow, 'important');
	}
}

/** Apply hover/selection highlights directly on preview DOM nodes. */
export function syncInlinePreviewOutlines(
	root: HTMLElement,
	input: {
		hoverEl: HTMLElement | null;
		selectedEl: HTMLElement | null;
	},
): void {
	scrubLegacyInlineOutlines(root);
	const { hoverEl, selectedEl } = input;
	if (hoverEl?.isConnected && root.contains(hoverEl)) {
		paintOutlineTargets(highlightTargetsFor(hoverEl), 'hover');
	}
	if (selectedEl?.isConnected && root.contains(selectedEl)) {
		paintOutlineTargets(highlightTargetsFor(selectedEl), 'selected');
	}
}

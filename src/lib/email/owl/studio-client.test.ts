/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
	applyInspectorPatch,
	applyShellInspectorPatch,
	extractInspector,
	extractShellInspector,
	findSectionIdForOwlId,
	isOwlIdInShell,
	mintOwlDoc,
	mintOwlIdsInFragment,
	mintOwlIdsInShell,
	shellCanvasBackgroundColor,
	shellCanvasCrumb,
} from './studio-client';
import { applySlotValues } from './slots';
import { parseDocument, serialize } from './parser';
import { starterByKey } from './starters';
import { OWL } from './format';

function owlIdForSlot(html: string, slotName: string): string {
	const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
	const el = doc.querySelector(`[${OWL.slot}="${slotName}"]`);
	const id = el?.getAttribute(OWL.id);
	if (!id) throw new Error(`No owl id for slot ${slotName}`);
	return id;
}

describe('studio-client: email container', () => {
	it('mints owl ids in shell and sections without overlap', () => {
		const shell = starterByKey('base-layout')!.html;
		const doc = mintOwlDoc({
			owl: 'v1',
			shell,
			sections: [
				{
					id: 's1',
					key: 'heading',
					label: 'Heading',
					html: starterByKey('heading')!.html,
				},
			],
			slotValues: {},
		});
		expect(doc.shell).toMatch(/data-owl-id="w\d+"/);
		const shellIds = new Set([...doc.shell.matchAll(/data-owl-id="(w\d+)"/g)].map((m) => m[1]!));
		const sectionIds = new Set(
			[...doc.sections[0].html.matchAll(/data-owl-id="(w\d+)"/g)].map((m) => m[1]!),
		);
		expect(shellIds.size).toBeGreaterThan(0);
		expect(sectionIds.size).toBeGreaterThan(0);
		for (const id of shellIds) expect(sectionIds.has(id)).toBe(false);
	});

	it('remints shell ids when they collide with section ids', () => {
		const sectionHtml = mintOwlIdsInFragment(starterByKey('logo-header')!.html);
		const shell = mintOwlIdsInShell(starterByKey('base-layout')!.html, 0);
		const doc = mintOwlDoc({
			owl: 'v1',
			shell,
			sections: [{ id: 's1', key: 'logo-header', label: 'Logo', html: sectionHtml }],
			slotValues: {},
		});
		const shellIds = new Set([...doc.shell.matchAll(/data-owl-id="(w\d+)"/g)].map((m) => m[1]!));
		const sectionIds = new Set(
			doc.sections.flatMap((s) => [...s.html.matchAll(/data-owl-id="(w\d+)"/g)].map((m) => m[1]!)),
		);
		for (const id of shellIds) expect(sectionIds.has(id)).toBe(false);
	});

	it('remints duplicate section ids instead of preserving collisions', () => {
		const frag = mintOwlIdsInFragment(starterByKey('heading')!.html);
		const doc = mintOwlDoc({
			owl: 'v1',
			shell: starterByKey('base-layout')!.html,
			sections: [
				{ id: 's1', key: 'heading', label: 'A', html: frag },
				{ id: 's2', key: 'heading', label: 'B', html: frag },
			],
			slotValues: {},
		});
		const allIds = doc.sections.flatMap((s) =>
			[...s.html.matchAll(/data-owl-id="(w\d+)"/g)].map((m) => m[1]!),
		);
		expect(new Set(allIds).size).toBe(allIds.length);
	});

	it('shellCanvasCrumb points at the 620px email container', () => {
		const shell = mintOwlIdsInShell(starterByKey('base-layout')!.html);
		const crumb = shellCanvasCrumb(shell);
		expect(crumb).not.toBeNull();
		expect(crumb!.label).toBe('Email container');
		expect(crumb!.kind).toBe('canvas');
		expect(shellCanvasBackgroundColor(shell)?.toLowerCase()).toBe('#ffffff');
	});

	it('isOwlIdInShell treats the canvas id as shell even when a section reuses it', () => {
		const shell = mintOwlIdsInShell(starterByKey('base-layout')!.html);
		const canvasId = shellCanvasCrumb(shell)!.owlId;
		const doc = {
			owl: 'v1' as const,
			shell,
			sections: [
				{
					id: 's1',
					key: 'logo-header',
					label: 'Logo',
					html: `<img data-owl-id="${canvasId}" src="/logo.png" alt="Logo">`,
				},
			],
			slotValues: {},
		};
		expect(findSectionIdForOwlId(doc, canvasId)).toBe('s1');
		expect(isOwlIdInShell(doc, canvasId)).toBe(true);
		expect(extractShellInspector(shell, canvasId)?.tag).toBe('table');
	});

	it('applyShellInspectorPatch updates only the canvas background', () => {
		const shell = mintOwlIdsInShell(starterByKey('base-layout')!.html);
		const canvasId = shellCanvasCrumb(shell)!.owlId;
		const next = applyShellInspectorPatch(shell, canvasId, {
			styleRows: [{ prop: 'background-color', value: '#eef2ff' }],
			attrRows: [{ name: 'bgcolor', value: '#eef2ff' }],
		});
		expect(next).toContain('background-color: #eef2ff');
		expect(next).toContain('bgcolor="#eef2ff"');
		expect(shellCanvasBackgroundColor(next!)?.toLowerCase()).toBe('#eef2ff');
		// Outer shell backdrop stays default — no syncing.
		expect(next).toContain('background-color:#F5F5F5');
	});
});

describe('studio-client: per-instance slot values', () => {
	it('keys slot values by owlId so two instances diverge', () => {
		const reserved = new Set<string>();
		const a = mintOwlIdsInFragment(starterByKey('text')!.html, 0, reserved);
		const b = mintOwlIdsInFragment(starterByKey('text')!.html, 0, new Set(reserved));
		const aId = owlIdForSlot(a, 'text');
		const bId = owlIdForSlot(b, 'text');
		expect(aId).not.toBe(bId);

		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${a}${b}</body></html>`);
		applySlotValues(doc, { [aId]: 'First instance copy' });
		const html = serialize(doc);

		expect(html).toContain('First instance copy');
		// Second instance keeps its authored default, not the first instance's value.
		expect(html).toContain('Write a short, benefit-focused paragraph here.');
		expect(html.match(/First instance copy/g)?.length).toBe(1);
	});

	it('falls back to slot-name values for legacy envelopes', () => {
		const frag = starterByKey('text')!.html;
		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${frag}</body></html>`);
		applySlotValues(doc, { text: 'Legacy default' });
		expect(serialize(doc)).toContain('Legacy default');
	});
});

describe('studio-client: component-scoped rawHtml patch', () => {
	it('replaces only the selected element and preserves data-owl-id', () => {
		const html = mintOwlIdsInFragment(starterByKey('cta-button')!.html);
		const owlId = owlIdForSlot(html, 'cta_text');
		const snap = extractInspector(html, owlId)!;
		expect(snap.rawHtml).toContain(owlId);

		const edited = `<a href="https://example.com/new" style="background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;" data-owl-slot="cta_text" data-owl-slot-type="text">Shop now</a>`;
		const next = applyInspectorPatch(html, owlId, { rawHtml: edited });
		expect(next).toBeTruthy();
		expect(next!).toContain(`data-owl-id="${owlId}"`);
		expect(next!).toContain('Shop now');
		expect(next!).toContain('border-radius:8px');
		expect(next!).toContain('data-owl-component="cta-button"');
		expect(next!).toContain('data-owl-slot="cta_url"');

		const again = extractInspector(next!, owlId);
		expect(again).not.toBeNull();
		expect(again!.textContent).toContain('Shop now');
	});

	it('re-attaches data-owl-id when the replacement omits it', () => {
		const html = mintOwlIdsInFragment(starterByKey('cta-button')!.html);
		const owlId = owlIdForSlot(html, 'cta_text');
		const next = applyInspectorPatch(html, owlId, {
			rawHtml: `<span data-owl-slot="cta_text" data-owl-slot-type="text">Bare</span>`,
		});
		expect(next).toContain(`data-owl-id="${owlId}"`);
		expect(extractInspector(next!, owlId)?.textContent).toContain('Bare');
	});
});

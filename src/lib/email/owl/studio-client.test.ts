/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
	applyInspectorPatch,
	applyShellInspectorPatch,
	copyDarkStylesToLight,
	copyLightStylesToDark,
	darkOverridePropSet,
	effectiveDarkStyleRows,
	ensureVariantPartner,
	extractInspector,
	extractShellInspector,
	findSectionIdForOwlId,
	isOwlIdInShell,
	mintOwlDoc,
	mintOwlIdsInFragment,
	mintOwlIdsInShell,
	resolveVariantEditTargets,
	shellCanvasBackgroundColor,
	shellCanvasCrumb,
} from './studio-client';
import { starterByKey } from './starters';
import { OWL, OWL_CLASS } from './format';

function owlIdForSlot(html: string, slotName: string): string {
	const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
	const el = doc.querySelector(`[${OWL.slot}="${slotName}"]`);
	const id = el?.getAttribute(OWL.id);
	if (!id) throw new Error(`No owl id for slot ${slotName}`);
	return id;
}

describe('studio-client: variant edit targets', () => {
	it('resolveVariantEditTargets maps light selection to both variants', () => {
		const html = mintOwlIdsInFragment(starterByKey('logo-header')!.html);
		const owlId = owlIdForSlot(html, 'logo');
		const targets = resolveVariantEditTargets(html, owlId);
		expect(targets).not.toBeNull();
		expect(targets!.lightOwlId).toBe(owlId);
		expect(targets!.darkOwlId).toBeTruthy();
		expect(targets!.styleOwlId).toBe(owlId);
	});

	it('resolveVariantEditTargets maps dark selection back to light slot owner', () => {
		const html = mintOwlIdsInFragment(starterByKey('logo-header')!.html);
		const lightId = owlIdForSlot(html, 'logo');
		const targets = resolveVariantEditTargets(html, lightId);
		const darkId = targets!.darkOwlId!;
		const fromDark = resolveVariantEditTargets(html, darkId);
		expect(fromDark!.lightOwlId).toBe(lightId);
		expect(fromDark!.darkOwlId).toBe(darkId);
		expect(fromDark!.styleOwlId).toBe(lightId);
	});
});

describe('studio-client: style copy between light and dark', () => {
	it('copyLightStylesToDark copies padding and colors onto data-owl-dark-style', () => {
		const html =
			'<a data-owl-id="w1" style="padding:12px 24px;color:#000;background-color:#fff">Go</a>';
		const result = copyLightStylesToDark(html, 'w1');
		expect(result).not.toBeNull();
		expect(result!.darkStyleRows).toEqual(
			expect.arrayContaining([
				{ prop: 'padding', value: '12px 24px' },
				{ prop: 'color', value: '#000' },
				{ prop: 'background-color', value: '#fff' },
			]),
		);
		expect(result!.html).toContain('data-owl-dark-style=');
		expect(result!.html).toContain('padding');
		expect(result!.html).toContain('12px 24px');
		const snap = extractInspector(result!.html, 'w1');
		expect(snap!.darkStyleRows).toEqual(result!.darkStyleRows);
	});

	it('copyDarkStylesToLight copies dark overrides onto inline style', () => {
		const html =
			'<a data-owl-id="w1" style="padding:4px;color:#000" data-owl-dark-style="padding:16px;color:#fff">Go</a>';
		const result = copyDarkStylesToLight(html, 'w1');
		expect(result).not.toBeNull();
		expect(result!.styleRows).toEqual(
			expect.arrayContaining([
				{ prop: 'padding', value: '16px' },
				{ prop: 'color', value: '#fff' },
			]),
		);
		expect(result!.html).toContain('style="padding:16px;color:#fff"');
	});
});

describe('studio-client: variant partner layout sync', () => {
	it('mirrors width and max-width from light img onto dark partner', () => {
		const html = mintOwlIdsInFragment(starterByKey('logo-header')!.html);
		const owlId = owlIdForSlot(html, 'logo');
		const targets = resolveVariantEditTargets(html, owlId)!;
		const next = applyInspectorPatch(html, owlId, {
			styleRows: [
				{ prop: 'display', value: 'block' },
				{ prop: 'width', value: '120px' },
				{ prop: 'max-width', value: '80%' },
				{ prop: 'height', value: 'auto' },
			],
		});
		expect(next).toBeTruthy();
		const darkSnap = extractInspector(next!, targets.darkOwlId!);
		expect(darkSnap!.styleRows).toEqual(
			expect.arrayContaining([
				{ prop: 'width', value: '120px' },
				{ prop: 'max-width', value: '80%' },
			]),
		);
		expect(darkSnap!.styleRows.find((r) => r.prop === 'display')?.value).toBe('none');
	});

	it('mirrors width attribute from light img onto dark partner', () => {
		const html = mintOwlIdsInFragment(starterByKey('logo-header')!.html);
		const owlId = owlIdForSlot(html, 'logo');
		const targets = resolveVariantEditTargets(html, owlId)!;
		const lightSnap = extractInspector(html, owlId)!;
		const next = applyInspectorPatch(html, owlId, {
			attrRows: lightSnap.attrRows.map((r) =>
				r.name === 'width' ? { ...r, value: '140' } : { ...r },
			),
		});
		expect(next).toBeTruthy();
		const darkSnap = extractInspector(next!, targets.darkOwlId!);
		expect(darkSnap!.attrRows.find((r) => r.name === 'width')?.value).toBe('140');
	});
});

describe('studio-client: effective dark style rows', () => {
	it('merges light base with dark overrides', () => {
		const light = [
			{ prop: 'width', value: '100%' },
			{ prop: 'color', value: '#000' },
		];
		const overrides = [{ prop: 'color', value: '#fff' }];
		expect(effectiveDarkStyleRows(light, overrides)).toEqual([
			{ prop: 'width', value: '100%' },
			{ prop: 'color', value: '#fff' },
		]);
	});

	it('returns light rows when there are no overrides', () => {
		const light = [{ prop: 'max-width', value: '600px' }];
		expect(effectiveDarkStyleRows(light, [])).toEqual([{ prop: 'max-width', value: '600px' }]);
	});

	it('darkOverridePropSet lists override property names', () => {
		expect(darkOverridePropSet([{ prop: 'color', value: '#fff' }])).toEqual(new Set(['color']));
	});
});

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
		const shellIds = [...doc.shell.matchAll(/data-owl-id="w(\d+)"/g)].map((m) => Number(m[1]));
		const sectionIds = [
			...doc.sections[0].html.matchAll(/data-owl-id="w(\d+)"/g),
		].map((m) => Number(m[1]));
		expect(Math.min(...sectionIds)).toBeGreaterThan(Math.max(...shellIds));
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

	it('shellCanvasCrumb points at the 620px email container', () => {
		const shell = mintOwlIdsInShell(starterByKey('base-layout')!.html);
		const crumb = shellCanvasCrumb(shell);
		expect(crumb).not.toBeNull();
		expect(crumb!.label).toBe('Email container');
		expect(crumb!.kind).toBe('canvas');
		expect(shellCanvasBackgroundColor(shell, false)?.toLowerCase()).toBe('#ffffff');
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
			darkStyleRows: [{ prop: 'background-color', value: '#1e1b4b' }],
			attrRows: [{ name: 'bgcolor', value: '#eef2ff' }],
		});
		expect(next).toContain('background-color: #eef2ff');
		expect(next).toContain('data-owl-dark-style="background-color: #1e1b4b"');
		expect(next).toContain('bgcolor="#eef2ff"');
		expect(shellCanvasBackgroundColor(next!, false)?.toLowerCase()).toBe('#eef2ff');
		// Outer shell backdrop stays default — no syncing.
		expect(next).toContain('background-color:#F5F5F5');
	});
});

describe('studio-client: variant partner inspector', () => {
	it('extracts variantPartner from hero pair', () => {
		const html = mintOwlIdsInFragment(starterByKey('hero-image')!.html);
		const owlId = owlIdForSlot(html, 'hero');
		const snap = extractInspector(html, owlId);
		expect(snap).not.toBeNull();
		expect(snap!.variantRole).toBe('light');
		expect(snap!.variantGroup).toBe('hero');
		expect(snap!.variantPartner).toBeDefined();
		expect(snap!.variantPartner!.tag).toBe('img');
		expect(snap!.variantPartner!.src).toContain('placehold.co');
	});

	it('patches partner src via InspectorPatch', () => {
		const html = mintOwlIdsInFragment(starterByKey('hero-image')!.html);
		const owlId = owlIdForSlot(html, 'hero');
		const next = applyInspectorPatch(html, owlId, {
			partnerSrc: 'https://cdn.example/dark-hero.png',
			partnerAlt: 'Dark hero',
		});
		expect(next).toContain('https://cdn.example/dark-hero.png');
		expect(next).toContain('alt="Dark hero"');
		const snap = extractInspector(next!, owlId);
		expect(snap!.variantPartner!.src).toBe('https://cdn.example/dark-hero.png');
		expect(snap!.variantPartner!.alt).toBe('Dark hero');
	});

	it('ensureVariantPartner mints an owl-dark sibling', () => {
		const lone = mintOwlIdsInFragment(
			`<img src="https://example.com/a.png" alt="A" style="display:block;" data-owl-slot="pic" data-owl-slot-type="image">`,
		);
		const owlId = owlIdForSlot(lone, 'pic');
		const next = ensureVariantPartner(lone, owlId, 'dark');
		expect(next).toBeTruthy();
		expect(next!).toContain(OWL_CLASS.light);
		expect(next!).toContain(OWL_CLASS.dark);
		expect(next!).toContain(OWL.variantGroup);
		expect(next!.match(/<img/g)?.length).toBe(2);
		const snap = extractInspector(next!, owlId);
		expect(snap!.variantPartner).toBeDefined();
	});
});

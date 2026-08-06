// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { compileOwlDoc, defaultOwlShell } from './studio-server';
import { emptyOwlDoc, newSectionId } from './studio';
import { starterByKey } from './starters';
import { findSectionIdForOwlId, mintOwlDocSections, mintOwlIdsInFragment } from './studio-client';

describe('studio id minting', () => {
	it('mints globally unique ids across sections', () => {
		const doc = emptyOwlDoc(defaultOwlShell(), 'Preview');
		const logo = starterByKey('logo-header')!;
		const cta = starterByKey('cta-button')!;
		doc.sections.push(
			{ id: newSectionId(), key: logo.key, label: logo.name, html: logo.html },
			{ id: newSectionId(), key: cta.key, label: cta.name, html: cta.html },
		);
		const minted = mintOwlDocSections(doc);
		const allIds = minted.sections.flatMap((s) => [
			...s.html.matchAll(/data-owl-id="(w\d+)"/g),
		]).map((m) => m[1]);
		expect(new Set(allIds).size).toBe(allIds.length);
	});

	it('remints colliding ids when sections were minted independently', () => {
		const shared = mintOwlIdsInFragment(starterByKey('text')!.html);
		const doc = emptyOwlDoc(defaultOwlShell(), 'Preview');
		doc.sections.push(
			{ id: newSectionId(), key: 'logo-header', label: 'Logo', html: shared },
			{ id: newSectionId(), key: 'text', label: 'Text', html: shared },
		);
		const before = doc.sections.flatMap((s) => [
			...s.html.matchAll(/data-owl-id="(w\d+)"/g),
		]).map((m) => m[1]);
		expect(new Set(before).size).toBeLessThan(before.length);

		const minted = mintOwlDocSections(doc);
		const allIds = minted.sections.flatMap((s) => [
			...s.html.matchAll(/data-owl-id="(w\d+)"/g),
		]).map((m) => m[1]);
		expect(new Set(allIds).size).toBe(allIds.length);

		const textOwlId = [...minted.sections[1].html.matchAll(/data-owl-id="(w\d+)"/g)].map(
			(m) => m[1]!,
		)[0]!;
		expect(minted.sections[0].html.includes(`data-owl-id="${textOwlId}"`)).toBe(false);
		expect(findSectionIdForOwlId(minted, textOwlId)).toBe(minted.sections[1].id);
	});

	it('preserves data-owl-id on a/img in compiled preview', () => {
		const logoHtml = mintOwlIdsInFragment(starterByKey('logo-header')!.html);
		const doc = emptyOwlDoc(defaultOwlShell(), 'Preview');
		doc.sections.push({ id: newSectionId(), key: 'logo-header', label: 'Logo', html: logoHtml });
		const { html } = compileOwlDoc(doc, { origin: 'http://localhost' });
		const m = html.match(/data-owl-component="logo-header"[\s\S]*?<\/table>/);
		const compiled = m?.[0] ?? '';
		expect(compiled).toMatch(/<a\b[^>]*data-owl-id="w\d+"[^>]*data-owl-slot="logo_link"|<a\b[^>]*data-owl-slot="logo_link"[^>]*data-owl-id="w\d+"/);
		expect(compiled).toMatch(/<img\b[^>]*data-owl-id="w\d+"[^>]*data-owl-slot="logo"|<img\b[^>]*data-owl-slot="logo"[^>]*data-owl-id="w\d+"/);
	});
});

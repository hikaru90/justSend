import { describe, expect, it } from 'vitest';
import {
	annotateOwlSectionRoot,
	isOwlSectionHtml,
	prepareOwlSectionFragment,
} from '$lib/email/owl/fragment';

const LOGO_HEADER = `<table role="presentation" data-owl-component="logo-header" data-owl-role="section" width="100%"><tbody><tr><td style="padding:24px;"><img src="/logo.png" data-owl-slot="logo" data-owl-slot-type="image"></td></tr></tbody></table>`;

describe('prepareOwlSectionFragment', () => {
	it('mints missing data-owl-id values', () => {
		const out = prepareOwlSectionFragment(LOGO_HEADER);
		expect(out).toContain('data-owl-id="w1"');
	});

	it('detects owl annotations', () => {
		expect(isOwlSectionHtml(LOGO_HEADER)).toBe(true);
		expect(isOwlSectionHtml('<table><tr><td>Hi</td></tr></table>')).toBe(false);
	});

	it('adds component markers when missing', () => {
		const bare = `<table role="presentation"><tbody><tr><td data-owl-slot="title" data-owl-slot-type="text">Hi</td></tr></tbody></table>`;
		const out = annotateOwlSectionRoot(bare, 'brand-header');
		expect(out).toContain('data-owl-role="section"');
		expect(out).toContain('data-owl-component="brand-header"');
	});
});

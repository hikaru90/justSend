import { describe, expect, it } from 'vitest';
import {
	buildOwlScaffoldMessages,
	collectOwlSlotNames,
	owlSectionContexts,
	parseScaffoldJson,
	parseComposeJson,
	assembleOwlDocFromCompose,
	type OwlAiSectionContext,
} from './ai-owl-service';
import type { OwlDoc } from '$lib/email/owl/studio';

const CTA = `<table role="presentation" data-owl-component="cta-button" data-owl-role="section" width="100%"><tbody><tr><td style="padding:16px 24px;"><a href="https://example.com" data-owl-slot="cta_url" data-owl-slot-type="url" data-owl-slot-label="Button link">Get started</a></td></tr></tbody></table>`;

const TEXT = `<table role="presentation" data-owl-component="text" data-owl-role="section" width="100%"><tbody><tr><td style="padding:16px 24px;"><p data-owl-slot="body_text" data-owl-slot-type="text" data-owl-slot-label="Body text">Hello</p></td></tr></tbody></table>`;

function makeDoc(sections: Array<{ id: string; key: string; label: string; html: string }>): OwlDoc {
	return {
		owl: 'v1',
		shell: '<table data-owl-role="shell"><tbody><tr><td><!--owl:sections--></td></tr></tbody></table>',
		sections,
		preheader: 'Preview',
		slotValues: {},
	};
}

describe('owlSectionContexts', () => {
	it('extracts declared slots with types from each section', () => {
		const contexts = owlSectionContexts(
			makeDoc([
				{ id: 'a', key: 'cta-button', label: 'CTA', html: CTA },
				{ id: 'b', key: 'text', label: 'Text', html: TEXT },
			]),
		);

		expect(contexts).toHaveLength(2);
		expect(contexts[0].slots).toEqual([
			{ name: 'cta_url', type: 'url', label: 'Button link' },
		]);
		expect(contexts[1].slots).toEqual([
			{ name: 'body_text', type: 'text', label: 'Body text' },
		]);
	});

	it('collects unique slot names across sections', () => {
		const contexts: OwlAiSectionContext[] = [
			{ id: 'a', key: 'cta-button', label: 'CTA', slots: [{ name: 'cta_url', type: 'url' }] },
			{ id: 'b', key: 'text', label: 'Text', slots: [{ name: 'body_text', type: 'text' }] },
			{ id: 'c', key: 'cta-button', label: 'CTA', slots: [{ name: 'cta_url', type: 'url' }] },
		];
		expect(collectOwlSlotNames(contexts)).toEqual(['cta_url', 'body_text']);
	});
});

describe('buildOwlScaffoldMessages', () => {
	const baseInput = {
		templateName: 'Welcome',
		templateSubject: 'Welcome to Owlery',
		designMd: 'Modern, navy + white.',
		components: [{ id: 'c1', name: 'CTA', description: null, role: 'promo', props: 'cta_text', starterKey: 'cta-button' }],
		assets: [],
		contexts: [
			{ id: 'a', key: 'cta-button', label: 'CTA', slots: [{ name: 'cta_url', type: 'url' }] },
		],
		targetLabel: 'Section "CTA" — write copy for this section only.',
		prompt: 'Friendly, short.',
		assetBaseUrl: 'https://app.example.com',
		expectedSlots: ['cta_url'],
	};

	it('renders allowed slot keys and the copy target', () => {
		const [system, user] = buildOwlScaffoldMessages(baseInput);

		expect(system.content).toContain('"slots"');
		expect(user.content).toContain('Allowed slot keys');
		expect(user.content).toContain('cta_url');
		expect(user.content).toContain('Section "CTA"');
		expect(user.content).toContain('Welcome to Owlery');
	});
});

describe('parseComposeJson', () => {
	const catalog = ['logo-header', 'heading', 'text', 'cta-button', 'footer-legal'];

	it('parses ordered sections with slot values', () => {
		const result = parseComposeJson(
			JSON.stringify({
				subject: 'Welcome!',
				preheader: 'Glad you joined',
				sections: [
					{ key: 'logo-header', slots: { logo: '/api/design-asset/x' } },
					{ key: 'heading', slots: { heading_text: 'Hello' } },
					{ key: 'cta-button', slots: { cta_text: 'Go', cta_url: 'https://x.io' } },
				],
			}),
			catalog,
		);
		expect(result.subject).toBe('Welcome!');
		expect(result.sections).toHaveLength(3);
		expect(result.sections[2].slots?.cta_text).toBe('Go');
	});

	it('rejects unknown section keys', () => {
		expect(() =>
			parseComposeJson(JSON.stringify({ sections: [{ key: 'unknown-block' }] }), catalog),
		).toThrow(/Unknown/);
	});
});

describe('assembleOwlDocFromCompose', () => {
	it('builds an OwlDoc from compose output', () => {
		const catalog = [
			{
				key: 'text',
				name: 'Text',
				description: '',
				html: TEXT,
				slots: [{ name: 'body_text', type: 'text' }],
				source: 'starter' as const,
			},
		];
		const doc = assembleOwlDocFromCompose(
			{
				preheader: 'Hi there',
				sections: [{ key: 'text', slots: { body_text: 'Welcome aboard' } }],
			},
			catalog,
			'<html><body><!--owl:sections--></body></html>',
		);
		expect(doc.sections).toHaveLength(1);
		expect(doc.preheader).toBe('Hi there');
		expect(doc.slotValues.body_text).toBe('Welcome aboard');
	});
});

describe('parseScaffoldJson', () => {
	it('accepts fenced json and keeps only allowed slot keys', () => {
		const result = parseScaffoldJson(
			'```json\n{"subject":"Hi","preheader":"P","slots":{"cta_url":"https://x.io","hacked":"nope"}}\n```',
			['cta_url'],
		);
		expect(result.subject).toBe('Hi');
		expect(result.preheader).toBe('P');
		expect(result.slots).toEqual({ cta_url: 'https://x.io' });
	});

	it('throws on non-json responses', () => {
		expect(() => parseScaffoldJson('sorry, no json here', [])).toThrow();
	});
});

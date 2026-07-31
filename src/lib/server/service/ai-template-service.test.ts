import { describe, it, expect } from 'vitest';
import { buildScaffoldMessages, parseScaffoldJson } from './ai-template-service';
import type { Template } from './template-service';
import type { TemplateElement } from './template-element-service';

function fakeTemplate(overrides: Partial<Template> = {}): Template {
	return {
		id: 'tpl_1',
		name: 'Welcome',
		teamId: 1,
		domainId: 1,
		subject: 'Welcome aboard',
		html: null,
		content: null,
		prompt: null,
		designSnapshot: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

function fakeElement(overrides: Partial<TemplateElement> = {}): TemplateElement {
	return {
		id: 'el_1',
		templateId: 'tpl_1',
		type: 'cta',
		label: 'Primary CTA',
		required: true,
		config: '{}',
		order: 0,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

describe('buildScaffoldMessages', () => {
	it('includes design context and allowed slots', () => {
		const messages = buildScaffoldMessages({
			template: fakeTemplate(),
			designMd: '# Brand\nPrimary: #111',
			components: [
				{
					id: 'dc_1',
					name: 'Hero',
					description: 'Hero section',
					html: '<h1>{{headline}}</h1>',
					kind: 'starter',
					role: 'hero',
					props: '["headline","body"]',
					starterKey: 'hero'
				}
			],
			assets: [{ id: 'asset_1', kind: 'logo', name: 'Logo', filename: 'logo.png' }],
			elements: [
				fakeElement({
					type: 'component',
					label: 'Hero',
					config: JSON.stringify({ designComponentId: 'dc_1' })
				})
			],
			prompt: 'Make it warm',
			assetBaseUrl: 'http://localhost:5173',
			expectedSlots: ['headline', 'body']
		});

		expect(messages).toHaveLength(2);
		expect(messages[0].content).toContain('ONLY valid JSON');
		expect(messages[1].content).toContain('# Brand');
		expect(messages[1].content).toContain('Hero');
		expect(messages[1].content).toContain('Make it warm');
		expect(messages[1].content).toContain('/api/design-asset/asset_1');
	});
});

describe('parseScaffoldJson', () => {
	it('parses subject, preheader, and filtered slots', () => {
		const parsed = parseScaffoldJson(
			JSON.stringify({
				subject: 'Sub',
				preheader: 'Pre',
				slots: { headline: 'H', extra: 'x' }
			}),
			['headline']
		);
		expect(parsed.subject).toBe('Sub');
		expect(parsed.preheader).toBe('Pre');
		expect(parsed.slots).toEqual({ headline: 'H' });
	});
});

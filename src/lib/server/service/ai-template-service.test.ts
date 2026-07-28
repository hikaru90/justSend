import { describe, it, expect } from 'vitest';
import {
	buildPlannerMessages,
	buildComponentMessages,
	type ComponentPlan
} from './ai-template-service';
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
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

const baseInput = () => ({
	template: fakeTemplate(),
	designMd: '# Brand\nPrimary: #111',
	components: [
		{ name: 'Primary Button', description: 'Filled CTA', html: '<a class="btn">{{label}}</a>' }
	],
	assets: [{ id: 'asset_1', kind: 'logo', name: 'Logo', filename: 'logo.png' }],
	elements: [
		fakeElement({
			config: JSON.stringify({ text: 'Get started', url: 'https://example.com/start' })
		}),
		fakeElement({
			id: 'el_2',
			type: 'text',
			label: 'Footer note',
			required: false,
			config: JSON.stringify({ text: 'Thanks for reading' })
		}),
		fakeElement({
			id: 'el_3',
			type: 'logo',
			label: 'Header logo',
			config: JSON.stringify({ assetId: 'asset_1' })
		})
	],
	prompt: 'Make it warm and short',
	assetBaseUrl: 'http://localhost:5173'
});

describe('buildPlannerMessages', () => {
	it('asks for a JSON component plan with element props', () => {
		const messages = buildPlannerMessages(baseInput());

		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe('system');
		expect(messages[0].content).toContain('Svelte 5');
		expect(messages[0].content).toContain('kind');
		expect(messages[0].content).toContain('Root');

		const user = messages[1].content;
		expect(user).toContain('Welcome');
		expect(user).toContain('# Brand');
		expect(user).toContain('Primary Button');
		expect(user).toContain('type=cta; label="Primary CTA"');
		expect(user).toContain('props: primary_cta');
		expect(user).toContain('Make it warm and short');
		expect(user).toContain('/api/design-asset/asset_1');
	});

	it('handles empty design system gracefully', () => {
		const messages = buildPlannerMessages({
			template: fakeTemplate(),
			designMd: null,
			components: [],
			assets: [],
			elements: [],
			prompt: '',
			assetBaseUrl: 'http://localhost:5173'
		});
		expect(messages[1].content).toContain('(empty');
		expect(messages[1].content).toContain('(none)');
	});
});

describe('buildComponentMessages', () => {
	it('instructs props binding and restricted script', () => {
		const plan: ComponentPlan = {
			components: [
				{
					name: 'Root',
					kind: 'root',
					role: 'layout',
					props: ['primary_cta', 'primary_cta_url'],
					imports: ['Header']
				},
				{
					name: 'Header',
					kind: 'component',
					role: 'header',
					props: ['header_logo_url']
				}
			]
		};

		const messages = buildComponentMessages(baseInput(), plan, plan.components[0]);
		expect(messages[0].content).toContain('$props()');
		expect(messages[0].content).toContain('tbody');
		expect(messages[0].content).toContain('./Header.svelte');
		expect(messages[0].content).toContain('primary_cta');
		expect(messages[1].content).toContain('Generate component: Root');
	});
});

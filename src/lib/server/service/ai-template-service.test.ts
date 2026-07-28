import { describe, it, expect } from 'vitest';
import { buildGenerationMessages } from './ai-template-service';
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

describe('buildGenerationMessages', () => {
	it('includes design system, required elements, assets, and user prompt', () => {
		const messages = buildGenerationMessages({
			template: fakeTemplate(),
			designMd: '# Brand\nPrimary: #111',
			components: [
				{ name: 'Primary Button', description: 'Filled CTA', html: '<a class="btn">{{label}}</a>' }
			],
			assets: [{ id: 'asset_1', kind: 'logo', name: 'Logo', filename: 'logo.png' }],
			elements: [
				fakeElement(),
				fakeElement({
					id: 'el_2',
					type: 'text',
					label: 'Footer note',
					required: false
				})
			],
			prompt: 'Make it warm and short',
			assetBaseUrl: 'http://localhost:5173'
		});

		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe('system');
		expect(messages[0].content).toContain('self-contained HTML email');

		const user = messages[1].content;
		expect(user).toContain('Welcome');
		expect(user).toContain('Welcome aboard');
		expect(user).toContain('# Brand');
		expect(user).toContain('Primary Button');
		expect(user).toContain('/api/design-asset/asset_1');
		expect(user).toContain('type=cta; label="Primary CTA"');
		expect(user).toContain('{{primary_cta}}');
		expect(user).toContain('type=text; label="Footer note"');
		expect(user).toContain('Make it warm and short');
	});

	it('handles empty design system gracefully', () => {
		const messages = buildGenerationMessages({
			template: fakeTemplate(),
			designMd: null,
			components: [],
			assets: [],
			elements: [],
			prompt: '',
			assetBaseUrl: 'http://localhost:5173'
		});

		const user = messages[1].content;
		expect(user).toContain('clean, modern default');
		expect(user).toContain('(none)');
		expect(user).toContain('no additional instructions');
	});
});

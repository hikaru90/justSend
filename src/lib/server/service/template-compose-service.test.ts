import { describe, it, expect } from 'vitest';
import {
	applySlotTemplate,
	composeEmailHtml,
	parseScaffoldContent,
	serializeScaffoldContent,
	collectExpectedSlots
} from './template-compose-service';
import { buildScaffoldMessages, parseScaffoldJson } from './ai-template-service';
import { STARTER_DESIGN_COMPONENTS } from './design-component-library';
import type { Template } from './template-service';
import type { TemplateElement } from './template-element-service';
import type { DesignComponent, DesignAsset } from './design-system-service';

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
		type: 'component',
		label: 'Hero',
		required: true,
		config: '{}',
		order: 0,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

function asDesignComponent(
	starter: (typeof STARTER_DESIGN_COMPONENTS)[number],
	id: string
): DesignComponent {
	return {
		id,
		teamId: 1,
		name: starter.name,
		kind: 'starter',
		role: starter.role,
		description: starter.description,
		props: JSON.stringify(starter.props),
		starterKey: starter.starterKey,
		html: starter.html,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z'
	};
}

describe('applySlotTemplate', () => {
	it('substitutes slots and strips empty owl-if blocks', () => {
		const html = `
			<!--owl-if:eyebrow--><p>{{eyebrow}}</p><!--/owl-if-->
			<h1>{{headline}}</h1>
			<!--owl-if:image_url--><img src="{{image_url}}" /><!--/owl-if-->
		`;
		const out = applySlotTemplate(html, { headline: 'Hello', eyebrow: '', image_url: '' });
		expect(out).toContain('<h1>Hello</h1>');
		expect(out).not.toContain('eyebrow');
		expect(out).not.toContain('<img');
	});

	it('keeps owl-if blocks when slot has a value', () => {
		const html = `<!--owl-if:eyebrow--><p>{{eyebrow}}</p><!--/owl-if-->`;
		const out = applySlotTemplate(html, { eyebrow: 'New' });
		expect(out).toContain('<p>New</p>');
	});
});

describe('parseScaffoldContent / serializeScaffoldContent', () => {
	it('round-trips scaffold JSON', () => {
		const raw = serializeScaffoldContent({
			subject: 'Hi',
			preheader: 'Preview',
			slots: { headline: 'Welcome' }
		});
		const parsed = parseScaffoldContent(raw);
		expect(parsed.subject).toBe('Hi');
		expect(parsed.preheader).toBe('Preview');
		expect(parsed.slots.headline).toBe('Welcome');
	});

	it('ignores legacy Tiptap docs', () => {
		expect(parseScaffoldContent(JSON.stringify({ type: 'doc', content: [] }))).toEqual({
			slots: {}
		});
	});
});

describe('composeEmailHtml', () => {
	it('is deterministic and respects element order', () => {
		const hero = STARTER_DESIGN_COMPONENTS.find((c) => c.starterKey === 'hero')!;
		const cta = STARTER_DESIGN_COMPONENTS.find((c) => c.starterKey === 'cta')!;
		const components = [asDesignComponent(hero, 'dc_hero'), asDesignComponent(cta, 'dc_cta')];

		const elements = [
			fakeElement({
				id: 'el_hero',
				label: 'Hero',
				order: 0,
				config: JSON.stringify({ designComponentId: 'dc_hero' })
			}),
			fakeElement({
				id: 'el_cta',
				label: 'CTA',
				order: 1,
				config: JSON.stringify({ designComponentId: 'dc_cta' })
			})
		];

		const content = serializeScaffoldContent({
			preheader: 'You are in',
			slots: {
				headline: 'Hello there',
				body: 'Thanks for joining.',
				primary_cta_label: 'Get started',
				primary_cta_url: 'https://example.com',
				title: 'Ready?',
				eyebrow: 'Welcome'
			}
		});

		const input = {
			template: fakeTemplate({ content }),
			elements,
			components,
			assets: [] as DesignAsset[],
			assetBaseUrl: 'http://localhost:5173'
		};

		const a = composeEmailHtml(input);
		const b = composeEmailHtml(input);
		expect(a).toBe(b);
		expect(a).toContain('role="article"');
		expect(a).toContain('max-width:620px');
		expect(a).toContain('Hello there');
		expect(a).toContain('Get started');
		expect(a).toContain('data-owl-section="hero"');
		expect(a).toContain('data-owl-section="cta"');
		expect(a.indexOf('data-owl-section="hero"')).toBeLessThan(
			a.indexOf('data-owl-section="cta"')
		);
	});

	it('emits fixed sections for custom text/cta elements', () => {
		const html = composeEmailHtml({
			template: fakeTemplate({
				content: serializeScaffoldContent({ slots: {} })
			}),
			elements: [
				fakeElement({
					id: 'el_text',
					type: 'text',
					label: 'Body',
					config: JSON.stringify({ text: 'Plain body copy' })
				}),
				fakeElement({
					id: 'el_cta',
					type: 'cta',
					label: 'Primary CTA',
					order: 1,
					config: JSON.stringify({ text: 'Shop', url: 'https://shop.example' })
				})
			],
			components: [],
			assets: [],
			assetBaseUrl: 'http://localhost:5173'
		});

		expect(html).toContain('Plain body copy');
		expect(html).toContain('Shop');
		expect(html).toContain('https://shop.example');
	});

	it('falls back to empty for missing slots without throwing', () => {
		const hero = STARTER_DESIGN_COMPONENTS.find((c) => c.starterKey === 'hero')!;
		const html = composeEmailHtml({
			template: fakeTemplate({ content: null }),
			elements: [
				fakeElement({
					config: JSON.stringify({ designComponentId: 'dc_hero' })
				})
			],
			components: [asDesignComponent(hero, 'dc_hero')],
			assets: [],
			assetBaseUrl: 'http://localhost:5173'
		});
		expect(html).toContain('data-owl-section="hero"');
		expect(html).not.toContain('{{headline}}');
	});
});

describe('collectExpectedSlots', () => {
	it('includes library component props', () => {
		const hero = STARTER_DESIGN_COMPONENTS.find((c) => c.starterKey === 'hero')!;
		const slots = collectExpectedSlots(
			[
				fakeElement({
					config: JSON.stringify({ designComponentId: 'dc_hero' })
				})
			],
			[asDesignComponent(hero, 'dc_hero')]
		);
		expect(slots).toContain('headline');
		expect(slots).toContain('primary_cta_label');
	});
});

describe('parseScaffoldJson', () => {
	it('accepts only expected slot keys', () => {
		const raw = JSON.stringify({
			subject: 'Hi',
			preheader: 'Preview line',
			slots: {
				headline: 'Welcome',
				bogus_key: 'nope',
				body: 'Copy'
			}
		});
		const parsed = parseScaffoldJson(raw, ['headline', 'body']);
		expect(parsed.subject).toBe('Hi');
		expect(parsed.slots.headline).toBe('Welcome');
		expect(parsed.slots.body).toBe('Copy');
		expect(parsed.slots.bogus_key).toBeUndefined();
	});

	it('extracts JSON from markdown fences', () => {
		const raw = '```json\n{"slots":{"headline":"X"}}\n```';
		expect(parseScaffoldJson(raw, ['headline']).slots.headline).toBe('X');
	});
});

describe('buildScaffoldMessages', () => {
	it('asks for JSON slot values only', () => {
		const hero = STARTER_DESIGN_COMPONENTS.find((c) => c.starterKey === 'hero')!;
		const messages = buildScaffoldMessages({
			template: fakeTemplate(),
			designMd: '# Brand',
			components: [
				{
					id: 'dc_hero',
					name: hero.name,
					description: hero.description,
					html: hero.html,
					kind: 'starter',
					role: hero.role,
					props: JSON.stringify(hero.props),
					starterKey: hero.starterKey
				}
			],
			assets: [],
			elements: [
				fakeElement({
					config: JSON.stringify({ designComponentId: 'dc_hero' })
				})
			],
			prompt: 'Warm welcome',
			assetBaseUrl: 'http://localhost:5173',
			expectedSlots: ['headline', 'body']
		});

		expect(messages[0].content).toContain('ONLY valid JSON');
		expect(messages[0].content).toContain('Do NOT invent HTML');
		expect(messages[1].content).toContain('Warm welcome');
		expect(messages[1].content).toContain('headline, body');
		expect(messages[1].content).toContain('Hero');
	});
});

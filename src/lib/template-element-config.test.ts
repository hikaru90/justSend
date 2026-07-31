import { describe, it, expect } from 'vitest';
import {
	elementSlug,
	elementValueVariables,
	formatElementConfigForPrompt,
	parseElementConfig,
	serializeElementConfig
} from './template-element-config';

describe('parseElementConfig', () => {
	it('parses valid config', () => {
		expect(
			parseElementConfig(
				'{"text":"Go","url":"https://x.com","assetId":"a1","designComponentId":"dc1"}'
			)
		).toEqual({
			text: 'Go',
			url: 'https://x.com',
			assetId: 'a1',
			designComponentId: 'dc1'
		});
	});

	it('returns empty object for invalid JSON', () => {
		expect(parseElementConfig('{nope')).toEqual({});
		expect(parseElementConfig(null)).toEqual({});
	});
});

describe('serializeElementConfig', () => {
	it('omits empty fields', () => {
		expect(serializeElementConfig({ text: ' Hi ', url: '', assetId: undefined })).toBe(
			'{"text":"Hi"}'
		);
	});

	it('keeps designComponentId', () => {
		expect(serializeElementConfig({ designComponentId: ' dc_1 ' })).toBe(
			'{"designComponentId":"dc_1"}'
		);
	});
});

describe('formatElementConfigForPrompt', () => {
	it('includes concrete src for images', () => {
		const line = formatElementConfigForPrompt(
			{
				type: 'image',
				label: 'Hero',
				config: serializeElementConfig({ assetId: 'img_1' })
			},
			{ assetBaseUrl: 'https://app.example' }
		);
		expect(line).toContain('src="https://app.example/api/design-asset/img_1"');
	});

	it('describes library component elements', () => {
		const line = formatElementConfigForPrompt(
			{
				type: 'component',
				label: 'Hero',
				config: serializeElementConfig({ designComponentId: 'dc_hero' })
			},
			{
				designComponentById: {
					dc_hero: { name: 'Hero', starterKey: 'hero' }
				}
			}
		);
		expect(line).toContain('library component "Hero"');
		expect(line).toContain('libraryRef=hero');
		expect(line).toContain('MUST include');
	});
});

describe('elementValueVariables', () => {
	it('maps logo asset to url variables', () => {
		const vars = elementValueVariables(
			{
				type: 'logo',
				label: 'Brand Logo',
				config: serializeElementConfig({ assetId: 'asset_1' })
			},
			{ assetBaseUrl: 'http://localhost:5173' }
		);
		expect(vars.brand_logo).toBe('http://localhost:5173/api/design-asset/asset_1');
		expect(vars.logo).toBe('http://localhost:5173/api/design-asset/asset_1');
	});

	it('maps cta text and url', () => {
		const vars = elementValueVariables({
			type: 'cta',
			label: 'Primary CTA',
			config: serializeElementConfig({ text: 'Shop now', url: 'https://shop.example' })
		});
		expect(vars.primary_cta).toBe('Shop now');
		expect(vars.primary_cta_url).toBe('https://shop.example');
		expect(vars.cta_label).toBe('Shop now');
		expect(vars.cta_url).toBe('https://shop.example');
	});

	it('maps text content', () => {
		const vars = elementValueVariables({
			type: 'text',
			label: 'Headline',
			config: serializeElementConfig({ text: 'Welcome back' })
		});
		expect(vars.headline).toBe('Welcome back');
		expect(elementSlug('Headline', 'text')).toBe('headline');
	});

	it('returns empty props for component elements', () => {
		expect(
			elementValueVariables({
				type: 'component',
				label: 'Hero',
				config: serializeElementConfig({ designComponentId: 'dc_1' })
			})
		).toEqual({});
	});
});

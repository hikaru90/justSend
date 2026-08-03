import { describe, expect, it } from 'vitest';
import { EMPTY_DOCUMENT } from '$lib/email-builder/types';
import {
	buildDesignWorkspaceUserPrompt,
	formatDesignAssetsForPrompt,
	formatLibraryComponentsForPrompt,
	inferDesignWorkspaceMode,
	isEmptyComponentDocument,
	modeInstructionRules,
	resolveLibraryComponentHtml,
	toPiDesignContext,
	type DesignWorkspaceContext,
} from './design-workspace-context';
import { inferEditApproach } from '$lib/email-builder/edit-approach';

describe('inferDesignWorkspaceMode', () => {
	it('honors explicit mode', () => {
		expect(
			inferDesignWorkspaceMode({
				mode: 'validate',
				instruction: 'make a hero',
				document: EMPTY_DOCUMENT,
			}),
		).toBe('validate');
	});

	it('uses create for empty documents', () => {
		expect(
			inferDesignWorkspaceMode({
				instruction: 'hero with CTA',
				document: EMPTY_DOCUMENT,
			}),
		).toBe('create');
	});

	it('uses edit when the document already has blocks', () => {
		expect(
			inferDesignWorkspaceMode({
				instruction: 'use the dark logo',
				document: {
					root: {
						type: 'EmailLayout',
						data: { childrenIds: ['img1'] },
					},
					img1: { type: 'Image', data: { props: { url: 'https://x/a', alt: 'L' } } },
				},
			}),
		).toBe('edit');
	});

	it('detects validate-style instructions', () => {
		expect(
			inferDesignWorkspaceMode({
				instruction: 'Validate the component against the design system',
				document: {
					root: { type: 'EmailLayout', data: { childrenIds: ['t1'] } },
					t1: { type: 'Text', data: { props: { text: 'Hi', markdown: true } } },
				},
			}),
		).toBe('validate');
	});
});

describe('isEmptyComponentDocument', () => {
	it('treats EMPTY_DOCUMENT as empty', () => {
		expect(isEmptyComponentDocument(EMPTY_DOCUMENT)).toBe(true);
	});
});

describe('inferEditApproach re-export', () => {
	it('is available via design workspace context surface', () => {
		expect(
			inferEditApproach({
				instruction: 'custom html dark and light button',
				document: EMPTY_DOCUMENT,
			}),
		).toBe('html');
	});
});

describe('formatDesignAssetsForPrompt', () => {
	it('labels light and dark logo embed URLs', () => {
		const text = formatDesignAssetsForPrompt(
			[
				{ id: 'l1', kind: 'logo', name: 'Brand', filename: 'logo.png' },
				{ id: 'd1', kind: 'logo', name: 'Brand dark', filename: 'logo-dark.png' },
				{ id: 'h1', kind: 'image', name: 'Hero', filename: 'hero.jpg' },
			],
			'https://owlery.test',
		);
		expect(text).toContain('[logo/light] Brand → https://owlery.test/api/design-asset/l1');
		expect(text).toContain('[logo/dark] Brand dark → https://owlery.test/api/design-asset/d1');
		expect(text).toContain('[image] Hero → https://owlery.test/api/design-asset/h1');
	});
});

describe('modeInstructionRules', () => {
	it('includes distinct mode guidance', () => {
		expect(modeInstructionRules('create')).toContain('Mode: CREATE');
		expect(modeInstructionRules('edit')).toContain('MINIMAL DIFF');
		expect(modeInstructionRules('validate')).toContain('Mode: VALIDATE');
		expect(modeInstructionRules('validate')).toContain('unchanged');
	});
});

describe('resolveLibraryComponentHtml', () => {
	it('falls back to rendering document when html is empty', () => {
		const html = resolveLibraryComponentHtml({
			name: 'Header',
			html: '',
			document: JSON.stringify({
				root: {
					type: 'EmailLayout',
					data: {
						backdropColor: '#fff',
						canvasColor: '#fff',
						textColor: '#111',
						fontFamily: 'MODERN_SANS',
						childrenIds: ['h1'],
					},
				},
				h1: {
					type: 'Heading',
					data: { props: { text: 'Hello brand', level: 'h1' } },
				},
			}),
		});
		expect(html).toContain('Hello brand');
	});

	it('prefers stored html', () => {
		expect(
			resolveLibraryComponentHtml({
				name: 'Header',
				html: '<table><tr><td>Stored</td></tr></table>',
				document: '',
			}),
		).toContain('Stored');
	});
});

describe('buildDesignWorkspaceUserPrompt', () => {
	it('packs design.md, formatting rules, assets, peers, and target for any mode', () => {
		const ctx: DesignWorkspaceContext = {
			mode: 'edit',
			designMd: '# Brand\nPrimary: #111',
			formattingRules: '# Email Formatting Rules\n- Use 620px',
			assets: [
				{ id: 'l1', kind: 'logo', name: 'Brand', filename: 'logo.png' },
				{ id: 'd1', kind: 'logo', name: 'Brand dark', filename: 'logo-dark.png' },
			],
			assetBaseUrl: 'https://owlery.test',
			assetRows: [],
			libraryComponents: [
				{
					id: 'c1',
					name: 'Footer',
					description: 'Site footer',
					role: 'footer',
					html: '<table><tr><td>Footer</td></tr></table>',
					slots: [{ name: 'company', blockId: 't1', prop: 'props.text', type: 'text' }],
				},
			],
			target: {
				kind: 'component-tree',
				name: 'Header',
				description: 'Top bar',
				document: {
					root: {
						type: 'EmailLayout',
						data: {
							backdropColor: '#fff',
							canvasColor: '#fff',
							textColor: '#111',
							fontFamily: 'MODERN_SANS',
							childrenIds: ['img1'],
						},
					},
					img1: {
						type: 'Image',
						data: { props: { url: 'https://owlery.test/api/design-asset/l1', alt: 'Logo' } },
					},
				},
				slots: [{ name: 'logo', blockId: 'img1', prop: 'props.url', type: 'asset' }],
			},
		};

		const prompt = buildDesignWorkspaceUserPrompt(ctx, 'Use the dark logo variant');
		expect(prompt).toContain('Mode: edit');
		expect(prompt).toContain('MINIMAL DIFF');
		expect(prompt).toContain('# Brand');
		expect(prompt).toContain('Email Formatting Rules');
		expect(prompt).toContain('[logo/dark]');
		expect(prompt).toContain('### Footer');
		expect(prompt).toContain('## Current document');
		expect(prompt).toContain('"img1"');
		expect(prompt).toContain('Use the dark logo variant');
	});
});

describe('formatLibraryComponentsForPrompt', () => {
	it('includes role, slots, and html', () => {
		const text = formatLibraryComponentsForPrompt([
			{
				id: '1',
				name: 'CTA',
				description: 'Button block',
				role: 'section',
				html: '<a>Go</a>',
				slots: [{ name: 'label', blockId: 'b1', prop: 'props.text', type: 'text' }],
			},
		]);
		expect(text).toContain('### CTA — Button block');
		expect(text).toContain('slots: [label]');
		expect(text).toContain('<a>Go</a>');
	});
});

describe('toPiDesignContext', () => {
	it('maps workspace into Pi file-staging shape with resolved peer html', () => {
		const pi = toPiDesignContext({
			mode: 'edit',
			designMd: '# Brand',
			formattingRules: '',
			assets: [],
			assetBaseUrl: 'https://owlery.test',
			assetRows: [
				{
					id: 'a1',
					teamId: 1,
					kind: 'logo',
					name: 'Logo',
					filename: 'logo.png',
					mime: 'image/png',
					size: 10,
					createdAt: '2026-01-01',
				} as never,
			],
			libraryComponents: [
				{
					id: 'c1',
					name: 'Header',
					description: null,
					role: 'header',
					html: '<table></table>',
					slots: [],
				},
			],
			target: {
				kind: 'component-tree',
				name: 'Footer',
				document: EMPTY_DOCUMENT,
				slots: [],
			},
		});
		expect(pi.designMd).toBe('# Brand');
		expect(pi.components?.[0]?.html).toBe('<table></table>');
		expect(pi.assets?.[0]?.id).toBe('a1');
		expect(pi.excludeComponentName).toBe('Footer');
	});
});

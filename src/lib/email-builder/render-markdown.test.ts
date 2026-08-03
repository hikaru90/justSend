import { describe, expect, it } from 'vitest';
import { enableTextBlockMarkdown, renderEmailHtml } from './render';
import type { TEditorConfiguration } from './types';

const doc: TEditorConfiguration = {
	root: {
		type: 'EmailLayout',
		data: {
			backdropColor: '#F5F5F5',
			canvasColor: '#FFFFFF',
			textColor: '#262626',
			fontFamily: 'MODERN_SANS',
			childrenIds: ['t1'],
		},
	},
	t1: {
		type: 'Text',
		data: {
			props: { text: 'Hello **{{firstName}}** and [site](https://example.com)' },
			style: { padding: { top: 16, bottom: 16, left: 24, right: 24 } },
		},
	},
};

describe('Text block markdown', () => {
	it('enables markdown on Text blocks without mutating the source', () => {
		const enabled = enableTextBlockMarkdown(doc);
		expect((enabled.t1.data.props as { markdown?: boolean }).markdown).toBe(true);
		expect((doc.t1.data.props as { markdown?: boolean }).markdown).toBeUndefined();
	});

	it('renders markdown formatting in Text blocks', () => {
		const html = renderEmailHtml(doc);
		expect(html).toMatch(/<(strong|b)>/);
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('{{firstName}}');
	});
});

describe('Image / background transparency', () => {
	it('does not paint a black background behind images', () => {
		const imageDoc: TEditorConfiguration = {
			root: {
				type: 'EmailLayout',
				data: {
					backdropColor: '#F5F5F5',
					canvasColor: '#FFFFFF',
					textColor: '#262626',
					fontFamily: 'MODERN_SANS',
					childrenIds: ['img1'],
				},
			},
			img1: {
				type: 'Image',
				data: {
					props: {
						url: 'https://example.com/logo.png',
						alt: 'Logo',
						width: null,
					},
					style: { padding: { top: 0, bottom: 0, left: 0, right: 0 } },
				},
			},
		};
		const html = renderEmailHtml(imageDoc);
		expect(html).toContain('logo.png');
		expect(html).not.toMatch(/background-color:\s*#000000/i);
		expect(html).not.toMatch(/bgcolor=["']#000000["']/i);
	});

	it('does not default container background-image fills to black', () => {
		const heroDoc: TEditorConfiguration = {
			root: {
				type: 'EmailLayout',
				data: {
					backdropColor: '#F5F5F5',
					canvasColor: '#FFFFFF',
					textColor: '#262626',
					fontFamily: 'MODERN_SANS',
					childrenIds: ['hero'],
				},
			},
			hero: {
				type: 'Container',
				data: {
					style: {
						backgroundImage: 'https://example.com/hero.png',
						backgroundSize: 'cover',
						minHeight: 200,
						padding: { top: 16, bottom: 16, left: 16, right: 16 },
					},
					props: { childrenIds: [] },
				},
			},
		};
		const html = renderEmailHtml(heroDoc);
		expect(html).toContain('hero.png');
		expect(html).not.toMatch(/background-color:\s*#000000/i);
		expect(html).not.toMatch(/bgcolor=["']#000000["']/i);
	});
});

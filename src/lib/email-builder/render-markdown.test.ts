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
			childrenIds: ['t1']
		}
	},
	t1: {
		type: 'Text',
		data: {
			props: { text: 'Hello **{{firstName}}** and [site](https://example.com)' },
			style: { padding: { top: 16, bottom: 16, left: 24, right: 24 } }
		}
	}
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

import { describe, expect, it } from 'vitest';
import { EMPTY_DOCUMENT } from './types';
import {
	applyHtmlToComponentDocument,
	extractHtmlFragment,
	inferEditApproach,
	isEmptyComponentDocument,
	isHtmlOnlyDocument,
	resolveEditApproach,
} from './edit-approach';

describe('inferEditApproach', () => {
	const withButton = {
		root: { type: 'EmailLayout', data: { childrenIds: ['b1'] } },
		b1: { type: 'Button', data: { props: { text: 'Go', url: 'https://x' } } },
	};

	it('picks html for raw/custom html and media-query cues', () => {
		expect(
			inferEditApproach({ instruction: 'raw html CTA button', document: withButton }),
		).toBe('html');
		expect(
			inferEditApproach({
				instruction: 'Add @media queries for mobile stacking',
				document: withButton,
			}),
		).toBe('html');
		expect(
			inferEditApproach({
				instruction: 'Use inline CSS in the markup',
				document: withButton,
			}),
		).toBe('html');
	});

	it('picks html for empty document with stored legacy html', () => {
		expect(
			inferEditApproach({
				instruction: 'tweak spacing',
				document: EMPTY_DOCUMENT,
				html: '<a href="#">CTA</a>',
			}),
		).toBe('html');
	});

	it('picks blocks for empty document without stored html', () => {
		expect(
			inferEditApproach({
				instruction: 'hero with heading and CTA',
				document: EMPTY_DOCUMENT,
			}),
		).toBe('blocks');
	});

	it('picks html when document is only Html blocks with contents', () => {
		expect(
			inferEditApproach({
				instruction: 'make the link open in a new tab',
				document: {
					root: { type: 'EmailLayout', data: { childrenIds: ['h1'] } },
					h1: {
						type: 'Html',
						data: { props: { contents: '<a href="#">Hi</a>' } },
					},
				},
			}),
		).toBe('html');
	});

	it('picks blocks for normal structured documents', () => {
		expect(
			inferEditApproach({
				instruction: 'change the heading text',
				document: withButton,
			}),
		).toBe('blocks');
	});
});

describe('resolveEditApproach', () => {
	it('honors explicit override', () => {
		expect(
			resolveEditApproach({
				approach: 'html',
				instruction: 'change heading',
				document: {
					root: { type: 'EmailLayout', data: { childrenIds: ['t1'] } },
					t1: { type: 'Text', data: { props: { text: 'Hi', markdown: true } } },
				},
			}),
		).toBe('html');
		expect(
			resolveEditApproach({
				approach: 'blocks',
				instruction: 'raw html button',
				document: EMPTY_DOCUMENT,
			}),
		).toBe('blocks');
	});
});

describe('isEmptyComponentDocument / isHtmlOnlyDocument', () => {
	it('detects empty root', () => {
		expect(isEmptyComponentDocument(EMPTY_DOCUMENT)).toBe(true);
	});

	it('detects html-only trees including nested containers', () => {
		expect(
			isHtmlOnlyDocument({
				root: { type: 'EmailLayout', data: { childrenIds: ['c1'] } },
				c1: {
					type: 'Container',
					data: { props: { childrenIds: ['h1'] } },
				},
				h1: {
					type: 'Html',
					data: { props: { contents: '<strong>x</strong>' } },
				},
			}),
		).toBe(true);
	});

	it('rejects mixed trees', () => {
		expect(
			isHtmlOnlyDocument({
				root: { type: 'EmailLayout', data: { childrenIds: ['h1', 'b1'] } },
				h1: { type: 'Html', data: { props: { contents: '<p>x</p>' } } },
				b1: { type: 'Button', data: { props: { text: 'Go', url: '#' } } },
			}),
		).toBe(false);
	});
});

describe('extractHtmlFragment', () => {
	it('unwraps body contents', () => {
		expect(
			extractHtmlFragment('<!DOCTYPE html><html><body><a href="#">CTA</a></body></html>'),
		).toBe('<a href="#">CTA</a>');
	});

	it('returns fragment unchanged', () => {
		expect(extractHtmlFragment('<div>Hi</div>')).toBe('<div>Hi</div>');
	});
});

describe('applyHtmlToComponentDocument', () => {
	it('updates a single top-level Html block and keeps valid slots', () => {
		const result = applyHtmlToComponentDocument({
			document: {
				root: { type: 'EmailLayout', data: { childrenIds: ['html1'] } },
				html1: {
					type: 'Html',
					data: { props: { contents: '<a>Old</a>' } },
				},
			},
			slots: [{ name: 'body', blockId: 'html1', prop: 'props.contents', type: 'text' }],
			html: '<a href="https://x">New</a>',
		});
		expect(result.document.html1.data.props).toMatchObject({
			contents: '<a href="https://x">New</a>',
		});
		expect(result.slots).toHaveLength(1);
		expect(result.html).toContain('New');
	});

	it('replaces mixed trees with one Html block and clears slots', () => {
		const result = applyHtmlToComponentDocument({
			document: {
				root: {
					type: 'EmailLayout',
					data: {
						backdropColor: '#eee',
						canvasColor: '#fff',
						textColor: '#111',
						fontFamily: 'MODERN_SANS',
						childrenIds: ['t1', 'b1'],
					},
				},
				t1: { type: 'Text', data: { props: { text: 'Hi', markdown: true } } },
				b1: { type: 'Button', data: { props: { text: 'Go', url: '#' } } },
			},
			slots: [{ name: 'title', blockId: 't1', prop: 'props.text', type: 'text' }],
			html: '<table><tr><td>CTA</td></tr></table>',
		});
		expect(result.document.root.data.childrenIds).toHaveLength(1);
		const id = result.document.root.data.childrenIds![0];
		expect(result.document[id].type).toBe('Html');
		expect(result.document[id].data.props).toMatchObject({
			contents: '<table><tr><td>CTA</td></tr></table>',
		});
		expect(result.document.t1).toBeUndefined();
		expect(result.slots).toEqual([]);
	});

	it('strips full email wrappers before storing contents', () => {
		const result = applyHtmlToComponentDocument({
			document: EMPTY_DOCUMENT,
			slots: [],
			html: '<html><body><div class="cta"><a href="#">Go</a></div></body></html>',
		});
		const id = result.document.root.data.childrenIds![0];
		expect(result.document[id].data.props).toMatchObject({
			contents: '<div class="cta"><a href="#">Go</a></div>',
		});
	});
});

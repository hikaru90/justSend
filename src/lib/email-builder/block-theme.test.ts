import { describe, expect, it } from 'vitest';
import {
	applyBlockTheme,
	createFactoryBlock,
	resolveBlockTheme,
	themeEmptyDocument,
} from './block-theme';
import { EMPTY_DOCUMENT } from './types';
import { renderBlock } from './render-html';

describe('resolveBlockTheme', () => {
	it('returns defaults when no colors', () => {
		expect(resolveBlockTheme([])).toEqual({
			primary: '#000000',
			onPrimary: '#FFFFFF',
			text: '#262626',
			muted: '#CCCCCC',
			canvas: '#FFFFFF',
			backdrop: '#F5F5F5',
		});
	});

	it('picks brand primary and contrasting button text', () => {
		const theme = resolveBlockTheme(['#0b3d91', '#f5f5f5', '#111111']);
		expect(theme.primary).toBe('#0b3d91');
		expect(theme.onPrimary).toBe('#FFFFFF');
		expect(theme.canvas).toBe('#f5f5f5');
		expect(theme.text).toBe('#111111');
	});
});

describe('applyBlockTheme / createFactoryBlock', () => {
	it('themes Button with primary fill', () => {
		const theme = resolveBlockTheme(['#ff5500', '#111111']);
		const block = createFactoryBlock('Button', theme);
		expect(block?.type).toBe('Button');
		expect(block?.data.props).toMatchObject({
			buttonBackgroundColor: '#ff5500',
			buttonTextColor: '#FFFFFF',
		});
	});

	it('themes Heading and Text text color', () => {
		const theme = resolveBlockTheme(['#222222', '#ffffff']);
		const heading = createFactoryBlock('Heading', theme);
		const text = createFactoryBlock('Text', theme);
		expect(heading?.data.style).toMatchObject({ color: '#222222' });
		expect(text?.data.style).toMatchObject({ color: '#222222' });
	});

	it('themes Divider line color', () => {
		const theme = resolveBlockTheme(['#0b3d91', '#aaaaaa', '#111111', '#ffffff']);
		const divider = createFactoryBlock('Divider', theme);
		expect(divider?.data.props).toMatchObject({ lineColor: '#aaaaaa' });
	});

	it('leaves unknown types unchanged via applyBlockTheme', () => {
		const theme = resolveBlockTheme(['#123456']);
		const spacer = { type: 'Spacer', data: { props: { height: 16 } } };
		expect(applyBlockTheme(spacer, theme)).toEqual(spacer);
	});
});

describe('themeEmptyDocument', () => {
	it('applies theme to a stock empty document (light-only)', () => {
		const theme = resolveBlockTheme(['#102030', '#fafafa']);
		const next = themeEmptyDocument(structuredClone(EMPTY_DOCUMENT), theme);
		expect(next.root.data.canvasColor).toBe('#fafafa');
		expect(next.root.data.textColor).toBe('#102030');
		expect(next.root.data.backdropColor).toBe(theme.backdrop);
	});

	it('does not override a non-empty document', () => {
		const theme = resolveBlockTheme(['#102030']);
		const doc = structuredClone(EMPTY_DOCUMENT);
		doc.root.data.childrenIds = ['block-1'];
		doc['block-1'] = { type: 'Spacer', data: { props: { height: 8 } } };
		const next = themeEmptyDocument(doc, theme);
		expect(next.root.data.canvasColor).toBe('#FFFFFF');
	});
});

describe('render light-only output', () => {
	it('emits light-only metas and pins a dark-mode override', () => {
		const html = renderBlock(structuredClone(EMPTY_DOCUMENT), 'root');
		expect(html).toContain('<meta name="color-scheme" content="light only">');
		expect(html).toContain('<meta name="supported-color-schemes" content="light only">');
		expect(html).toContain('color-scheme:light only');
		expect(html).toContain('@media (prefers-color-scheme:dark)');
		expect(html).toContain('u + .body .gmail-blend-screen');
		expect(html).toContain('class="body"');
		expect(html).toContain('class="gmail-blend-screen"');
		expect(html).not.toContain('data-owl-dark');
	});

	it('renders per-block colors from light fields for Heading and Button', () => {
		const doc = structuredClone(EMPTY_DOCUMENT);
		doc.root.data.childrenIds = ['h1', 'btn'];
		doc.h1 = {
			type: 'Heading',
			data: { props: { text: 'Hi', level: 'h1' }, style: { color: '#111111' } },
		};
		doc.btn = {
			type: 'Button',
			data: {
				props: {
					text: 'Go',
					url: 'https://example.com',
					buttonBackgroundColor: '#000000',
					buttonTextColor: '#FFFFFF',
				},
				style: {},
			},
		};
		const html = renderBlock(doc, 'root');
		expect(html).toContain('owl-block-h1');
		expect(html).toContain('owl-block-btn');
		expect(html).toContain('color:#111111');
		expect(html).toContain('background-color:#000000');
		expect(html).toContain('color:#FFFFFF');
	});

	it('uses light layout defaults when layout colors are unset', () => {
		const doc = structuredClone(EMPTY_DOCUMENT);
		doc.root.data.canvasColor = '#FFFFFF';
		doc.root.data.backdropColor = '#F5F5F5';
		const html = renderBlock(doc, 'root');
		expect(html).toContain('background-color:#F5F5F5');
		expect(html).toContain('background-color:#FFFFFF');
		expect(html).toContain('color:#262626');
	});
});

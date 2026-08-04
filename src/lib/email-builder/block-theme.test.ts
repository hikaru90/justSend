import { describe, expect, it } from 'vitest';
import {
	applyBlockTheme,
	createFactoryBlock,
	resolveBlockTheme,
	themeEmptyDocument,
} from './block-theme';
import { EMPTY_DOCUMENT } from './types';
import { promoteDarkColors, renderBlock } from './render-html';

describe('resolveBlockTheme', () => {
	it('returns defaults when no colors', () => {
		expect(resolveBlockTheme([])).toEqual({
			primary: '#000000',
			onPrimary: '#FFFFFF',
			text: '#262626',
			muted: '#CCCCCC',
			canvas: '#FFFFFF',
			backdrop: '#F5F5F5',
			darkCanvas: '#1a1a1a',
			darkBackdrop: '#0a0a0a',
			darkText: '#f2f2f2',
			darkPrimary: '#FFFFFF',
			darkOnPrimary: '#111111',
			darkMuted: '#555555',
		});
	});

	it('picks brand primary and contrasting button text', () => {
		const theme = resolveBlockTheme(['#0b3d91', '#f5f5f5', '#111111']);
		expect(theme.primary).toBe('#0b3d91');
		expect(theme.onPrimary).toBe('#FFFFFF');
		expect(theme.canvas).toBe('#f5f5f5');
		expect(theme.text).toBe('#111111');
		expect(theme.darkText).toBe('#f5f5f5');
		expect(theme.darkCanvas).toBeTruthy();
		expect(theme.darkBackdrop).toBeTruthy();
	});
});

describe('applyBlockTheme / createFactoryBlock', () => {
	it('themes Button with primary fill and dark variant', () => {
		const theme = resolveBlockTheme(['#ff5500', '#111111']);
		const block = createFactoryBlock('Button', theme);
		expect(block?.type).toBe('Button');
		expect(block?.data.props).toMatchObject({
			buttonBackgroundColor: '#ff5500',
			buttonTextColor: '#FFFFFF',
			buttonBackgroundColorDark: theme.darkPrimary,
			buttonTextColorDark: theme.darkOnPrimary,
		});
	});

	it('themes Heading and Text text color including dark', () => {
		const theme = resolveBlockTheme(['#222222', '#ffffff']);
		const heading = createFactoryBlock('Heading', theme);
		const text = createFactoryBlock('Text', theme);
		expect(heading?.data.style).toMatchObject({ color: '#222222' });
		expect(heading?.data.darkStyle).toMatchObject({ color: theme.darkText });
		expect(text?.data.style).toMatchObject({ color: '#222222' });
		expect(text?.data.darkStyle).toMatchObject({ color: theme.darkText });
	});

	it('themes Divider line color including dark', () => {
		const theme = resolveBlockTheme(['#0b3d91', '#aaaaaa', '#111111', '#ffffff']);
		const divider = createFactoryBlock('Divider', theme);
		expect(divider?.data.props).toMatchObject({
			lineColor: '#aaaaaa',
			lineColorDark: theme.darkMuted,
		});
	});

	it('leaves unknown types unchanged via applyBlockTheme', () => {
		const theme = resolveBlockTheme(['#123456']);
		const spacer = { type: 'Spacer', data: { props: { height: 16 } } };
		expect(applyBlockTheme(spacer, theme)).toEqual(spacer);
	});
});

describe('themeEmptyDocument', () => {
	it('applies theme to a stock empty document including dark fields', () => {
		const theme = resolveBlockTheme(['#102030', '#fafafa']);
		const next = themeEmptyDocument(structuredClone(EMPTY_DOCUMENT), theme);
		expect(next.root.data.canvasColor).toBe('#fafafa');
		expect(next.root.data.textColor).toBe('#102030');
		expect(next.root.data.darkCanvasColor).toBe(theme.darkCanvas);
		expect(next.root.data.darkBackdropColor).toBe(theme.darkBackdrop);
		expect(next.root.data.darkTextColor).toBe(theme.darkText);
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

describe('render dark overrides', () => {
	it('emits stored dark layout colors instead of hardcoded #111111', () => {
		const doc = structuredClone(EMPTY_DOCUMENT);
		doc.root.data.darkBackdropColor = '#121212';
		doc.root.data.darkCanvasColor = '#1e1e1e';
		doc.root.data.darkTextColor = '#eeeeee';
		const html = renderBlock(doc, 'root');
		expect(html).toContain('background-color:#121212!important');
		expect(html).toContain('background-color:#1e1e1e!important');
		expect(html).toContain('color:#eeeeee!important');
		expect(html).not.toContain('background-color:#111111!important');
		expect(html).not.toContain('background-color:#1c1c1c!important');
	});

	it('emits per-block dark overrides for Heading and Button', () => {
		const doc = structuredClone(EMPTY_DOCUMENT);
		doc.root.data.childrenIds = ['h1', 'btn'];
		doc.h1 = {
			type: 'Heading',
			data: {
				props: { text: 'Hi', level: 'h1' },
				style: { color: '#111111' },
				darkStyle: { color: '#fafafa' },
			},
		};
		doc.btn = {
			type: 'Button',
			data: {
				props: {
					text: 'Go',
					url: 'https://example.com',
					buttonBackgroundColor: '#000000',
					buttonTextColor: '#FFFFFF',
					buttonBackgroundColorDark: '#FFFFFF',
					buttonTextColorDark: '#000000',
				},
				style: {},
			},
		};
		const html = renderBlock(doc, 'root');
		expect(html).toContain('owl-block-h1');
		expect(html).toContain('owl-block-btn');
		expect(html).toContain('.owl-block-h1-fg{color:#fafafa!important;}');
		expect(html).toContain(
			'.owl-block-btn-btn{background-color:#FFFFFF!important;color:#000000!important;}',
		);
	});

	it('emits dark layout defaults when dark fields are unset (never light !important)', () => {
		const doc = structuredClone(EMPTY_DOCUMENT);
		delete doc.root.data.darkBackdropColor;
		delete doc.root.data.darkCanvasColor;
		delete doc.root.data.darkTextColor;
		doc.root.data.canvasColor = '#FFFFFF';
		doc.root.data.backdropColor = '#F5F5F5';
		const html = renderBlock(doc, 'root');
		expect(html).toContain('background-color:#0a0a0a!important');
		expect(html).toContain('background-color:#1a1a1a!important');
		expect(html).not.toMatch(
			/@media \(prefers-color-scheme:dark\)\{[^}]*background-color:#FFFFFF!important/,
		);
	});

	it('promoteDarkColors uses dark defaults when dark fields are unset', () => {
		const doc = structuredClone(EMPTY_DOCUMENT);
		delete doc.root.data.darkBackdropColor;
		delete doc.root.data.darkCanvasColor;
		delete doc.root.data.darkTextColor;
		const promoted = promoteDarkColors(doc);
		expect(promoted.root.data.canvasColor).toBe('#1a1a1a');
		expect(promoted.root.data.backdropColor).toBe('#0a0a0a');
		expect(promoted.root.data.textColor).toBe('#f2f2f2');
	});

	it('promoteDarkColors maps stored dark fields onto light for canvas display', () => {
		const doc = structuredClone(EMPTY_DOCUMENT);
		doc.root.data.darkCanvasColor = '#222222';
		doc.root.data.childrenIds = ['t1'];
		doc.t1 = {
			type: 'Text',
			data: {
				props: { text: 'Hello', markdown: true },
				style: { color: '#222222' },
				darkStyle: { color: '#f0f0f0' },
			},
		};
		const promoted = promoteDarkColors(doc);
		expect(promoted.root.data.canvasColor).toBe('#222222');
		expect(promoted.t1.data.style).toMatchObject({ color: '#f0f0f0' });
	});
});

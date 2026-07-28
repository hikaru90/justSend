import { describe, expect, it } from 'vitest';
import {
	assertSafeUrl,
	extractFontCssUrls,
	extractLogoUrl,
	parseFontFaces,
	uniqueFontsByFamily
} from './design-asset-fetch-service';

describe('assertSafeUrl', () => {
	it('allows public https URLs', () => {
		expect(assertSafeUrl('https://example.com/path').hostname).toBe('example.com');
	});

	it('blocks localhost and private IPs', () => {
		expect(() => assertSafeUrl('http://localhost/x')).toThrow(/not allowed/);
		expect(() => assertSafeUrl('http://127.0.0.1/x')).toThrow(/not allowed/);
		expect(() => assertSafeUrl('http://192.168.1.1/x')).toThrow(/not allowed/);
		expect(() => assertSafeUrl('http://10.0.0.1/x')).toThrow(/not allowed/);
	});
});

describe('extractLogoUrl', () => {
	const base = new URL('https://brand.example/');

	it('prefers apple-touch-icon', () => {
		const html = `
			<link rel="icon" href="/favicon.ico">
			<link rel="apple-touch-icon" href="/apple-touch-icon.png">
		`;
		expect(extractLogoUrl(html, base)).toBe('https://brand.example/apple-touch-icon.png');
	});

	it('falls back to og:image', () => {
		const html = `<meta property="og:image" content="https://cdn.example/logo.png">`;
		expect(extractLogoUrl(html, base)).toBe('https://cdn.example/logo.png');
	});

	it('falls back to header img', () => {
		const html = `<header><img src="/logo.svg" alt="Brand"></header>`;
		expect(extractLogoUrl(html, base)).toBe('https://brand.example/logo.svg');
	});
});

describe('extractFontCssUrls', () => {
	const base = new URL('https://brand.example/');

	it('prioritizes Google Fonts stylesheets', () => {
		const html = `
			<link rel="stylesheet" href="/app.css">
			<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
		`;
		const urls = extractFontCssUrls(html, base);
		expect(urls[0]).toContain('fonts.googleapis.com');
		expect(urls).toContain('https://brand.example/app.css');
	});
});

describe('parseFontFaces', () => {
	it('prefers woff2 src', () => {
		const css = `
			@font-face {
				font-family: 'Inter';
				src: url('./inter.woff') format('woff'),
				     url('./inter.woff2') format('woff2');
			}
		`;
		const faces = parseFontFaces(css, 'https://cdn.example/fonts/styles.css');
		expect(faces).toHaveLength(1);
		expect(faces[0].family).toBe('Inter');
		expect(faces[0].url).toContain('inter.woff2');
	});
});

describe('uniqueFontsByFamily', () => {
	it('keeps first face per family', () => {
		const out = uniqueFontsByFamily([
			{ family: 'Inter', url: 'a', format: 'woff2' },
			{ family: 'Inter', url: 'b', format: 'woff2' },
			{ family: 'Roboto', url: 'c', format: 'woff2' }
		]);
		expect(out).toHaveLength(2);
		expect(out[0].url).toBe('a');
	});
});

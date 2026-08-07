import { describe, expect, it } from 'vitest';
import { parseDocument, serialize } from './parser';
import { applyLightOverride } from './light-override';
import { normalizeDocument } from './normalize';
import { applyTokens } from './tokens';

const DOC = (body: string) =>
	serialize(
		parseDocument(`<!DOCTYPE html><html><head></head><body class="body">${body}</body></html>`),
	);

function compile(body: string, tokens?: Record<string, string>): string {
	const doc = parseDocument(DOC(body));
	normalizeDocument(doc);
	if (tokens) applyTokens(doc, { tokens });
	applyLightOverride(doc, {});
	return serialize(doc);
}

describe('applyLightOverride', () => {
	it('pins inline colors with owll classes inside a dark media query', () => {
		const html = compile(`<div style="color:#111111;background-color:#FFFFFF">Hi</div>`);
		expect(html).toContain('@media (prefers-color-scheme:dark)');
		expect(html).toContain('.owll-w1{color:#111111!important;background-color:#FFFFFF!important;}');
		expect(html).toMatch(/class="owll-w1"/);
	});

	it('pins the body background by tag', () => {
		const doc = parseDocument(
			`<!DOCTYPE html><html><head></head><body style="background-color:#F5F5F5"><div>Hi</div></body></html>`,
		);
		normalizeDocument(doc);
		applyLightOverride(doc, {});
		const html = serialize(doc);
		expect(html).toContain('body{background-color:#F5F5F5!important;');
	});

	it('stamps data-ogsc / data-ogsb with the light values for Outlook', () => {
		const html = compile(`<a style="color:#FFFFFF;background-color:#0A2540">Go</a>`);
		expect(html).toContain('data-ogsc="#FFFFFF"');
		expect(html).toContain('data-ogsb="#0A2540"');
	});

	it('skips no-op and inherited colors', () => {
		const html = compile(
			`<div style="color:inherit;background-color:transparent;font-size:16px">Hi</div>`,
		);
		expect(html).not.toContain('color:inherit!important');
		expect(html).not.toContain('background-color:transparent!important');
		expect(html).not.toMatch(/class="owll-/);
	});

	it('emits the Gmail blend-mode CSS in the light-css container', () => {
		const html = compile(`<div>Hi</div>`);
		expect(html).toContain('data-owl-light-css');
		expect(html).toContain('u + .body .gmail-blend-screen{background:#000;mix-blend-mode:screen;}');
		expect(html).toContain(
			'u + .body .gmail-blend-difference{background:#000;mix-blend-mode:difference;}',
		);
	});

	it('creates the light-css container when the shell lacks one', () => {
		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>Hi</body></html>`);
		applyLightOverride(doc, {});
		expect(doc.head.querySelector('style[data-owl-light-css]')).toBeTruthy();
	});

	it('pins token-resolved colors, not the authored placeholder', () => {
		const html = compile(`<div style="color:#000" data-owl-token="color:primary">Hi</div>`, {
			primary: '#0A2540',
		});
		expect(html).toContain('.owll-');
		expect(html).toContain('color:#0A2540!important');
		expect(html).not.toContain('color:#000!important');
	});

	it('is a fixed point: recompiling clears stale classes and keeps bytes stable', () => {
		const first = compile(
			`<div style="color:#111111">A</div><a style="background-color:#0A2540">B</a>`,
		);
		const doc = parseDocument(first);
		normalizeDocument(doc);
		applyLightOverride(doc, {});
		const second = serialize(doc);
		expect(second).toBe(first);
		const count = second.split('class="owll-w').length - 1;
		expect(count).toBe(2);
	});
});

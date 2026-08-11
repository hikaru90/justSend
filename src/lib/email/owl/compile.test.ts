import { describe, expect, it } from 'vitest';
import { compileOwlHtml, composeEmailHtml, slotsFromFragment } from './index';
import { parseDocument, serialize } from './parser';
import { applySlotValues } from './slots';
import { STARTERS, starterByKey } from './starters';

const SHELL = starterByKey('base-layout')!.html;

const SAMPLE_SECTION = `<table role="presentation" data-owl-component="cta-button" width="100%" cellpadding="0" cellspacing="0" border="0">
<tbody><tr><td style="padding:16px 24px;">
<a href="https://example.com" style="display:inline-block;background-color:#0A2540;color:#FFFFFF;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:bold;" data-owl-slot="cta_text" data-owl-slot-type="text">Get started</a>
</td></tr></tbody></table>`;

describe('owl: determinism & idempotency', () => {
	it('serialize is a fixed point', () => {
		const src = STARTERS.map((s) => s.html).join('\n');
		const once = serialize(parseDocument(src));
		const twice = serialize(parseDocument(once));
		expect(twice).toBe(once);
	});

	it('compile is byte-identical for identical input', () => {
		const src = composeEmailHtml(SHELL, [SAMPLE_SECTION]).html;
		expect(compileOwlHtml(src).html).toBe(compileOwlHtml(src).html);
	});

	it('recompiling compiled output is a fixed point', () => {
		const src = composeEmailHtml(SHELL, [SAMPLE_SECTION]).html;
		const first = compileOwlHtml(src).html;
		const second = compileOwlHtml(first).html;
		expect(second).toBe(first);
	});

	it('compiles the full starter library without throwing', () => {
		for (const starter of STARTERS) {
			const doc = parseDocument(starter.html);
			expect(serialize(doc).length).toBeGreaterThan(0);
		}
	});
});

describe('owl: compose + compile end-to-end', () => {
	it('composes sections into the shell and compiles', () => {
		const composed = composeEmailHtml(SHELL, [
			starterByKey('logo-header')!.html,
			starterByKey('heading')!.html,
			SAMPLE_SECTION,
			starterByKey('footer-legal')!.html,
		]);
		const { html, issues, slots } = compileOwlHtml(composed.html, {
			kind: 'marketing',
			tokens: { primary: '#123456' },
		});

		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('data-owl-component="logo-header"');
		expect(html).toContain('data-owl-component="footer-legal"');
		// sections anchor fully consumed
		expect(html).not.toContain('owl:sections');
		// variables untouched
		expect(html).toContain('{{unsubscribe_url}}');
		// no errors from lint (unsubscribe present)
		expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
		// slots extracted
		expect(slots.some((s) => s.name === 'cta_text')).toBe(true);
		expect(slots.some((s) => s.name === 'logo')).toBe(true);
	});

	it('fills the preheader once and keeps filler', () => {
		const composed = composeEmailHtml(SHELL, [SAMPLE_SECTION], { preheader: 'Big sale now' });
		const first = compileOwlHtml(composed.html).html;
		const second = compileOwlHtml(first).html;
		expect(first).toContain('Big sale now');
		expect(second).toBe(first);
		// filler present exactly once
		const count = second.split('&zwnj;').length - 1;
		expect(count).toBeGreaterThanOrEqual(2);
	});
});

describe('owl: light-only output', () => {
	it('pins light colors with a dark-mode override and never emits dark variants', () => {
		const composed = composeEmailHtml(SHELL, [SAMPLE_SECTION]).html;
		const { html } = compileOwlHtml(composed);

		// Light-only signaling: metas + :root pin say "light only".
		expect(html).toContain('name="color-scheme" content="light only"');
		expect(html).toContain('name="supported-color-schemes" content="light only"');
		expect(html).toContain('color-scheme:light only');

		// The override re-asserts the same light colors inside a dark media query.
		expect(html).toContain('@media (prefers-color-scheme:dark)');
		expect(html).toContain('body{background-color:#F5F5F5!important');
		expect(html).toContain('background-color:#FFFFFF!important');
		expect(html).toContain('color:#262626!important');
		expect(html).toContain('.owll-w');

		// Outlook stamps + Gmail blend wrappers present.
		expect(html).toContain('data-ogsc="#FFFFFF"');
		expect(html).toContain('data-ogsb="#0A2540"');
		expect(html).toContain('gmail-blend-screen');
		expect(html).toContain('u + .body .gmail-blend-screen');
		expect(html).toContain('mix-blend-mode:screen');

		// Never reintroduce dark-variant markup.
		expect(html).not.toContain('data-owl-dark');
	});

	it('strips authored dark-variant logos and swap CSS from legacy templates', () => {
		const legacyHead = `<meta name="color-scheme" content="light dark">
<style data-owl-base-css>
.logo-dark{display:none!important;max-height:0!important;overflow:hidden!important;}
@media (prefers-color-scheme:dark){
.logo-light{display:none!important;max-height:0!important;overflow:hidden!important;}
.logo-dark{display:inline-block!important;max-height:none!important;overflow:visible!important;}
}
</style>
<style data-owl-dark-css></style>`;
		const legacySection = `<table role="presentation" data-owl-component="logo-header" data-owl-role="section" width="100%">
<tbody><tr><td style="padding: 24px 24px 8px 24px" align="center" data-owl-dark-style="color: #ffffff">
<a href="#" data-owl-slot="logo_link" data-owl-slot-type="url" data-owl-slot-label="Logo link">
<img src="/api/design-asset/light" class="logo-light" style="display: block; width: 120px; height: auto; max-width: 100%" data-owl-slot="logo" data-owl-slot-type="image" data-owl-slot-label="Logo" alt="Brand" width="93">
<img src="/api/design-asset/dark" alt="Brand" width="93" class="logo-dark" style="display:none;width:120px;height:auto;max-width:100%;">
<img src="/api/design-asset/hero-dark" class="owl-dark" data-owl-variant="dark" data-owl-variant-group="hero" alt="Hero" style="display:none;">
</a>
</td></tr></tbody></table>`;
		const shell = SHELL.replace(
			'<style data-owl-base-css>',
			`${legacyHead.replace('<style data-owl-base-css>', '<style data-owl-base-css data-legacy="1">')}<style data-owl-base-css>`,
		);
		const composed = composeEmailHtml(shell, [legacySection]).html;
		const { html } = compileOwlHtml(composed);

		// Dark-variant elements are gone; only the light logo survives.
		expect(html).toContain('/api/design-asset/light');
		expect(html).not.toContain('/api/design-asset/dark');
		expect(html).not.toContain('logo-dark');
		expect(html).not.toContain('owl-dark');
		expect(html).not.toContain('data-owl-variant');

		// The authored dark swap media query is stripped from base css;
		// the only surviving dark media block is the compiler's light-pin.
		expect(html).not.toContain('light dark');
		expect(html).toContain('name="color-scheme" content="light only"');
	});
});

describe('owl: tokens & heal & normalize', () => {
	it('resolves data-owl-token into literal styles', () => {
		const src = `<div style="color:#000;font-size:16px;" data-owl-token="color:primary">Hi</div>`;
		const full = serialize(
			parseDocument(`<!DOCTYPE html><html><head></head><body>${src}</body></html>`),
		);
		const { html } = compileOwlHtml(full, { tokens: { primary: '#0A2540' } });
		expect(html).toContain('color:#0A2540');
		expect(html).not.toContain('color:#000');
	});

	it('strips scripts and wraps bare tr in tbody', () => {
		const src = `<script>alert(1)</script><table><tr><td>x</td></tr></table>`;
		const { html, issues } = compileOwlHtml(
			serialize(parseDocument(`<!DOCTYPE html><html><head></head><body>${src}</body></html>`)),
		);
		expect(html).not.toContain('<script');
		expect(html).toContain('<tbody');
		expect(issues.some((i) => i.code === 'heal.banned-tag')).toBe(true);
	});

	it('assigns stable data-owl-ids in document order', () => {
		const src = `<div><span>A</span><span>B</span></div>`;
		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${src}</body></html>`);
		const { html } = compileOwlHtml(serialize(doc));
		const ids = [...html.matchAll(/data-owl-id="(w\d+)"/g)].map((m) => m[1]);
		expect(ids[0]).toBe('w1');
		expect(ids[1]).toBe('w2');
	});
});

describe('owl: lint', () => {
	it('flags missing unsubscribe for marketing', () => {
		const composed = composeEmailHtml(SHELL, [SAMPLE_SECTION]).html;
		const { issues } = compileOwlHtml(composed, { kind: 'marketing' });
		expect(issues.some((i) => i.code === 'lint.unsubscribe-missing')).toBe(true);
	});

	it('flags missing alt text on images', () => {
		const composed = composeEmailHtml(SHELL, [
			`<table role="presentation"><tbody><tr><td><img src="x.png"></td></tr></tbody></table>`,
		]).html;
		const { issues } = compileOwlHtml(composed);
		expect(issues.some((i) => i.code === 'lint.img-missing-alt')).toBe(true);
	});
});

describe('owl: slots', () => {
	it('extracts slots from a bare fragment', () => {
		const slots = slotsFromFragment(SAMPLE_SECTION);
		expect(slots.map((s) => s.name)).toContain('cta_text');
		expect(slots.find((s) => s.name === 'cta_text')?.type).toBe('text');
	});
});

describe('owl: image slots (light-only)', () => {
	it('base shell signals light-only and carries the override scaffold', () => {
		expect(SHELL).not.toContain('.owl-dark');
		expect(SHELL).not.toContain('.logo-dark');
		expect(SHELL).toContain('color-scheme:light only');
		expect(SHELL).toContain('data-owl-light-css');
		expect(SHELL).toContain('class="body"');
		expect(SHELL).toContain('gmail-blend-screen');
		// prefers-color-scheme + blend CSS are compiler-generated, not authored.
		expect(SHELL).not.toContain('prefers-color-scheme');
	});

	it('hero starter ships a single image slot', () => {
		const hero = starterByKey('hero-image')!.html;
		expect(hero).toContain('data-owl-slot="hero"');
		expect(hero).not.toContain('owl-dark');
		expect(hero).not.toContain('owl-light');
		expect(hero.match(/data-owl-slot="hero"/g)?.length).toBe(1);
	});

	it('fills the image slot once (no dark partner)', () => {
		const frag = starterByKey('hero-image')!.html;
		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${frag}</body></html>`);
		applySlotValues(doc, { hero: 'https://cdn.example/hero.png' });
		const html = serialize(doc);
		const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
		expect(srcs).toEqual(['https://cdn.example/hero.png']);
	});

	it('ignores legacy <slot>_dark values', () => {
		const frag = starterByKey('hero-image')!.html;
		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${frag}</body></html>`);
		applySlotValues(doc, {
			hero: 'https://cdn.example/hero.png',
			hero_dark: 'https://cdn.example/dark.png',
		});
		const html = serialize(doc);
		expect(html).toContain('src="https://cdn.example/hero.png"');
		expect(html).not.toContain('https://cdn.example/dark.png');
	});

	it('fills the logo slot on the single logo img', () => {
		const frag = starterByKey('logo-header')!.html;
		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${frag}</body></html>`);
		applySlotValues(doc, { logo: 'https://cdn.example/logo.png' });
		const html = serialize(doc);
		const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
		expect(srcs.every((s) => s === 'https://cdn.example/logo.png')).toBe(true);
	});

	it('wraps bare asset ids as /api/design-asset/{id} on image slots', () => {
		const frag = starterByKey('logo-header')!.html;
		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${frag}</body></html>`);
		applySlotValues(doc, { logo: '174e2ac4d3aa4de49eb17b86' });
		const html = serialize(doc);
		expect(html).toContain('src="/api/design-asset/174e2ac4d3aa4de49eb17b86"');
		expect(html).not.toContain('src="174e2ac4d3aa4de49eb17b86"');
	});

	it('leaves already-prefixed image slot values unchanged', () => {
		const frag = starterByKey('hero-image')!.html;
		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${frag}</body></html>`);
		applySlotValues(doc, { hero: '/api/design-asset/5b638723b5fc4c20997f1496' });
		const html = serialize(doc);
		expect(html).toContain('src="/api/design-asset/5b638723b5fc4c20997f1496"');
		expect(html.match(/\/api\/design-asset\/5b638723b5fc4c20997f1496/g)?.length).toBe(1);
	});
});

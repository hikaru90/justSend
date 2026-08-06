import { describe, expect, it } from 'vitest';
import { compileOwlHtml, composeEmailHtml, promoteDarkStyles, slotsFromFragment } from './index';
import { parseDocument, serialize, parseFragment, walkElements } from './parser';
import { OWL, OWL_CLASS } from './format';
import { applySlotValues } from './slots';
import { STARTERS, starterByKey } from './starters';

const SHELL = starterByKey('base-layout')!.html;

const SAMPLE_SECTION = `<table role="presentation" data-owl-component="cta-button" width="100%" cellpadding="0" cellspacing="0" border="0">
<tbody><tr><td style="padding:16px 24px;">
<a href="https://example.com" style="display:inline-block;background-color:#0A2540;color:#FFFFFF;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:bold;" data-owl-slot="cta_text" data-owl-slot-type="text" data-owl-dark-style="background-color:#1a3a6e;color:#FFFFFF;">Get started</a>
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

describe('owl: dark mode', () => {
	it('emits stable classes, media rules, and data-og* mirrors', () => {
		const composed = composeEmailHtml(SHELL, [SAMPLE_SECTION]).html;
		const { html } = compileOwlHtml(composed);

		expect(html).toContain('@media (prefers-color-scheme:dark)');
		expect(html).toContain(`.${OWL_CLASS.darkOverride}-`);
		expect(html).toContain('data-ogsc="#FFFFFF"');
		expect(html).toContain('data-ogsb="#1a3a6e"');
		// backdrop dark override present
		expect(html).toContain('background-color:#0a0a0a!important');
		// color-scheme meta kept
		expect(html).toContain('name="color-scheme"');
	});

	it('promoteDarkStyles produces a forced-dark preview', () => {
		const composed = composeEmailHtml(SHELL, [SAMPLE_SECTION]).html;
		const doc = parseDocument(composed);
		promoteDarkStyles(doc);
		const html = serialize(doc);
		// dark values are now inline, dark-css media block emptied
		expect(html).toContain('background-color:#1a3a6e');
		expect(html).not.toContain(`[data-owl-dark-css]:not([data-owl-dark-css=""])`);
		expect(html).not.toContain('.owld-w');
		expect(html).not.toContain('data-owl-dark-style');
	});
});

describe('owl: tokens & heal & normalize', () => {
	it('resolves data-owl-token into literal styles', () => {
		const src = `<div style="color:#000;font-size:16px;" data-owl-token="color:primary">Hi</div>`;
		const full = serialize(parseDocument(`<!DOCTYPE html><html><head></head><body>${src}</body></html>`));
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
		const composed = composeEmailHtml(SHELL, [`<table role="presentation"><tbody><tr><td><img src="x.png"></td></tr></tbody></table>`]).html;
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

describe('owl: light/dark content pairs', () => {
	it('base CSS hides owl-dark and swaps under prefers-color-scheme', () => {
		expect(SHELL).toContain('.owl-dark,.logo-dark{display:none');
		expect(SHELL).toMatch(
			/@media \(prefers-color-scheme:dark\)\{[\s\S]*\.owl-light,\.logo-light/,
		);
		expect(SHELL).toMatch(
			/@media \(prefers-color-scheme:dark\)\{[\s\S]*\.owl-dark,\.logo-dark\{display:block/,
		);
	});

	it('hero starter ships owl-light/owl-dark pair with shared group', () => {
		const hero = starterByKey('hero-image')!.html;
		expect(hero).toContain('data-owl-variant-group="hero"');
		expect(hero).toContain('class="owl-light"');
		expect(hero).toContain('class="owl-dark"');
		expect(hero).toContain('data-owl-slot="hero"');
		// only the light img owns the slot
		expect(hero.match(/data-owl-slot="hero"/g)?.length).toBe(1);
	});

	it('syncs image src onto dark partner when filling light slot', () => {
		const frag = starterByKey('hero-image')!.html;
		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${frag}</body></html>`);
		applySlotValues(doc, { hero: 'https://cdn.example/light.png' });
		const html = serialize(doc);
		const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
		expect(srcs.filter((s) => s === 'https://cdn.example/light.png').length).toBe(2);
	});

	it('fills dark partner independently via <slot>_dark', () => {
		const frag = starterByKey('hero-image')!.html;
		const doc = parseDocument(`<!DOCTYPE html><html><head></head><body>${frag}</body></html>`);
		applySlotValues(doc, {
			hero: 'https://cdn.example/light.png',
			hero_dark: 'https://cdn.example/dark.png',
		});
		const html = serialize(doc);
		expect(html).toContain('src="https://cdn.example/light.png"');
		expect(html).toContain('src="https://cdn.example/dark.png"');
		expect(html).not.toMatch(/owl-dark[^>]*src="https:\/\/cdn\.example\/light\.png"/);
	});

	it('still syncs legacy logo-light / logo-dark siblings', () => {
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
		expect(html.match(/\/api\/design-asset\/5b638723b5fc4c20997f1496/g)?.length).toBe(2);
	});
});

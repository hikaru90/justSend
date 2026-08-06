import { describe, expect, it } from 'vitest';
import { compileOwlDoc, defaultOwlShell, mergeEditedHtmlIntoOwlDoc, migrateToOwlDoc } from './studio-server';
import { emptyOwlDoc, newSectionId, parseOwlDoc, serializeOwlDoc, type OwlDoc } from './studio';
import { starterByKey } from './starters';

function shellDoc(): OwlDoc {
	return emptyOwlDoc(defaultOwlShell(), 'Preview me');
}

describe('studio: compileOwlDoc', () => {
	it('composes shell + sections and applies slot values', () => {
		const doc = shellDoc();
		const cta = starterByKey('cta-button')!;
		doc.sections.push({
			id: newSectionId(),
			key: cta.key,
			label: cta.name,
			html: cta.html,
		});
		doc.sections.push({
			id: newSectionId(),
			key: 'footer-legal',
			label: 'Footer',
			html: starterByKey('footer-legal')!.html,
		});
		doc.slotValues = { cta_text: 'Buy now', cta_url: 'https://example.com/buy' };

		const { html, issues, sectionSlots, sectionHtml } = compileOwlDoc(doc);

		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('Buy now');
		expect(html).toContain('href="https://example.com/buy"');
		expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
		expect(sectionSlots[doc.sections[0].id]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'cta_text', type: 'text' }),
				expect.objectContaining({ name: 'cta_url', type: 'url' }),
			]),
		);
		expect(sectionHtml[doc.sections[0].id]).toContain('data-owl-component="cta-button"');
		expect(sectionHtml[doc.sections[1].id]).toContain('data-owl-component="footer-legal"');
	});

	it('rewrites design-asset urls to an origin when requested', () => {
		const doc = shellDoc();
		const hero = starterByKey('hero-image')!;
		doc.sections.push({ id: newSectionId(), key: hero.key, label: hero.name, html: hero.html });
		doc.slotValues = { hero: '/api/design-asset/abc123' };

		const relative = compileOwlDoc(doc);
		const absolute = compileOwlDoc(doc, { origin: 'http://localhost:5173' });

		expect(relative.html).toContain('src="/api/design-asset/abc123"');
		expect(absolute.html).toContain('src="http://localhost:5173/api/design-asset/abc123"');
		expect(absolute.html).not.toContain('src="/api/design-asset/abc123"');
	});

	it('forced-dark compile inlines dark values', () => {
		const doc = shellDoc();
		const cta = starterByKey('cta-button')!;
		doc.sections.push({ id: newSectionId(), key: cta.key, label: cta.name, html: cta.html });

		const { html } = compileOwlDoc(doc, { colorScheme: 'dark' });
		expect(html).toContain('background-color:#1a3a6e');
	});
});

describe('studio: envelope round-trip', () => {
	it('parseOwlDoc / serializeOwlDoc round-trips', () => {
		const doc = shellDoc();
		doc.sections.push({ id: newSectionId(), key: 'text', label: 'Text', html: '<p>Hi</p>' });
		doc.slotValues = { body: 'Hello' };

		const parsed = parseOwlDoc(serializeOwlDoc(doc));
		expect(parsed).toEqual(doc);
	});

	it('rejects non-owl content', () => {
		expect(parseOwlDoc('{"root":{"type":"EmailLayout"}}')).toBeNull();
		expect(parseOwlDoc('<p>plain html</p>')).toBeNull();
		expect(parseOwlDoc(null)).toBeNull();
	});
});

describe('studio: migrateToOwlDoc', () => {
	it('passes through an existing owl envelope', () => {
		const doc = shellDoc();
		const result = migrateToOwlDoc({ content: serializeOwlDoc(doc) });
		expect(result.migrated).toBe(false);
		expect(result.doc).toEqual(doc);
	});

	it('extracts sections from compiled html', () => {
		const result = migrateToOwlDoc({
			html: '<html><body><table data-owl-component="heading" data-owl-role="section"><tr><td>Hi</td></tr></table></body></html>',
		});
		expect(result.migrated).toBe(true);
		expect(result.note).toContain('Imported');
		expect(result.doc.sections[0].key).toBe('heading');
	});

	it('carries preheader and slot values over from legacy content', () => {
		const legacy = JSON.stringify({
			format: 'email-builder',
			scaffold: { preheader: 'Sneak peek', slots: { cta_text: 'Read more', cta_url: 'https://x.io' } },
		});
		const result = migrateToOwlDoc({ content: legacy });
		expect(result.migrated).toBe(false);
		expect(result.doc.preheader).toBe('Sneak peek');
		expect(result.doc.slotValues).toEqual({
			cta_text: 'Read more',
			cta_url: 'https://x.io',
		});
	});

	it('returns an empty doc with a note when nothing to migrate', () => {
		const result = migrateToOwlDoc({});
		expect(result.migrated).toBe(false);
		expect(result.doc.sections).toEqual([]);
		expect(result.note).toContain('No sections');
	});
});

describe('studio: mergeEditedHtmlIntoOwlDoc', () => {
	it('replaces sections while preserving ids when keys match', () => {
		const doc = shellDoc();
		const cta = starterByKey('cta-button')!;
		const sectionId = newSectionId();
		doc.sections.push({
			id: sectionId,
			key: cta.key,
			label: cta.name,
			html: cta.html,
		});
		doc.slotValues = { cta_text: 'Old label' };

		const edited = compileOwlDoc(doc).html.replace('Old label', 'Start now');
		const merged = mergeEditedHtmlIntoOwlDoc(doc, edited);

		expect(merged.sections).toHaveLength(1);
		expect(merged.sections[0].id).toBe(sectionId);
		expect(merged.sections[0].html).toContain('Start now');
		expect(merged.slotValues).toEqual(doc.slotValues);
		expect(merged.shell).toBe(doc.shell);
	});
});

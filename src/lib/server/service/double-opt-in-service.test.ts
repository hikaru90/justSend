import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { resetDb, db } from '../../../tests/helpers/db';
import { createTeam, createContactBook, createContact } from '../../../tests/helpers/factories';
import { env } from '../env';
import {
	confirmDoubleOptInSubscription,
	hasDoubleOptInUrlPlaceholder,
	DEFAULT_DOUBLE_OPT_IN_CONTENT
} from './double-opt-in-service';

beforeEach(() => resetDb());

function validHash(contactId: string, expiresAt: number) {
	return createHash('sha256')
		.update(`${contactId}-${expiresAt}-${env.AUTH_SECRET}`)
		.digest('hex');
}

describe('double-opt-in-service', () => {
	describe('hasDoubleOptInUrlPlaceholder', () => {
		it('detects {{doubleOptInUrl}} in plain text', () => {
			expect(hasDoubleOptInUrlPlaceholder('Click {{doubleOptInUrl}} to confirm')).toBe(true);
		});

		it('detects placeholder with fallback syntax', () => {
			expect(
				hasDoubleOptInUrlPlaceholder('{{ doubleOptInUrl, fallback=https://example.com }}')
			).toBe(true);
		});

		it('detects placeholder inside JSON content', () => {
			expect(hasDoubleOptInUrlPlaceholder(DEFAULT_DOUBLE_OPT_IN_CONTENT)).toBe(true);
		});

		it('returns false when placeholder is missing', () => {
			expect(hasDoubleOptInUrlPlaceholder('<p>No confirmation link</p>')).toBe(false);
		});
	});

	describe('confirmDoubleOptInSubscription', () => {
		it('confirms subscription with a valid hash', () => {
			const team = createTeam();
			const book = createContactBook(team.id, { doubleOptInEnabled: true });
			const contact = createContact(book.id, { subscribed: false });

			const expiresAt = Date.now() + 86_400_000;
			const hash = validHash(contact.id, expiresAt);

			const updated = confirmDoubleOptInSubscription({
				contactId: contact.id,
				expiresAt: String(expiresAt),
				hash
			});

			expect(updated.subscribed).toBe(true);
			expect(updated.unsubscribeReason).toBeNull();
		});

		it('throws for an invalid hash', () => {
			const team = createTeam();
			const book = createContactBook(team.id, { doubleOptInEnabled: true });
			const contact = createContact(book.id, { subscribed: false });
			const expiresAt = Date.now() + 86_400_000;

			expect(() =>
				confirmDoubleOptInSubscription({
					contactId: contact.id,
					expiresAt: String(expiresAt),
					hash: 'invalid-hash'
				})
			).toThrow('Invalid confirmation link');
		});

		it('throws for an expired link', () => {
			const team = createTeam();
			const book = createContactBook(team.id, { doubleOptInEnabled: true });
			const contact = createContact(book.id, { subscribed: false });
			const expiresAt = Date.now() - 1000;
			const hash = validHash(contact.id, expiresAt);

			expect(() =>
				confirmDoubleOptInSubscription({
					contactId: contact.id,
					expiresAt: String(expiresAt),
					hash
				})
			).toThrow('Confirmation link has expired');
		});

		it('returns existing contact when already subscribed', () => {
			const team = createTeam();
			const book = createContactBook(team.id, { doubleOptInEnabled: true });
			const contact = createContact(book.id, { subscribed: true });
			const expiresAt = Date.now() + 86_400_000;
			const hash = validHash(contact.id, expiresAt);

			const result = confirmDoubleOptInSubscription({
				contactId: contact.id,
				expiresAt: String(expiresAt),
				hash
			});

			expect(result.id).toBe(contact.id);
			expect(result.subscribed).toBe(true);
		});

		it('throws when contact is not found', () => {
			const expiresAt = Date.now() + 86_400_000;
			const hash = validHash('missing-contact', expiresAt);

			expect(() =>
				confirmDoubleOptInSubscription({
					contactId: 'missing-contact',
					expiresAt: String(expiresAt),
					hash
				})
			).toThrow('Contact not found');
		});
	});
});

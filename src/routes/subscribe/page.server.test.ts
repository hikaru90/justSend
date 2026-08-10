import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { resetDb, db } from '../../tests/helpers/db';
import {
	createTeam,
	createContactBook,
	createContact,
} from '../../tests/helpers/factories';
import { contacts } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$lib/server/env';
import { load } from './+page.server';

beforeEach(() => resetDb());

function validHash(contactId: string, expiresAt: number) {
	return createHash('sha256').update(`${contactId}-${expiresAt}-${env.AUTH_SECRET}`).digest('hex');
}

describe('GET /subscribe', () => {
	it('confirms double opt-in via contactId link', async () => {
		const team = createTeam();
		const book = createContactBook(team.id, { doubleOptInEnabled: true });
		const contact = createContact(book.id, {
			email: 'pending@example.com',
			subscribed: false,
		});

		const expiresAt = Date.now() + 86_400_000;
		const hash = validHash(contact.id, expiresAt);
		const url = new URL('http://localhost:5173/subscribe');
		url.searchParams.set('contactId', contact.id);
		url.searchParams.set('expiresAt', String(expiresAt));
		url.searchParams.set('hash', hash);

		const result = await load({ url } as Parameters<typeof load>[0]);
		expect(result).toEqual({ success: true });

		const updated = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
		expect(updated?.subscribed).toBe(true);
	});

	it('rejects incomplete double opt-in links', async () => {
		const url = new URL('http://localhost:5173/subscribe?contactId=abc');
		await expect(load({ url } as Parameters<typeof load>[0])).rejects.toMatchObject({
			status: 400,
		});
	});
});

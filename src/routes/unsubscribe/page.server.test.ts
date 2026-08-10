import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../tests/helpers/db';
import {
	createTeam,
	createContactBook,
	createContact,
} from '../../tests/helpers/factories';
import { createContactUnsubUrl } from '$lib/server/service/campaign-service';
import { load } from './+page.server';

beforeEach(() => resetDb());

describe('GET /unsubscribe', () => {
	it('renders a bare info page when id/hash are missing', async () => {
		const result = await load({
			url: new URL('http://localhost:5173/unsubscribe'),
		} as Parameters<typeof load>[0]);

		expect(result).toEqual({ success: false, bare: true, email: null });
	});

	it('unsubscribes via a signed contact link', async () => {
		const team = createTeam();
		const book = createContactBook(team.id);
		const contact = createContact(book.id, { email: 'bye@example.com', subscribed: true });
		const url = new URL(createContactUnsubUrl(contact.id));

		const result = await load({ url } as Parameters<typeof load>[0]);

		expect(result).toEqual({
			success: true,
			bare: false,
			email: 'bye@example.com',
		});
	});
});

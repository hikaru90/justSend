import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../../tests/helpers/db';
import {
	createTeamWithApiKey,
	createContactBook,
	createContact
} from '../../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../../tests/helpers/api';
import { GET, POST } from './+server';

describe('GET /api/v1/contactBooks/[id]/contacts', () => {
	beforeEach(() => resetDb());

	it('lists contacts in a contact book', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const book = createContactBook(team.id);
		createContact(book.id, { email: 'one@example.com' });

		const event = buildApiEvent({
			method: 'GET',
			path: `/api/v1/contactBooks/${book.id}/contacts`,
			params: { id: book.id },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect((json as { data: unknown[] }).data).toHaveLength(1);
	});
});

describe('POST /api/v1/contactBooks/[id]/contacts', () => {
	beforeEach(() => resetDb());

	it('adds a contact to a contact book', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const book = createContactBook(team.id);

		const event = buildApiEvent({
			method: 'POST',
			path: `/api/v1/contactBooks/${book.id}/contacts`,
			params: { id: book.id },
			body: { email: 'new@example.com', firstName: 'New' },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(200);
		expect((json as { contactId: string }).contactId).toBeTruthy();
	});
});

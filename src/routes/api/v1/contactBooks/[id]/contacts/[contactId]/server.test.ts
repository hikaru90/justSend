import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../../../tests/helpers/db';
import {
	createTeamWithApiKey,
	createContactBook,
	createContact
} from '../../../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../../../tests/helpers/api';
import { GET, PATCH, PUT, DELETE } from './+server';

describe('GET /api/v1/contactBooks/[id]/contacts/[contactId]', () => {
	beforeEach(() => resetDb());

	it('returns a contact by id', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const book = createContactBook(team.id);
		const contact = createContact(book.id, { email: 'get@example.com', firstName: 'Get' });

		const event = buildApiEvent({
			method: 'GET',
			path: `/api/v1/contactBooks/${book.id}/contacts/${contact.id}`,
			params: { id: book.id, contactId: contact.id },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ id: contact.id, email: 'get@example.com' });
	});
});

describe('PATCH /api/v1/contactBooks/[id]/contacts/[contactId]', () => {
	beforeEach(() => resetDb());

	it('updates a contact', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const book = createContactBook(team.id);
		const contact = createContact(book.id, { email: 'patch@example.com' });

		const event = buildApiEvent({
			method: 'PATCH',
			path: `/api/v1/contactBooks/${book.id}/contacts/${contact.id}`,
			params: { id: book.id, contactId: contact.id },
			body: { firstName: 'Updated' },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(PATCH, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ id: contact.id, firstName: 'Updated' });
	});
});

describe('PUT /api/v1/contactBooks/[id]/contacts/[contactId]', () => {
	beforeEach(() => resetDb());

	it('upserts a contact by email', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const book = createContactBook(team.id);

		const event = buildApiEvent({
			method: 'PUT',
			path: `/api/v1/contactBooks/${book.id}/contacts/ignored`,
			params: { id: book.id, contactId: 'ignored' },
			body: { email: 'put@example.com', firstName: 'Put' },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(PUT, event);

		expect(status).toBe(200);
		expect((json as { contactId: string }).contactId).toBeTruthy();
	});
});

describe('DELETE /api/v1/contactBooks/[id]/contacts/[contactId]', () => {
	beforeEach(() => resetDb());

	it('deletes a contact', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const book = createContactBook(team.id);
		const contact = createContact(book.id, { email: 'delete@example.com' });

		const event = buildApiEvent({
			method: 'DELETE',
			path: `/api/v1/contactBooks/${book.id}/contacts/${contact.id}`,
			params: { id: book.id, contactId: contact.id },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(DELETE, event);

		expect(status).toBe(200);
		expect(json).toEqual({ ok: true });
	});
});

import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../tests/helpers/db';
import { createTeamWithApiKey, createContactBook } from '../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../tests/helpers/api';
import { GET, PATCH, DELETE } from './+server';

describe('GET /api/v1/contactBooks/[id]', () => {
	beforeEach(() => resetDb());

	it('returns a contact book by id', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const book = createContactBook(team.id, { name: 'Main list' });

		const event = buildApiEvent({
			method: 'GET',
			path: `/api/v1/contactBooks/${book.id}`,
			params: { id: book.id },
			headers: bearer(apiKey),
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ id: book.id, name: 'Main list' });
	});
});

describe('PATCH /api/v1/contactBooks/[id]', () => {
	beforeEach(() => resetDb());

	it('updates a contact book', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const book = createContactBook(team.id, { name: 'Old name' });

		const event = buildApiEvent({
			method: 'PATCH',
			path: `/api/v1/contactBooks/${book.id}`,
			params: { id: book.id },
			body: { name: 'New name' },
			headers: bearer(apiKey),
		});
		const { status, json } = await invokeHandler(PATCH, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ id: book.id, name: 'New name' });
	});
});

describe('DELETE /api/v1/contactBooks/[id]', () => {
	beforeEach(() => resetDb());

	it('deletes a contact book', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const book = createContactBook(team.id);

		const event = buildApiEvent({
			method: 'DELETE',
			path: `/api/v1/contactBooks/${book.id}`,
			params: { id: book.id },
			headers: bearer(apiKey),
		});
		const { status, json } = await invokeHandler(DELETE, event);

		expect(status).toBe(200);
		expect(json).toEqual({ ok: true });
	});
});

import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../../../tests/helpers/db';
import {
	createTeamWithApiKey,
	createContactBook,
	createContact,
} from '../../../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../../../tests/helpers/api';
import { POST, DELETE } from './+server';

describe('POST /api/v1/contactBooks/[id]/contacts/bulk', () => {
	beforeEach(() => resetDb());

	it('bulk-adds contacts', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const book = createContactBook(team.id);

		const event = buildApiEvent({
			method: 'POST',
			path: `/api/v1/contactBooks/${book.id}/contacts/bulk`,
			params: { id: book.id },
			body: {
				contacts: [{ email: 'bulk1@example.com' }, { email: 'bulk2@example.com' }],
			},
			headers: bearer(apiKey),
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ count: 2 });
	});
});

describe('DELETE /api/v1/contactBooks/[id]/contacts/bulk', () => {
	beforeEach(() => resetDb());

	it('bulk-deletes contacts by id', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const book = createContactBook(team.id);
		const c1 = createContact(book.id, { email: 'del1@example.com' });
		const c2 = createContact(book.id, { email: 'del2@example.com' });

		const event = buildApiEvent({
			method: 'DELETE',
			path: `/api/v1/contactBooks/${book.id}/contacts/bulk`,
			params: { id: book.id },
			body: { contactIds: [c1.id, c2.id] },
			headers: bearer(apiKey),
		});
		const { status, json } = await invokeHandler(DELETE, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ success: true, count: 2 });
	});
});

import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../tests/helpers/db';
import { createTeamWithApiKey, createContactBook } from '../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../tests/helpers/api';
import { GET, POST } from './+server';

describe('GET /api/v1/contactBooks', () => {
	beforeEach(() => resetDb());

	it('lists contact books for the authenticated team', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		createContactBook(team.id, { name: 'Newsletter' });

		const event = buildApiEvent({
			method: 'GET',
			path: '/api/v1/contactBooks',
			headers: bearer(apiKey),
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect((json as { data: unknown[] }).data).toHaveLength(1);
	});
});

describe('POST /api/v1/contactBooks', () => {
	beforeEach(() => resetDb());

	it('creates a contact book', async () => {
		const { apiKey } = await createTeamWithApiKey();

		const event = buildApiEvent({
			method: 'POST',
			path: '/api/v1/contactBooks',
			body: { name: 'Customers', emoji: '📬' },
			headers: bearer(apiKey),
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ name: 'Customers', emoji: '📬' });
	});
});

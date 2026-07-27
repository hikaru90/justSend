import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../tests/helpers/db';
import {
	createTeamWithApiKey,
	createEmail,
	createSesSetting
} from '../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../tests/helpers/api';
import { GET, POST } from './+server';

describe('GET /api/v1/emails', () => {
	beforeEach(() => resetDb());

	it('lists emails for the authenticated team', async () => {
		const { team, domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		createEmail(team.id, { domainId: domain.id, subject: 'Listed' });

		const event = buildApiEvent({
			method: 'GET',
			path: '/api/v1/emails',
			urlSearchParams: { limit: '10' },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect((json as { data: unknown[] }).data).toHaveLength(1);
	});
});

describe('POST /api/v1/emails', () => {
	beforeEach(() => resetDb());

	it('sends an email successfully', async () => {
		const { domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		createSesSetting({ region: domain.region });

		const event = buildApiEvent({
			method: 'POST',
			path: '/api/v1/emails',
			body: {
				to: 'a@b.com',
				from: 'noreply@mail.example.com',
				subject: 'Hi',
				text: 'Hello'
			},
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ status: 'QUEUED' });
		expect((json as { id: string }).id).toBeTruthy();
	});

	it('returns 400 for validation errors', async () => {
		const { apiKey } = await createTeamWithApiKey();

		const event = buildApiEvent({
			method: 'POST',
			path: '/api/v1/emails',
			body: { to: 'a@b.com' },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(400);
		expect(json).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
	});

	it('returns 401 without auth', async () => {
		const event = buildApiEvent({
			method: 'POST',
			path: '/api/v1/emails',
			body: { to: 'a@b.com', from: 'a@b.com', subject: 'Hi', text: 'Hi' }
		});
		const { status } = await invokeHandler(POST, event);
		expect(status).toBe(401);
	});

	it('replays idempotent responses for the same Idempotency-Key', async () => {
		const { domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		createSesSetting({ region: domain.region });

		const body = {
			to: 'a@b.com',
			from: 'noreply@mail.example.com',
			subject: 'Hi',
			text: 'Hello'
		};
		const headers = { ...bearer(apiKey), 'Idempotency-Key': 'idem-1' };

		const first = await invokeHandler(
			POST,
			buildApiEvent({ method: 'POST', path: '/api/v1/emails', body, headers })
		);
		const second = await invokeHandler(
			POST,
			buildApiEvent({ method: 'POST', path: '/api/v1/emails', body, headers })
		);

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(second.json).toEqual(first.json);
	});
});

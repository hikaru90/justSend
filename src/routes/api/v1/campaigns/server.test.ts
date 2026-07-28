import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../tests/helpers/db';
import {
	createTeamWithApiKey,
	createContactBook,
	createCampaign
} from '../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../tests/helpers/api';
import { GET, POST } from './+server';

const UNSUB_HTML = '<p>Hello</p><a href="{{justsend_unsubscribe_url}}">Unsubscribe</a>';

describe('GET /api/v1/campaigns', () => {
	beforeEach(() => resetDb());

	it('lists campaigns for the authenticated team', async () => {
		const { team, domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		const book = createContactBook(team.id);
		createCampaign(team.id, domain.id, { contactBookId: book.id, html: UNSUB_HTML });

		const event = buildApiEvent({
			method: 'GET',
			path: '/api/v1/campaigns',
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect((json as { data: unknown[] }).data).toHaveLength(1);
	});
});

describe('POST /api/v1/campaigns', () => {
	beforeEach(() => resetDb());

	it('creates a draft campaign', async () => {
		const { team, domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		const book = createContactBook(team.id);

		const event = buildApiEvent({
			method: 'POST',
			path: '/api/v1/campaigns',
			body: {
				name: 'Newsletter',
				from: 'noreply@mail.example.com',
				subject: 'Hello',
				html: UNSUB_HTML,
				contactBookId: book.id
			},
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ name: 'Newsletter', status: 'DRAFT' });
	});
});

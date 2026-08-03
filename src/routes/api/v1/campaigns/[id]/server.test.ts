import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../tests/helpers/db';
import {
	createTeamWithApiKey,
	createContactBook,
	createCampaign,
} from '../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../tests/helpers/api';
import { GET, DELETE } from './+server';

const UNSUB_HTML = '<p>Hello</p><a href="{{owlery_unsubscribe_url}}">Unsubscribe</a>';

describe('GET /api/v1/campaigns/[id]', () => {
	beforeEach(() => resetDb());

	it('returns a campaign by id', async () => {
		const { team, domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		const book = createContactBook(team.id);
		const campaign = createCampaign(team.id, domain.id, {
			name: 'Fetch',
			contactBookId: book.id,
			html: UNSUB_HTML,
		});

		const event = buildApiEvent({
			method: 'GET',
			path: `/api/v1/campaigns/${campaign.id}`,
			params: { id: campaign.id },
			headers: bearer(apiKey),
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ id: campaign.id, name: 'Fetch' });
	});
});

describe('DELETE /api/v1/campaigns/[id]', () => {
	beforeEach(() => resetDb());

	it('deletes a campaign', async () => {
		const { team, domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		const book = createContactBook(team.id);
		const campaign = createCampaign(team.id, domain.id, {
			contactBookId: book.id,
			html: UNSUB_HTML,
		});

		const event = buildApiEvent({
			method: 'DELETE',
			path: `/api/v1/campaigns/${campaign.id}`,
			params: { id: campaign.id },
			headers: bearer(apiKey),
		});
		const { status, json } = await invokeHandler(DELETE, event);

		expect(status).toBe(200);
		expect(json).toEqual({ ok: true });
	});
});

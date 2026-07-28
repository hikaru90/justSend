import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../../tests/helpers/db';
import {
	createTeamWithApiKey,
	createContactBook,
	createContact,
	createCampaign
} from '../../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../../tests/helpers/api';
import { POST } from './+server';

const UNSUB_HTML = '<p>Hello</p><a href="{{justsend_unsubscribe_url}}">Unsubscribe</a>';

describe('POST /api/v1/campaigns/[id]/schedule', () => {
	beforeEach(() => resetDb());

	it('schedules a draft campaign', async () => {
		const { team, domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		const book = createContactBook(team.id);
		createContact(book.id, { email: 'sub@example.com', subscribed: true });
		const campaign = createCampaign(team.id, domain.id, {
			from: 'noreply@mail.example.com',
			contactBookId: book.id,
			html: UNSUB_HTML
		});

		const event = buildApiEvent({
			method: 'POST',
			path: `/api/v1/campaigns/${campaign.id}/schedule`,
			params: { id: campaign.id },
			body: {},
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(200);
		expect(json).toEqual({ success: true });
	});
});

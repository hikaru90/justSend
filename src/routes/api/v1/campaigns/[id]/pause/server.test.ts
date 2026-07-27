import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../../tests/helpers/db';
import {
	createTeamWithApiKey,
	createContactBook,
	createContact,
	createCampaign
} from '../../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../../tests/helpers/api';
import { scheduleCampaign } from '$lib/server/service/campaign-service';
import { POST } from './+server';

const UNSUB_HTML = '<p>Hello</p><a href="{{usesend_unsubscribe_url}}">Unsubscribe</a>';

describe('POST /api/v1/campaigns/[id]/pause', () => {
	beforeEach(() => resetDb());

	it('pauses a scheduled campaign', async () => {
		const { team, domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		const book = createContactBook(team.id);
		createContact(book.id, { email: 'sub@example.com', subscribed: true });
		const campaign = createCampaign(team.id, domain.id, {
			from: 'noreply@mail.example.com',
			contactBookId: book.id,
			html: UNSUB_HTML
		});
		await scheduleCampaign({ campaignId: campaign.id, teamId: team.id });

		const event = buildApiEvent({
			method: 'POST',
			path: `/api/v1/campaigns/${campaign.id}/pause`,
			params: { id: campaign.id },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(200);
		expect(json).toEqual({ ok: true });
	});
});

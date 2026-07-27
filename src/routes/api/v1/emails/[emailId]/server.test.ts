import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../tests/helpers/db';
import {
	createTeamWithApiKey,
	createEmail,
	createSesSetting
} from '../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../tests/helpers/api';
import { POST as sendEmail } from '../+server';
import { GET, PATCH } from './+server';

describe('GET /api/v1/emails/[emailId]', () => {
	beforeEach(() => resetDb());

	it('returns an email by id', async () => {
		const { team, domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		const email = createEmail(team.id, {
			domainId: domain.id,
			from: 'noreply@mail.example.com',
			subject: 'Fetch me'
		});

		const event = buildApiEvent({
			method: 'GET',
			path: `/api/v1/emails/${email.id}`,
			params: { emailId: email.id },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ id: email.id, subject: 'Fetch me' });
	});
});

describe('PATCH /api/v1/emails/[emailId]', () => {
	beforeEach(() => resetDb());

	it('updates scheduledAt for a scheduled email', async () => {
		const { domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		createSesSetting({ region: domain.region });

		const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
		const created = await invokeHandler(
			sendEmail,
			buildApiEvent({
				method: 'POST',
				path: '/api/v1/emails',
				body: {
					to: 'a@b.com',
					from: 'noreply@mail.example.com',
					subject: 'Scheduled',
					text: 'Later',
					scheduledAt
				},
				headers: bearer(apiKey)
			})
		);
		const emailId = (created.json as { id: string }).id;
		const newScheduledAt = new Date(Date.now() + 7200_000).toISOString();

		const event = buildApiEvent({
			method: 'PATCH',
			path: `/api/v1/emails/${emailId}`,
			params: { emailId },
			body: { scheduledAt: newScheduledAt },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(PATCH, event);

		expect(status).toBe(200);
		expect(json).toEqual({ ok: true });
	});
});

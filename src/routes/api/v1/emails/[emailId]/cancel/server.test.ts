import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../../tests/helpers/db';
import { createTeamWithApiKey, createSesSetting } from '../../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../../tests/helpers/api';
import { POST as sendEmail } from '../../+server';
import { POST } from './+server';

describe('POST /api/v1/emails/[emailId]/cancel', () => {
	beforeEach(() => resetDb());

	it('cancels a scheduled email', async () => {
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
					subject: 'Cancel me',
					text: 'Later',
					scheduledAt,
				},
				headers: bearer(apiKey),
			}),
		);
		const emailId = (created.json as { id: string }).id;

		const event = buildApiEvent({
			method: 'POST',
			path: `/api/v1/emails/${emailId}/cancel`,
			params: { emailId },
			headers: bearer(apiKey),
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(200);
		expect(json).toEqual({ ok: true });
	});
});

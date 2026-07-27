import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../tests/helpers/db';
import { createTeamWithApiKey, createSesSetting } from '../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../tests/helpers/api';
import { POST } from './+server';

describe('POST /api/v1/emails/batch', () => {
	beforeEach(() => resetDb());

	it('sends multiple emails in one request', async () => {
		const { domain, apiKey } = await createTeamWithApiKey({ domainName: 'mail.example.com' });
		createSesSetting({ region: domain.region });

		const event = buildApiEvent({
			method: 'POST',
			path: '/api/v1/emails/batch',
			body: {
				emails: [
					{
						to: 'one@example.com',
						from: 'noreply@mail.example.com',
						subject: 'One',
						text: 'First'
					},
					{
						to: 'two@example.com',
						from: 'noreply@mail.example.com',
						subject: 'Two',
						text: 'Second'
					}
				]
			},
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(200);
		const data = (json as { data: Array<{ id?: string; status?: string }> }).data;
		expect(data).toHaveLength(2);
		expect(data[0].status).toBe('QUEUED');
		expect(data[1].status).toBe('QUEUED');
	});
});

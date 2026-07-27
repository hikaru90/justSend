import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '../../../../tests/helpers/db';
import {
	createTeamWithApiKey,
	createDomain,
	createSesSetting
} from '../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../tests/helpers/api';
import { GET, POST } from './+server';

vi.mock('$lib/server/aws/ses', () => ({
	addDomain: vi.fn(async () => 'pubkey'),
	deleteDomain: vi.fn(async () => true),
	getDomainIdentity: vi.fn(async () => ({
		VerificationStatus: 'SUCCESS',
		DkimAttributes: { Status: 'SUCCESS', Tokens: [] },
		MailFromAttributes: { MailFromDomainStatus: 'SUCCESS' }
	}))
}));

describe('GET /api/v1/domains', () => {
	beforeEach(() => resetDb());

	it('lists domains for the authenticated team', async () => {
		const { team, apiKey } = await createTeamWithApiKey({ domainName: 'existing.example.com' });
		createDomain(team.id, { name: 'other.example.com' });

		const event = buildApiEvent({
			method: 'GET',
			path: '/api/v1/domains',
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect((json as { data: unknown[] }).data).toHaveLength(2);
	});
});

describe('POST /api/v1/domains', () => {
	beforeEach(() => {
		resetDb();
		vi.clearAllMocks();
	});

	it('creates a domain when SES settings exist', async () => {
		const { apiKey } = await createTeamWithApiKey();
		createSesSetting({ region: 'us-east-1' });

		const event = buildApiEvent({
			method: 'POST',
			path: '/api/v1/domains',
			body: { name: 'new.example.com' },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ name: 'new.example.com' });
	});
});

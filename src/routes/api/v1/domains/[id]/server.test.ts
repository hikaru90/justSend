import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '../../../../../tests/helpers/db';
import { createTeamWithApiKey, createDomain } from '../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../tests/helpers/api';
import { GET, DELETE } from './+server';

vi.mock('$lib/server/aws/ses', () => ({
	addDomain: vi.fn(async () => 'pubkey'),
	deleteDomain: vi.fn(async () => true),
	getDomainIdentity: vi.fn(async () => ({
		VerificationStatus: 'SUCCESS',
		DkimAttributes: { Status: 'SUCCESS', Tokens: [] },
		MailFromAttributes: { MailFromDomainStatus: 'SUCCESS' }
	}))
}));

describe('GET /api/v1/domains/[id]', () => {
	beforeEach(() => resetDb());

	it('returns a domain by id', async () => {
		const { domain, apiKey } = await createTeamWithApiKey({ domainName: 'get.example.com' });

		const event = buildApiEvent({
			method: 'GET',
			path: `/api/v1/domains/${domain.id}`,
			params: { id: String(domain.id) },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({ id: domain.id, name: 'get.example.com' });
	});
});

describe('DELETE /api/v1/domains/[id]', () => {
	beforeEach(() => {
		resetDb();
		vi.clearAllMocks();
	});

	it('deletes a domain', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const domain = createDomain(team.id, { name: 'delete.example.com' });

		const event = buildApiEvent({
			method: 'DELETE',
			path: `/api/v1/domains/${domain.id}`,
			params: { id: String(domain.id) },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(DELETE, event);

		expect(status).toBe(200);
		expect(json).toEqual({ ok: true });
	});
});

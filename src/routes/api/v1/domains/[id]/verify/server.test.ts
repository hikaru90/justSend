import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '../../../../../../tests/helpers/db';
import { createTeamWithApiKey } from '../../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../../tests/helpers/api';
import { POST } from './+server';

vi.mock('$lib/server/aws/ses', () => ({
	addDomain: vi.fn(async () => 'pubkey'),
	deleteDomain: vi.fn(async () => true),
	getDomainIdentity: vi.fn(async () => ({
		VerificationStatus: 'SUCCESS',
		DkimAttributes: { Status: 'SUCCESS', Tokens: [] },
		MailFromAttributes: { MailFromDomainStatus: 'SUCCESS' }
	}))
}));

describe('POST /api/v1/domains/[id]/verify', () => {
	beforeEach(() => {
		resetDb();
		vi.clearAllMocks();
	});

	it('refreshes domain verification status', async () => {
		const { domain, apiKey } = await createTeamWithApiKey({ domainName: 'verify.example.com' });

		const event = buildApiEvent({
			method: 'POST',
			path: `/api/v1/domains/${domain.id}/verify`,
			params: { id: String(domain.id) },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(POST, event);

		expect(status).toBe(200);
		expect(json).toBeTruthy();
	});
});

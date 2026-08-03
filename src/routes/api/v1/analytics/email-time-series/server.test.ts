import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../tests/helpers/db';
import { createTeamWithApiKey, createDailyUsage } from '../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../tests/helpers/api';
import { GET } from './+server';

describe('GET /api/v1/analytics/email-time-series', () => {
	beforeEach(() => resetDb());

	it('returns email time-series data', async () => {
		const { team, domain, apiKey } = await createTeamWithApiKey();
		createDailyUsage(team.id, domain.id, { sent: 5, delivered: 4 });

		const event = buildApiEvent({
			method: 'GET',
			path: '/api/v1/analytics/email-time-series',
			urlSearchParams: { days: '7', domainId: String(domain.id) },
			headers: bearer(apiKey),
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({
			result: expect.any(Array),
			totalCounts: expect.objectContaining({ sent: 5, delivered: 4 }),
		});
	});
});

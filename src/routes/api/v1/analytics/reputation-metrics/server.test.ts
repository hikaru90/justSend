import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../../../tests/helpers/db';
import {
	createTeamWithApiKey,
	createCumulatedMetrics
} from '../../../../../tests/helpers/factories';
import { buildApiEvent, bearer, invokeHandler } from '../../../../../tests/helpers/api';
import { GET } from './+server';

describe('GET /api/v1/analytics/reputation-metrics', () => {
	beforeEach(() => resetDb());

	it('returns reputation metrics', async () => {
		const { team, domain, apiKey } = await createTeamWithApiKey();
		createCumulatedMetrics(team.id, domain.id, { delivered: 200, hardBounced: 2, complained: 1 });

		const event = buildApiEvent({
			method: 'GET',
			path: '/api/v1/analytics/reputation-metrics',
			urlSearchParams: { domainId: String(domain.id) },
			headers: bearer(apiKey)
		});
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect(json).toMatchObject({
			delivered: 200,
			hardBounced: 2,
			complained: 1
		});
	});
});

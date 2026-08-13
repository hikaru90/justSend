import { describe, it, expect } from 'vitest';
import { buildApiEvent, invokeHandler } from '../../../tests/helpers/api';
import { GET } from './+server';

describe('GET /api/health', () => {
	it('returns ok status', async () => {
		const event = buildApiEvent({ method: 'GET', path: '/api/health' });
		const { status, json } = await invokeHandler(GET, event);

		expect(status).toBe(200);
		expect(json).toEqual({ status: 'ok' });
	});
});

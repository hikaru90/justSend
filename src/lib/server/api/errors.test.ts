import { describe, it, expect } from 'vitest';
import { jsonError, jsonErrorFromException } from './errors';

describe('jsonError', () => {
	it('returns the expected error shape', async () => {
		const response = jsonError(422, 'Unprocessable', 'UNPROCESSABLE');
		expect(response.status).toBe(422);

		const body = await response.json();
		expect(body).toEqual({
			error: { message: 'Unprocessable', code: 'UNPROCESSABLE' },
		});
	});
});

describe('jsonErrorFromException', () => {
	it('maps not-found messages to 404', async () => {
		const response = jsonErrorFromException(new Error('Campaign not found'));
		expect(response.status).toBe(404);
		const body = await response.json();
		expect(body.error.message).toBe('Campaign not found');
	});

	it('maps other errors to 400 by default', async () => {
		const response = jsonErrorFromException(new Error('Invalid input'));
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error.message).toBe('Invalid input');
	});
});

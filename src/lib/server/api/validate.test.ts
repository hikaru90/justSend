import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseBody } from './validate';

const schema = z.object({ name: z.string() });

async function tryParseBody(body: unknown) {
	const request = new Request('http://localhost', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});

	try {
		const data = await parseBody(request, schema);
		return { ok: true as const, data };
	} catch (err) {
		const response = err as Response;
		return { ok: false as const, status: response.status, json: await response.json() };
	}
}

describe('parseBody', () => {
	it('parses a valid JSON body', async () => {
		const result = await tryParseBody({ name: 'Acme' });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toEqual({ name: 'Acme' });
		}
	});

	it('returns 400 for invalid JSON', async () => {
		const result = await tryParseBody('{ not-json');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(400);
			expect(result.json).toMatchObject({
				error: { message: 'Invalid JSON body', code: 'BAD_REQUEST' }
			});
		}
	});

	it('returns 400 with validation details for schema failures', async () => {
		const result = await tryParseBody({});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(400);
			expect(result.json).toMatchObject({
				error: { message: 'Validation failed', code: 'VALIDATION_ERROR' }
			});
		}
	});
});

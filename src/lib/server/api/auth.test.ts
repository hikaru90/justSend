import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetDb } from '../../../tests/helpers/db';
import { createTeamWithApiKey } from '../../../tests/helpers/factories';
import { requireApiTeam } from './auth';
import { db } from '../db';
import { apiKeys } from '../db/schema';

describe('requireApiTeam', () => {
	beforeEach(() => resetDb());

	it('returns 401 when Authorization header is missing', async () => {
		const request = new Request('http://localhost/api/v1/test');
		await expect(requireApiTeam(request)).rejects.toMatchObject({ status: 401 });
	});

	it('returns 401 for non-Bearer authorization', async () => {
		const request = new Request('http://localhost/api/v1/test', {
			headers: { authorization: 'Basic abc123' }
		});
		await expect(requireApiTeam(request)).rejects.toMatchObject({ status: 401 });
	});

	it('returns 401 for an invalid API key', async () => {
		const request = new Request('http://localhost/api/v1/test', {
			headers: { authorization: 'Bearer us_unknownid_0123456789abcdef0123456789abcdef' }
		});
		await expect(requireApiTeam(request)).rejects.toMatchObject({ status: 401 });
	});

	it('returns team context and updates lastUsed for a valid key', async () => {
		const { team, apiKey } = await createTeamWithApiKey();
		const keyBefore = db.select().from(apiKeys).where(eq(apiKeys.teamId, team.id)).get();
		expect(keyBefore!.lastUsed).toBeNull();

		const request = new Request('http://localhost/api/v1/test', {
			headers: { authorization: `Bearer ${apiKey}` }
		});
		const ctx = await requireApiTeam(request);

		expect(ctx.team.id).toBe(team.id);
		expect(ctx.apiKeyId).toBe(keyBefore!.id);

		const keyAfter = db.select().from(apiKeys).where(eq(apiKeys.id, ctx.apiKeyId)).get();
		expect(keyAfter!.lastUsed).not.toBeNull();
	});
});

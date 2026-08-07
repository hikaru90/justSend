import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { teams } from '../db/schema';
import { encryptSecret } from '../crypto';
import { env } from '../env';
import { resetPiRuntimeCache } from './pi-service';
import {
	clearTeamOpenRouterKey,
	getTeamOpenRouterKey,
	resolveOpenRouterApiKey,
	teamHasOpenRouterKey,
} from './team-openrouter-key-service';

describe('team-openrouter-key-service', () => {
	const createdTeamIds: number[] = [];

	afterEach(() => {
		for (const id of createdTeamIds.splice(0)) {
			db.delete(teams).where(eq(teams.id, id)).run();
		}
		resetPiRuntimeCache();
	});

	function createTeam(name: string, openrouterApiKey?: string | null) {
		const row = db
			.insert(teams)
			.values({
				name,
				openrouterApiKey: openrouterApiKey ?? null,
			})
			.returning()
			.get();
		createdTeamIds.push(row.id);
		return row;
	}

	it('detects stored BYOK keys', () => {
		const team = createTeam('BYOK team', encryptSecret('sk-or-test-key', env.AUTH_SECRET));
		expect(teamHasOpenRouterKey(team.id)).toBe(true);
		expect(getTeamOpenRouterKey(team.id)).toBe('sk-or-test-key');
	});

	it('prefers team key over platform key when resolving', () => {
		const team = createTeam('BYOK team', 'sk-or-team-key');
		const resolved = resolveOpenRouterApiKey(team.id);
		expect(resolved).toBe('sk-or-team-key');
	});

	it('clears BYOK key so platform credits are used', () => {
		const team = createTeam('BYOK team', 'sk-or-team-key');
		expect(clearTeamOpenRouterKey(team.id)).toBe(true);
		expect(teamHasOpenRouterKey(team.id)).toBe(false);
		expect(getTeamOpenRouterKey(team.id)).toBeNull();
		expect(resolveOpenRouterApiKey(team.id)).toBe(env.OPENROUTER_API_KEY?.trim() || null);
	});
});

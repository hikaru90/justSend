import { eq } from 'drizzle-orm';
import { db } from '../db';
import { teams } from '../db/schema';
import { decryptSecret } from '../crypto';
import { env } from '../env';

function decodeStoredTeamOpenRouterKey(stored: string | null | undefined): string | null {
	const trimmed = stored?.trim();
	if (!trimmed) return null;

	const decrypted = decryptSecret(trimmed, env.AUTH_SECRET);
	if (decrypted?.trim()) return decrypted.trim();

	// Legacy rows may store the key in plaintext.
	return trimmed;
}

/** True when the team has a BYOK OpenRouter key saved (regardless of platform key). */
export function teamHasOpenRouterKey(teamId: number): boolean {
	const row = db
		.select({ openrouterApiKey: teams.openrouterApiKey })
		.from(teams)
		.where(eq(teams.id, teamId))
		.get();
	return Boolean(row?.openrouterApiKey?.trim());
}

/** Return the team's BYOK OpenRouter key, or null when unset. */
export function getTeamOpenRouterKey(teamId: number): string | null {
	const row = db
		.select({ openrouterApiKey: teams.openrouterApiKey })
		.from(teams)
		.where(eq(teams.id, teamId))
		.get();
	return decodeStoredTeamOpenRouterKey(row?.openrouterApiKey);
}

/** Remove a team's BYOK key so AI requests use platform credits. */
export function clearTeamOpenRouterKey(teamId: number): boolean {
	const hadKey = teamHasOpenRouterKey(teamId);
	if (!hadKey) return false;

	db.update(teams)
		.set({ openrouterApiKey: null, updatedAt: new Date().toISOString() })
		.where(eq(teams.id, teamId))
		.run();

	return true;
}

/**
 * Resolve the OpenRouter key for AI calls: team BYOK wins, else platform credits.
 * Returns null when neither is configured.
 */
export function resolveOpenRouterApiKey(teamId?: number | null): string | null {
	if (teamId != null) {
		const teamKey = getTeamOpenRouterKey(teamId);
		if (teamKey) return teamKey;
	}
	const platformKey = env.OPENROUTER_API_KEY?.trim();
	return platformKey || null;
}

/** Mask a key for display, e.g. sk-or-…abc */
export function maskOpenRouterApiKey(key: string): string {
	const trimmed = key.trim();
	if (trimmed.length <= 10) return '••••••••';
	return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

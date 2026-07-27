import { error } from '@sveltejs/kit';
import { getTeamAndApiKey } from '../service/api-service';
import { nowIso } from '$lib/utils';
import { db } from '../db';
import { apiKeys, teams } from '../db/schema';
import { eq } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

export type ApiAuthContext = {
	team: typeof teams.$inferSelect;
	apiKey: NonNullable<Awaited<ReturnType<typeof getTeamAndApiKey>>>['apiKey'];
	apiKeyId: number;
};

export async function requireApiTeam(request: Request): Promise<ApiAuthContext> {
	const header = request.headers.get('authorization') ?? '';
	const match = header.match(/^Bearer\s+(.+)$/i);
	if (!match?.[1]) {
		throw error(401, 'Missing or invalid Authorization header');
	}

	const result = await getTeamAndApiKey(match[1].trim());
	if (!result?.team || !result.apiKey) {
		throw error(401, 'Invalid API key');
	}

	db.update(apiKeys)
		.set({ lastUsed: nowIso(), updatedAt: nowIso() })
		.where(eq(apiKeys.id, result.apiKey.id))
		.run();

	return {
		team: result.team,
		apiKey: result.apiKey,
		apiKeyId: result.apiKey.id
	};
}

export function jsonError(status: number, message: string, code?: string) {
	return json({ error: { message, code: code ?? 'ERROR' } }, { status });
}

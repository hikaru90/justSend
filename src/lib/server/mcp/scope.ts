import { getTeamAndApiKey } from '../service/api-service';
import type { McpScope } from './handlers';

export async function resolveScopeFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): Promise<McpScope> {
	const apiKey = env.OWLERY_API_KEY?.trim();
	if (!apiKey) {
		throw new Error('OWLERY_API_KEY is required');
	}

	const result = await getTeamAndApiKey(apiKey);
	if (!result?.team || !result.apiKey) {
		throw new Error('Invalid OWLERY_API_KEY');
	}

	const envDomain = env.OWLERY_DOMAIN_ID?.trim();
	let domainId: number | undefined;
	if (envDomain) {
		const parsed = Number(envDomain);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			throw new Error('OWLERY_DOMAIN_ID must be a positive integer');
		}
		domainId = parsed;
	} else if (result.apiKey.domainId != null) {
		domainId = result.apiKey.domainId;
	}

	return { teamId: result.team.id, domainId };
}

export function scopeFromApiAuth(auth: {
	team: { id: number };
	apiKey: { domainId: number | null };
}): McpScope {
	return {
		teamId: auth.team.id,
		domainId: auth.apiKey.domainId ?? undefined,
	};
}

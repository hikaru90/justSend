import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiTeam } from '$lib/server/api/auth';
import { getReputationMetrics } from '$lib/server/service/dashboard-service';

export const GET: RequestHandler = async ({ request, url }) => {
	const { team, apiKey } = await requireApiTeam(request);

	const domainIdParam = url.searchParams.get('domainId');
	const domainId = apiKey.domainId ?? (domainIdParam ? Number(domainIdParam) : undefined);

	const data = getReputationMetrics({
		teamId: team.id,
		domainId: domainId && Number.isFinite(domainId) ? domainId : undefined,
	});

	return json(data);
};

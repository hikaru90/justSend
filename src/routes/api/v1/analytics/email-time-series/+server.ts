import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiTeam } from '$lib/server/api/auth';
import { getEmailTimeSeries } from '$lib/server/service/dashboard-service';

export const GET: RequestHandler = async ({ request, url }) => {
	const { team, apiKey } = await requireApiTeam(request);

	const daysParam = url.searchParams.get('days');
	const domainIdParam = url.searchParams.get('domainId');
	const days = daysParam === '7' ? 7 : daysParam === '30' ? 30 : undefined;
	const domainId =
		apiKey.domainId ?? (domainIdParam ? Number(domainIdParam) : undefined);

	const data = getEmailTimeSeries({
		teamId: team.id,
		days,
		domainId: domainId && Number.isFinite(domainId) ? domainId : undefined
	});

	return json(data);
};

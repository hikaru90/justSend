import { getEmailTimeSeries, getReputationMetrics } from '$lib/server/service/dashboard-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	const timeSeries = getEmailTimeSeries({ teamId, days: 30 });
	const reputation = getReputationMetrics({ teamId });

	return { timeSeries, reputation };
};

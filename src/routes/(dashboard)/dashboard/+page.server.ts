import { getEmailTimeSeries, getReputationMetrics } from '$lib/server/service/dashboard-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = locals.domainId;
	if (!domainId) {
		return {
			needsDomain: true as const,
			timeSeries: {
				result: [],
				totalCounts: {
					sent: 0,
					delivered: 0,
					opened: 0,
					clicked: 0,
					bounced: 0,
					complained: 0
				}
			},
			reputation: {
				delivered: 0,
				hardBounced: 0,
				complained: 0,
				bounceRate: 0,
				complaintRate: 0
			}
		};
	}

	const timeSeries = getEmailTimeSeries({ teamId, domainId, days: 30 });
	const reputation = getReputationMetrics({ teamId, domainId });

	return { needsDomain: false as const, timeSeries, reputation };
};

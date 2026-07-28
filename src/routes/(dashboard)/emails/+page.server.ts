import { listEmails } from '$lib/server/service/email-service';
import { getWorkerStatus } from '$lib/server/service/worker-status-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const cursor = url.searchParams.get('cursor') ?? undefined;
	const emails = listEmails({ teamId, cursor, limit: 30 });
	return {
		...emails,
		worker: getWorkerStatus()
	};
};

import { listEmails } from '$lib/server/service/email-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const cursor = url.searchParams.get('cursor') ?? undefined;
	return listEmails({ teamId, cursor, limit: 30 });
};

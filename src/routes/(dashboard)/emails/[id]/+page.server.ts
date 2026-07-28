import { error } from '@sveltejs/kit';
import { getEmail } from '$lib/server/service/email-service';
import { requireDomainId, requireTeamId } from '$lib/server/dashboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = requireDomainId(locals.domainId);
	try {
		return { email: getEmail(params.id, teamId, domainId) };
	} catch {
		error(404, 'Email not found');
	}
};

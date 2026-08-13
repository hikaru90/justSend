import { fail } from '@sveltejs/kit';
import { updateTeam } from '$lib/server/service/team-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	return { team: locals.team };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Name required' });
		updateTeam(teamId, { name });
	},
};

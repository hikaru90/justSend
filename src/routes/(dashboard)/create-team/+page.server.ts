import { fail, redirect } from '@sveltejs/kit';
import { createTeam } from '$lib/server/service/team-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const data = await parent();
	if (data.team) {
		redirect(302, '/dashboard');
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) redirect(302, '/login');

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { teamError: 'Team name is required' });

		try {
			await createTeam(locals.user.id, name);
		} catch (e) {
			return fail(400, { teamError: e instanceof Error ? e.message : 'Failed to create team' });
		}

		redirect(302, '/dashboard');
	},
};

import { fail } from '@sveltejs/kit';
import {
	getSuppressionList,
	addSuppression,
	removeSuppression
} from '$lib/server/service/suppression-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const page = Number(url.searchParams.get('page') ?? '1');
	const search = url.searchParams.get('search') ?? undefined;
	return getSuppressionList({ teamId, page, search, limit: 30 });
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		if (!email) return fail(400, { error: 'Email required' });
		await addSuppression({ teamId, email, reason: 'MANUAL', source: 'dashboard' });
	},
	remove: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const email = String((await request.formData()).get('email') ?? '').trim();
		if (email) await removeSuppression(email, teamId);
	}
};

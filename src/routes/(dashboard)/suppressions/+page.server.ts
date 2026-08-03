import { fail } from '@sveltejs/kit';
import {
	getSuppressionList,
	addSuppression,
	removeSuppression,
} from '$lib/server/service/suppression-service';
import { requireDomainId, requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const teamId = requireTeamId(locals.teamId);
	if (!locals.domainId) {
		return { needsDomain: true as const, suppressions: [], total: 0 };
	}
	const page = Number(url.searchParams.get('page') ?? '1');
	const search = url.searchParams.get('search') ?? undefined;
	const result = await getSuppressionList({
		teamId,
		domainId: locals.domainId,
		page,
		search,
		limit: 30,
	});
	return { needsDomain: false as const, ...result };
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = requireDomainId(locals.domainId);
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		if (!email) return fail(400, { error: 'Email required' });
		await addSuppression({ teamId, domainId, email, reason: 'MANUAL', source: 'dashboard' });
	},
	remove: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		const email = String((await request.formData()).get('email') ?? '').trim();
		if (email) await removeSuppression(email, teamId);
	},
};

import { fail, redirect } from '@sveltejs/kit';
import { requireDomainId, requireTeamId } from '$lib/server/dashboard';
import { createFlow, deleteFlow, listFlows } from '$lib/server/service/flow-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	if (!locals.domainId) {
		return { needsDomain: true as const, flows: [] };
	}
	return {
		needsDomain: false as const,
		flows: listFlows(teamId, locals.domainId),
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = requireDomainId(locals.domainId);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim() || 'Untitled flow';

		try {
			const flow = createFlow({ teamId, domainId, name });
			redirect(302, `/flows/${flow.id}`);
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e) throw e;
			return fail(400, { error: e instanceof Error ? e.message : 'Create failed' });
		}
	},
	delete: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { error: 'Missing id' });
		try {
			deleteFlow(id, teamId, domainId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
	},
};

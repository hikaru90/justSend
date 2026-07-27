import { error, fail, redirect } from '@sveltejs/kit';
import { getDomain, refreshDomainVerification, deleteDomain, updateDomain } from '$lib/server/service/domain-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const teamId = requireTeamId(locals.teamId);
	const id = Number(params.id);
	if (!Number.isFinite(id)) error(404, 'Not found');

	try {
		return { domain: await getDomain(id, teamId) };
	} catch {
		error(404, 'Domain not found');
	}
};

export const actions: Actions = {
	verify: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const id = Number(params.id);
		try {
			await refreshDomainVerification(id);
			return { verified: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Verification failed' });
		}
	},
	delete: async ({ locals, params }) => {
		requireTeamId(locals.teamId);
		const id = Number(params.id);
		try {
			await deleteDomain(id);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
		redirect(302, '/domains');
	},
	updateTracking: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const id = Number(params.id);
		const form = await request.formData();
		try {
			await updateDomain(id, {
				clickTracking: form.get('clickTracking') === 'on',
				openTracking: form.get('openTracking') === 'on'
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
	}
};

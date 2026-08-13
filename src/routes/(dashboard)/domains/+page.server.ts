import { fail } from '@sveltejs/kit';
import { getDomains, createDomain } from '$lib/server/service/domain-service';
import { getAllSettings } from '$lib/server/service/ses-settings-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	const domains = await getDomains(teamId);
	const regions = getAllSettings().map((s) => s.region);
	return { domains, regions };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const region = String(form.get('region') ?? '').trim();

		if (!name || !region) return fail(400, { error: 'Name and region are required' });

		try {
			await createDomain(teamId, name, region);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to create domain' });
		}

		return { success: true };
	},
};

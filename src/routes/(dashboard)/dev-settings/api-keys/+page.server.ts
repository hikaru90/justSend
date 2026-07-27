import { fail } from '@sveltejs/kit';
import { addApiKey, listApiKeys, deleteApiKey } from '$lib/server/service/api-service';
import { getDomains } from '$lib/server/service/domain-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	return {
		keys: await listApiKeys(teamId),
		domains: await getDomains(teamId)
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const permission = String(form.get('permission') ?? 'FULL') as 'FULL' | 'SENDING';
		const domainRaw = String(form.get('domainId') ?? '').trim();
		const domainId = domainRaw ? Number(domainRaw) : undefined;
		if (!name) return fail(400, { error: 'Name required' });
		try {
			const key = await addApiKey({ name, permission, teamId, domainId });
			return { newKey: key };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed' });
		}
	},
	delete: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const id = Number((await request.formData()).get('id'));
		const keys = await listApiKeys(teamId);
		if (keys.some((k) => k.id === id)) {
			await deleteApiKey(id);
		}
	}
};

import { fail } from '@sveltejs/kit';
import { addApiKey, listApiKeys, deleteApiKey } from '$lib/server/service/api-service';
import { getDomains } from '$lib/server/service/domain-service';
import { requireDomainId, requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	if (!locals.domainId) {
		return { needsDomain: true as const, keys: [], domains: [] };
	}
	return {
		needsDomain: false as const,
		keys: await listApiKeys(teamId, locals.domainId),
		domains: await getDomains(teamId),
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const selectedDomainId = requireDomainId(locals.domainId);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const permission = String(form.get('permission') ?? 'FULL') as 'FULL' | 'SENDING';
		const domainRaw = String(form.get('domainId') ?? '').trim();
		const domainId = domainRaw ? Number(domainRaw) : selectedDomainId;
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
		const domainId = requireDomainId(locals.domainId);
		const id = Number((await request.formData()).get('id'));
		const keys = await listApiKeys(teamId, domainId);
		if (keys.some((k) => k.id === id)) {
			await deleteApiKey(id);
		}
	},
};

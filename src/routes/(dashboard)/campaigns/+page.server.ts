import { fail } from '@sveltejs/kit';
import { listCampaigns, createCampaign } from '$lib/server/service/campaign-service';
import { getContactBooks } from '$lib/server/service/contact-book-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const cursor = url.searchParams.get('cursor') ?? undefined;
	return {
		...listCampaigns(teamId, { cursor }),
		books: getContactBooks(teamId)
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const from = String(form.get('from') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();
		const contactBookId = String(form.get('contactBookId') ?? '').trim() || undefined;

		if (!name || !from || !subject) return fail(400, { error: 'Name, from, and subject required' });

		try {
			const campaign = await createCampaign({ teamId, name, from, subject, contactBookId });
			return { created: campaign.id };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed' });
		}
	}
};

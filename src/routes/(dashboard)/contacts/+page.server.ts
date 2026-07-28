import { fail } from '@sveltejs/kit';
import { getContactBooks, createContactBook } from '$lib/server/service/contact-book-service';
import { requireDomainId, requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	if (!locals.domainId) {
		return { needsDomain: true as const, books: [] };
	}
	return {
		needsDomain: false as const,
		books: getContactBooks(teamId, { domainId: locals.domainId })
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = requireDomainId(locals.domainId);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Name required' });
		createContactBook(teamId, name, undefined, domainId);
		return { success: true };
	}
};

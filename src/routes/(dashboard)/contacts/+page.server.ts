import { fail } from '@sveltejs/kit';
import { getContactBooks, createContactBook } from '$lib/server/service/contact-book-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	return { books: getContactBooks(teamId) };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Name required' });
		createContactBook(teamId, name);
		return { success: true };
	}
};

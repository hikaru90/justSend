import { error, fail } from '@sveltejs/kit';
import { getContactBook } from '$lib/server/service/contact-book-service';
import { listContacts, addOrUpdateContact } from '$lib/server/service/contact-service';
import { requireDomainId, requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = requireDomainId(locals.domainId);
	try {
		const book = getContactBook(params.id, teamId, domainId);
		const cursor = url.searchParams.get('cursor') ?? undefined;
		const contacts = listContacts({ contactBookId: params.id, cursor, limit: 50 });
		return { book, contacts };
	} catch {
		error(404, 'Not found');
	}
};

export const actions: Actions = {
	add: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		if (!email) return fail(400, { error: 'Email required' });
		try {
			await addOrUpdateContact(params.id, { email }, teamId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed' });
		}
	},
};

import { fail } from '@sveltejs/kit';
import {
	getContactBooks,
	createContactBook,
	updateContactBook,
	deleteContactBook,
	duplicateContactBook,
} from '$lib/server/service/contact-book-service';
import { requireDomainId, requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	if (!locals.domainId) {
		return { needsDomain: true as const, books: [] };
	}
	return {
		needsDomain: false as const,
		books: getContactBooks(teamId, { domainId: locals.domainId }),
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
	},
	rename: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		if (!id || !name) return fail(400, { error: 'Name required' });
		try {
			await updateContactBook(id, teamId, { name });
			return { renamed: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Rename failed' });
		}
	},
	duplicate: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Book required' });
		try {
			duplicateContactBook(id, teamId);
			return { duplicated: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Duplicate failed' });
		}
	},
	delete: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Book required' });
		try {
			deleteContactBook(id, teamId);
			return { deleted: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
	},
};

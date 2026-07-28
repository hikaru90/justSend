import { error, fail } from '@sveltejs/kit';
import { getContactBook, updateContactBook } from '$lib/server/service/contact-book-service';
import { requireDomainId, requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = requireDomainId(locals.domainId);
	try {
		return { book: getContactBook(params.id, teamId, domainId) };
	} catch {
		error(404, 'Not found');
	}
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		const form = await request.formData();
		try {
			await updateContactBook(params.id, teamId, {
				doubleOptInEnabled: form.get('doubleOptInEnabled') === 'on',
				doubleOptInFrom: String(form.get('doubleOptInFrom') ?? '') || null,
				doubleOptInSubject: String(form.get('doubleOptInSubject') ?? ''),
				doubleOptInContent: String(form.get('doubleOptInContent') ?? '')
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
	}
};

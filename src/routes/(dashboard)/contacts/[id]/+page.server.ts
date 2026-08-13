import { error, fail } from '@sveltejs/kit';
import { getContactBook } from '$lib/server/service/contact-book-service';
import {
	listContacts,
	addOrUpdateContact,
	deleteContactInContactBook,
} from '$lib/server/service/contact-service';
import { sendDoubleOptInConfirmationEmail } from '$lib/server/service/double-opt-in-service';
import { requireDomainId, requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = requireDomainId(locals.domainId);
	try {
		const book = getContactBook(params.id, teamId, domainId);
		// Load a large page for client-side filtering of the table.
		const contacts = listContacts({ contactBookId: params.id, limit: 500 });
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
			const result = await addOrUpdateContact(params.id, { email }, teamId);
			return { added: true, doiSent: result.doiSent ?? false, doiError: result.doiError ?? null };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed' });
		}
	},
	delete: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		const form = await request.formData();
		const contactId = String(form.get('contactId') ?? '').trim();
		if (!contactId) return fail(400, { error: 'Contact required' });
		try {
			const deleted = await deleteContactInContactBook(contactId, params.id, teamId);
			if (!deleted) return fail(404, { error: 'Contact not found' });
			return { deleted: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
	},
	resendConfirmation: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		const form = await request.formData();
		const contactId = String(form.get('contactId') ?? '').trim();
		if (!contactId) return fail(400, { error: 'Contact required' });
		try {
			const result = await sendDoubleOptInConfirmationEmail({
				contactId,
				contactBookId: params.id,
				teamId,
			});
			if (!result.sent) {
				return fail(400, { error: result.reason ?? 'Confirmation email was not sent' });
			}
			return { resent: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Resend failed' });
		}
	},
};

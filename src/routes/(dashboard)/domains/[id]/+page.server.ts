import { error, fail, redirect } from '@sveltejs/kit';
import { getDomain, refreshDomainVerification, deleteDomain, updateDomain } from '$lib/server/service/domain-service';
import { sendEmail } from '$lib/server/service/email-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const teamId = requireTeamId(locals.teamId);
	const id = Number(params.id);
	if (!Number.isFinite(id)) error(404, 'Not found');

	try {
		return {
			domain: await getDomain(id, teamId),
			userEmail: locals.user?.email ?? null
		};
	} catch {
		error(404, 'Domain not found');
	}
};

export const actions: Actions = {
	verify: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const id = Number(params.id);
		try {
			await refreshDomainVerification(id);
			return { verified: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Verification failed' });
		}
	},
	delete: async ({ locals, params }) => {
		requireTeamId(locals.teamId);
		const id = Number(params.id);
		try {
			await deleteDomain(id);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
		redirect(302, '/domains');
	},
	updateTracking: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const id = Number(params.id);
		const form = await request.formData();
		try {
			await updateDomain(id, {
				clickTracking: form.get('clickTracking') === 'on',
				openTracking: form.get('openTracking') === 'on'
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
	},
	sendTest: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const id = Number(params.id);
		const form = await request.formData();
		const to = String(form.get('to') ?? '').trim();

		if (!to) {
			return fail(400, { error: 'Recipient email is required' });
		}

		try {
			const domain = await getDomain(id, teamId);
			if (domain.status !== 'SUCCESS') {
				return fail(400, { error: 'Domain must be verified before sending' });
			}

			const from = `test@${domain.name}`;
			const email = await sendEmail({
				teamId,
				from,
				to,
				subject: `Owlery test — ${domain.name}`,
				text: `This is a test email from Owlery for ${domain.name} (${domain.region}).`,
				html: `<p>This is a test email from Owlery for <strong>${domain.name}</strong> (${domain.region}).</p>`
			});

			if (email.latestStatus === 'SUPPRESSED') {
				return fail(400, {
					error: 'Recipient is on the suppression list',
					emailId: email.id
				});
			}

			return { sent: true, emailId: email.id };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Send failed' });
		}
	}
};

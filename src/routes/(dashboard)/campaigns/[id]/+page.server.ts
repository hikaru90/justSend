import { error, fail, redirect } from '@sveltejs/kit';
import {
	getCampaign,
	updateCampaign,
	scheduleCampaign,
	pauseCampaign,
	resumeCampaign,
	deleteCampaign
} from '$lib/server/service/campaign-service';
import { getContactBooks } from '$lib/server/service/contact-book-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const teamId = requireTeamId(locals.teamId);
	try {
		return {
			campaign: getCampaign(params.id, teamId),
			books: getContactBooks(teamId)
		};
	} catch {
		error(404, 'Not found');
	}
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		try {
			await updateCampaign(params.id, teamId, {
				name: String(form.get('name') ?? ''),
				from: String(form.get('from') ?? ''),
				subject: String(form.get('subject') ?? ''),
				html: String(form.get('html') ?? '') || null,
				contactBookId: String(form.get('contactBookId') ?? '') || null
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
	},
	schedule: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const scheduledAt = String(form.get('scheduledAt') ?? '').trim();
		try {
			await scheduleCampaign({
				campaignId: params.id,
				teamId,
				scheduledAt: scheduledAt || undefined
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Schedule failed' });
		}
	},
	pause: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		pauseCampaign({ campaignId: params.id, teamId });
	},
	resume: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		resumeCampaign({ campaignId: params.id, teamId });
	},
	delete: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		deleteCampaign(params.id, teamId);
		redirect(302, '/campaigns');
	}
};

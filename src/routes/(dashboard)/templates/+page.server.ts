import { fail } from '@sveltejs/kit';
import {
	listTemplates,
	createTemplate,
	updateTemplate,
	deleteTemplate
} from '$lib/server/service/template-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	return { templates: listTemplates(teamId) };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();
		const html = String(form.get('html') ?? '').trim();
		if (!name || !subject) return fail(400, { error: 'Name and subject required' });
		createTemplate({ teamId, name, subject, html: html || null });
	},
	update: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		try {
			updateTemplate(id, teamId, {
				name: String(form.get('name') ?? ''),
				subject: String(form.get('subject') ?? ''),
				html: String(form.get('html') ?? '') || null
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
	},
	delete: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const id = String((await request.formData()).get('id') ?? '');
		deleteTemplate(id, teamId);
	}
};

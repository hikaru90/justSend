import { fail, redirect } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { getDesignSystemBundle } from '$lib/server/service/design-system-service';
import { createTemplate, deleteTemplate, listTemplates, updateTemplate } from '$lib/server/service/template-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	const bundle = getDesignSystemBundle(teamId);
	const designReady = Boolean(
		bundle.system?.designMd?.trim() || bundle.components.length > 0 || bundle.assets.length > 0
	);

	if (!locals.domainId) {
		return {
			needsDomain: true as const,
			templates: [],
			designReady,
			designSummary: {
				hasMd: Boolean(bundle.system?.designMd?.trim()),
				assetCount: bundle.assets.length,
				componentCount: bundle.components.length
			}
		};
	}

	return {
		needsDomain: false as const,
		templates: listTemplates(teamId, locals.domainId),
		designReady,
		designSummary: {
			hasMd: Boolean(bundle.system?.designMd?.trim()),
			assetCount: bundle.assets.length,
			componentCount: bundle.components.length
		}
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId;
		if (!domainId) return fail(400, { error: 'No domain selected' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();
		const prompt = String(form.get('prompt') ?? '').trim();

		if (!name || !subject) return fail(400, { error: 'Name and subject required' });

		let templateId: string;
		try {
			const template = createTemplate({
				teamId,
				domainId,
				name,
				subject,
				html: null
			});
			if (prompt) {
				updateTemplate(template.id, teamId, { prompt }, domainId);
			}
			templateId = template.id;
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Create failed' });
		}
		redirect(303, `/templates/${templateId}`);
	},

	delete: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const id = String((await request.formData()).get('id') ?? '');
		try {
			deleteTemplate(id, teamId, domainId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
	}
};

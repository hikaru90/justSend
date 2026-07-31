import { fail, redirect } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { getDesignSystemBundle } from '$lib/server/service/design-system-service';
import {
	createTemplate,
	deleteTemplate,
	listTemplates,
	normalizeTemplateTags,
	updateTemplate
} from '$lib/server/service/template-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	const bundle = getDesignSystemBundle(teamId);
	const designReady = Boolean(
		bundle.system?.designMd?.trim() || bundle.components.length > 0 || bundle.assets.length > 0
	);
	const designSummary = {
		hasMd: Boolean(bundle.system?.designMd?.trim()),
		assetCount: bundle.assets.length,
		componentCount: bundle.components.length
	};

	if (!locals.domainId) {
		return {
			needsDomain: true as const,
			templates: [],
			allTags: [] as string[],
			designReady,
			designSummary
		};
	}

	const templates = listTemplates(teamId, locals.domainId);
	const tagSet = new Set<string>();
	for (const template of templates) {
		for (const tag of template.tagList) tagSet.add(tag);
	}

	return {
		needsDomain: false as const,
		templates,
		allTags: [...tagSet].sort((a, b) => a.localeCompare(b)),
		designReady,
		designSummary
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
		const tags = normalizeTemplateTags(
			String(form.get('tags') ?? '')
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean)
		);

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
			const patch: { prompt?: string; tags?: string[] } = {};
			if (prompt) patch.prompt = prompt;
			if (tags.length) patch.tags = tags;
			if (Object.keys(patch).length) {
				updateTemplate(template.id, teamId, patch, domainId);
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
	},

	setTags: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId;
		if (!domainId) return fail(400, { error: 'No domain selected' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const tagsRaw = String(form.get('tags') ?? '');
		let tags: string[];
		try {
			tags = normalizeTemplateTags(JSON.parse(tagsRaw) as string[]);
		} catch {
			tags = normalizeTemplateTags(tagsRaw.split(','));
		}

		if (!id) return fail(400, { error: 'Template id required' });

		try {
			updateTemplate(id, teamId, { tags }, domainId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update tags failed' });
		}
	}
};

import { error, fail, redirect } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { generateTemplateHtml } from '$lib/server/service/ai-template-service';
import { getDesignSystemBundle } from '$lib/server/service/design-system-service';
import {
	createElement,
	deleteElement,
	listElements
} from '$lib/server/service/template-element-service';
import { deleteTemplate, getTemplate, updateTemplate } from '$lib/server/service/template-service';
import { templateElementTypes, type TemplateElementType } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

const ELEMENT_TYPES = new Set<string>(templateElementTypes);

export const load: PageServerLoad = async ({ locals, params }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = locals.domainId ?? undefined;
	const bundle = getDesignSystemBundle(teamId);

	try {
		const template = getTemplate(params.id, teamId, domainId);
		return {
			template,
			elements: listElements(template.id, teamId, domainId),
			designReady: Boolean(
				bundle.system?.designMd?.trim() ||
					bundle.components.length > 0 ||
					bundle.assets.length > 0
			),
			designSummary: {
				hasMd: Boolean(bundle.system?.designMd?.trim()),
				assetCount: bundle.assets.length,
				componentCount: bundle.components.length
			}
		};
	} catch {
		error(404, 'Template not found');
	}
};

export const actions: Actions = {
	updateMeta: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();
		if (!name || !subject) return fail(400, { error: 'Name and subject required' });

		try {
			updateTemplate(params.id, teamId, { name, subject }, domainId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
		return { success: true, saved: 'meta' as const };
	},

	delete: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		try {
			deleteTemplate(params.id, teamId, domainId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
		redirect(302, '/templates');
	},

	addElement: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const type = String(form.get('type') ?? '').trim();
		const label = String(form.get('label') ?? '').trim();
		const required = form.get('required') === 'on';

		if (!ELEMENT_TYPES.has(type)) {
			return fail(400, { error: 'Invalid element type' });
		}
		if (!label) return fail(400, { error: 'Label is required' });

		try {
			createElement({
				templateId: params.id,
				teamId,
				domainId,
				type: type as TemplateElementType,
				label,
				required
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to add element' });
		}
		return { success: true, saved: 'element' as const };
	},

	deleteElement: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const id = String((await request.formData()).get('id') ?? '');
		try {
			deleteElement(id, params.id, teamId, domainId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
		return { success: true };
	},

	generate: async ({ request, locals, params, url }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const prompt = String(form.get('prompt') ?? '');

		try {
			await generateTemplateHtml({
				teamId,
				domainId,
				templateId: params.id,
				prompt,
				assetBaseUrl: url.origin
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Generation failed' });
		}
		return { success: true, saved: 'generate' as const };
	}
};

import { fail } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import {
	addAsset,
	deleteAsset,
	deleteComponent,
	getDesignSystemBundle,
	upsertComponent,
	upsertDesignMd
} from '$lib/server/service/design-system-service';
import { inferDesignSystemFromUrl } from '$lib/server/service/design-infer-service';
import { designAssetKinds, type DesignAssetKind } from '$lib/server/db/schema';
import { editHtmlWithPi, isPiConfigured } from '$lib/server/service/pi-service';
import type { Actions, PageServerLoad } from './$types';

const KIND_SET = new Set<string>(designAssetKinds);

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	const bundle = getDesignSystemBundle(teamId);
	return {
		designMd: bundle.system?.designMd ?? '',
		assets: bundle.assets,
		components: bundle.components,
		piConfigured: isPiConfigured()
	};
};

export const actions: Actions = {
	inferFromUrl: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const url = String(form.get('url') ?? '').trim();
		if (!url) return fail(400, { error: 'URL is required' });

		try {
			const result = await inferDesignSystemFromUrl(teamId, url);
			return {
				success: true,
				saved: 'infer' as const,
				componentsCreated: result.componentsCreated,
				assetsDownloaded: result.assetsDownloaded
			};
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Inference failed' });
		}
	},

	saveMd: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const designMd = String(form.get('designMd') ?? '');
		upsertDesignMd(teamId, designMd);
		return { success: true, saved: 'md' as const };
	},

	uploadAsset: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const kindRaw = String(form.get('kind') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		const file = form.get('file');

		if (!KIND_SET.has(kindRaw)) {
			return fail(400, { error: 'Invalid asset kind' });
		}
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'File is required' });
		}
		if (!name) {
			return fail(400, { error: 'Name is required' });
		}

		const bytes = new Uint8Array(await file.arrayBuffer());
		await addAsset(teamId, {
			kind: kindRaw as DesignAssetKind,
			name,
			filename: file.name || name,
			mime: file.type || 'application/octet-stream',
			bytes
		});
		return { success: true, saved: 'asset' as const };
	},

	deleteAsset: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const id = String((await request.formData()).get('id') ?? '');
		try {
			await deleteAsset(id, teamId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
		return { success: true };
	},

	saveComponent: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim() || undefined;
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim() || null;
		const html = String(form.get('html') ?? '');

		if (!name) return fail(400, { error: 'Component name is required' });

		try {
			upsertComponent(teamId, { id, name, description, html });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Save failed' });
		}
		return { success: true, saved: 'component' as const };
	},

	deleteComponent: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const id = String((await request.formData()).get('id') ?? '');
		try {
			deleteComponent(id, teamId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
		return { success: true };
	},

	piEditComponent: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		if (!isPiConfigured()) {
			return fail(400, { error: 'Pi is not configured (OPENROUTER_API_KEY)' });
		}

		const form = await request.formData();
		const html = String(form.get('html') ?? '');
		const instruction = String(form.get('instruction') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim() || null;

		if (!instruction) return fail(400, { error: 'Describe the change for Pi' });

		try {
			const bundle = getDesignSystemBundle(teamId);
			const edited = await editHtmlWithPi({
				html,
				instruction,
				context: { kind: 'component', name, description },
				design: {
					designMd: bundle.system?.designMd ?? null,
					// Other components as style reference (not the one being edited).
					components: bundle.components
						.filter((c) => c.name !== name)
						.map((c) => ({
							name: c.name,
							description: c.description,
							html: c.html
						}))
				}
			});
			return { success: true, saved: 'pi-component' as const, html: edited };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Pi edit failed' });
		}
	}
};

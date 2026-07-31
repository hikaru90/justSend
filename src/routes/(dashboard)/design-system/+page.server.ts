import { fail } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import {
	addAsset,
	appendStarterComponents,
	deleteAsset,
	deleteComponent,
	getDesignSystemBundle,
	updateAsset,
	upsertComponent,
	upsertDesignMd
} from '$lib/server/service/design-system-service';
import {
	inferDesignSystemFromUrl,
	reapplyDesignSystemToComponent
} from '$lib/server/service/design-infer-service';
import { designAssetKinds, type DesignAssetKind } from '$lib/server/db/schema';
import { isPiConfigured } from '$lib/server/service/pi-service';
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
				assetsDownloaded: result.assetsDownloaded
			};
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Inference failed' });
		}
	},

	appendStarters: async ({ locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const result = appendStarterComponents(teamId);
		return {
			success: true,
			saved: 'starters' as const,
			startersAdded: result.added,
			startersSkipped: result.skipped
		};
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

	updateAsset: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		const file = form.get('file');

		if (!id) return fail(400, { error: 'Asset id is required' });
		if (!name) return fail(400, { error: 'Name is required' });

		const replacement =
			file instanceof File && file.size > 0
				? {
						filename: file.name || name,
						mime: file.type || 'application/octet-stream',
						bytes: new Uint8Array(await file.arrayBuffer())
					}
				: undefined;

		try {
			await updateAsset(id, teamId, {
				name,
				file: replacement
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
		return { success: true, saved: 'asset' as const };
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

	reapplyComponent: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const id = String((await request.formData()).get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Component id is required' });

		try {
			await reapplyDesignSystemToComponent(teamId, id);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Reapply failed' });
		}
		return { success: true, saved: 'reapply' as const };
	}
};

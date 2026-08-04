import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { teams } from '$lib/server/db/schema';
import { createSesSetting, getAllSettings } from '$lib/server/service/ses-settings-service';
import { DB_PARTS } from '$lib/server/service/db-parts-service';
import { env } from '$lib/server/env';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		settings: getAllSettings(),
		defaultUrl: env.HOST_URL,
		teams: db.select({ id: teams.id, name: teams.name }).from(teams).all(),
		dbParts: DB_PARTS.map((p) => ({ id: p.id, label: p.label, scope: p.scope })),
		currentDomainId: locals.domainId,
	};
};

export const actions: Actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const region = String(form.get('region') ?? '').trim();
		const owleryUrl = String(form.get('owleryUrl') ?? '').trim();
		const sendingRateLimit = Number(form.get('sendingRateLimit') ?? 1);
		const transactionalQuota = Number(form.get('transactionalQuota') ?? 50);

		if (!region || !owleryUrl) return fail(400, { error: 'Region and URL required' });

		try {
			await createSesSetting({ region, owleryUrl, sendingRateLimit, transactionalQuota });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to create setting' });
		}
	},
};

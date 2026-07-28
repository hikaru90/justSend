import { fail } from '@sveltejs/kit';
import { createSesSetting, getAllSettings } from '$lib/server/service/ses-settings-service';
import { env } from '$lib/server/env';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { settings: getAllSettings(), defaultUrl: env.HOST_URL };
};

export const actions: Actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const region = String(form.get('region') ?? '').trim();
		const justsendUrl = String(form.get('justsendUrl') ?? '').trim();
		const sendingRateLimit = Number(form.get('sendingRateLimit') ?? 1);
		const transactionalQuota = Number(form.get('transactionalQuota') ?? 50);

		if (!region || !justsendUrl) return fail(400, { error: 'Region and URL required' });

		try {
			await createSesSetting({ region, justsendUrl, sendingRateLimit, transactionalQuota });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed to create setting' });
		}
	}
};

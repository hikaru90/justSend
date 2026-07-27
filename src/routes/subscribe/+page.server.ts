import { error } from '@sveltejs/kit';
import { subscribeContact } from '$lib/server/service/campaign-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const id = url.searchParams.get('id');
	const hash = url.searchParams.get('hash');

	if (!id || !hash) {
		error(400, 'Invalid subscribe link');
	}

	try {
		await subscribeContact(id, hash);
		return { success: true };
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Subscribe failed');
	}
};

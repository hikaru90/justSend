import { error } from '@sveltejs/kit';
import { subscribeContact } from '$lib/server/service/campaign-service';
import { confirmDoubleOptInSubscription } from '$lib/server/service/double-opt-in-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const contactId = url.searchParams.get('contactId');
	const expiresAt = url.searchParams.get('expiresAt');
	const hash = url.searchParams.get('hash');
	const id = url.searchParams.get('id');

	// Double opt-in confirmation links use contactId + expiresAt + hash.
	if (contactId) {
		if (!expiresAt || !hash) {
			error(400, 'Invalid subscribe link');
		}
		try {
			confirmDoubleOptInSubscription({ contactId, expiresAt, hash });
			return { success: true };
		} catch (e) {
			error(400, e instanceof Error ? e.message : 'Subscribe failed');
		}
	}

	// Campaign-style subscribe links use id + hash.
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

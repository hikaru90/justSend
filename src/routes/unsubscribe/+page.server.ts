import { error } from '@sveltejs/kit';
import { unsubscribeContactFromLink } from '$lib/server/service/campaign-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const id = url.searchParams.get('id');
	const hash = url.searchParams.get('hash');

	// Bare /unsubscribe (no signed params): show a generic info page.
	// Signed-link behavior below is unchanged.
	if (!id && !hash) {
		return { success: false, bare: true as const, email: null };
	}

	if (!id || !hash) {
		error(400, 'Invalid unsubscribe link');
	}

	try {
		const contact = await unsubscribeContactFromLink(id, hash);
		return { success: true, bare: false as const, email: contact.email };
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Unsubscribe failed');
	}
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unsubscribeContactFromLink } from '$lib/server/service/campaign-service';

export const POST: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	const hash = url.searchParams.get('hash');

	if (!id || !hash) {
		return json({ error: 'Invalid unsubscribe link' }, { status: 400 });
	}

	try {
		const contact = await unsubscribeContactFromLink(id, hash);
		return json({ success: true, contactId: contact.id });
	} catch (error) {
		console.error('[unsubscribe-oneclick]', error);
		return json({ error: 'Failed to process unsubscribe request' }, { status: 500 });
	}
};

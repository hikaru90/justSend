import { fail } from '@sveltejs/kit';
import { listWebhooks, createWebhook } from '$lib/server/service/webhook-service';
import { WebhookEvents } from '$lib/server/webhook-events';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	return { webhooks: listWebhooks(teamId), eventTypes: WebhookEvents };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		if (!locals.user) return fail(401, { error: 'Unauthorized' });
		const form = await request.formData();
		const url = String(form.get('url') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		const eventTypes = form.getAll('eventTypes').map(String);
		if (!url) return fail(400, { error: 'URL required' });
		try {
			const webhook = await createWebhook({
				teamId,
				userId: locals.user.id,
				url,
				description: description || undefined,
				eventTypes
			});
			return { secret: webhook.secret };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Failed' });
		}
	}
};

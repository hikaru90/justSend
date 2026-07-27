import { error, fail, redirect } from '@sveltejs/kit';
import {
	getWebhook,
	listWebhookCalls,
	setWebhookStatus,
	deleteWebhook,
	testWebhook,
	retryCall
} from '$lib/server/service/webhook-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const cursor = url.searchParams.get('cursor') ?? undefined;
	try {
		return {
			webhook: getWebhook({ id: params.id, teamId }),
			calls: listWebhookCalls({ teamId, webhookId: params.id, limit: 30, cursor })
		};
	} catch {
		error(404, 'Not found');
	}
};

export const actions: Actions = {
	toggle: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const webhook = getWebhook({ id: params.id, teamId });
		setWebhookStatus({
			id: params.id,
			teamId,
			status: webhook.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
		});
	},
	test: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		await testWebhook({ webhookId: params.id, teamId });
	},
	delete: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		deleteWebhook({ id: params.id, teamId });
		redirect(302, '/webhooks');
	},
	retry: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const callId = String((await request.formData()).get('callId') ?? '');
		try {
			await retryCall({ callId, teamId });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Retry failed' });
		}
	}
};

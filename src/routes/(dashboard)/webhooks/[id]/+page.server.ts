import { error, fail, redirect } from '@sveltejs/kit';
import {
	getWebhook,
	listWebhookCalls,
	setWebhookStatus,
	deleteWebhook,
	testWebhook,
	retryCall
} from '$lib/server/service/webhook-service';
import { requireDomainId, requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

function webhookVisibleForDomain(domainIdsJson: string, domainId: number): boolean {
	try {
		const ids = JSON.parse(domainIdsJson) as unknown;
		if (!Array.isArray(ids) || ids.length === 0) return true;
		return ids.map(Number).includes(domainId);
	} catch {
		return true;
	}
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = requireDomainId(locals.domainId);
	const cursor = url.searchParams.get('cursor') ?? undefined;
	try {
		const webhook = getWebhook({ id: params.id, teamId });
		if (!webhookVisibleForDomain(webhook.domainIds, domainId)) {
			error(404, 'Not found');
		}
		return {
			webhook,
			calls: listWebhookCalls({ teamId, webhookId: params.id, limit: 30, cursor })
		};
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(404, 'Not found');
	}
};

export const actions: Actions = {
	toggle: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		const webhook = getWebhook({ id: params.id, teamId });
		setWebhookStatus({
			id: params.id,
			teamId,
			status: webhook.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
		});
	},
	test: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		await testWebhook({ webhookId: params.id, teamId });
	},
	delete: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		deleteWebhook({ id: params.id, teamId });
		redirect(302, '/webhooks');
	},
	retry: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		const callId = String((await request.formData()).get('callId') ?? '');
		try {
			await retryCall({ callId, teamId });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Retry failed' });
		}
	}
};

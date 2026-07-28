import { fail } from '@sveltejs/kit';
import { listEmails } from '$lib/server/service/email-service';
import {
	getWorkerStatus,
	requestWorkerAction,
	type WorkerControlAction
} from '$lib/server/service/worker-status-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

const ACTIONS = new Set<WorkerControlAction>(['start', 'stop', 'pause', 'restart']);

export const load: PageServerLoad = async ({ locals, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const cursor = url.searchParams.get('cursor') ?? undefined;
	const emails = listEmails({ teamId, cursor, limit: 30 });
	return {
		...emails,
		worker: getWorkerStatus(),
		canControlWorker: Boolean(locals.user?.isAdmin)
	};
};

export const actions: Actions = {
	control: async ({ request, locals }) => {
		if (!locals.user?.isAdmin) {
			return fail(403, { error: 'Admin access required' });
		}
		const form = await request.formData();
		const action = String(form.get('action') ?? '') as WorkerControlAction;
		if (!ACTIONS.has(action)) {
			return fail(400, { error: 'Invalid worker action' });
		}
		const control = requestWorkerAction(action);
		return { ok: true as const, action, control };
	}
};

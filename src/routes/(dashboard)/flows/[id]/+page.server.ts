import { error, fail, redirect } from '@sveltejs/kit';
import { requireDomainId, requireTeamId } from '$lib/server/dashboard';
import { getContactBooks } from '$lib/server/service/contact-book-service';
import {
	activateFlow,
	deleteFlow,
	getFlow,
	pauseFlow,
	updateFlow,
	type FlowGraph,
	type TriggerConfig,
} from '$lib/server/service/flow-service';
import { listTemplates } from '$lib/server/service/template-service';
import type { AutomationFlowStatus } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = requireDomainId(locals.domainId);

	try {
		const flow = getFlow(params.id, teamId, domainId);
		return {
			flow,
			templates: listTemplates(teamId, domainId).map((t) => ({ id: t.id, name: t.name })),
			books: getContactBooks(teamId, { domainId }).map((b) => ({ id: b.id, name: b.name })),
		};
	} catch {
		error(404, 'Flow not found');
	}
};

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = requireDomainId(locals.domainId);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const statusRaw = String(form.get('status') ?? 'draft');
		const contactBookId = String(form.get('contactBookId') ?? '').trim();
		const graphRaw = String(form.get('graph') ?? '');

		const status: AutomationFlowStatus =
			statusRaw === 'active' || statusRaw === 'paused' || statusRaw === 'draft'
				? statusRaw
				: 'draft';

		let graph: FlowGraph;
		try {
			graph = JSON.parse(graphRaw) as FlowGraph;
		} catch {
			return fail(400, { error: 'Invalid graph JSON' });
		}

		const triggerConfig: TriggerConfig = contactBookId ? { contactBookId } : {};

		graph = {
			...graph,
			nodes: graph.nodes.map((n) =>
				n.type === 'trigger'
					? {
							...n,
							data: {
								...n.data,
								contactBookId: contactBookId || undefined,
								label: 'Contact created',
							},
						}
					: n,
			),
		};

		try {
			updateFlow(
				params.id,
				teamId,
				{
					name: name || undefined,
					status,
					triggerConfig,
					graph,
				},
				domainId,
			);
			return { saved: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Save failed' });
		}
	},
	activate: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = requireDomainId(locals.domainId);
		try {
			activateFlow(params.id, teamId, domainId);
			return { activated: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Activate failed' });
		}
	},
	pause: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = requireDomainId(locals.domainId);
		try {
			pauseFlow(params.id, teamId, domainId);
			return { paused: true };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Pause failed' });
		}
	},
	delete: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		requireDomainId(locals.domainId);
		deleteFlow(params.id, teamId, locals.domainId ?? undefined);
		redirect(302, '/flows');
	},
};

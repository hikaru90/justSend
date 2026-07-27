import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiTeam } from '$lib/server/api/auth';
import { jsonError, jsonErrorFromException } from '$lib/server/api/errors';
import { deleteDomain, getDomain } from '$lib/server/service/domain-service';

export const GET: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	const id = Number(params.id);
	if (!Number.isFinite(id)) return jsonError(400, 'Invalid domain id');
	try {
		const domain = await getDomain(id, team.id);
		return json(domain);
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	const id = Number(params.id);
	if (!Number.isFinite(id)) return jsonError(400, 'Invalid domain id');
	try {
		// Ownership check before deletion.
		await getDomain(id, team.id);
		await deleteDomain(id);
		return json({ ok: true });
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

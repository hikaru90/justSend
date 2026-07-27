import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiTeam } from '$lib/server/api/auth';
import { jsonError, jsonErrorFromException } from '$lib/server/api/errors';
import { getDomain, refreshDomainVerification } from '$lib/server/service/domain-service';

export const POST: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	const id = Number(params.id);
	if (!Number.isFinite(id)) return jsonError(400, 'Invalid domain id');
	try {
		await getDomain(id, team.id);
		const result = await refreshDomainVerification(id);
		return json(result);
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

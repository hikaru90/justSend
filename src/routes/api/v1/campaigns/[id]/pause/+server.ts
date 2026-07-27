import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiTeam } from '$lib/server/api/auth';
import { jsonErrorFromException } from '$lib/server/api/errors';
import { pauseCampaign } from '$lib/server/service/campaign-service';

export const POST: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		pauseCampaign({ campaignId: params.id, teamId: team.id });
		return json({ ok: true });
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

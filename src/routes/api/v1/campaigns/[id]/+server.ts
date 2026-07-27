import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseJsonArray } from '$lib/utils';
import { requireApiTeam } from '$lib/server/api/auth';
import { jsonErrorFromException } from '$lib/server/api/errors';
import {
	deleteCampaign,
	getCampaign,
	type Campaign
} from '$lib/server/service/campaign-service';

function serializeCampaign(campaign: Campaign) {
	return {
		...campaign,
		replyTo: parseJsonArray(campaign.replyTo),
		cc: parseJsonArray(campaign.cc),
		bcc: parseJsonArray(campaign.bcc)
	};
}

export const GET: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		return json(serializeCampaign(getCampaign(params.id, team.id)));
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		deleteCampaign(params.id, team.id);
		return json({ ok: true });
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireApiTeam } from '$lib/server/api/auth';
import { parseBody } from '$lib/server/api/validate';
import { jsonErrorFromException } from '$lib/server/api/errors';
import { scheduleCampaign } from '$lib/server/service/campaign-service';

const scheduleSchema = z.object({
	scheduledAt: z.string().optional(),
	batchSize: z.number().int().optional(),
});

export const POST: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	const body = await parseBody(request, scheduleSchema);

	try {
		const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : undefined;
		if (body.scheduledAt && scheduledAt && Number.isNaN(scheduledAt.getTime())) {
			throw new Error('Invalid scheduledAt date');
		}

		await scheduleCampaign({
			campaignId: params.id,
			teamId: team.id,
			scheduledAt,
			batchSize: body.batchSize,
		});

		return json({ success: true });
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

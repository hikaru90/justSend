import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { parseJsonArray } from '$lib/utils';
import { requireApiTeam } from '$lib/server/api/auth';
import { parseBody } from '$lib/server/api/validate';
import { jsonErrorFromException } from '$lib/server/api/errors';
import {
	createCampaignFromApi,
	getCampaign,
	listCampaigns,
	scheduleCampaign,
	type Campaign,
} from '$lib/server/service/campaign-service';

const stringOrStringArray = z.union([z.string(), z.array(z.string())]);

const createSchema = z
	.object({
		name: z.string(),
		from: z.string(),
		subject: z.string(),
		previewText: z.string().optional(),
		contactBookId: z.string(),
		content: z.string().optional(),
		html: z.string().optional(),
		replyTo: stringOrStringArray.optional(),
		cc: stringOrStringArray.optional(),
		bcc: stringOrStringArray.optional(),
		sendNow: z.boolean().optional(),
		scheduledAt: z.string().optional(),
		batchSize: z.number().int().optional(),
	})
	.refine((data) => !!data.content || !!data.html, {
		message: 'Either content or html must be provided',
	});

function serializeCampaign(campaign: Campaign) {
	return {
		...campaign,
		replyTo: parseJsonArray(campaign.replyTo),
		cc: parseJsonArray(campaign.cc),
		bcc: parseJsonArray(campaign.bcc),
	};
}

export const GET: RequestHandler = async ({ request, url }) => {
	const { team } = await requireApiTeam(request);
	const limit = url.searchParams.get('limit');
	const cursor = url.searchParams.get('cursor') ?? undefined;

	const result = listCampaigns(team.id, {
		limit: limit ? Number(limit) : undefined,
		cursor,
	});

	return json({
		data: result.items.map(serializeCampaign),
		nextCursor: result.nextCursor,
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const { team, apiKeyId } = await requireApiTeam(request);
	const body = await parseBody(request, createSchema);

	try {
		const campaign = await createCampaignFromApi({
			teamId: team.id,
			apiKeyId,
			name: body.name,
			from: body.from,
			subject: body.subject,
			previewText: body.previewText,
			content: body.content,
			html: body.html,
			contactBookId: body.contactBookId,
			replyTo: body.replyTo,
			cc: body.cc,
			bcc: body.bcc,
			batchSize: body.batchSize,
		});

		if (body.sendNow || body.scheduledAt) {
			const scheduledAt = body.sendNow ? new Date() : new Date(body.scheduledAt!);
			if (Number.isNaN(scheduledAt.getTime())) {
				throw new Error('Invalid scheduledAt date');
			}
			await scheduleCampaign({
				campaignId: campaign.id,
				teamId: team.id,
				scheduledAt,
				batchSize: body.batchSize,
			});
		}

		return json(serializeCampaign(getCampaign(campaign.id, team.id)));
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

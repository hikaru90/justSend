import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireApiTeam } from '$lib/server/api/auth';
import { parseBody } from '$lib/server/api/validate';
import { jsonErrorFromException } from '$lib/server/api/errors';
import { serializeEmail } from '$lib/server/api/serialize';
import { listEmails, sendEmail } from '$lib/server/service/email-service';
import { getIdempotencyKey, setIdempotencyKey } from '$lib/server/service/idempotency-service';

const emailList = z.union([z.string(), z.array(z.string())]);

const sendSchema = z.object({
	to: emailList,
	from: z.string(),
	subject: z.string(),
	cc: emailList.optional(),
	bcc: emailList.optional(),
	replyTo: emailList.optional(),
	text: z.string().optional(),
	html: z.string().optional(),
	scheduledAt: z.string().optional(),
	templateId: z.string().optional(),
	variables: z.record(z.string(), z.string()).optional(),
	attachments: z.array(z.object({ filename: z.string(), content: z.string() })).optional(),
	headers: z.record(z.string(), z.string()).optional(),
	inReplyToId: z.string().optional(),
});

export const GET: RequestHandler = async ({ request, url }) => {
	const { team } = await requireApiTeam(request);
	const limit = url.searchParams.get('limit');
	const cursor = url.searchParams.get('cursor') ?? undefined;

	const result = listEmails({
		teamId: team.id,
		limit: limit ? Number(limit) : undefined,
		cursor,
	});

	return json({
		data: result.items.map(serializeEmail),
		nextCursor: result.nextCursor,
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const { team, apiKeyId } = await requireApiTeam(request);
	const input = await parseBody(request, sendSchema);

	const idempotencyKey = request.headers.get('Idempotency-Key');
	if (idempotencyKey) {
		const existing = getIdempotencyKey(team.id, idempotencyKey);
		if (existing) {
			return json(existing.response);
		}
	}

	try {
		const email = await sendEmail({ ...input, teamId: team.id, apiKeyId });
		const response = { id: email.id, status: email.latestStatus };
		if (idempotencyKey) {
			setIdempotencyKey(team.id, idempotencyKey, response);
		}
		return json(response);
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

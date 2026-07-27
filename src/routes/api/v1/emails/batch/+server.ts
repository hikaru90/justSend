import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireApiTeam } from '$lib/server/api/auth';
import { parseBody } from '$lib/server/api/validate';
import { sendEmail } from '$lib/server/service/email-service';

const emailList = z.union([z.string(), z.array(z.string())]);

const singleSchema = z.object({
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
	inReplyToId: z.string().optional()
});

const batchSchema = z.object({ emails: z.array(singleSchema) });

export const POST: RequestHandler = async ({ request }) => {
	const { team, apiKeyId } = await requireApiTeam(request);
	const { emails: inputs } = await parseBody(request, batchSchema);

	const data: Array<{ id?: string; status?: string; error?: string }> = [];
	for (const input of inputs) {
		try {
			const email = await sendEmail({ ...input, teamId: team.id, apiKeyId });
			data.push({ id: email.id, status: email.latestStatus });
		} catch (error) {
			data.push({ error: error instanceof Error ? error.message : 'Failed to send' });
		}
	}

	return json({ data });
};

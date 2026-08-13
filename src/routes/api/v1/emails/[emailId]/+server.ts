import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireApiTeam } from '$lib/server/api/auth';
import { parseBody } from '$lib/server/api/validate';
import { jsonErrorFromException } from '$lib/server/api/errors';
import { getEmail, updateEmail } from '$lib/server/service/email-service';

const patchSchema = z.object({ scheduledAt: z.string().optional() });

export const GET: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		const email = getEmail(params.emailId, team.id);
		return json(email);
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

export const PATCH: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	const { scheduledAt } = await parseBody(request, patchSchema);
	try {
		// Ensure the email belongs to the team before mutating.
		getEmail(params.emailId, team.id);
		await updateEmail(params.emailId, { scheduledAt });
		return json({ ok: true });
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

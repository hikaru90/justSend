import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiTeam } from '$lib/server/api/auth';
import { jsonErrorFromException } from '$lib/server/api/errors';
import { cancelEmail, getEmail } from '$lib/server/service/email-service';

export const POST: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		getEmail(params.emailId, team.id);
		await cancelEmail(params.emailId);
		return json({ ok: true });
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

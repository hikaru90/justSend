import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { parseJson } from '$lib/server/api/validate';

const schema = z.object({ teamId: z.number().int().positive() });

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { teamId } = await parseJson(request, schema);
	const allowed = locals.teams.some((t) => t.id === teamId);
	if (!allowed) {
		return json({ error: 'Team not found' }, { status: 403 });
	}

	cookies.set('usesend_team', String(teamId), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 365
	});

	return json({ ok: true });
};

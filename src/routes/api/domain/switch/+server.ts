import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { parseJson } from '$lib/server/api/validate';

const schema = z.object({ domainId: z.number().int().positive() });

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { domainId } = await parseJson(request, schema);
	const allowed = locals.domains.some((d) => d.id === domainId);
	if (!allowed) {
		return json({ error: 'Domain not found' }, { status: 403 });
	}

	cookies.set('owlery_domain', String(domainId), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 365
	});

	return json({ ok: true });
};

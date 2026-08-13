import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { env } from '$lib/server/env';
import { requireApiTeam } from '$lib/server/api/auth';
import { parseBody } from '$lib/server/api/validate';
import { jsonErrorFromException } from '$lib/server/api/errors';
import { createDomain, getDomains } from '$lib/server/service/domain-service';

const createSchema = z.object({
	name: z.string(),
	region: z.string().optional(),
});

export const GET: RequestHandler = async ({ request }) => {
	const { team } = await requireApiTeam(request);
	const domains = await getDomains(team.id);
	return json({ data: domains });
};

export const POST: RequestHandler = async ({ request }) => {
	const { team } = await requireApiTeam(request);
	const { name, region } = await parseBody(request, createSchema);
	try {
		const domain = await createDomain(team.id, name, region ?? env.AWS_DEFAULT_REGION);
		return json(domain);
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

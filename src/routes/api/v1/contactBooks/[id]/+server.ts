import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireApiTeam } from '$lib/server/api/auth';
import { parseBody } from '$lib/server/api/validate';
import { jsonErrorFromException } from '$lib/server/api/errors';
import {
	deleteContactBook,
	getContactBook,
	updateContactBook
} from '$lib/server/service/contact-book-service';

const patchSchema = z.object({
	name: z.string().optional(),
	emoji: z.string().optional(),
	properties: z.record(z.string(), z.unknown()).optional(),
	variables: z.array(z.string()).optional(),
	doubleOptInEnabled: z.boolean().optional(),
	doubleOptInFrom: z.string().nullable().optional(),
	doubleOptInSubject: z.string().optional(),
	doubleOptInContent: z.string().optional()
});

export const GET: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		return json(getContactBook(params.id, team.id));
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

export const PATCH: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	const body = await parseBody(request, patchSchema);
	try {
		const updated = await updateContactBook(params.id, team.id, body);
		return json(updated);
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		deleteContactBook(params.id, team.id);
		return json({ ok: true });
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

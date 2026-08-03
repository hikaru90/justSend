import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireApiTeam } from '$lib/server/api/auth';
import { parseBody } from '$lib/server/api/validate';
import { jsonErrorFromException } from '$lib/server/api/errors';
import {
	createContactBook,
	getContactBooks,
	updateContactBook,
} from '$lib/server/service/contact-book-service';

const createSchema = z.object({
	name: z.string(),
	emoji: z.string().optional(),
	variables: z.array(z.string()).optional(),
});

export const GET: RequestHandler = async ({ request, url }) => {
	const { team } = await requireApiTeam(request);
	const search = url.searchParams.get('search') ?? undefined;
	return json({ data: getContactBooks(team.id, search) });
};

export const POST: RequestHandler = async ({ request }) => {
	const { team } = await requireApiTeam(request);
	const { name, emoji, variables } = await parseBody(request, createSchema);
	try {
		let book = createContactBook(team.id, name, variables);
		if (emoji !== undefined) {
			book = await updateContactBook(book.id, team.id, { emoji });
		}
		return json(book);
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

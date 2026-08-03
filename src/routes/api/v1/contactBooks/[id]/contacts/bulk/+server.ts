import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { requireApiTeam } from '$lib/server/api/auth';
import { parseBody } from '$lib/server/api/validate';
import { jsonErrorFromException } from '$lib/server/api/errors';
import { db } from '$lib/server/db';
import { contacts } from '$lib/server/db/schema';
import { getContactBook } from '$lib/server/service/contact-book-service';
import {
	bulkAddContacts,
	bulkDeleteContactsInContactBook,
} from '$lib/server/service/contact-service';

const contactSchema = z.object({
	email: z.string(),
	firstName: z.string().optional(),
	lastName: z.string().optional(),
	properties: z.record(z.string(), z.unknown()).optional(),
	subscribed: z.boolean().optional(),
});

const bulkPostSchema = z.object({
	contacts: z.array(contactSchema).max(1000),
});

const bulkDeleteSchema = z.union([
	z.object({ contactIds: z.array(z.string()).min(1).max(1000) }),
	z.object({ emails: z.array(z.string()).min(1).max(1000) }),
]);

export const POST: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		getContactBook(params.id, team.id);
	} catch (error) {
		return jsonErrorFromException(error);
	}

	const { contacts: contactList } = await parseBody(request, bulkPostSchema);
	const result = bulkAddContacts(params.id, contactList, team.id);
	return json(result);
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		getContactBook(params.id, team.id);
	} catch (error) {
		return jsonErrorFromException(error);
	}

	const body = await parseBody(request, bulkDeleteSchema);

	try {
		let contactIds: string[];

		if ('contactIds' in body) {
			contactIds = body.contactIds;
		} else {
			const rows = db
				.select({ id: contacts.id })
				.from(contacts)
				.where(
					and(
						eq(contacts.contactBookId, params.id),
						inArray(
							contacts.email,
							body.emails.map((e) => e.toLowerCase().trim()),
						),
					),
				)
				.all();
			contactIds = rows.map((r) => r.id);
		}

		const deleted = await bulkDeleteContactsInContactBook(contactIds, params.id, team.id);
		return json({ success: true, count: deleted.length });
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

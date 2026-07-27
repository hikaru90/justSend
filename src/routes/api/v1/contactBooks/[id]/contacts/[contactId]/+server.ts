import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { parseJsonObject } from '$lib/utils';
import { requireApiTeam } from '$lib/server/api/auth';
import { parseBody } from '$lib/server/api/validate';
import { jsonError, jsonErrorFromException } from '$lib/server/api/errors';
import { getContactBook } from '$lib/server/service/contact-book-service';
import {
	addOrUpdateContact,
	deleteContactInContactBook,
	getContactInContactBook,
	updateContactInContactBook
} from '$lib/server/service/contact-service';

const contactSchema = z.object({
	email: z.string(),
	firstName: z.string().optional(),
	lastName: z.string().optional(),
	properties: z.record(z.string(), z.unknown()).optional(),
	subscribed: z.boolean().optional()
});

const patchSchema = contactSchema.partial().extend({ email: z.string().optional() });

function serializeContact(contact: {
	id: string;
	email: string;
	firstName: string | null;
	lastName: string | null;
	subscribed: boolean;
	properties: string;
	contactBookId: string;
	createdAt: string;
	updatedAt: string;
}) {
	return {
		...contact,
		properties: parseJsonObject(contact.properties)
	};
}

export const GET: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		getContactBook(params.id, team.id);
	} catch (error) {
		return jsonErrorFromException(error);
	}

	const contact = getContactInContactBook(params.contactId, params.id);
	if (!contact) {
		return jsonError(404, 'Contact not found');
	}

	return json(serializeContact(contact));
};

export const PATCH: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		getContactBook(params.id, team.id);
	} catch (error) {
		return jsonErrorFromException(error);
	}

	const input = await parseBody(request, patchSchema);
	try {
		const updated = await updateContactInContactBook(
			params.contactId,
			params.id,
			input,
			team.id
		);
		if (!updated) {
			return jsonError(404, 'Contact not found');
		}
		return json(serializeContact(updated));
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

export const PUT: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		getContactBook(params.id, team.id);
	} catch (error) {
		return jsonErrorFromException(error);
	}

	const input = await parseBody(request, contactSchema);
	try {
		const contact = await addOrUpdateContact(params.id, input, team.id);
		return json({ contactId: contact.id });
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	const { team } = await requireApiTeam(request);
	try {
		getContactBook(params.id, team.id);
	} catch (error) {
		return jsonErrorFromException(error);
	}

	try {
		const deleted = await deleteContactInContactBook(params.contactId, params.id, team.id);
		if (!deleted) {
			return jsonError(404, 'Contact not found');
		}
		return json({ ok: true });
	} catch (error) {
		return jsonErrorFromException(error);
	}
};

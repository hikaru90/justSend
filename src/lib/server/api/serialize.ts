import { parseJsonArray } from '$lib/utils';
import type { Email } from '$lib/server/service/email-service';

/**
 * Normalize an email row for API responses by parsing its JSON array columns
 * (to/cc/bcc/replyTo) back into string arrays.
 */
export function serializeEmail(email: Email) {
	return {
		...email,
		to: parseJsonArray(email.to),
		cc: parseJsonArray(email.cc),
		bcc: parseJsonArray(email.bcc),
		replyTo: parseJsonArray(email.replyTo)
	};
}

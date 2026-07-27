import { json } from '@sveltejs/kit';

export type ApiErrorBody = {
	error: {
		message: string;
		code?: string;
	};
};

/**
 * Build a JSON error response for the public REST API.
 */
export function jsonError(status: number, message: string, code?: string) {
	const body: ApiErrorBody = {
		error: {
			message,
			...(code ? { code } : {})
		}
	};
	return json(body, { status });
}

/**
 * Map an unknown thrown value to an appropriate API JSON error response.
 * Well-known "not found" style messages map to 404, otherwise 400.
 */
export function jsonErrorFromException(error: unknown, fallbackStatus = 400) {
	const message = error instanceof Error ? error.message : 'Something went wrong';
	const status = /not found/i.test(message) ? 404 : fallbackStatus;
	return jsonError(status, message);
}

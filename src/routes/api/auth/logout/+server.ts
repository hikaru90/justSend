import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSession, verifyCookieValue, SESSION_COOKIE } from '$lib/server/auth';

export const POST: RequestHandler = async ({ cookies }) => {
	const signed = cookies.get(SESSION_COOKIE);
	const token = verifyCookieValue(signed) ?? signed;
	if (token) {
		deleteSession(token);
	}
	cookies.delete(SESSION_COOKIE, { path: '/' });

	throw redirect(302, '/');
};

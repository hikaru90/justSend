import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	consumeMagicLinkToken,
	createSession,
	signCookieValue,
	SESSION_COOKIE
} from '$lib/server/auth';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const token = url.searchParams.get('token');
	if (!token) {
		throw error(400, 'Missing token');
	}

	let user: { id: number } | null;
	try {
		user = await consumeMagicLinkToken(token);
	} catch (e) {
		throw error(403, e instanceof Error ? e.message : 'Verification failed');
	}

	if (!user) {
		throw error(400, 'Invalid or expired token');
	}

	const session = createSession(user.id);
	cookies.set(SESSION_COOKIE, signCookieValue(session.sessionToken), {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 30
	});

	throw redirect(302, '/dashboard');
};

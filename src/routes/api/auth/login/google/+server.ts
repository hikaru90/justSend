import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createOAuthState,
	getGoogle,
	signCookieValue,
	OAUTH_STATE_COOKIE,
	OAUTH_VERIFIER_COOKIE,
	OAUTH_PROVIDER_COOKIE
} from '$lib/server/auth';

export const GET: RequestHandler = async ({ cookies }) => {
	const google = getGoogle();
	if (!google) {
		throw error(400, 'Google login is not configured');
	}

	const { state, codeVerifier } = createOAuthState();
	const url = google.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']);

	const cookieOptions = {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax' as const,
		maxAge: 60 * 10
	};

	cookies.set(OAUTH_STATE_COOKIE, signCookieValue(state), cookieOptions);
	cookies.set(OAUTH_VERIFIER_COOKIE, signCookieValue(codeVerifier), cookieOptions);
	cookies.set(OAUTH_PROVIDER_COOKIE, signCookieValue('google'), cookieOptions);

	throw redirect(302, url.toString());
};

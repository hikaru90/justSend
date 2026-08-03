import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createSession,
	getGoogle,
	upsertOAuthUser,
	verifyCookieValue,
	signCookieValue,
	SESSION_COOKIE,
	OAUTH_STATE_COOKIE,
	OAUTH_VERIFIER_COOKIE,
	OAUTH_PROVIDER_COOKIE,
} from '$lib/server/auth';

type GoogleClaims = {
	sub: string;
	email?: string;
	email_verified?: boolean;
	name?: string;
	picture?: string;
};

function decodeIdToken(idToken: string): GoogleClaims | null {
	try {
		const payload = idToken.split('.')[1];
		const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
		return JSON.parse(decoded) as GoogleClaims;
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const google = getGoogle();
	if (!google) {
		throw error(400, 'Google login is not configured');
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const storedState = verifyCookieValue(cookies.get(OAUTH_STATE_COOKIE));
	const codeVerifier = verifyCookieValue(cookies.get(OAUTH_VERIFIER_COOKIE));

	if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
		throw error(400, 'Invalid OAuth state');
	}

	cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });
	cookies.delete(OAUTH_VERIFIER_COOKIE, { path: '/' });
	cookies.delete(OAUTH_PROVIDER_COOKIE, { path: '/' });

	let idToken: string;
	let accessToken: string;
	try {
		const tokens = await google.validateAuthorizationCode(code, codeVerifier);
		idToken = tokens.idToken();
		accessToken = tokens.accessToken();
	} catch {
		throw error(400, 'Failed to validate Google authorization code');
	}

	const claims = decodeIdToken(idToken);
	if (!claims) {
		throw error(400, 'Failed to read Google profile');
	}

	let user: { id: number };
	try {
		user = await upsertOAuthUser({
			provider: 'google',
			providerAccountId: claims.sub,
			email: claims.email ?? null,
			name: claims.name ?? null,
			image: claims.picture ?? null,
			accessToken,
			idToken,
		});
	} catch (e) {
		throw error(403, e instanceof Error ? e.message : 'Registration failed');
	}

	const session = createSession(user.id);
	cookies.set(SESSION_COOKIE, signCookieValue(session.sessionToken), {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 30,
	});

	throw redirect(302, '/dashboard');
};

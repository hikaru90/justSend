import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createSession,
	getGitHub,
	upsertOAuthUser,
	verifyCookieValue,
	signCookieValue,
	SESSION_COOKIE,
	OAUTH_STATE_COOKIE,
	OAUTH_PROVIDER_COOKIE
} from '$lib/server/auth';

type GitHubUser = {
	id: number;
	login: string;
	name: string | null;
	email: string | null;
	avatar_url: string | null;
};

type GitHubEmail = { email: string; primary: boolean; verified: boolean };

export const GET: RequestHandler = async ({ url, cookies }) => {
	const github = getGitHub();
	if (!github) {
		throw error(400, 'GitHub login is not configured');
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const storedState = verifyCookieValue(cookies.get(OAUTH_STATE_COOKIE));

	if (!code || !state || !storedState || state !== storedState) {
		throw error(400, 'Invalid OAuth state');
	}

	cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });
	cookies.delete(OAUTH_PROVIDER_COOKIE, { path: '/' });

	let accessToken: string;
	try {
		const tokens = await github.validateAuthorizationCode(code);
		accessToken = tokens.accessToken();
	} catch {
		throw error(400, 'Failed to validate GitHub authorization code');
	}

	const userResponse = await fetch('https://api.github.com/user', {
		headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'justSend' }
	});
	if (!userResponse.ok) {
		throw error(400, 'Failed to fetch GitHub profile');
	}
	const ghUser = (await userResponse.json()) as GitHubUser;

	let email = ghUser.email;
	if (!email) {
		const emailResponse = await fetch('https://api.github.com/user/emails', {
			headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'justSend' }
		});
		if (emailResponse.ok) {
			const emails = (await emailResponse.json()) as GitHubEmail[];
			email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
		}
	}

	let user: { id: number };
	try {
		user = await upsertOAuthUser({
			provider: 'github',
			providerAccountId: String(ghUser.id),
			email,
			name: ghUser.name ?? ghUser.login,
			image: ghUser.avatar_url,
			accessToken
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
		maxAge: 60 * 60 * 24 * 30
	});

	throw redirect(302, '/dashboard');
};

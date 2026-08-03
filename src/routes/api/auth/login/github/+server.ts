import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	OAUTH_PROVIDER_COOKIE,
	OAUTH_STATE_COOKIE,
	createOAuthState,
	getGitHub,
} from '$lib/server/auth';

export const GET: RequestHandler = async ({ cookies }) => {
	const github = getGitHub();
	if (!github) throw redirect(302, '/login?error=github_not_configured');
	const { state } = createOAuthState();
	cookies.set(OAUTH_STATE_COOKIE, state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 600,
	});
	cookies.set(OAUTH_PROVIDER_COOKIE, 'github', {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 600,
	});
	const url = github.createAuthorizationURL(state, ['user:email']);
	throw redirect(302, url.toString());
};

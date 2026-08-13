import { redirect } from '@sveltejs/kit';
import { env } from '$lib/server/env';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) {
		redirect(302, '/dashboard');
	}
	return {
		error: url.searchParams.get('error'),
		githubEnabled: Boolean(env.GITHUB_ID && env.GITHUB_SECRET),
		googleEnabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
	};
};

import { redirect } from '@sveltejs/kit';
import { getInvitesForEmail } from '$lib/server/service/team-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	const email = locals.user.email;
	const invites = email ? getInvitesForEmail(email) : [];

	return { invites, email };
};

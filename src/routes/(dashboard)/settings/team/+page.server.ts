import { fail } from '@sveltejs/kit';
import {
	getTeamUsers,
	getTeamInvites,
	createTeamInvite,
	deleteTeamInvite,
	deleteTeamUser,
	updateTeamUserRole,
} from '$lib/server/service/team-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	return {
		members: await getTeamUsers(teamId),
		invites: await getTeamInvites(teamId),
		role: locals.team?.role,
	};
};

export const actions: Actions = {
	invite: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const role = (String(form.get('role') ?? 'MEMBER') as 'ADMIN' | 'MEMBER') || 'MEMBER';
		if (!email) return fail(400, { error: 'Email required' });
		try {
			await createTeamInvite(teamId, email, role);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Invite failed' });
		}
	},
	deleteInvite: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const inviteId = String((await request.formData()).get('inviteId') ?? '');
		await deleteTeamInvite(teamId, inviteId);
	},
	removeMember: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		if (!locals.user || !locals.team) return fail(401);
		const userId = Number((await request.formData()).get('userId'));
		try {
			await deleteTeamUser(teamId, userId, locals.team.role, locals.user.id);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Remove failed' });
		}
	},
	updateRole: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const userId = Number(form.get('userId'));
		const role = String(form.get('role')) as 'ADMIN' | 'MEMBER';
		try {
			await updateTeamUserRole(teamId, userId, role);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
	},
};

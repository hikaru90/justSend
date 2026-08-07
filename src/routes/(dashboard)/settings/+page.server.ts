import { fail } from '@sveltejs/kit';
import { updateTeam } from '$lib/server/service/team-service';
import {
	clearTeamOpenRouterKey,
	getTeamOpenRouterKey,
	maskOpenRouterApiKey,
	teamHasOpenRouterKey,
} from '$lib/server/service/team-openrouter-key-service';
import { resetPiRuntimeCache } from '$lib/server/service/pi-service';
import { requireTeamId } from '$lib/server/dashboard';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const teamId = requireTeamId(locals.teamId);
	const hasByokKey = teamHasOpenRouterKey(teamId);
	const byokKeyPreview = hasByokKey
		? maskOpenRouterApiKey(getTeamOpenRouterKey(teamId) ?? '')
		: null;

	return {
		team: locals.team,
		hasByokKey,
		byokKeyPreview,
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Name required' });
		updateTeam(teamId, { name });
	},
	removeByokKey: async ({ locals }) => {
		const teamId = requireTeamId(locals.teamId);
		if (!teamHasOpenRouterKey(teamId)) {
			return fail(400, { byokError: 'No personal OpenRouter key is saved for this team.' });
		}

		clearTeamOpenRouterKey(teamId);
		resetPiRuntimeCache();

		return { byokRemoved: true };
	},
};

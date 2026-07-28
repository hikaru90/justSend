import { migrate } from '$lib/server/db/migrate';
import {
	SESSION_COOKIE,
	getSessionUser,
	verifyCookieValue
} from '$lib/server/auth';
import { getUserTeams } from '$lib/server/service/team-service';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';

let migrated = false;

const init: Handle = async ({ event, resolve }) => {
	if (!migrated) {
		migrate();
		migrated = true;
	}
	return resolve(event);
};

const auth: Handle = async ({ event, resolve }) => {
	const signed = event.cookies.get(SESSION_COOKIE);
	const token = verifyCookieValue(signed) ?? signed;
	const user = getSessionUser(token);
	event.locals.user = user;

	const teamCookie = event.cookies.get('justsend_team');
	let teamId = teamCookie ? Number(teamCookie) : null;
	if (user) {
		const teams = getUserTeams(user.id);
		event.locals.teams = teams;
		if (!teamId || !teams.some((t) => t.id === teamId)) {
			teamId = teams[0]?.id ?? null;
		}
		event.locals.teamId = teamId;
		event.locals.team = teams.find((t) => t.id === teamId) ?? null;
	} else {
		event.locals.teams = [];
		event.locals.teamId = null;
		event.locals.team = null;
	}

	return resolve(event);
};

export const handle = sequence(init, auth);

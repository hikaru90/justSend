import { migrate } from '$lib/server/db/migrate';
import { SESSION_COOKIE, getSessionUser, verifyCookieValue } from '$lib/server/auth';
import { getUserTeams } from '$lib/server/service/team-service';
import { listTeamDomains } from '$lib/server/service/domain-service';
import { ensureDevDomain } from '$lib/server/service/dev-seed';
import { installOpenRouterFetchThrottle } from '$lib/server/service/openrouter-rate-limit';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';

// Throttle all OpenRouter HTTP (including Pi SDK tool loops) to ≤1 req/s.
installOpenRouterFetchThrottle();

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

	const teamCookie = event.cookies.get('owlery_team');
	let teamId = teamCookie ? Number(teamCookie) : null;
	if (user) {
		const teams = getUserTeams(user.id);
		event.locals.teams = teams;
		if (!teamId || !teams.some((t) => t.id === teamId)) {
			teamId = teams[0]?.id ?? null;
		}
		event.locals.teamId = teamId;
		event.locals.team = teams.find((t) => t.id === teamId) ?? null;

		if (teamId) ensureDevDomain(teamId);
		const domains = teamId ? listTeamDomains(teamId) : [];
		event.locals.domains = domains;
		const domainCookie = event.cookies.get('owlery_domain');
		let domainId = domainCookie ? Number(domainCookie) : null;
		if (!domainId || !domains.some((d) => d.id === domainId)) {
			domainId = domains[0]?.id ?? null;
		}
		event.locals.domainId = domainId;
		event.locals.domain = domains.find((d) => d.id === domainId) ?? null;
	} else {
		event.locals.teams = [];
		event.locals.teamId = null;
		event.locals.team = null;
		event.locals.domains = [];
		event.locals.domainId = null;
		event.locals.domain = null;
	}

	return resolve(event);
};

export const handle = sequence(init, auth);

import { error } from '@sveltejs/kit';

export function requireTeamId(teamId: number | null): number {
	if (!teamId) {
		error(400, 'No team selected');
	}
	return teamId;
}

export function requireDomainId(domainId: number | null): number {
	if (!domainId) {
		error(400, 'No domain selected');
	}
	return domainId;
}

import { error } from '@sveltejs/kit';
import {
	exportDbParts,
	parsePartsList,
	partsNeedTeam
} from '$lib/server/service/db-parts-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) error(401, 'Unauthorized');
	if (!locals.user.isAdmin) error(403, 'Admin access required');

	const parts = parsePartsList(url.searchParams.get('parts'));
	if (parts.length === 0) error(400, 'Query param parts is required (e.g. parts=templates,design)');

	const teamRaw = url.searchParams.get('teamId');
	const teamId = teamRaw ? Number(teamRaw) : undefined;
	if (partsNeedTeam(parts) && (!teamId || !Number.isInteger(teamId))) {
		error(400, 'teamId is required for team-scoped parts');
	}

	try {
		const zip = await exportDbParts({ parts, teamId });
		const stamp = new Date().toISOString().slice(0, 10);
		const filename = `owlery-parts-${parts.join('-')}-${stamp}.zip`;
		return new Response(new Uint8Array(zip), {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Cache-Control': 'no-store'
			}
		});
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Export failed');
	}
};

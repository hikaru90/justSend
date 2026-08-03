import { error, json } from '@sveltejs/kit';
import { importDbParts, parsePartsList, partsNeedTeam } from '$lib/server/service/db-parts-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Unauthorized');
	if (!locals.user.isAdmin) error(403, 'Admin access required');

	const form = await request.formData();
	const parts = parsePartsList(String(form.get('parts') ?? ''));
	if (parts.length === 0) error(400, 'parts is required');

	const teamRaw = form.get('teamId');
	const teamId = teamRaw != null && String(teamRaw) !== '' ? Number(teamRaw) : undefined;
	if (partsNeedTeam(parts) && (!teamId || !Number.isInteger(teamId))) {
		error(400, 'teamId is required for team-scoped parts');
	}

	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'file is required');
	const zipBytes = Buffer.from(await file.arrayBuffer());
	if (zipBytes.byteLength === 0) error(400, 'Empty file');

	try {
		const summary = await importDbParts({ parts, teamId, zipBytes });
		return json(summary);
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Import failed');
	}
};

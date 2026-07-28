import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { requireTeamId } from '$lib/server/dashboard';
import { assetDiskPath, getAsset } from '$lib/server/service/design-system-service';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const teamId = requireTeamId(locals.teamId);
	const id = params.id;

	let asset;
	try {
		asset = getAsset(id, teamId);
	} catch {
		error(404, 'Asset not found');
	}

	const path = assetDiskPath(teamId, asset.kind, asset.id, asset.filename);
	try {
		await access(path);
	} catch {
		error(404, 'Asset file missing');
	}

	const nodeStream = createReadStream(path);
	const webStream = Readable.toWeb(nodeStream) as ReadableStream;

	return new Response(webStream, {
		headers: {
			'Content-Type': asset.mime,
			'Content-Length': String(asset.size),
			'Cache-Control': 'private, max-age=3600',
			'Content-Disposition': `inline; filename="${asset.filename.replace(/"/g, '')}"`
		}
	});
};

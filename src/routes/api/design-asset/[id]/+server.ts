import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { assetDiskPath, getAssetById } from '$lib/server/service/design-system-service';

/**
 * Public GET — email clients fetch images without a session cookie.
 * Asset ids are sha256 content hashes (same bytes → same id); do not list this directory.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = params.id;

	let asset;
	try {
		asset = getAssetById(id);
	} catch {
		error(404, 'Asset not found');
	}

	const path = assetDiskPath(asset.teamId, asset.kind, asset.id, asset.filename);
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
			'Cache-Control': 'public, max-age=86400',
			'Content-Disposition': `inline; filename="${asset.filename.replace(/"/g, '')}"`,
		},
	});
};

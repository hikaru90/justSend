import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { backupDatabaseTo, dbPath } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	if (!locals.user.isAdmin) error(403, 'Admin access required');
	if (dbPath === ':memory:') error(400, 'In-memory database cannot be downloaded');

	const dir = await mkdtemp(join(tmpdir(), 'owlery-db-'));
	const dest = join(dir, 'owlery.db');

	try {
		await backupDatabaseTo(dest);
	} catch (e) {
		await rm(dir, { recursive: true, force: true });
		error(500, e instanceof Error ? e.message : 'Database backup failed');
	}

	const filename = basename(dbPath) || 'owlery.db';
	const nodeStream = createReadStream(dest);
	const cleanup = () => {
		void rm(dir, { recursive: true, force: true });
	};
	nodeStream.on('close', cleanup);
	nodeStream.on('error', cleanup);

	return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
		headers: {
			'Content-Type': 'application/vnd.sqlite3',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-store'
		}
	});
};

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '../env';
import * as schema from './schema';

export function resolveDbPath(url: string) {
	if (url === ':memory:' || url.startsWith('file::memory:')) return ':memory:';
	const path = url.startsWith('file:') ? url.slice('file:'.length) : url;
	return resolve(process.cwd(), path);
}

export const dbPath = resolveDbPath(env.DATABASE_URL);
if (dbPath !== ':memory:') {
	mkdirSync(dirname(dbPath), { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('synchronous = NORMAL');

export const db = drizzle(sqlite, { schema });
export const rawDb = sqlite;
export type Db = typeof db;

/** Consistent on-disk snapshot (safe with WAL). Caller must delete `dest` when done. */
export async function backupDatabaseTo(dest: string) {
	if (dbPath === ':memory:') {
		throw new Error('Cannot backup in-memory database to a file');
	}
	await sqlite.backup(dest);
}

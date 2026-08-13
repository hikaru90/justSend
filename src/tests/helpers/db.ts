import { rawDb } from '$lib/server/db';

/** Truncate all application tables so each test starts clean. */
export function resetDb() {
	rawDb.pragma('foreign_keys = OFF');
	const tables = rawDb
		.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
		.all() as { name: string }[];

	for (const { name } of tables) {
		rawDb.exec(`DELETE FROM "${name}"`);
	}

	try {
		rawDb.exec('DELETE FROM sqlite_sequence');
	} catch {
		// sqlite_sequence may not exist yet
	}

	rawDb.pragma('foreign_keys = ON');
}

export { rawDb, db } from '$lib/server/db';
